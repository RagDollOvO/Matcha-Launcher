use super::BrowserState;
use serde_json::{json, Value};

fn clean(list: &Value) -> Vec<Value> {
    let mut out = Vec::<Value>::new();
    for c in list.as_array().into_iter().flatten() {
        let Some(source) = c["source"].as_str() else { continue };
        let sites: &[&str] = match source {
            "steam" => &["steamcommunity.com"], "bilibili" => &["bilibili.com"],
            "gamemaps" => &["gamemaps.com"], "afdian" => &["afdian.com", "afdian.net", "ifdian.net"],
            _ => continue,
        };
        if out.iter().any(|v| v["source"] == source) { continue; }
        let Some(url) = c["url"].as_str().and_then(|s| tauri::Url::parse(s).ok()) else { continue };
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() { continue; }
        if !url.host_str().is_some_and(|h| sites.iter().any(|s| h == *s || h.strip_suffix(s).is_some_and(|p| p.ends_with('.')))) { continue; }
        let Some(title) = c["title"].as_str() else { continue };
        let label = |s: &str| s.trim().chars().take(200).collect::<String>();
        let mut item = json!({"source":source, "url":url.as_str(), "title":label(title)});
        if let Some(author) = c["author"].as_str().map(label).filter(|s| !s.is_empty()) { item["author"] = json!(author); }
        out.push(item);
        if out.len() == 2 { break; }
    }
    out
}

pub(super) fn annotate(state: &BrowserState, id: &str, input: &Value) -> Result<Value, String> {
    if let Some(e) = &state.load_error { return Err(e.clone()); }
    let mut rows = state.downloads.lock().unwrap();
    let i = rows.iter().position(|r| r["id"].as_str() == Some(id)).ok_or("下载记录已移除。")?;
    let creators = clean(input);
    if !creators.is_empty() && rows[i]["creators"] != json!(creators) {
        let previous = rows[i].clone();
        rows[i]["creators"] = json!(creators);
        if let Err(e) = state.save(&rows) { rows[i] = previous; return Err(e); }
    }
    Ok(json!({"creators": clean(&rows[i]["creators"])}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn annotate_persists_only_existing_download_sources() {
        let folder = std::env::temp_dir().join(format!("matcha-annotate-{}-{}", std::process::id(), chrono::Utc::now().timestamp_micros()));
        std::fs::create_dir(&folder).unwrap();
        let state = BrowserState { downloads: vec![json!({"id":"1-0","state":"done","path":"original.zip"})].into(),
            pages: Default::default(), steam_views: Default::default(), folder, load_error: None };
        let video = json!({"source":"bilibili","url":"https://www.bilibili.com/video/BV1xx411c7mD","title":"演示"});
        let fake = json!({"source":"bilibili","url":"https://bilibili.com.example.org/","title":"无效"});
        let result = annotate(&state, "1-0", &json!([fake, video])).unwrap();
        assert_eq!(result, json!({"creators":[video]}));
        assert_eq!(annotate(&state, "1-0", &json!([fake])).unwrap(), result);
        assert!(annotate(&state, "missing", &json!([video])).is_err());
        let file = state.folder.join("downloads.json");
        let rows: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert_eq!(rows, json!([{"id":"1-0","state":"done","path":"original.zip","creators":[video]}]));
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(state.folder).unwrap();
    }
}
