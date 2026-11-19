// 资源管理器里「复制」的文件在剪贴板上是 CF_HDROP 文件列表。
// WebView 粘贴只给文件内容、不给路径，zip 这类大文件只能由壳读出本机路径交给茶茶。
use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf, time::Duration};
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

const CF_HDROP: u32 = 15;

pub fn file_list() -> Result<Vec<PathBuf>, String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP).is_err() { return Ok(Vec::new()); }
        // 别的程序可能正占着剪贴板，稍等重试
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() { opened = true; break; }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !opened { return Err("剪贴板被其他程序占用，请稍后再粘贴。".into()); }
        let paths = match GetClipboardData(CF_HDROP) {
            Ok(handle) => {
                let drop = HDROP(handle.0);
                (0..DragQueryFileW(drop, u32::MAX, None)).filter_map(|i| {
                    let len = DragQueryFileW(drop, i, None) as usize;
                    if len == 0 { return None; }
                    let mut buf = vec![0u16; len + 1];
                    let n = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
                    Some(PathBuf::from(OsString::from_wide(&buf[..n.min(len)])))
                }).collect()
            }
            Err(_) => Vec::new(),
        };
        let _ = CloseClipboard();
        Ok(paths)
    }
}
