//! Download records and lifecycle, independent of page navigation.
use super::{BrowserState, err, event, filename};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Manager, Webview};

#[cfg(windows)]
mod native;
#[cfg(windows)]
pub(super) use native::{attach, control};

type Progress = (u64, Option<u64>);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Downloading,
    Paused { can_resume: bool },
    Waiting { can_resume: bool },
    Done,
    Failed,
    Canceled,
}
impl Status {
    fn name(self) -> &'static str {
        match self {
            Self::Downloading => "downloading",
            Self::Paused { .. } => "paused",
            Self::Waiting { .. } => "waiting",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
    fn can_resume(self) -> Option<bool> {
        match self { Self::Paused { can_resume } | Self::Waiting { can_resume } => Some(can_resume), _ => None }
    }
}

pub(super) fn pending(row: &Value) -> bool {
    matches!(row["state"].as_str(), Some("downloading" | "paused" | "waiting"))
}

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
        "view":view.label(),"state":"downloading","controllable":cfg!(windows),"startedAt":started.to_rfc3339_opts(SecondsFormat::Millis, true),
        "received":received,"total":total});
    rows.insert(0, row.clone());
    if let Err(e) = state.save(&rows) { rows.remove(0); return Err(e); }
    event(app, json!({"type":"download","download":row}));
    Ok(id)
}

/// Late byte events leave paused and terminal rows alone. WebView2 may restart
/// a transfer on resume, so the current count may be lower than the last one.
fn update(row: &mut Value, progress: Option<Progress>, status: Option<Status>) -> bool {
    if !pending(row) || (status.is_none() && row["state"] != "downloading") { return false; }
    if let Some((received, total)) = progress {
        row["received"] = json!(received);
        row["total"] = json!(total);
    }
    if let Some(status) = status {
        row["state"] = json!(status.name());
        if let Some(can_resume) = status.can_resume() { row["canResume"] = json!(can_resume); }
        else if let Some(fields) = row.as_object_mut() { fields.remove("canResume"); }
        if !pending(row) {
            row["finishedAt"] = json!(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
            row["controllable"] = json!(false);
            if status == Status::Done {
                let size = row["path"].as_str().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len())
                    .unwrap_or_else(|| row["received"].as_u64().unwrap_or(0));
                row["size"] = json!(size);
                row["received"] = json!(size);
                row["total"] = json!(size);
            }
        }
    }
    true
}

/// Stamp an unfinished row once, when the next session discovers the interruption.
pub(super) fn recover(rows: &mut [Value]) -> bool {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut changed = false;
    for row in rows.iter_mut().filter(|r| pending(r)) {
        row["state"] = json!("interrupted");
        row["controllable"] = json!(false);
        if let Some(fields) = row.as_object_mut() { fields.remove("canResume"); }
        row["finishedAt"] = json!(at);
        changed = true;
    }
    changed
}

fn publish(app: &tauri::AppHandle, id: &str, progress: Option<Progress>, status: Option<Status>) -> bool {
    let state = app.state::<BrowserState>();
    let mut rows = state.downloads.lock().unwrap();
    let Some(row) = rows.iter_mut().find(|r| r["id"] == id) else { return false; };
    let changed = status.is_some_and(|s| row["state"] != s.name() || row["canResume"].as_bool() != s.can_resume());
    if !update(row, progress, status) { return false; }
    let ended = !pending(row);
    let row = row.clone();
    if changed {
        if let Err(e) = state.save(&rows) { event(app, json!({"type":"error","message":e})); }
    }
    event(app, json!({"type":"download","download":row}));
    ended
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
            if let Some(id) = id { publish(app, &id, None, Some(if success { Status::Done } else { Status::Failed })); }
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
        let mut row = json!({"state":"downloading","received":0,"total":null});
        assert!(update(&mut row, Some((1024, None)), None));
        assert!(row["total"].is_null());
        assert!(update(&mut row, Some((1024, Some(2048))), None));
        assert!(row.get("finishedAt").is_none());
        assert!(update(&mut row, Some((2048, Some(2048))), Some(Status::Done)));
        assert_eq!(row["received"], row["size"]);
        assert_eq!(row["received"], row["total"]);
        assert_eq!(row["state"], "done");
        let finished = row["finishedAt"].clone();
        assert!(chrono::DateTime::parse_from_rfc3339(finished.as_str().unwrap()).is_ok());
        assert!(!update(&mut row, Some((1, None)), None));
        assert_eq!(row["finishedAt"], finished);
        assert_eq!(row["received"], 2048);
    }
    #[test]
    fn failed_transfer_keeps_partial_bytes() {
        let mut row = json!({"state":"downloading","received":1024,"total":4096});
        assert!(update(&mut row, Some((1536, Some(4096))), Some(Status::Failed)));
        assert_eq!(row["state"], "failed");
        assert!(chrono::DateTime::parse_from_rfc3339(row["finishedAt"].as_str().unwrap()).is_ok());
        assert_eq!(row["received"], 1536);
        assert_eq!(row["total"], 4096);
        assert!(!update(&mut row, Some((4096, Some(4096))), Some(Status::Done)));
        assert_eq!(row["state"], "failed");
    }
    #[test]
    fn pause_resume_restart_and_cancel_follow_the_native_operation() {
        let mut row = json!({"state":"downloading","controllable":true,"received":1024,"total":4096});
        assert!(update(&mut row, Some((1536, Some(4096))), Some(Status::Paused { can_resume: true })));
        assert!(pending(&row));
        assert_eq!(row["canResume"], true);
        assert!(row.get("finishedAt").is_none());
        assert!(!update(&mut row, Some((2048, Some(4096))), None));
        assert_eq!(row["received"], 1536);
        assert!(update(&mut row, Some((0, None)), Some(Status::Downloading)));
        assert_eq!(row["received"], 0);
        assert!(row["total"].is_null());
        assert!(row.get("canResume").is_none());
        assert!(update(&mut row, None, Some(Status::Waiting { can_resume: false })));
        assert!(pending(&row));
        assert!(update(&mut row, None, Some(Status::Downloading)));
        assert!(update(&mut row, None, Some(Status::Canceled)));
        assert_eq!(row["state"], "canceled");
        assert_eq!(row["controllable"], false);
        assert!(!update(&mut row, None, Some(Status::Downloading)));
    }
    #[test]
    fn recovery_dates_only_the_newly_interrupted_rows() {
        let mut rows = [json!({"state":"done"}), json!({"state":"downloading","startedAt":"2026-11-01T00:00:00.000Z"}),
            json!({"state":"paused","controllable":true,"canResume":true,"received":1024})];
        assert!(recover(&mut rows));
        assert!(rows[0].get("finishedAt").is_none());
        assert_eq!(rows[1]["state"], "interrupted");
        assert_eq!(rows[2]["state"], "interrupted");
        assert_eq!(rows[2]["received"], 1024);
        assert!(rows[2].get("canResume").is_none());
        assert_eq!(rows[2]["controllable"], false);
        let finished = rows[1]["finishedAt"].clone();
        assert!(chrono::DateTime::parse_from_rfc3339(finished.as_str().unwrap()).is_ok());
        assert!(!recover(&mut rows)); assert_eq!(rows[1]["finishedAt"], finished);
    }
}
