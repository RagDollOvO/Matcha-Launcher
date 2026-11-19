use super::err;
use serde_json::{json, Value};
use std::{sync::{Arc, atomic::{AtomicU8, Ordering}}, time::Duration};
use tauri::{Manager, Webview, WebviewUrl, webview::{NewWindowResponse, WebviewBuilder}};

static BUSY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
struct Hidden(Webview);
impl Drop for Hidden {
    fn drop(&mut self) { let _ = self.0.close(); }
}
async fn read(view: &Webview, script: &str) -> Result<Value, String> {
    let (send, recv) = tokio::sync::oneshot::channel();
    let send = std::sync::Mutex::new(Some(send));
    view.eval_with_callback(script, move |s| {
        if let Some(tx) = send.lock().unwrap().take() { let _ = tx.send(s); }
    }).map_err(err)?;
    serde_json::from_str(&recv.await.map_err(err)?).map_err(err)
}

async fn like(app: &tauri::AppHandle, bvid: &str) -> Result<Value, String> {
    let path = format!("/video/{bvid}");
    let target = tauri::Url::parse(&format!("https://www.bilibili.com{path}/")).map_err(err)?;
    let redirected = Arc::new(AtomicU8::new(0));
    let nav = redirected.clone();
    let builder = WebviewBuilder::new("matcha-bili-like", WebviewUrl::External(tauri::Url::parse("about:blank").unwrap()))
        .data_directory(super::storage::profile(app,0)?)
        .focused(false).disable_drag_drop_handler()
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_navigation(move |url| {
            if url.as_str() == "about:blank" { return true; }
            let secure = url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none();
            if secure && url.host_str() == Some("www.bilibili.com") && url.path().trim_end_matches('/') == path { return true; }
            nav.store(if secure && url.host_str() == Some("passport.bilibili.com") { 1 } else { 2 }, Ordering::Relaxed);
            false
        });
    let win = app.get_window("main").ok_or("主窗口已关闭")?;
    let hidden = Hidden(win.add_child(builder, tauri::LogicalPosition::new(-32., -32.), tauri::LogicalSize::new(1., 1.)).map_err(err)?);
    let view = &hidden.0;
    view.hide().map_err(err)?;
    view.navigate(target).map_err(err)?;
    let ready = format!("location.origin === 'https://www.bilibili.com' && location.pathname.replace(/\\/$/,'') === '/video/{bvid}' && document.readyState !== 'loading'");
    let mut started = false;
    loop {
        match redirected.load(Ordering::Relaxed) {
            1 => return Ok(json!({"status":"login"})),
            2 => return Err("视频页发生跳转".into()),
            _ => (),
        }
        if !started {
            if read(view, &ready).await? == true {
                // Do not dispatch a second write if the video page reloads or a response is lost.
                view.eval(format!("void ({}('{}'))", include_str!("bili-like.js").trim(), bvid)).map_err(err)?;
                started = true;
            }
        } else {
            let r = read(view, "(() => { const r = window.__matchaBiliLikeResult; if (!r) return null; return {status: String(r.status).slice(0,8), message: typeof r.message === 'string' ? r.message.slice(0,120) : ''}; })()").await?;
            match r["status"].as_str() {
                Some(s @ ("login" | "already" | "voted")) => return Ok(json!({"status":s})),
                Some("failed") => return Ok(r),
                Some(_) => return Err("B站未确认点赞结果".into()),
                None => (),
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}
pub(super) async fn run(app: &tauri::AppHandle, bvid: &str) -> Value {
    let failed = |s: &str| json!({"status":"failed", "message":s});
    if bvid.len() != 12 || !bvid.starts_with("BV") || !bvid.bytes().skip(2).all(|c| c.is_ascii_alphanumeric()) { return failed("视频 BV 号无效"); }
    let Ok(_guard) = BUSY.try_lock() else { return failed("已有点赞请求正在处理"); };
    match tokio::time::timeout(Duration::from_secs(15), like(app, bvid)).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => failed(&e),
        Err(_) => failed("等待 B站回应超时"),
    }
}
