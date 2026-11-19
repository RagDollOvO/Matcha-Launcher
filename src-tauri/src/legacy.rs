//! Matcha 以前叫 Flare。新版第一次启动时，在任何窗口和服务起来之前，
//! 把本机数据文件夹 com.flare.launcher 改名为 com.matcha.launcher（WebView 存储也在里面）。
//! 改名成功后留下 legacy-rename.json，由后端把设置里记着的旧路径改成新的。
use std::path::{Path, PathBuf};

const LEGACY: &str = "com.flare.launcher";
const CURRENT: &str = "com.matcha.launcher";
pub const MARKER: &str = "legacy-rename.json";

pub fn migrate_data_dir() {
    // 测试和便携数据目录自己指定位置，不参与改名。
    if std::env::var_os("BEACON_DATA_DIR").is_some() { return; }
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return };
    let (old, new) = (local.join(LEGACY), local.join(CURRENT));
    loop {
        if new.exists() || !old.is_dir() { return; }
        let message = if other_instance_running() {
            format!("旧版 Matcha 还开着。\n\n新版要把本机数据文件夹 {LEGACY} 改名为 {CURRENT}，设置、方案和茶茶的对话都在里面。请先退出旧版（托盘里的图标也右键退出），再点「重试」。\n\n点「取消」会退出新版，数据不动。")
        } else {
            match rename(&old, &new) {
                Ok(()) => { write_marker(&old, &new); return; }
                Err(e) => format!("数据文件夹改名没成功：{e}\n\n{}\n\n可能有程序正在用里面的文件，比如没关干净的旧版 Matcha。关掉后点「重试」；点「取消」会退出新版，数据不动。", old.display()),
            }
        };
        if !ask_retry(&message) { std::process::exit(0); }
    }
}

/// 旧版刚退出时，WebView 子进程可能还要一两秒才放开文件。
fn rename(old: &Path, new: &Path) -> std::io::Result<()> {
    let mut last = None;
    for _ in 0..10 {
        match std::fs::rename(old, new) {
            Ok(()) => return Ok(()),
            Err(e) => { last = Some(e); std::thread::sleep(std::time::Duration::from_millis(300)); }
        }
    }
    Err(last.unwrap())
}

fn write_marker(old: &Path, new: &Path) {
    let body = serde_json::json!({ "from": old, "to": new });
    let _ = std::fs::write(new.join(MARKER), body.to_string());
}

#[cfg(windows)]
fn other_instance_running() -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let me = std::process::id();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return false };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
                if entry.th32ProcessID != me && matches!(name.as_str(), "matcha.exe" | "flare.exe") { found = true; break; }
                if Process32NextW(snapshot, &mut entry).is_err() { break; }
            }
        }
        let _ = CloseHandle(snapshot);
        found
    }
}
#[cfg(not(windows))]
fn other_instance_running() -> bool { false }

#[cfg(windows)]
fn ask_retry(text: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDRETRY, MB_ICONWARNING, MB_RETRYCANCEL, MB_SETFOREGROUND};
    let text: Vec<u16> = text.encode_utf16().chain([0]).collect();
    let caption: Vec<u16> = "Matcha".encode_utf16().chain([0]).collect();
    unsafe { MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_RETRYCANCEL | MB_ICONWARNING | MB_SETFOREGROUND) == IDRETRY }
}
#[cfg(not(windows))]
fn ask_retry(_: &str) -> bool { false }
