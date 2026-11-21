//! Tauri follows WebView2's HTML fullscreen event on the parent window. A tab
//! can be closed or hidden before the page sends the matching exit event.
use super::{err, BrowserState};
use tauri::{AppHandle, Manager, Webview};

#[cfg(windows)]
pub(super) async fn attach(view: &Webview) -> Result<(), String> {
    use webview2_com::ContainsFullScreenElementChangedEventHandler;
    use windows::core::BOOL;

    let app = view.app_handle().clone();
    let name = view.label().to_owned();
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = native.controller().CoreWebView2().and_then(|core| {
            core.add_ContainsFullScreenElementChanged(
                &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                    let Some(core) = sender else { return Ok(()); };
                    let mut full = BOOL::default();
                    core.ContainsFullScreenElement(&mut full)?;
                    let state = app.state::<BrowserState>();
                    let mut owner = state.fullscreen_owner.lock().unwrap();
                    if full.as_bool() { *owner = Some(name.clone()); }
                    else if owner.as_deref() == Some(&name) { *owner = None; }
                    Ok(())
                })), &mut 0,
            )
        });
        let _ = tx.send(result.map_err(err));
    }).map_err(err)?;
    rx.await.map_err(err)?
}

pub(super) fn leave(view: &Webview, keep_page: bool) -> Result<(), String> {
    let state = view.app_handle().state::<BrowserState>();
    if state.fullscreen_owner.lock().unwrap().as_deref() != Some(view.label()) { return Ok(()); }
    // Let the window runtime restore its saved placement (including ordinary maximization).
    // Do not hold the owner lock across window operations on the UI thread.
    view.window().set_fullscreen(false).map_err(err)?;
    if keep_page {
        view.eval("if (document.fullscreenElement) document.exitFullscreen().catch(() => {});").map_err(err)?;
    }
    let mut owner = state.fullscreen_owner.lock().unwrap();
    if owner.as_deref() == Some(view.label()) { *owner = None; }
    Ok(())
}

pub(super) fn exit_main(app: &AppHandle) -> Result<(), String> {
    let owner = app.state::<BrowserState>().fullscreen_owner.lock().unwrap().clone();
    if let Some(view) = owner.and_then(|name| app.get_webview(&name)) { return leave(&view, true); }
    app.get_window("main").ok_or("主窗口已关闭。")?.set_fullscreen(false).map_err(err)
}
