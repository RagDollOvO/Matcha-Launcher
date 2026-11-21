//! WebView2 download objects and their event handlers live on the UI thread.
use super::{begin, err, event, filename, pending, publish, BrowserState, Progress, Status};
use serde_json::{json, Value};
use std::{cell::{Cell, RefCell}, collections::HashMap, path::PathBuf, rc::Rc, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, Webview};
use webview2_com::{BytesReceivedChangedEventHandler, CoTaskMemPWSTR, DownloadStartingEventHandler, StateChangedEventHandler,
    Microsoft::Web::WebView2::Win32::*};
use windows::core::{BOOL, HSTRING, Interface, PWSTR};

struct ActiveDownload {
    operation: ICoreWebView2DownloadOperation,
    listening: Rc<Cell<bool>>,
    bytes_token: i64,
    state_token: i64,
}
thread_local! {
    // New transfers of the same URL have distinct IDs. WebView2 may replace the
    // object during a Range retry. Keep its previous subscriptions alive until
    // the transfer ends: removing them mid-retry also silences the new object's events.
    static ACTIVE: RefCell<HashMap<String, Vec<ActiveDownload>>> = RefCell::default();
}

fn total_bytes(value: i64) -> Option<u64> { (value > 0).then_some(value as u64) }

unsafe fn counts(op: &ICoreWebView2DownloadOperation) -> windows::core::Result<Progress> {
    let (mut bytes, mut total) = (0, 0);
    op.BytesReceived(&mut bytes)?;
    op.TotalBytesToReceive(&mut total)?;
    Ok((bytes.max(0) as u64, total_bytes(total)))
}

unsafe fn status(op: &ICoreWebView2DownloadOperation) -> windows::core::Result<Status> {
    let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
    op.State(&mut state)?;
    Ok(match state {
        COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS => Status::Downloading,
        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => Status::Done,
        COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED => {
            let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
            op.InterruptReason(&mut reason)?;
            let mut can_resume = BOOL::default();
            op.CanResume(&mut can_resume)?;
            let can_resume = can_resume.as_bool();
            match reason {
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED => Status::Paused { can_resume },
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED => Status::Canceled,
                // WebView2 can retry these three interruptions itself, even from byte zero.
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_SERVER_NO_RANGE | COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_HASH_MISMATCH |
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_FILE_TOO_SHORT => Status::Waiting { can_resume },
                _ if can_resume => Status::Waiting { can_resume },
                _ => Status::Failed,
            }
        }
        _ => Status::Failed,
    })
}

unsafe fn refresh(app: &AppHandle, id: &str, op: &ICoreWebView2DownloadOperation) -> windows::core::Result<()> {
    // Read the latest native state and flush bytes outside the 200 ms throttle.
    if publish(app, id, counts(op).ok(), Some(status(op)?)) {
        detach(id);
    }
    Ok(())
}

unsafe fn detach(id: &str) {
    let active = ACTIVE.with(|all| all.borrow_mut().remove(id));
    if let Some(handlers) = active {
        for h in handlers {
            h.listening.set(false);
            let _ = h.operation.remove_BytesReceivedChanged(h.bytes_token);
            let _ = h.operation.remove_StateChanged(h.state_token);
        }
    }
}

// A native Range retry can fire DownloadStarting again, with a new COM object and
// the original *suggested* filename. The old object then stops receiving events.
// Bind the new object only to a unique matching live byte offset; starts at zero
// always get a separate destination, even for the same URL.
unsafe fn continued(view: &Webview, url: &str, name: &str, progress: Progress) -> Option<(String, PathBuf)> {
    if progress.0 == 0 { return None; }
    let state = view.app_handle().state::<BrowserState>();
    let rows = state.downloads.lock().unwrap().iter()
        .filter(|r| pending(r) && r["view"] == view.label() && r["url"] == url && r["name"] == name)
        .filter_map(|r| Some((r["id"].as_str()?.to_owned(), PathBuf::from(r["path"].as_str()?))))
        .collect::<Vec<_>>();
    let mut matched = rows.into_iter().filter(|(id, _)| {
        let op = ACTIVE.with(|all| all.borrow().get(id)?.last().map(|d| d.operation.clone()));
        op.is_some_and(|op| counts(&op).ok() == Some(progress) &&
            matches!(status(&op), Ok(Status::Downloading | Status::Waiting { .. })))
    });
    let found = matched.next()?;
    matched.next().is_none().then_some(found)
}

pub(in crate::browser) async fn control(app: &AppHandle, action: String, id: String) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| unsafe {
            // Release the registry borrow before invoking COM, which may dispatch another event.
            let (op, listening) = ACTIVE.with(|all| all.borrow().get(&id)?.last().map(|d| (d.operation.clone(), d.listening.clone())))
                .ok_or("这条网页下载已结束或已中断。")?;
            let current = status(&op).map_err(err)?;
            match (action.as_str(), current) {
                ("download-pause", Status::Downloading) => op.Pause().map_err(err)?,
                ("download-resume", s) if s.can_resume() == Some(true) => op.Resume().map_err(err)?,
                ("download-resume", s) if s.can_resume() == Some(false) => return Err("请回到原网页重新下载。".into()),
                ("download-cancel", Status::Downloading | Status::Paused { .. } | Status::Waiting { .. }) => op.Cancel().map_err(err)?,
                _ => return Err("下载状态已变化，请查看当前操作。".into()),
            }
            // Canceling a paused download may keep the enum at INTERRUPTED and change its reason.
            if listening.get() { refresh(&handle, &id, &op).map_err(err)?; }
            Ok(json!({}))
        })();
        let _ = tx.send(result);
    }).map_err(err)?;
    rx.await.map_err(err)?
}

unsafe fn register(app: &AppHandle, id: &str, op: ICoreWebView2DownloadOperation) -> windows::core::Result<()> {
    let (mut bytes_token, mut state_token) = (0, 0);
    let listening = Rc::new(Cell::new(true));
    let bytes_live = listening.clone(); let state_live = listening.clone();
    let a = app.clone(); let key = id.to_owned(); let mut last = Instant::now();
    op.add_BytesReceivedChanged(&BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
        let Some(operation) = operation else { return Ok(()); };
        if bytes_live.get() && last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            publish(&a, &key, Some(counts(&operation)?), None);
        }
        Ok(())
    })), &mut bytes_token)?;
    let a = app.clone(); let key = id.to_owned();
    if let Err(e) = op.add_StateChanged(&StateChangedEventHandler::create(Box::new(move |operation, _| {
        if state_live.get() {
            if let Some(operation) = operation { refresh(&a, &key, &operation)?; }
        }
        Ok(())
    })), &mut state_token) {
        let _ = op.remove_BytesReceivedChanged(bytes_token);
        return Err(e);
    }
    ACTIVE.with(|all| {
        let mut all = all.borrow_mut();
        let handlers = all.entry(id.to_owned()).or_default();
        if let Some(prior) = handlers.last() { prior.listening.set(false); }
        handlers.push(ActiveDownload { operation: op, listening, bytes_token, state_token });
    });
    Ok(())
}

pub(in crate::browser) async fn attach(view: &Webview) -> Result<(), String> {
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
                let (id, resumed) = if let Some((id, path)) = continued(&source, &url, &filename(&destination), (bytes, total)) {
                    destination = path;
                    (id, true)
                } else {
                    match begin(&source, &url, &mut destination, bytes, total) {
                        Ok(id) => (id, false),
                        Err(message) => {
                            args.SetCancel(true)?;
                            event(app, json!({"type":"error","message":message}));
                            return Ok(());
                        }
                    }
                };
                let result = (|| -> windows::core::Result<()> {
                    args.SetResultFilePath(&HSTRING::from(dunce::simplified(&destination)))?;
                    args.SetHandled(true)?;
                    register(app, &id, op.clone())?;
                    if resumed { refresh(app, &id, &op)?; }
                    Ok(())
                })();
                if let Err(e) = result {
                    detach(&id);
                    args.SetCancel(true)?;
                    publish(app, &id, None, Some(Status::Failed));
                    event(app, json!({"type":"error","message":format!("建立网页下载失败：{e}")}));
                }
                Ok(())
            })), &mut 0)?;
            Ok(())
        })();
        let _ = tx.send(result.map_err(err));
    }).map_err(err)?;
    rx.await.map_err(err)?
}

#[cfg(test)]
#[test]
fn unknown_native_total() {
    assert_eq!(total_bytes(-1), None);
    assert_eq!(total_bytes(0), None);
    assert_eq!(total_bytes(2048), Some(2048));
}
