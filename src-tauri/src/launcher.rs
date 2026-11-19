use serde_json::{json, Value};
use std::io;
use tauri::{menu::{Menu, MenuItem}, tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent}, Manager};
use winreg::{enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE}, RegKey};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const NAME: &str = "Matcha";
fn startup_command() -> io::Result<String> {
    let exe = std::env::current_exe()?;
    Ok(format!("\"{}\" --tray", dunce::simplified(&exe).display()))
}
fn optional<T>(r: io::Result<T>) -> io::Result<Option<T>> {
    match r { Ok(v) => Ok(Some(v)), Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None), Err(e) => Err(e) }
}
fn registered() -> io::Result<bool> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cmd = startup_command()?;
    let value: Option<String> = optional(hkcu.open_subkey(RUN).and_then(|k| k.get_value(NAME)))?;
    if !value.is_some_and(|v| v.eq_ignore_ascii_case(&cmd)) { return Ok(false); }
    let flag = optional(hkcu.open_subkey(APPROVED).and_then(|k| k.get_raw_value(NAME)))?;
    Ok(!flag.is_some_and(|v| matches!(v.bytes.first(), Some(3 | 7))))
}
fn autostart(enable: bool) -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cmd = startup_command()?;
    if enable {
        let (key, _) = hkcu.create_subkey(RUN)?;
        key.set_value(NAME, &cmd)?;
        if let Some(k) = optional(hkcu.open_subkey_with_flags(APPROVED, KEY_SET_VALUE))? { optional(k.delete_value(NAME))?; }
    } else if let Some(key) = optional(hkcu.open_subkey_with_flags(RUN, KEY_READ | KEY_SET_VALUE))? {
        if optional(key.get_value::<String,_>(NAME))?.is_some_and(|v| v.eq_ignore_ascii_case(&cmd)) { optional(key.delete_value(NAME))?; }
    }
    Ok(())
}
pub fn behavior(_app: &tauri::AppHandle, cmd: &str, params: Option<&Value>) -> io::Result<Value> {
    if cmd == "launcher-behavior-set" {
        let patch = params.and_then(Value::as_object).filter(|p| !p.is_empty() &&
            p.iter().all(|(k,v)| matches!(k.as_str(),"autostart"|"closeToTray") && v.is_boolean()))
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "请指定启动器开关。"))?;
        if patch.get("closeToTray").and_then(Value::as_bool) == Some(false) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "关闭窗口会收起到托盘，右键托盘图标可退出。"));
        }
        if let Some(enabled) = patch.get("autostart") { autostart(enabled.as_bool().unwrap())?; }
    }
    Ok(json!({"closeToTray":true,"autostart":registered()?}))
}
fn show(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") { let _ = main.show(); let _ = main.unminimize(); let _ = main.set_focus(); }
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app,"show","显示 Matcha",true,None::<&str>)?;
    let quit = MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
    let menu = Menu::with_items(app,&[&open,&quit])?;
    let mut tray = TrayIconBuilder::with_id("matcha").tooltip("Matcha").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.on_menu_event(|app,e| match e.id.as_ref() { "show"=>show(app), "quit"=>app.exit(0), _=>{} })
        .on_tray_icon_event(|tray,e| if matches!(e,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}) {show(tray.app_handle())}).build(app)?;
    if !std::env::args_os().any(|v| v == "--tray") { show(app.handle()); }
    Ok(())
}
