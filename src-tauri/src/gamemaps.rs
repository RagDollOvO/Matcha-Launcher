//! GameMaps uses an ordinary, isolated WebView2 profile. Challenge pages stay errors.
#[cfg(windows)]
pub(crate) mod transfer;
use serde_json::{json, Value};
use std::{sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}, collections::HashMap};
use tauri::{Manager, Webview, WebviewUrl, webview::{WebviewBuilder, PageLoadEvent, NewWindowResponse}};

fn error(message: impl std::fmt::Display) -> String { message.to_string() }
fn send(app: &tauri::AppHandle, value: Value) {
    if let Some(state) = app.try_state::<crate::BridgeState>() {
        if let Some(bridge) = &state.bridge { bridge.send(&value); }
    }
}
fn site(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && url.host_str().is_some_and(|h| h == "gamemaps.com" || h.ends_with(".gamemaps.com"))
}
fn job_id(id: &str) -> bool { id.len() == 36 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') }
fn item_id(id: &str) -> bool { !id.is_empty() && id.len() <= 12 && !id.starts_with('0') && id.bytes().all(|c| c.is_ascii_digit()) }
fn workshop_id(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "https" || url.host_str() != Some("steamcommunity.com") || !["/sharedfiles/filedetails", "/workshop/filedetails"].contains(&url.path().trim_end_matches('/')) { return None; }
    url.query_pairs().find(|(k, v)| k == "id" && !v.is_empty() && v.len() <= 20 && v.bytes().all(|c| c.is_ascii_digit())).map(|(_, v)| v.into_owned())
}
struct Job {
    alive: AtomicBool, paused: AtomicBool, stopped: tokio::sync::Notify,
    #[cfg(windows)] grant: Mutex<Option<tokio::sync::oneshot::Sender<u64>>>,
}
static JOBS: OnceLock<Mutex<HashMap<String, Arc<Job>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<Job>>> { JOBS.get_or_init(Mutex::default) }
pub fn register(id: &str) {
    if job_id(id) { jobs().lock().unwrap().insert(id.into(), Arc::new(Job {
        alive: AtomicBool::new(true), paused: AtomicBool::new(false), stopped: Default::default(),
        #[cfg(windows)] grant: Mutex::new(None),
    })); }
}
async fn pace(alive: &AtomicBool) -> Result<(), String> {
    static GATE: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    let mut last = GATE.get_or_init(|| tokio::sync::Mutex::new(None)).lock().await;
    if let Some(t) = *last { tokio::time::sleep(Duration::from_secs(1).saturating_sub(t.elapsed())).await; }
    if !alive.load(Ordering::SeqCst) { return Err("GameMaps 请求已取消。".into()); }
    *last = Some(Instant::now()); Ok(())
}

pub fn cancel(app: &tauri::AppHandle, id: &str, paused: bool) {
    if !job_id(id) { return; }
    if let Some(job) = jobs().lock().unwrap().get(id) {
        if paused { job.paused.store(true, Ordering::SeqCst); }
        job.alive.store(false, Ordering::SeqCst);
        job.stopped.notify_one();
        #[cfg(windows)] job.grant.lock().unwrap().take();
    }
    let a = app.clone(); let id = id.to_string();
    let _ = app.run_on_main_thread(move || {
        if let Some(view) = a.get_webview(&format!("gamemaps-{id}")) { let _ = view.close(); }
    });
}

#[cfg(windows)]
async fn script(view: &Webview, source: String) -> Result<Value, String> {
    use windows::core::HSTRING;
    use webview2_com::ExecuteScriptCompletedHandler;
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |v| unsafe {
        let callback = ExecuteScriptCompletedHandler::create(Box::new(move |result, data| {
            let reply = result.map_err(error).and_then(|_| serde_json::from_str(&data).map_err(error));
            let _ = tx.send(reply); Ok(())
        }));
        if let Ok(core) = v.controller().CoreWebView2() { let _ = core.ExecuteScript(&HSTRING::from(source), &callback); }
    }).map_err(error)?;
    tokio::time::timeout(Duration::from_secs(10), rx).await.map_err(error)?.map_err(error)?
}
#[cfg(not(windows))]
async fn script(_: &Webview, _: String) -> Result<Value, String> { Err("GameMaps 浏览器通道需要 Windows WebView2。".into()) }

async fn page(view: &Webview) -> Result<Value, String> {
    let result = script(view, "({url:location.href,html:document.documentElement.outerHTML.slice(0,4194305),sort:document.querySelector('select[name=sort]')?.value,workshopAction:document.querySelector('form[action^=\"/downloads/outsourced/\"][action$=\"/steam\"]')?.getAttribute('action')})".into()).await?;
    let html = result["html"].as_str().ok_or("GameMaps 页面读取失败。")?;
    if html.len() > 4 * 1024 * 1024 { return Err("GameMaps 页面超过大小限制。".into()); }
    Ok(result)
}
fn is_blocked(page: &Value) -> bool {
    let html = page["html"].as_str().unwrap_or("").to_ascii_lowercase();
    html.contains("sorry, you have been blocked") || html.contains("cf-chl-") || html.contains("<title>just a moment")
        || html.contains("<title>attention required")
}
async fn wait_document(view: &Webview, alive: &AtomicBool, loaded: &AtomicBool, after_sort: bool) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    // The list, detail and forms are server-rendered. Take them as soon as
    // parsing is complete; screenshots, ads and other subresources can lag.
    let probe = r#"(() => {
        if (document.readyState === 'loading' || !document.body) return null;
        return {url:location.href, previous:window.__flareBeforeSort === true,
            content:!!document.querySelector('.paged-list, .title-row h1, #challenge-form, [id^="cf-chl-"]') ||
                /^(just a moment|attention required|access denied)/i.test(document.title)};
    })()"#;
    while Instant::now() < deadline {
        if !alive.load(Ordering::SeqCst) { return Err("GameMaps 请求已取消。".into()); }
        let probe = script(view, probe.into()).await?;
        if probe["url"].as_str().and_then(|u| tauri::Url::parse(u).ok()).is_some_and(|u| site(&u))
            && (!after_sort || probe["previous"] != true) && (probe["content"] == true || loaded.load(Ordering::SeqCst)) {
            return page(view).await;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("GameMaps 页面加载超时。".into())
}

async fn run(app: &tauri::AppHandle, request: &Value) -> Result<Value, (String, String)> {
    let fail = |s: String| ("gamemaps_browser".into(), s);
    let id = request["id"].as_str().unwrap_or("");
    let kind = request["kind"].as_str().unwrap_or("");
    let item = request["itemId"].as_str().unwrap_or("");
    let task = request["taskId"].as_str().unwrap_or("");
    if !job_id(id) || !["page", "download"].contains(&kind) || (kind == "download" && (!item_id(item) || !job_id(task))) { return Err(fail("GameMaps 请求标识无效。".into())); }
    let job = jobs().lock().unwrap().get(id).cloned().ok_or_else(|| fail("请求已关闭。".into()))?;
    let alive = &job.alive;
    let sort = request["sort"].as_str().unwrap_or("");
    if !["", "recent", "popular", "rviews"].contains(&sort) { return Err(fail("GameMaps 排序无效。".into())); }
    let url = if kind == "download" { format!("https://www.gamemaps.com/details/{item}") } else { request["url"].as_str().unwrap_or("").into() };
    let url = tauri::Url::parse(&url).map_err(|e| fail(error(e)))?;
    if !site(&url) || !["/l4d2", "/search/l4d2", "/details/"].iter().any(|p| url.path().starts_with(p)) { return Err(fail("GameMaps 页面地址无效。".into())); }
    let profile = crate::browser::storage::profile(app,2).map_err(fail)?;
    std::fs::create_dir_all(&profile).map_err(|e| fail(error(e)))?;
    pace(alive).await.map_err(fail)?;
    let ready = Arc::new(AtomicBool::new(false)); let loaded = ready.clone();
    let permitted = job.clone();
    let steam = Arc::new(Mutex::new(None)); let destination = steam.clone();
    let resolving = Arc::new(AtomicBool::new(false)); let resolve_steam = resolving.clone();
    let detail_id = url.path().strip_prefix("/details/").filter(|s| item_id(s)).map(str::to_owned);
    let builder = WebviewBuilder::new(format!("gamemaps-{id}"), WebviewUrl::External(url))
        .data_directory(profile).disable_drag_drop_handler()
        .on_navigation(move |url| {
            if resolve_steam.load(Ordering::SeqCst) { if let Some(id) = workshop_id(url) { *destination.lock().unwrap() = Some(id); } }
            permitted.alive.load(Ordering::SeqCst) && site(url)
        }).on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(move |_, event| { loaded.store(matches!(event.event(), PageLoadEvent::Finished), Ordering::SeqCst); });
    let window = app.get_window("main").ok_or_else(|| fail("Matcha 主窗口已关闭。".into()))?;
    let view = window.add_child(builder, tauri::LogicalPosition::new(-2000., -2000.), tauri::LogicalSize::new(1024., 768.)).map_err(|e| fail(error(e)))?;
    if let Err(e) = view.hide() { let _ = view.close(); return Err(fail(error(e))); }
    let work = async {
        let mut document = wait_document(&view, alive, &ready, false).await.map_err(fail)?;
        if is_blocked(&document) { return Err(("gamemaps_blocked".into(), "GameMaps 暂时拦截了请求，请在内置浏览器查看页面提示，稍后再试。".into())); }
        if kind == "page" && !sort.is_empty() && document["sort"].as_str().is_some_and(|s| s != sort) {
            pace(alive).await.map_err(fail)?;
            ready.store(false, Ordering::SeqCst);
            let source = format!(r#"(()=>{{const s=document.querySelector('select[name=sort]');window.__flareBeforeSort=true;s.value={};s.form.submit();return true;}})()"#, serde_json::to_string(sort).unwrap());
            script(&view, source).await.map_err(fail)?;
            document = wait_document(&view, alive, &ready, true).await.map_err(fail)?;
            if is_blocked(&document) { return Err(("gamemaps_blocked".into(), "GameMaps 暂时拦截了排序请求，请稍后重试。".into())); }
            if document["sort"].as_str() != Some(sort) { return Err(fail("GameMaps 排序未生效，请在原页面查看。".into())); }
        }
        if kind == "page" {
            // Some authors expose Steam through a redirect form. Capture its destination
            // without granting the external page access or starting a download.
            if let Some(item) = detail_id {
                let action = format!("/downloads/outsourced/{item}/steam");
                if document["workshopAction"].as_str() == Some(action.as_str()) {
                    pace(alive).await.map_err(fail)?;
                    resolving.store(true, Ordering::SeqCst);
                    let selector = format!("form[action=\"{action}\"]");
                    let source = format!("document.querySelector({}).submit();true", serde_json::to_string(&selector).unwrap());
                    if script(&view, source).await.is_ok() {
                        for _ in 0..50 {
                            if !alive.load(Ordering::SeqCst) { return Err(fail("GameMaps 请求已取消。".into())); }
                            if let Some(id) = steam.lock().unwrap().clone() { document["workshopId"] = json!(id); break; }
                            tokio::time::sleep(Duration::from_millis(200)).await;
                        }
                    }
                }
            }
            return Ok(document);
        }
        #[cfg(windows)] { transfer::download(app, &view, request, &job, &ready).await }
        #[cfg(not(windows))] { Err(fail("GameMaps 下载需要 Windows WebView2。".into())) }
    };
    let result = tokio::select! {
        result = work => result,
        _ = job.stopped.notified() => Err(fail("GameMaps 请求已取消。".into())),
    };
    cancel(app, id, false);
    result
}

pub async fn handle(app: tauri::AppHandle, request: Value) {
    let id = request["id"].clone();
    let result = if request["kind"]=="storage"{crate::browser::storage::request(&app,&request).await}else{run(&app, &request).await};
    if let Some(key) = id.as_str() { jobs().lock().unwrap().remove(key); }
    send(&app, match result {
        Ok(value) => json!({"type":"gamemaps_response","id":id,"result":value}),
        Err((code, message)) => json!({"type":"gamemaps_response","id":id,"error":{"code":code,"message":message}}),
    });
}
