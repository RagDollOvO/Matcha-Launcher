//! Native download operation identity and byte progress, independent of page navigation.
use super::{BrowserState, err, event, filename};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Manager, Webview};

fn total_bytes(value: i64) -> Option<u64> { (value > 0).then_some(value as u64) }

fn begin(view: &Webview, url: &str, destination: &mut PathBuf, received: u64, total: Option<u64>) -> Result<String, String> {
    let app = view.app_handle();
    let state = app.state::<BrowserState>();
    if let Some(error) = &state.load_error { return Err(error.clone()); }
    let mut rows = state.downloads.lock().unwrap();
    let started = Utc::now();
    let id = format!("{}-{}", started.timestamp_millis(), rows.len());
    let dir = super::storage::download_root(&state,false)?.join(&id);
    std::fs::create_dir(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let name = filename(destination);
    *destination = dir.join(&name);
    let page = state.pages.lock().unwrap().get(view.label()).cloned().unwrap_or(json!({}));
    let row = json!({"id":id,"name":name,"path":destination.to_string_lossy(),"url":url,
        "pageUrl":view.url().ok().map(|u|u.to_string()).unwrap_or_default(),"pageTitle":page["title"],
        "view":view.label(),"state":"downloading","startedAt":started.to_rfc3339_opts(SecondsFormat::Millis, true),
        "received":received,"total":total});
    rows.insert(0, row.clone());
    if let Err(e) = state.save(&rows) { rows.remove(0); return Err(e); }
    event(app, json!({"type":"download","download":row}));
    Ok(id)
}

/// Late byte callbacks never resurrect a terminal row. Only start/finish write
/// the history file; 200 ms progress is kept in memory for snapshots and events.
fn update(row: &mut Value, received: u64, total: Option<u64>, finished: Option<bool>) -> bool {
    if row["state"] != "downloading" { return false; }
    row["received"] = json!(received.max(row["received"].as_u64().unwrap_or(0)));
    if total.is_some() { row["total"] = json!(total); }
    if let Some(success) = finished {
        row["state"] = json!(if success { "done" } else { "failed" });
        row["finishedAt"] = json!(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
        if success {
            let size = row["path"].as_str().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(received);
            row["size"] = json!(size);
            row["received"] = json!(size);
            row["total"] = json!(size);
        }
    }
    true
}

/// Stamp an unfinished row once, when the next session discovers the interruption.
pub(super) fn recover(rows: &mut [Value]) -> bool {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut changed = false;
    for row in rows.iter_mut().filter(|r| r["state"] == "downloading") {
        row["state"] = json!("interrupted");
        row["finishedAt"] = json!(at);
        changed = true;
    }
    changed
}

fn publish(app: &tauri::AppHandle, id: &str, received: u64, total: Option<u64>, finished: Option<bool>) {
    let state = app.state::<BrowserState>();
    let mut rows = state.downloads.lock().unwrap();
    let Some(row) = rows.iter_mut().find(|r| r["id"] == id) else { return; };
    if !update(row, received, total, finished) { return; }
    let row = row.clone();
    if finished.is_some() {
        if let Err(e) = state.save(&rows) { event(app, json!({"type":"error","message":e})); }
    }
    event(app, json!({"type":"download","download":row}));
}

#[cfg(windows)]
pub async fn attach(view: &Webview) -> Result<(), String> {
    use std::{cell::Cell, rc::Rc, time::{Duration, Instant}};
    use windows::core::{HSTRING, Interface, PWSTR};
    use webview2_com::{BytesReceivedChangedEventHandler, CoTaskMemPWSTR, DownloadStartingEventHandler, StateChangedEventHandler,
        Microsoft::Web::WebView2::Win32::*};

    // Each operation supplies its own counts and completion state. In particular,
    // simultaneous downloads of the same URL must never be matched by URL.
    unsafe fn counts(op: &ICoreWebView2DownloadOperation) -> windows::core::Result<(u64, Option<u64>)> {
        let (mut bytes, mut total) = (0, 0);
        op.BytesReceived(&mut bytes)?;
        op.TotalBytesToReceive(&mut total)?;
        Ok((bytes.max(0) as u64, total_bytes(total)))
    }
    let source = view.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core: ICoreWebView2_4 = native.controller().CoreWebView2()?.cast()?;
            core.add_DownloadStarting(&DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()); };
                let app = source.app_handle();
                let op = args.DownloadOperation()?;
                let mut raw = PWSTR::null();
                op.Uri(&mut raw)?;
                let url = CoTaskMemPWSTR::from(raw).to_string();
                args.ResultFilePath(&mut raw)?;
                let mut destination = PathBuf::from(CoTaskMemPWSTR::from(raw).to_string());
                let (bytes, total) = counts(&op)?;
                let id = match begin(&source, &url, &mut destination, bytes, total) {
                    Ok(id) => id,
                    Err(message) => {
                        args.SetCancel(true)?;
                        event(app, json!({"type":"error","message":message}));
                        return Ok(());
                    }
                };
                let bytes_token = Rc::new(Cell::new(None));
                let state_token = Rc::new(Cell::new(None));
                let register = (|| -> windows::core::Result<()> {
                    args.SetResultFilePath(&HSTRING::from(dunce::simplified(&destination)))?;
                    args.SetHandled(true)?;
                    let a = app.clone(); let key = id.clone(); let mut last = Instant::now();
                    let mut token = 0;
                    op.add_BytesReceivedChanged(&BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                        let Some(operation) = operation else { return Ok(()); };
                        if last.elapsed() >= Duration::from_millis(200) {
                            let (received, total) = counts(&operation)?;
                            last = Instant::now();
                            publish(&a, &key, received, total, None);
                        }
                        Ok(())
                    })), &mut token)?;
                    bytes_token.set(Some(token));
                    let b = bytes_token.clone(); let s = state_token.clone();
                    let a = app.clone(); let key = id.clone();
                    op.add_StateChanged(&StateChangedEventHandler::create(Box::new(move |operation, _| {
                        let Some(operation) = operation else { return Ok(()); };
                        let mut status = COREWEBVIEW2_DOWNLOAD_STATE::default();
                        operation.State(&mut status)?;
                        if status == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS { return Ok(()); }
                        let (received, total) = counts(&operation).unwrap_or((0, None));
                        // Always flush final bytes, even inside the 200 ms throttle.
                        publish(&a, &key, received, total, Some(status == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED));
                        if let Some(token) = b.take() { let _ = operation.remove_BytesReceivedChanged(token); }
                        if let Some(token) = s.take() { let _ = operation.remove_StateChanged(token); }
                        Ok(())
                    })), &mut token)?;
                    state_token.set(Some(token));
                    Ok(())
                })();
                if let Err(e) = register {
                    if let Some(token) = bytes_token.take() { let _ = op.remove_BytesReceivedChanged(token); }
                    if let Some(token) = state_token.take() { let _ = op.remove_StateChanged(token); }
                    args.SetCancel(true)?;
                    publish(app, &id, bytes, total, Some(false));
                    event(app, json!({"type":"error","message":format!("建立下载进度失败：{e}")}));
                }
                Ok(())
            })), &mut 0)?;
            Ok(())
        })();
        let _ = tx.send(result.map_err(err));
    }).map_err(err)?;
    rx.await.map_err(err)?
}

#[cfg(not(windows))]
pub fn fallback(view: Webview, e: tauri::webview::DownloadEvent<'_>) -> bool {
    use tauri::webview::DownloadEvent;
    let app = view.app_handle();
    match e {
        DownloadEvent::Requested { url, destination } => {
            if let Err(message) = begin(&view, url.as_str(), destination, 0, None) {
                event(app, json!({"type":"error","message":message})); return false;
            }
        }
        DownloadEvent::Finished { url, path, success } => {
            let id = app.state::<BrowserState>().downloads.lock().unwrap().iter().find(|d| {
                d["state"] == "downloading" && d["view"] == view.label() && match path.as_ref() {
                    Some(p) => d["path"].as_str() == Some(p.to_string_lossy().as_ref()),
                    None => d["url"].as_str() == Some(url.as_str()),
                }
            }).and_then(|d| d["id"].as_str().map(str::to_owned));
            if let Some(id) = id { publish(app, &id, 0, None, Some(success)); }
        }
        _ => {}
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_length_progress_and_final_flush() {
        assert_eq!(total_bytes(-1), None);
        assert_eq!(total_bytes(0), None);
        assert_eq!(total_bytes(2048), Some(2048));
        let mut row = json!({"state":"downloading","received":0,"total":null});
        assert!(update(&mut row, 1024, None, None));
        assert!(row["total"].is_null());
        assert!(update(&mut row, 1023, Some(2048), None));
        assert_eq!(row["received"], 1024);
        assert!(row.get("finishedAt").is_none());
        assert!(update(&mut row, 2048, Some(2048), Some(true)));
        assert_eq!(row["received"], row["size"]);
        assert_eq!(row["received"], row["total"]);
        assert_eq!(row["state"], "done");
        let finished = row["finishedAt"].clone();
        assert!(chrono::DateTime::parse_from_rfc3339(finished.as_str().unwrap()).is_ok());
        assert!(!update(&mut row, 1, None, None));
        assert_eq!(row["finishedAt"], finished);
        assert_eq!(row["received"], 2048);
    }
    #[test]
    fn failed_transfer_keeps_partial_bytes() {
        let mut row = json!({"state":"downloading","received":1024,"total":4096});
        assert!(update(&mut row, 1536, None, Some(false)));
        assert_eq!(row["state"], "failed");
        assert!(chrono::DateTime::parse_from_rfc3339(row["finishedAt"].as_str().unwrap()).is_ok());
        assert_eq!(row["received"], 1536);
        assert_eq!(row["total"], 4096);
        assert!(!update(&mut row, 4096, Some(4096), Some(true)));
        assert_eq!(row["state"], "failed");
    }
    #[test]
    fn recovery_dates_only_the_newly_interrupted_rows() {
        let mut rows = [json!({"state":"done"}), json!({"state":"downloading","startedAt":"2026-11-01T00:00:00.000Z"})];
        assert!(recover(&mut rows));
        assert!(rows[0].get("finishedAt").is_none());
        assert_eq!(rows[1]["state"], "interrupted");
        let finished = rows[1]["finishedAt"].clone();
        assert!(chrono::DateTime::parse_from_rfc3339(finished.as_str().unwrap()).is_ok());
        assert!(!recover(&mut rows)); assert_eq!(rows[1]["finishedAt"], finished);
    }
}
