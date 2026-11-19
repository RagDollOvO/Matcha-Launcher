#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::oneshot;
mod browser;
mod agent_window;
mod launcher;
mod gamemaps;
mod legacy;
#[cfg(windows)]
mod clipboard;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

type Reply = Result<Value, String>;
const BETA_ID: &str = "com.matcha.launcher.beta";
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Reply>>>>;
struct BridgeState { bridge: Option<Bridge>, error: Option<String> }
struct Bridge {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    pending: Pending,
    sequence: AtomicU64,
    community_active: Arc<AtomicBool>,
    community_busy: Arc<AtomicBool>,
}
impl Bridge {
    fn start(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
        } else { app.path().resource_dir()? };
        // Node's Windows entry resolver rejects the \\?\ prefix returned by
        // resource_dir. Normalize it before passing paths to the child process.
        let root = dunce::simplified(&root).to_path_buf();
        let node = std::env::var_os("BEACON_NODE").unwrap_or_else(|| {
            if cfg!(debug_assertions) { "node".into() } else { root.join("runtime").join("node.exe").into_os_string() }
        });
        let data = browser::data_dir(app)?;
        std::fs::create_dir_all(data.join("logs"))?;
        let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("logs").join("desktop-service.log"))?;
        let mut cmd = Command::new(node);
        cmd.arg(root.join("backend").join("desktop").join("host.mjs"))
            .current_dir(&root)
            .env("BEACON_DATA_DIR", &data)
            .env("MATCHA_CHANNEL", if app.config().identifier == BETA_ID { "beta" } else { "stable" })
            .env("MATCHA_APP_VERSION", app.package_info().version.to_string())
            .env("FLARE_DESKTOP_DIR", app.path().desktop_dir()?)
            .env("FLARE_GAMEMAPS_WEBVIEW", "1")
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let replies = pending.clone();
        let community_active = Arc::new(AtomicBool::new(false));
        let acceleration = community_active.clone();
        let community_busy = Arc::new(AtomicBool::new(false));
        let changing = community_busy.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(record) = serde_json::from_str::<Value>(&line) else {
                    let _ = app.emit("beacon-event", json!({"type":"bridge_fault","error":{"message":"本地服务返回了无效消息。"}}));
                    continue;
                };
                if record["type"] == "gamemaps_request" {
                    gamemaps::register(record["id"].as_str().unwrap_or(""));
                    let a = app.clone();
                    tauri::async_runtime::spawn(async move { gamemaps::handle(a, record).await; });
                } else if record["type"] == "gamemaps_cancel" {
                    gamemaps::cancel(&app, record["id"].as_str().unwrap_or(""), record["paused"] == true);
                } else if record["type"] == "gamemaps_grant" {
                    #[cfg(windows)]
                    gamemaps::transfer::grant(record["id"].as_str().unwrap_or(""), record["bytes"].as_u64().unwrap_or(0));
                } else if record["type"] == "event" {
                    if record["event"]["type"]=="storage_layout" { browser::storage::layout(&app,&record["event"]);continue; }
                    if record["event"]["type"] == "community_acceleration" {
                        acceleration.store(record["event"]["status"]["active"].as_bool().unwrap_or(false), Ordering::Relaxed);
                        changing.store(matches!(record["event"]["status"]["phase"].as_str(), Some("starting" | "running" | "stopping")), Ordering::Relaxed);
                    }
                    let _ = app.emit("beacon-event", &record["event"]);
                } else if let Some(id) = record["id"].as_str() {
                    if let Some(tx) = replies.lock().unwrap().remove(id) { let _ = tx.send(Ok(record)); }
                }
            }
            acceleration.store(false, Ordering::Relaxed);
            changing.store(false, Ordering::Relaxed);
            for (_, tx) in replies.lock().unwrap().drain() { let _ = tx.send(Err("本地服务已退出，请重新打开 Matcha。".into())); }
            let _ = app.emit("beacon-event", json!({"type":"bridge_exit"}));
        });
        Ok(Self { stdin: Mutex::new(Some(stdin)), child: Mutex::new(child), pending, sequence: AtomicU64::new(0), community_active, community_busy })
    }
    fn send(&self, value: &Value) {
        if let Some(stdin) = self.stdin.lock().unwrap().as_mut() { let _ = writeln!(stdin, "{}", value); }
    }
    fn close(&self) {
        let wait = if self.community_busy.load(Ordering::Relaxed) { 250 } else { 80 };
        self.stdin.lock().unwrap().take(); // EOF lets Core and Pi finish their owned work.
        let mut child = self.child.lock().unwrap();
        for _ in 0..wait {
            if let Ok(Some(_)) = child.try_wait() { return; }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
async fn beacon_call(webview: tauri::Webview, state: tauri::State<'_, BridgeState>, command: String, params: Option<Value>, confirmation: Option<Value>) -> Reply {
    // The assistant attaches to the same service as main. Browser tabs and
    // GameMaps carriers never get the launcher bridge, even inside main's window.
    if !(webview.label() == "agent" && command.starts_with("pi-")) {
        browser::require_shell(&webview)?;
    }
    if matches!(command.as_str(), "launcher-behavior-get" | "launcher-behavior-set") {
        let value = launcher::behavior(webview.app_handle(), &command, params.as_ref());
        return Ok(match value { Ok(result) => json!({"ok":true,"result":result}),
            Err(e) => json!({"ok":false,"error":{"code":"launcher_settings","message":e.to_string()}}) });
    }
    // Pi compaction calls the model; allow its five-minute deadline plus IPC margin.
    let timeout_secs = if command == "pi-command" && params.as_ref().and_then(|p| p.get("type")).and_then(Value::as_str) == Some("compact") { 330 }
        else if command == "community-set" { 300 } // Allow time for Windows consent and the engine's readiness checks.
        else { 120 };
    let bridge = state.bridge.as_ref().ok_or_else(|| state.error.clone().unwrap_or_else(|| "本地服务尚未连接。".into()))?;
    let id = format!("desktop-{}", bridge.sequence.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id.clone(), tx);
    let line = format!("{}\n", json!({"id":id,"command":command,"params":params.unwrap_or(json!({})),"confirmation":confirmation}));
    let write_result = {
        let mut guard = bridge.stdin.lock().unwrap();
        guard.as_mut().ok_or_else(|| "本地服务已关闭。".to_string()).and_then(|stdin| stdin.write_all(line.as_bytes()).map_err(|e| e.to_string()))
    };
    if let Err(e) = write_result { bridge.pending.lock().unwrap().remove(&id); return Err(e); }
    match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(reply)) => reply,
        other => {
            bridge.pending.lock().unwrap().remove(&id);
            Err(if other.is_err() { "等待本地服务超时。操作可能仍在进行，请刷新状态后处理。" } else { "本地服务连接已断开。" }.into())
        }
    }
}

// Only local shell views and paths granted by the native picker/drop are eligible.
#[tauri::command]
async fn chat_attachment(webview: tauri::Webview, path: PathBuf) -> Result<Value, String> {
    if !matches!(webview.label(), "agent" | "main") || !path.is_absolute() || !webview.app_handle().asset_protocol_scope().is_allowed(&path) {
        return Err("请从本机选择或拖入文件。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use base64::prelude::*;
        use std::io::Read;
        let name = path.file_name().ok_or("缺少文件名")?.to_string_lossy();
        let stat = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !stat.is_file() { return Err("请选择普通文件。".to_string()); }
        let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let mime = match ext.as_str() { "png"=>"image/png", "jpg"|"jpeg"=>"image/jpeg", "webp"=>"image/webp", "gif"=>"image/gif", _=>"" };
        let text = matches!(ext.as_str(),"txt"|"cfg"|"ini"|"log"|"md"|"json"|"jsonl"|"csv"|"tsv"|"xml"|"yaml"|"yml"|"toml"|"vdf"|"vmt"|"nut"|"js"|"ts"|"py"|"cpp"|"h"|"css"|"html"|"sh"|"bat"|"ps1");
        let mut result = json!({"name":name, "path":path, "size":stat.len()});
        let limit = if !mime.is_empty() { 5*1024*1024 } else if text { 32*1024 } else { 0 };
        if limit > 0 && stat.len() <= limit {
            let mut buf = Vec::new();
            std::fs::File::open(&path).map_err(|e|e.to_string())?.take(limit+1).read_to_end(&mut buf).map_err(|e|e.to_string())?;
            if buf.len() as u64 <= limit {
                if !mime.is_empty() { result["image"] = json!({"type":"image","mimeType":mime,"data":BASE64_STANDARD.encode(buf)}); }
                else if let Ok(body) = std::str::from_utf8(&buf) { if !body.contains('\0') { result["text"] = json!(body); } }
            }
        }
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}

// Ctrl+V 粘贴资源管理器里复制的文件：读剪贴板文件列表，放进与拖放相同的授权范围，再由 chat_attachment 读取。
#[tauri::command]
async fn chat_clipboard_files(webview: tauri::Webview) -> Result<Value, String> {
    if !matches!(webview.label(), "agent" | "main") { return Err("只能粘贴到茶茶对话。".into()); }
    #[cfg(windows)]
    let paths = tauri::async_runtime::spawn_blocking(clipboard::file_list).await.map_err(|e| e.to_string())??;
    #[cfg(not(windows))]
    let paths: Vec<PathBuf> = Vec::new();
    let scope = webview.app_handle().asset_protocol_scope();
    let (mut files, mut folders) = (Vec::new(), 0);
    for path in paths {
        match std::fs::metadata(&path) {
            Ok(m) if m.is_file() && path.is_absolute() => { scope.allow_file(&path).map_err(|e| e.to_string())?; files.push(path); }
            Ok(m) if m.is_dir() => folders += 1,
            _ => {}
        }
    }
    Ok(json!({ "paths": files, "folders": folders }))
}

/// 动态壁纸只记本机视频路径（不复制进 WebView 存储，C 盘紧张）。选择窗口放行只管本次运行，
/// 重启后主窗口用这个命令再放行一次；只认视频文件。
#[tauri::command]
fn wallpaper_video(webview: tauri::Webview, path: PathBuf) -> Result<u64, String> {
    browser::require_shell(&webview)?;
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    if !path.is_absolute() || !matches!(ext.as_str(), "mp4" | "webm" | "m4v" | "mov") {
        return Err("动态壁纸支持 MP4、WebM 视频".into());
    }
    let meta = std::fs::metadata(&path).map_err(|_| "找不到这个视频，可能被移动或删除了".to_string())?;
    if !meta.is_file() { return Err("找不到这个视频，可能被移动或删除了".into()); }
    webview.app_handle().asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(meta.len())
}

/// 壁纸轮播：桌面版也只记本机图片路径，不复制（C 盘紧张）。传图片或文件夹（只看第一层），
/// 放行其中的图片给主窗口读；重启后用同一个命令再放行一次。返回放行的图片和找不到的路径。
#[tauri::command]
fn wallpaper_images(webview: tauri::Webview, paths: Vec<PathBuf>) -> Result<Value, String> {
    browser::require_shell(&webview)?;
    const EXTS: [&str; 8] = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "jfif"];
    let is_image = |p: &std::path::Path| {
        p.extension().map(|e| EXTS.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false)
    };
    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    let mut missing: Vec<PathBuf> = Vec::new();
    for path in paths.into_iter().take(500) {
        match std::fs::metadata(&path) {
            Ok(m) if path.is_absolute() && m.is_dir() => {
                let mut found: Vec<(PathBuf, u64)> = std::fs::read_dir(&path)
                    .map_err(|_| "这个文件夹打不开".to_string())?
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let p = e.path();
                        let m = e.metadata().ok()?;
                        (m.is_file() && is_image(&p)).then_some((p, m.len()))
                    })
                    .collect();
                found.sort_by(|a, b| a.0.cmp(&b.0));
                files.extend(found.into_iter().take(200));
            }
            Ok(m) if path.is_absolute() && m.is_file() && is_image(&path) => files.push((path, m.len())),
            _ => missing.push(path),
        }
    }
    let scope = webview.app_handle().asset_protocol_scope();
    for (p, _) in &files {
        scope.allow_file(p).map_err(|e| e.to_string())?;
    }
    Ok(json!({
        "files": files.iter().map(|(p, size)| json!({ "path": p, "size": size })).collect::<Vec<_>>(),
        "missing": missing,
    }))
}

fn main() {
    // 必须在 Builder 之前：WebView2 的存储目录按 identifier 定位。
    let context = tauri::generate_context!();
    if context.config().identifier != BETA_ID { legacy::migrate_data_dir(); }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            launcher::setup(app)?;
            let handle = app.handle().clone();
            app.notification().on_action(move |action| {
                if action.action_id() != "tap" || action.notification().and_then(|n| n.extra().get("route")).and_then(Value::as_str) != Some("downloads") { return; }
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                    let _ = main.emit_to("main", "beacon-event", json!({"type":"open_downloads"}));
                }
            })?;
            app.manage(browser::BrowserState::new(app.handle())?);
            let state = match Bridge::start(app.handle()) {
                Ok(bridge) => BridgeState { bridge: Some(bridge), error: None },
                Err(error) => BridgeState { bridge: None, error: Some(format!("本地服务启动失败：{}。请从完整的 Matcha 文件夹启动程序。", error)) },
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![chat_attachment, chat_clipboard_files, wallpaper_video, wallpaper_images, beacon_call, browser::browser_call, agent_window::dock_agent_window])
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                if window.hide().is_err() { let _ = window.minimize(); }
                {
                    if let Some(agent) = window.get_webview_window("agent") { let _ = agent.hide(); }
                    let _ = window.emit_to("main", "matcha://to-main", json!({"type":"hidden"}));
                }
            }
            ("agent", WindowEvent::CloseRequested { api, .. }) => {
                // Alt+F4 on the companion has the same semantics as its fold button.
                if window.hide().is_ok() {
                    api.prevent_close();
                    let _ = window.emit_to("main", "matcha://to-main", json!({"type":"hidden"}));
                }
            }
            ("main", WindowEvent::Destroyed) => {
                if let Some(agent) = window.get_webview_window("agent") { let _ = agent.destroy(); }
            }
            ("main", event) => agent_window::follow(window, event),
            _ => {}
        })
        .build(context).expect("Matcha desktop initialization failed");
    app.run(|app, event| { if let tauri::RunEvent::Exit = event { if let Some(bridge) = &app.state::<BridgeState>().bridge { bridge.close(); } } });
}
