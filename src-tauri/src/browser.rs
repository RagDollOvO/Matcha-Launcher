//! Native carrier for the DSH Browser tab model. Remote pages have no Matcha ACL.
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::{Mutex, atomic::Ordering}};
use tauri::{Emitter, Manager, Webview, WebviewUrl, webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder}};
pub mod storage;
mod downloads;
mod images;
mod fullscreen;
mod bili_like;
mod creators;

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    if app.config().identifier == crate::BETA_ID { return app.path().app_local_data_dir(); }
    // Also used by isolated desktop fixtures and portable data directories.
    Ok(std::env::var_os("BEACON_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_local_data_dir()?))
}
pub fn require_shell(view: &Webview) -> Result<(), String> {
    if view.label() == "main" { Ok(()) } else { Err("此操作由 Matcha 主界面发起。".into()) }
}
pub struct BrowserState {
    downloads: Mutex<Vec<Value>>,
    pages: Mutex<HashMap<String, Value>>,
    steam_views: Mutex<HashSet<String>>,
    fullscreen_owner: Mutex<Option<String>>,
    folder: PathBuf,
    routes: Mutex<storage::Routes>,
    load_error: Option<String>,
}
impl BrowserState {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let folder = data_dir(app)?.join("browser");
        std::fs::create_dir_all(&folder)?;
        let file = folder.join("downloads.json");
        let (mut downloads, load_error): (Vec<Value>, Option<String>) = if file.exists() {
            match std::fs::read(&file).map_err(err).and_then(|raw|serde_json::from_slice::<Vec<Value>>(&raw).map_err(err)) {
                Ok(rows) => (rows, None),
                Err(e) => (vec![], Some(format!("下载记录读取失败，原文件已保留：{}（{e}）", file.display()))),
            }
        } else { (vec![], None) };
        let recovered = downloads::recover(&mut downloads);
        let mut state = Self { downloads: Mutex::new(downloads), pages: Mutex::new(HashMap::new()), steam_views: Mutex::new(HashSet::new()), fullscreen_owner: Mutex::default(), folder, load_error,routes:Mutex::default() };
        if recovered {
            let result = state.save(&state.downloads.lock().unwrap());
            if let Err(e) = result { state.load_error = Some(format!("下载中断记录保存失败：{e}")); }
        }
        Ok(state)
    }
    fn save(&self, rows: &[Value]) -> Result<(), String> {
        let temp = self.folder.join("downloads.json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(rows).map_err(err)?).map_err(err)?;
        std::fs::rename(temp, self.folder.join("downloads.json")).map_err(err)
    }
    fn has_downloads(&self, view: &str) -> bool {
        self.downloads.lock().unwrap().iter().any(|d| d["view"] == view && downloads::pending(d))
    }
}
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
fn event(app: &tauri::AppHandle, v: Value) { let _ = app.emit_to("main", "browser-event", v); }
fn http(raw: &str) -> Result<tauri::Url, String> {
    let u = tauri::Url::parse(raw).map_err(err)?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() || !u.username().is_empty() || u.password().is_some() {
        return Err("请输入 HTTP 或 HTTPS 网页地址。".into());
    }
    // Reserve app/custom IPC origins even when a webpage navigates itself.
    if matches!(u.host_str(), Some("tauri.localhost" | "ipc.localhost" | "asset.localhost")) {
        return Err("此地址保留给 Matcha 主界面。".into());
    }
    Ok(u)
}
fn steam_page(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.host_str().is_some_and(|h|
        ["steamcommunity.com", "steampowered.com"].iter().any(|domain| h == *domain || h.strip_suffix(domain).is_some_and(|prefix| prefix.ends_with('.'))))
}
fn steam_route(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    steam_page(url) && app.state::<crate::BridgeState>().bridge.as_ref()
        .is_some_and(|b| b.community_active.load(Ordering::Relaxed))
}
fn label(id: &str) -> Result<String, String> {
    if !id.starts_with("tab-") || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("标签页标识无效。".into());
    }
    Ok(format!("browser-{id}"))
}
fn filename(path: &std::path::Path) -> String {
    let raw = path.file_name().unwrap_or_default().to_string_lossy();
    let name: String = raw.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)).take(160).collect();
    let name = name.trim_matches([' ', '.']);
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || stem.starts_with("COM") || stem.starts_with("LPT") {
        format!("download-{name}")
    } else { name.into() }
}
async fn create(app: &tauri::AppHandle, id: &str, url: &str) -> Result<Webview, String> {
    let name = label(id)?;
    let a = app.clone(); let nav_id = id.to_string();
    let a2 = app.clone(); let popup_id = id.to_string();
    let url = http(url)?;
    let direct = steam_route(app, &url);
    let profile = storage::profile(app,if direct {1}else{0})?;
    // Register download operation handlers before a page can initiate a download.
    let mut builder = WebviewBuilder::new(&name, WebviewUrl::External(tauri::Url::parse("about:blank").unwrap()))
        .data_directory(profile).disable_drag_drop_handler()
        .on_navigation(move |url| {
            if url.as_str() == "about:blank" { return true; }
            if http(url.as_str()).is_ok() {
                if direct && !steam_page(url) {
                    // Move links outside Steam to a regular tab with its existing profile.
                    event(&a, json!({"type":"open","url":url.as_str()})); false
                } else { true }
            }
            else {
                event(&a, json!({"type":"error","id":nav_id,"message":"此链接需要在系统浏览器中处理，可点击右上角打开。"})); false
            }
        })
        .on_new_window(move |url, _| {
            if http(url.as_str()).is_ok() { event(&a2, json!({"type":"open","from":popup_id,"url":url.as_str()})); }
            else { event(&a2, json!({"type":"error","message":"请在系统浏览器中继续此页面的外部应用操作。"})); }
            NewWindowResponse::Deny
        })
        .on_page_load(|view, payload| {
            let id = view.label().strip_prefix("browser-").unwrap_or("");
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let state = view.app_handle().state::<BrowserState>();
            state.pages.lock().unwrap().entry(view.label().into()).or_insert(json!({}))["url"] = json!(payload.url().as_str());
            event(view.app_handle(), json!({"type":"page","id":id,"url":payload.url().as_str(),"loading":loading}));
        })
        .on_document_title_changed(|view, title| {
            view.app_handle().state::<BrowserState>().pages.lock().unwrap().entry(view.label().into()).or_insert(json!({}))["title"] = json!(title);
            event(view.app_handle(), json!({"type":"title","id":view.label().strip_prefix("browser-").unwrap_or(""),"title":title}));
        });
    #[cfg(not(windows))]
    { builder = builder.on_download(downloads::fallback); }
    if direct { builder = builder.additional_browser_args("--no-proxy-server"); }
    let win = app.get_window("main").ok_or("主窗口已关闭。")?;
    let view = win.add_child(builder, tauri::LogicalPosition::new(0., 120.), tauri::LogicalSize::new(400., 400.)).map_err(err)?;
    if let Err(e) = async {
        view.hide().map_err(err)?;
        #[cfg(windows)]
        {
            fullscreen::attach(&view).await?;
            downloads::attach(&view).await?;
            if direct { images::attach(&view).await?; }
        }
        view.navigate(url).map_err(err)
    }.await { let _ = view.close(); return Err(e); }
    let state = app.state::<BrowserState>();
    let mut steam = state.steam_views.lock().unwrap();
    if direct { steam.insert(name); } else { steam.remove(&name); }
    Ok(view)
}

async fn navigate(app: &tauri::AppHandle, id: &str, view: Webview, url: tauri::Url, reload: bool) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let direct = state.steam_views.lock().unwrap().contains(view.label());
    if direct != steam_route(app, &url) && !state.has_downloads(view.label()) {
        let bounds = view.bounds().map_err(err)?;
        fullscreen::leave(&view, false)?;
        view.close().map_err(err)?;
        let new_view = create(app, id, url.as_str()).await?;
        new_view.set_bounds(bounds).map_err(err)?;
        new_view.show().map_err(err)
    } else if reload { view.reload().map_err(err) }
    else { view.navigate(url).map_err(err) }
}

fn hide_tab(view: &Webview) -> Result<(), String> {
    fullscreen::leave(view, true)?;
    view.hide().map_err(err)
}

fn close_tab(view: &Webview) -> Result<(), String> {
    let state = view.app_handle().state::<BrowserState>();
    let name = view.label();
    // Keep the native operation (including paused ones) when the user leaves its tab.
    if state.has_downloads(name) { return hide_tab(view); }
    fullscreen::leave(view, false)?;
    view.close().map_err(err)?;
    state.pages.lock().unwrap().remove(name);
    state.steam_views.lock().unwrap().remove(name);
    Ok(())
}

/// Always async: WebView2 creation must not block its UI event thread.
#[tauri::command]
pub async fn browser_call(webview: Webview, app: tauri::AppHandle, action: String, params: Option<Value>) -> Result<Value, String> {
    require_shell(&webview)?;
    let p = params.unwrap_or(json!({}));
    let id = p["id"].as_str().unwrap_or("");
    match action.as_str() {
        "exit-fullscreen" => { fullscreen::exit_main(&app)?; Ok(json!({})) }
        "bili-like" => Ok(bili_like::run(&app, p["bvid"].as_str().unwrap_or("")).await),
        "annotate" => creators::annotate(&app.state::<BrowserState>(), id, &p["creators"]),
        "downloads" => {
            let state = app.state::<BrowserState>();
            if let Some(error) = &state.load_error { return Err(error.clone()); }
            let downloads = state.downloads.lock().unwrap().clone();
            Ok(json!(downloads))
        }
        #[cfg(windows)]
        "download-pause" | "download-resume" | "download-cancel" => {
            downloads::control(&app, action, id.to_owned()).await
        }
        "sync" => {
            let tabs = p["tabs"].as_array().ok_or("标签页列表无效。")?;
            if tabs.len() > 10 { return Err("最多打开 10 个标签页。".into()); }
            let mut names = Vec::new();
            for t in tabs {
                let name = label(t["id"].as_str().unwrap_or(""))?;
                if t["url"] != "start" { names.push(name); }
            }
            let active = p["activeId"].as_str().unwrap_or("");
            let visible = p["visible"].as_bool().unwrap_or(false);
            for (name, v) in app.webviews() {
                if !name.starts_with("browser-") { continue; }
                if !names.contains(&name) { close_tab(&v)?; }
                else if !visible || name != format!("browser-{active}") { hide_tab(&v)?; }
            }
            if visible {
                if let Some(tab) = tabs.iter().find(|t| t["id"] == active && t["url"] != "start") {
                    let key = label(active)?;
                    let view = match app.get_webview(&key) { Some(v) => v, None => create(&app, active, tab["url"].as_str().unwrap_or("")).await? };
                    let n = |key: &str, min: f64| -> Result<f64, String> { let v = p["bounds"][key].as_f64().ok_or("浏览区域尚未就绪。")?; if !v.is_finite() || v < min || v > 20000. { Err("浏览区域尺寸无效。".into()) } else { Ok(v) } };
                    let (x, y, w, h) = (n("x",0.)?, n("y",0.)?, n("width",1.)?, n("height",1.)?);
                    let rect = if p["bounds"]["physical"] == true {
                        tauri::Rect { position: tauri::PhysicalPosition::new(x as i32, y as i32).into(), size: tauri::PhysicalSize::new(w as u32, h as u32).into() }
                    } else {
                        tauri::Rect { position: tauri::LogicalPosition::new(x, y).into(), size: tauri::LogicalSize::new(w, h).into() }
                    };
                    view.set_bounds(rect).map_err(err)?;
                    view.show().map_err(err)?;
                }
            }
            Ok(json!({}))
        }
        "navigate" => {
            let url = p["url"].as_str().unwrap_or("");
            match app.get_webview(&label(id)?) {
                Some(view) => navigate(&app, id, view, http(url)?, false).await?,
                None => { create(&app, id, url).await?; }
            }
            Ok(json!({}))
        }
        "close" => {
            let key = label(id)?;
            if let Some(v) = app.get_webview(&key) { close_tab(&v)?; }
            Ok(json!({}))
        }
        "back" | "forward" | "stop" | "reload" => {
            let view = app.get_webview(&label(id)?).ok_or("请先打开网页。")?;
            if action == "reload" {
                let url = view.url().map_err(err)?;
                navigate(&app, id, view, url, true).await?;
            }
            else {
                #[cfg(windows)] {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    view.with_webview(move |v| {
                        let result = unsafe { v.controller().CoreWebView2().and_then(|core| match action.as_str() { "back" => core.GoBack(), "forward" => core.GoForward(), _ => core.Stop() }) };
                        let _ = tx.send(result.map_err(err));
                    }).map_err(err)?;
                    rx.await.map_err(err)??;
                }
            }
            Ok(json!({}))
        }
        "external" => {
            let url = http(p["url"].as_str().unwrap_or(""))?;
            let mut cmd = std::process::Command::new("rundll32.exe");
            cmd.args(["url.dll,FileProtocolHandler",url.as_str()]);
            #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
            cmd.spawn().map_err(err)?; Ok(json!({}))
        }
        _ => Err("浏览器操作无效。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn remote_urls_and_download_names() {
        for u in ["file:///C:/secret", "javascript:alert(1)", "https://ipc.localhost/", "https://user:pass@example.com"] { assert!(http(u).is_err()); }
        assert!(http("https://www.bilibili.com/video/BV123").is_ok());
        assert!(label("main").is_err());
        assert!(label("tab-test-1").is_ok());
        assert_eq!(filename(std::path::Path::new("C:/temp/CON.vpk")), "download-CON.vpk");
        assert_eq!(filename(std::path::Path::new("test.vpk")), "test.vpk");
    }
}
