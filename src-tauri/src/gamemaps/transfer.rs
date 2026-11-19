//! Read the original form response inside its isolated WebView2 session. A pull
//! stream keeps at most one application block ahead of the shared Node byte budget.
//! No second HTTP request, cookies, or attachment data cross the launcher bridge.
use super::{error, is_blocked, pace, page, script, send, site, Job};
use base64::prelude::*;
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, Webview};
use tokio::sync::{mpsc, oneshot};
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR, DevToolsProtocolEventReceivedEventHandler};
use windows::core::{HSTRING, PWSTR};

const BLOCK: usize = 256 * 1024;
const MAX_FILE: u64 = 8 * 1024 * 1024 * 1024;
pub(crate) fn grant(id: &str, bytes: u64) {
    if let Some(job) = super::jobs().lock().unwrap().get(id) {
        if let Some(tx) = job.grant.lock().unwrap().take() { let _ = tx.send(bytes); }
    }
}
async fn allowance(app: &AppHandle, id: &str, max: usize, job: &Job) -> Result<usize, String> {
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = job.grant.lock().unwrap();
        if !job.alive.load(Ordering::SeqCst) { return Err("GameMaps 下载已取消。".into()); }
        *pending = Some(tx);
    }
    send(app, json!({"type":"gamemaps_budget","id":id,"bytes":max}));
    let n = tokio::time::timeout(Duration::from_secs(30), rx).await.map_err(error)?.map_err(error)?;
    if n == 0 || n > max as u64 { return Err("下载分块配额无效。".into()); }
    Ok(n as usize)
}

async fn cdp(view: &Webview, method: &'static str, params: Value) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    let (start, started) = oneshot::channel();
    view.with_webview(move |native| unsafe {
        let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, data| {
            let _ = tx.send(result.map_err(error).and_then(|_| serde_json::from_str(&data).map_err(error))); Ok(())
        }));
        let result = native.controller().CoreWebView2().and_then(|core|
            core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params.to_string()), &callback));
        let _ = start.send(result.map_err(error));
    }).map_err(error)?;
    started.await.map_err(error)??;
    tokio::time::timeout(Duration::from_secs(90), rx).await.map_err(error)?.map_err(error)?
}

async fn responses(view: &Webview) -> Result<mpsc::UnboundedReceiver<Value>, String> {
    let (tx, rx) = mpsc::unbounded_channel();
    let (setup, ready) = oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let events = native.controller().CoreWebView2()?.GetDevToolsProtocolEventReceiver(&HSTRING::from("Fetch.requestPaused"))?;
            events.add_DevToolsProtocolEventReceived(&DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut raw = PWSTR::null(); args.ParameterObjectAsJson(&mut raw)?;
                    if let Ok(event) = serde_json::from_str(&CoTaskMemPWSTR::from(raw).to_string()) { let _ = tx.send(event); }
                }
                Ok(())
            })), &mut 0)
        })();
        let _ = setup.send(result.map_err(error));
    }).map_err(error)?;
    ready.await.map_err(error)??;
    cdp(view, "Fetch.enable", json!({"patterns":[{"resourceType":"Document","requestStage":"Response"}]})).await?;
    Ok(rx)
}

fn header<'a>(event: &'a Value, name: &str) -> Option<&'a str> {
    event["responseHeaders"].as_array()?.iter().find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name)))?["value"].as_str()
}
fn archive_name(name: &str) -> bool {
    let ext = Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "vpk" | "zip" | "7z" | "rar")
}
fn file_name(event: &Value, url: &tauri::Url, suggested: Option<&str>) -> Result<String, String> {
    // Disposition parameters use MIME's token / quoted-string grammar (including
    // semicolons in quoted filenames). RFC 6266 prefers filename* over filename.
    let params = header(event, "content-disposition").and_then(|s| format!("application/{}", s.trim()).parse::<mime::Mime>().ok());
    let header_name = params.as_ref().and_then(|params| {
        params.get_param("filename*").and_then(|value| {
            let mut parts = value.as_str().splitn(3, '\'');
            let charset = parts.next()?; parts.next()?;
            let encoded = percent_encoding::percent_decode_str(parts.next()?);
            if charset.eq_ignore_ascii_case("utf-8") { encoded.decode_utf8().ok().map(|s| s.into_owned()) }
            else if charset.eq_ignore_ascii_case("iso-8859-1") { Some(encoded.map(char::from).collect()) }
            else { None }
        }).or_else(|| params.get_param("filename").map(|n| n.as_str().to_owned()))
    });
    let leaf = url.path_segments().and_then(|mut p| p.next_back()).unwrap_or("");
    let leaf = percent_encoding::percent_decode_str(leaf).decode_utf8_lossy();
    let name = header_name.unwrap_or_else(|| if archive_name(&leaf) { leaf.into_owned() } else { suggested.unwrap_or("").into() });
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "NUL" | "PRN" | "AUX" | "CONIN$" | "CONOUT$") ||
        stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT")).is_some_and(|n| n.chars().count() == 1 && "0123456789¹²³".contains(n));
    if !archive_name(&name) || name.chars().any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
        || name.encode_utf16().count() > 255 || device {
        return Err("GameMaps 文件名或格式需要检查，请在原页面下载。".into());
    }
    Ok(name)
}

async fn save_body(app: &AppHandle, view: &Webview, request: &Value, job: &Job, e: &Value, url: &tauri::Url) -> Result<Value, String> {
    let id = request["id"].as_str().unwrap(); let task = request["taskId"].as_str().unwrap(); // validated by run()
    let name = file_name(e, url, request["fileName"].as_str())?;
    let declared = header(e, "content-length").and_then(|n| n.trim().parse::<u64>().ok());
    if e["responseStatusCode"] == 206 && !declared.is_some_and(|n| n > 0 &&
        header(e, "content-range").is_some_and(|range| range.trim() == format!("bytes 0-{}/{n}", n-1))) {
        return Err("GameMaps 只返回了文件片段，请重新下载。".into());
    }
    if declared.is_some_and(|n| n > MAX_FILE) { return Err("GameMaps 下载超过 8 GiB。".into()); }
    let total = declared.filter(|_| header(e, "content-encoding").is_none_or(|v| v.eq_ignore_ascii_case("identity")));
    let folder = crate::browser::storage::download_root(&app.state::<crate::browser::BrowserState>(),true)?.join(task).join(id);
    crate::browser::storage::folder(folder.parent().unwrap())?;
    fs::create_dir(&folder).map_err(error)?; // Fresh request directory; never overwrite a previous download.
    let partial = folder.join("payload.part"); let target = folder.join(&name);
    // Restart-only pauses discard this attempt's scratch bytes. Completed archives
    // and the files retained for manual recovery after errors remain untouched.
    struct PausedPart<'a>(&'a Path, &'a AtomicBool);
    impl Drop for PausedPart<'_> {
        fn drop(&mut self) { if self.1.load(Ordering::SeqCst) && fs::remove_file(self.0).is_ok() { let _ = fs::remove_dir(self.0.parent().unwrap()); } }
    }
    let _cleanup = PausedPart(&partial, &job.paused);
    let mut file = fs::File::create_new(&partial).map_err(error)?;
    let reply = cdp(view, "Fetch.takeResponseBodyAsStream", json!({"requestId":e["requestId"]})).await?;
    let stream = reply["stream"].as_str().ok_or("GameMaps 文件流尚未就绪。")?;
    let mut bytes = 0u64; let start = Instant::now(); let mut last = start - Duration::from_secs(1);
    loop {
        if !job.alive.load(Ordering::SeqCst) { return Err("GameMaps 下载已取消。".into()); }
        let reply = cdp(view, "IO.read", json!({"handle":stream,"size":BLOCK})).await?;
        let data = reply["data"].as_str().ok_or("GameMaps 文件分块缺失。")?;
        let chunk = if reply["base64Encoded"] == true { BASE64_STANDARD.decode(data).map_err(error)? } else { data.as_bytes().to_vec() };
        if chunk.len() > BLOCK || bytes + chunk.len() as u64 > total.unwrap_or(MAX_FILE) { return Err("GameMaps 下载大小与响应不符。".into()); }
        let mut rest = chunk.as_slice();
        while !rest.is_empty() {
            let n = allowance(app, id, rest.len(), job).await?;
            let (part, next) = rest.split_at(n); file.write_all(part).map_err(error)?; rest = next;
            bytes += n as u64;
            if last.elapsed() >= Duration::from_millis(100) {
                last = Instant::now();
                send(app, json!({"type":"gamemaps_progress","id":id,"progress":{"done":bytes,"total":total,"unit":"bytes",
                    "bytesPerSecond":(bytes as f64 / start.elapsed().as_secs_f64().max(0.001)) as u64}}));
            }
        }
        if reply["eof"] == true { break; }
    }
    if bytes == 0 || total.is_some_and(|n| bytes != n) { return Err("GameMaps 下载文件长度不完整。".into()); }
    file.sync_all().map_err(error)?; drop(file);
    fs::rename(&partial, &target).map_err(error)?;
    // Closing this one-use carrier cancels the intercepted navigation and closes the stream.
    Ok(json!({"path":target,"name":name,"url":url.as_str(),"size":bytes}))
}

pub(super) async fn download(app: &AppHandle, view: &Webview, request: &Value, job: &Job, loaded: &AtomicBool) -> Result<Value, (String, String)> {
    let fail = |s: String| ("gamemaps_browser".into(), s);
    let blocked = || ("gamemaps_blocked".into(), "GameMaps 暂时拦截了下载，请在原页面查看提示。".into());
    let tree = cdp(view, "Page.getFrameTree", json!({})).await.map_err(fail)?;
    let frame = tree["frameTree"]["frame"]["id"].as_str().ok_or_else(|| fail("GameMaps 主页面已关闭。".into()))?;
    let mut events = responses(view).await.map_err(fail)?;
    pace(&job.alive).await.map_err(fail)?;
    let form = format!(r#"(()=>{{const f=document.createElement('form');f.method='POST';f.action='/downloads/download';for(const [k,v] of Object.entries({{'ids[]':{},noqueue:'true',direct:'true'}})){{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i);}}document.body.appendChild(f);f.submit();return true;}})()"#, request["itemId"]);
    script(view, form).await.map_err(fail)?;
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline && job.alive.load(Ordering::SeqCst) {
        let event = match tokio::time::timeout(Duration::from_secs(1), events.recv()).await {
            Ok(Some(e)) => e,
            Ok(None) => return Err(fail("GameMaps 下载通道已关闭。".into())),
            Err(_) => {
                if loaded.load(Ordering::SeqCst) && is_blocked(&page(view).await.map_err(fail)?) { return Err(blocked()); }
                continue;
            }
        };
        if event["frameId"] == frame {
            let status = event["responseStatusCode"].as_u64().unwrap_or(0);
            if matches!(status, 403 | 429 | 503) { return Err(blocked()); }
            if status >= 400 { return Err(fail(format!("GameMaps 下载失败（HTTP {status}）。"))); }
            let mime = header(&event, "content-type").unwrap_or("").to_ascii_lowercase();
            if matches!(status, 200 | 206) && !mime.starts_with("text/html") && !mime.starts_with("application/xhtml") {
                let url = event["request"]["url"].as_str().and_then(|s| tauri::Url::parse(s).ok()).filter(site)
                    .ok_or_else(|| fail("GameMaps 下载地址来源需要检查。".into()))?;
                return save_body(app, view, request, job, &event, &url).await.map_err(fail);
            }
        }
        // Redirects and HTML go through the original WebView navigation and site checks.
        cdp(view, "Fetch.continueRequest", json!({"requestId":event["requestId"]})).await.map_err(fail)?;
    }
    Err(fail("GameMaps 尚未开始传输，请在原页面查看下载条件。".into()))
}
