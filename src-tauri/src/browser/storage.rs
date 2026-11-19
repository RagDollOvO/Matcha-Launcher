//! Storage operations are private sidecar requests, never remote-page browser actions.
use super::{BrowserState,event,err};
use serde_json::{json,Value};
use std::path::{Path,PathBuf};
use tauri::{Manager,WebviewUrl,webview::WebviewBuilder};

#[derive(Default)]
pub(super) struct Routes { browser:Option<PathBuf>, game_maps:Option<PathBuf>, profiles:Vec<PathBuf>, blocked:bool }
pub fn layout(app:&tauri::AppHandle,v:&Value){
    let s=app.state::<BrowserState>(); let mut r=s.routes.lock().unwrap();
    r.browser=v["browser"].as_str().map(PathBuf::from);r.game_maps=v["gamemaps"].as_str().map(PathBuf::from);
    r.profiles=v["profiles"].as_array().into_iter().flatten().filter_map(|p|p.as_str().map(PathBuf::from)).collect();
    r.blocked=v["blocked"]==true;
}
pub fn folder(p:&Path)->Result<(),String>{
    if !p.is_absolute(){return Err("存储路径无效".into());}
    if let Some(parent)=p.parent(){folder(parent)?;}
    match std::fs::symlink_metadata(p){
        Ok(m)=>{
            #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("存储路径包含重解析点".into())}}
            if !m.is_dir()||m.file_type().is_symlink(){return Err("存储位置需要真实目录".into())}
        },
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{std::fs::create_dir(p).map_err(err)?;},
        Err(e)=>return Err(err(e))
    }Ok(())
}
pub fn profile(app:&tauri::AppHandle,i:usize)->Result<PathBuf,String>{
    let state=app.state::<BrowserState>();let p=state.routes.lock().unwrap().profiles.get(i).cloned().ok_or("浏览器存储尚未就绪")?;
    folder(&p)?;Ok(p)
}
pub fn download_root(s:&BrowserState,gm:bool)->Result<PathBuf,String>{
    let r=s.routes.lock().unwrap();if r.blocked{return Err("存储搬家中，请稍后下载".into())}
    let p=if gm{&r.game_maps}else{&r.browser};let p=p.clone().ok_or("下载位置尚未就绪")?;folder(&p)?;Ok(p)
}
#[cfg(windows)]
async fn clear(app:&tauri::AppHandle,p:PathBuf,i:usize)->Result<(),String>{
    use windows::core::Interface;
    use webview2_com::{ClearBrowsingDataCompletedHandler,Microsoft::Web::WebView2::Win32::*};
    if !p.exists(){return Ok(())}folder(&p)?;
    let win=app.get_window("main").ok_or("主窗口已关闭")?;
    let builder=WebviewBuilder::new(format!("matcha-cache-{i}"),WebviewUrl::External(tauri::Url::parse("about:blank").unwrap()))
        .data_directory(p).focused(false).disable_drag_drop_handler().on_navigation(|u|u.as_str()=="about:blank").on_download(|_,_|false);
    let view=win.add_child(builder,tauri::LogicalPosition::new(-40.,-40.),tauri::LogicalSize::new(1.,1.)).map_err(err)?;
    struct Temp(tauri::Webview);impl Drop for Temp{fn drop(&mut self){let _=self.0.close();}}
    let view=Temp(view);view.0.hide().map_err(err)?;
    let (tx,rx)=tokio::sync::oneshot::channel();
    view.0.with_webview(move |v|unsafe {
        let tx=std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));let done=tx.clone();
        let res=(||->windows::core::Result<()>{
            let profile=v.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
            let kinds=COREWEBVIEW2_BROWSING_DATA_KINDS(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0|COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0|COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS.0);
            profile.ClearBrowsingData(kinds,&ClearBrowsingDataCompletedHandler::create(Box::new(move |status|{
                if let Some(t)=done.lock().unwrap().take(){let _=t.send(status.map_err(err));}Ok(())
            })))
        })();if let Err(e)=res{if let Some(t)=tx.lock().unwrap().take(){let _=t.send(Err(err(e)));}}
    }).map_err(err)?;
    tokio::time::timeout(std::time::Duration::from_secs(25),rx).await.map_err(err)?.map_err(err)?
}
pub async fn request(app:&tauri::AppHandle,p:&Value)->Result<Value,(String,String)>{
    let s=app.state::<BrowserState>();let error=|e:String|("storage_native".into(),e);
    match p["action"].as_str(){
        Some("freeze")=>{let rows=s.downloads.lock().unwrap();if rows.iter().any(|r|r["state"]=="downloading"){return Err(("storage_busy".into(),"内置浏览器有下载正在进行。".into()))}s.routes.lock().unwrap().blocked=true;}
        Some("thaw")=>s.routes.lock().unwrap().blocked=false,
        Some("patch")=>{let mut rows=s.downloads.lock().unwrap();let mut next=rows.clone();
            let row=next.iter_mut().find(|r|r["id"]==p["rowId"]&&r["path"]==p["oldPath"]&&r["state"]!="downloading").ok_or_else(||error("网页下载记录已变化".into()))?;
            for k in ["path","archiveStamp","cleaned","cleanupPending","selectionStamp","importedNames"] {if let Some(v)=p["patch"].get(k){row[k]=v.clone();}}
            let updated=row.clone();s.save(&next).map_err(error)?;*rows=next;event(app,json!({"type":"download","download":updated}));
        }
        Some("clear-cache")=>{let paths=s.routes.lock().unwrap().profiles.clone();
            #[cfg(windows)] for (i,p) in paths.into_iter().enumerate(){clear(app,p,i).await.map_err(error)?;}
        }
        _=>return Err(error("未知存储操作".into()))
    }Ok(json!({}))
}
