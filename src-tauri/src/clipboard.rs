// Explorer file copies use CF_HDROP. Keep the paths native, without reading the
// file bodies into WebView2 or changing Explorer's normal copy semantics.
use std::{ffi::{OsStr, OsString}, mem::size_of, os::windows::ffi::{OsStrExt, OsStringExt}, path::PathBuf, ptr::copy_nonoverlapping, time::Duration};
use windows::{core::{BOOL, Error}, Win32::{
    Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND},
    System::{Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL}, DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData}, Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE}, Ole::{IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY}},
    UI::Shell::{DragQueryFileW, SHCreateDataObject, SHDoDragDrop, CFSTR_PREFERREDDROPEFFECT, DROPFILES, HDROP},
}};

const CF_HDROP: u32 = 15;

struct Clipboard;
impl Clipboard {
    fn open(owner: Option<HWND>) -> Result<Self, String> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(owner) }.is_ok() { return Ok(Self); }
            std::thread::sleep(Duration::from_millis(20));
        }
        Err("剪贴板被其他程序占用，请稍后重试。".into())
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) { let _ = unsafe { CloseClipboard() }; }
}

pub fn file_list() -> Result<Vec<PathBuf>, String> {
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP).is_err() { return Ok(Vec::new()); }
        let _clipboard = Clipboard::open(None)?;
        Ok(match GetClipboardData(CF_HDROP) {
            Ok(handle) => read_drop_paths(HDROP(handle.0)),
            Err(_) => Vec::new(),
        })
    }
}

unsafe fn read_drop_paths(drop: HDROP) -> Vec<PathBuf> {
    (0..DragQueryFileW(drop, u32::MAX, None)).filter_map(|i| {
        let len = DragQueryFileW(drop, i, None) as usize;
        if len == 0 { return None; }
        let mut buf = vec![0u16; len + 1];
        let n = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
        Some(PathBuf::from(OsString::from_wide(&buf[..n.min(len)])))
    }).collect()
}

struct GlobalData(Option<HGLOBAL>);
impl GlobalData {
    fn new(len: usize, write: impl FnOnce(*mut u8)) -> Result<Self, Error> {
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, len)?;
            let data = Self(Some(handle));
            let ptr = GlobalLock(handle).cast::<u8>();
            if ptr.is_null() { return Err(Error::from_thread()); }
            write(ptr);
            let _ = GlobalUnlock(handle);
            Ok(data)
        }
    }
    fn publish(mut self, format: u32) -> Result<(), Error> {
        unsafe { SetClipboardData(format, self.0.map(|h| HANDLE(h.0)))?; }
        self.0 = None; // Ownership transfers to Windows on success.
        Ok(())
    }
}
impl Drop for GlobalData {
    fn drop(&mut self) { if let Some(handle) = self.0 { let _ = unsafe { GlobalFree(Some(handle)) }; } }
}

fn check_vpks(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() { return Err("请选择要复制的 VPK。".into()); }
    for path in paths {
        if !path.is_absolute() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(OsStr::new("vpk"))) || !path.is_file() {
            return Err(format!("找不到可复制的 VPK：{}", path.display()));
        }
    }
    Ok(())
}

fn file_drop_payload(paths: &[PathBuf]) -> Result<GlobalData, Error> {
    let mut names = Vec::<u16>::new();
    for path in paths {
        names.extend(path.as_os_str().encode_wide());
        names.push(0);
    }
    names.push(0);
    let header_size = size_of::<DROPFILES>();
    GlobalData::new(header_size + size_of::<u16>() * names.len(), |ptr| unsafe {
        ptr.cast::<DROPFILES>().write(DROPFILES { pFiles: header_size as u32, fWide: BOOL(1), ..Default::default() });
        copy_nonoverlapping(names.as_ptr(), ptr.add(header_size).cast::<u16>(), names.len());
    })
}

fn file_drop_format() -> FORMATETC {
    FORMATETC { cfFormat: CF_HDROP as u16, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 }
}

unsafe fn drag_data_object(paths: &[PathBuf]) -> Result<IDataObject, Error> {
    // Attach the same CF_HDROP file list Explorer reads from the clipboard.
    // A shell ID list alone does not offer that format for files across folders.
    let data: IDataObject = SHCreateDataObject(None, None, None::<&IDataObject>)?;
    let mut payload = file_drop_payload(paths)?;
    let format = file_drop_format();
    let medium = STGMEDIUM { tymed: format.tymed, u: STGMEDIUM_0 { hGlobal: payload.0.unwrap() }, ..Default::default() };
    data.SetData(&format, &medium, true)?;
    payload.0 = None; // The data object now owns the allocation.
    Ok(data)
}

/// Hand the VPKs to the shell's own drag loop (Explorer's drag image and copy
/// progress). Only copy is offered, so a drop on the same drive never moves a
/// Mod out of addons. Must run on the window's UI thread. Returns true when a
/// target accepted the copy.
pub fn drag_file_list(owner: isize, paths: &[PathBuf]) -> Result<bool, String> {
    check_vpks(paths)?;
    unsafe {
        OleInitialize(None).map_err(|e| e.to_string())?;
        let result = (|| -> Result<bool, Error> {
            let data = drag_data_object(paths)?;
            let effect = SHDoDragDrop(Some(HWND(owner as _)), &data, None::<&IDropSource>, DROPEFFECT_COPY)?;
            Ok(effect.0 & DROPEFFECT_COPY.0 != 0)
        })();
        OleUninitialize();
        result.map_err(|e| e.to_string())
    }
}

pub fn write_file_list(owner: isize, paths: &[PathBuf]) -> Result<(), String> {
    check_vpks(paths)?;
    let data = file_drop_payload(paths).map_err(|e| e.to_string())?;
    let _clipboard = Clipboard::open(Some(HWND(owner as _)))?;
    unsafe { EmptyClipboard() }.map_err(|e| e.to_string())?;
    data.publish(CF_HDROP).map_err(|e| e.to_string())?;

    // Preferred DropEffect is a DWORD: copy (1), not cut/move.
    let format = unsafe { RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT) };
    if format != 0 {
        if let Ok(effect) = GlobalData::new(size_of::<u32>(), |ptr| unsafe { ptr.cast::<u32>().write(1); }) {
            let _ = effect.publish(format);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Ole::ReleaseStgMedium;

    #[test]
    fn drag_offers_shell_file_drop_paths() -> Result<(), Error> {
        let root = std::env::temp_dir();
        let paths = [root.join("库\\示例_dir.vpk"), root.join("库\\示例_000.vpk"), root.join("收藏\\另一包.vpk")];
        let actual = unsafe {
            OleInitialize(None)?;
            let result = (|| -> Result<_, Error> {
                let data = drag_data_object(&paths)?;
                let mut medium = data.GetData(&file_drop_format())?;
                let files = read_drop_paths(HDROP(medium.u.hGlobal.0));
                ReleaseStgMedium(&mut medium);
                Ok(files)
            })();
            OleUninitialize();
            result?
        };
        assert_eq!(actual, paths);
        Ok(())
    }
}
