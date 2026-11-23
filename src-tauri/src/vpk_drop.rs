use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

// Explorer passes dropped paths as argv. Hold them until the main webview has
// subscribed, including drops forwarded by the single-instance plugin at startup.
pub struct Drops(Mutex<Vec<PathBuf>>);

impl Drops {
    pub fn new(paths: Vec<PathBuf>) -> Self {
        Self(Mutex::new(paths))
    }
}

pub struct LaunchRequest {
    pub paths: Vec<PathBuf>,
    pub show_window: bool,
}

pub fn launch_request(args: impl IntoIterator<Item = impl Into<PathBuf>>) -> LaunchRequest {
    let mut tray = false;
    let mut paths = Vec::new();
    for arg in args.into_iter().skip(1).map(Into::into) {
        if arg.as_os_str() == "--tray" { tray = true; }
        else if arg.is_absolute() { paths.push(arg); }
    }
    // A shortcut drop is a background job, including when Matcha was closed.
    LaunchRequest { show_window: !tray && paths.is_empty(), paths }
}

pub fn forward(app: &tauri::AppHandle, args: Vec<String>) {
    let request = launch_request(args);
    if !request.paths.is_empty() {
        app.state::<Drops>().0.lock().unwrap().extend(request.paths);
        let _ = app.emit_to("main", "matcha://vpk-drop", ());
    } else if request.show_window {
        crate::launcher::show(app);
    }
}

#[tauri::command]
pub fn take_vpk_drops(webview: tauri::Webview, drops: tauri::State<'_, Drops>) -> Result<Vec<PathBuf>, String> {
    crate::browser::require_shell(&webview)?;
    Ok(std::mem::take(&mut *drops.0.lock().unwrap()))
}
