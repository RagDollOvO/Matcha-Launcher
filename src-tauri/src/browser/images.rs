//! Route modern public Steam covers through the image origin supported by Steam++.
use std::sync::OnceLock;

fn rule() -> &'static serde_json::Value {
    static RULE: OnceLock<serde_json::Value> = OnceLock::new();
    RULE.get_or_init(|| serde_json::from_str(include_str!("../../../backend/community/image-route.json")).expect("Steam image route"))
}

fn image_uri(raw: &str) -> Option<String> {
    let mut url = tauri::Url::parse(raw).ok()?;
    let rule = rule();
    if url.scheme() != "https" || url.port().is_some() || !url.username().is_empty() || url.password().is_some() ||
        url.host_str() != rule["source"].as_str() || !url.path().starts_with(rule["pathPrefix"].as_str()?) { return None; }
    url.set_host(rule["target"].as_str()).ok()?;
    Some(url.into())
}

#[cfg(windows)]
pub async fn attach(view: &tauri::Webview) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    use windows::{core::{HSTRING, PWSTR}, Win32::System::Com::IStream};
    use webview2_com::{CoTaskMemPWSTR, WebResourceRequestedEventHandler, Microsoft::Web::WebView2::Win32::*};

    let app = view.app_handle().clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = native.controller().CoreWebView2()?;
            let environment = native.environment();
            let filter = format!("https://{}{}*", rule()["source"].as_str().unwrap(), rule()["pathPrefix"].as_str().unwrap());
            core.AddWebResourceRequestedFilter(&HSTRING::from(filter), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE)?;
            core.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                if !app.state::<crate::BridgeState>().bridge.as_ref().is_some_and(|b| b.community_active.load(Ordering::Relaxed)) { return Ok(()); }
                let Some(args) = args else { return Ok(()); };
                let request = args.Request()?;
                let mut raw = PWSTR::null();
                request.Method(&mut raw)?;
                let method = CoTaskMemPWSTR::from(raw).to_string();
                if !matches!(method.as_str(), "GET" | "HEAD") { return Ok(()); }
                request.Uri(&mut raw)?;
                let Some(target) = image_uri(&CoTaskMemPWSTR::from(raw).to_string()) else { return Ok(()); };
                // A normal temporary redirect preserves Chromium's origin, cookie and
                // HTTPS policies. Never cache the toggle-dependent route in the profile.
                let headers = format!("Location: {target}\r\nCache-Control: no-store\r\n");
                let response = environment.CreateWebResourceResponse(None::<&IStream>, 302, &HSTRING::from("Found"), &HSTRING::from(headers))?;
                args.SetResponse(&response)
            })), &mut 0)?;
            Ok(())
        })();
        let _ = tx.send(result.map_err(super::err));
    }).map_err(super::err)?;
    rx.await.map_err(super::err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_steam_covers_keep_path_and_thumbnail_parameters() {
        let source = "https://images.steamusercontent.com/ugc/123/ABC/?imw=320&imh=200&imcolor=%23000000";
        assert_eq!(image_uri(source).unwrap(), source.replace("images.steamusercontent.com", "steamuserimages-a.akamaihd.net"));
        for url in ["http://images.steamusercontent.com/ugc/123/ABC/", "https://images.steamusercontent.com:8443/ugc/123/ABC/",
            "https://user:secret@images.steamusercontent.com/ugc/123/ABC/", "https://images.steamusercontent.com/login/",
            "https://images.steamusercontent.com.example.org/ugc/123/ABC/", "https://www.gamemaps.com/ugc/123/ABC/"] {
            assert!(image_uri(url).is_none(), "{url}");
        }
    }
}
