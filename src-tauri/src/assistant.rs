//! Side browser panel: ChatGPT, Gemini or any site next to notes and papers.
//!
//! These sites refuse to load in an <iframe>, so the panel is a real child
//! webview placed over a slot the frontend reserves. It loads remote pages
//! only: remote origins get no access to Dace's commands (Tauri grants IPC to
//! the app's own origin, not to external URLs), and it shares the app's
//! browser profile, so sign-ins persist between sessions.
//!
//! Every command is async: creating or moving a child webview happens on the
//! main thread, and a synchronous command would block that thread.

use serde::Deserialize;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const LABEL: &str = "assistant";

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PanelBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn parse_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "That doesn't look like a web address.".to_string())?;
    match url.scheme() {
        "https" | "http" => Ok(url),
        _ => Err("Only web pages (https://…) can open in the side panel.".to_string()),
    }
}

fn apply_bounds(webview: &tauri::Webview, bounds: PanelBounds) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0)))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)))
        .map_err(|e| e.to_string())
}

/// Show the panel at `bounds`, creating it on first use. Navigates only when
/// `url` differs from what is loaded, so reopening keeps the conversation.
#[tauri::command]
pub async fn assistant_show(app: AppHandle, url: String, bounds: PanelBounds) -> Result<(), String> {
    let target = parse_url(&url)?;
    if let Some(webview) = app.get_webview(LABEL) {
        apply_bounds(&webview, bounds)?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target))
        // Sign-in pop-ups (Google, Microsoft, Apple) open as their own window.
        .on_new_window(|_url, _features| NewWindowResponse::Allow);
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0)),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|e| format!("Could not open the side panel: {}", e))?;
    let _ = webview.show();
    Ok(())
}

#[tauri::command]
pub async fn assistant_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let target = parse_url(&url)?;
    let webview = app
        .get_webview(LABEL)
        .ok_or_else(|| "The side panel isn't open.".to_string())?;
    webview.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assistant_set_bounds(app: AppHandle, bounds: PanelBounds) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => apply_bounds(&webview, bounds),
        None => Ok(()),
    }
}

/// Hide (not destroy) so the page, its scroll position and sign-in survive.
#[tauri::command]
pub async fn assistant_hide(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn assistant_reload(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(webview) => webview.reload().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn assistant_current_url(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .get_webview(LABEL)
        .and_then(|webview| webview.url().ok())
        .map(|url| url.to_string()))
}

#[cfg(test)]
mod tests {
    use super::parse_url;

    #[test]
    fn only_web_addresses_are_allowed() {
        assert!(parse_url("https://chatgpt.com/").is_ok());
        assert!(parse_url("http://localhost:3000").is_ok());
        assert!(parse_url("file:///C:/secret.txt").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        assert!(parse_url("not a url").is_err());
    }
}
