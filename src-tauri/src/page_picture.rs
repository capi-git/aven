//! A picture of a page of the user's running app, at a phone's or a
//! desktop's size, for the before and after pictures in Avos's Review.
//!
//! The page loads in a borderless WebKit window placed off screen, with no
//! saved cookies or storage (a private data store), no access to Aven (its
//! label has no capability) and no address but a local one, then WebKit
//! snapshots it and the window goes. Nothing is written to disk.

use crate::browser_snapshot::PageCapture;
use tauri::AppHandle;
use tauri::Url;

/// Sizes a picture may be, in CSS pixels.
const WIDTH: std::ops::RangeInclusive<u32> = 320..=1600;
const HEIGHT: std::ops::RangeInclusive<u32> = 400..=1200;

/// Only an app running on this Mac: http(s) on localhost or a loopback
/// address, with a port.
pub(crate) fn local_page(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "Not a page address".to_string())?;
    let local = matches!(parsed.scheme(), "http" | "https")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_some()
        && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if local {
        Ok(parsed)
    } else {
        Err("Pictures are only taken of an app running on this Mac".into())
    }
}

#[tauri::command]
pub async fn page_picture(
    app: AppHandle,
    url: String,
    width: u32,
    height: u32,
) -> Result<PageCapture, String> {
    let url = local_page(&url)?;
    if !WIDTH.contains(&width) || !HEIGHT.contains(&height) {
        return Err("Invalid picture size".into());
    }
    #[cfg(target_os = "macos")]
    {
        take(app, url, width, height).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, url);
        Err("Pictures of pages are only taken on macOS".into())
    }
}

#[cfg(target_os = "macos")]
async fn take(app: AppHandle, url: Url, width: u32, height: u32) -> Result<PageCapture, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;
    use tauri::webview::PageLoadEvent;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    static NEXT: AtomicU64 = AtomicU64::new(1);
    let label = format!("avos-picture-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let (loaded, wait) = std::sync::mpsc::channel::<()>();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Avos picture")
        .inner_size(f64::from(width), f64::from(height))
        .position(-30_000.0, -30_000.0)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(true)
        .incognito(true)
        .disable_drag_drop_handler()
        // It never leaves the page it was given.
        .on_navigation(|url| local_page(url.as_str()).is_ok())
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = loaded.send(());
            }
        })
        .build()
        .map_err(|e| format!("Couldn't open the page for a picture: {e}"))?;
    let result = async {
        // The load, then a moment for scripts, fonts and images to settle.
        tauri::async_runtime::spawn_blocking(move || {
            wait.recv_timeout(Duration::from_secs(20))?;
            std::thread::sleep(Duration::from_millis(1200));
            Ok::<(), std::sync::mpsc::RecvTimeoutError>(())
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The page didn't finish loading in time".to_string())?;
        let webview = app
            .get_webview(&label)
            .ok_or("The page closed before its picture")?;
        let data_url = crate::browser_snapshot::capture(webview).await?;
        crate::browser_snapshot::page_capture(&serde_json::Value::String(data_url))
    }
    .await;
    let _ = window.destroy();
    result
}

#[cfg(test)]
mod tests {
    use super::local_page;

    #[test]
    fn takes_pictures_of_local_apps_only() {
        assert!(local_page("http://127.0.0.1:5174/pricing").is_ok());
        assert!(local_page("http://localhost:3000/").is_ok());
        assert!(local_page("https://[::1]:8443/a").is_ok());
        for refused in [
            "https://example.com/",
            "http://127.0.0.1/",
            "file:///etc/hosts",
            "http://user:pw@127.0.0.1:3000/",
            "http://localhost.evil.com:3000/",
            "javascript:alert(1)",
        ] {
            assert!(local_page(refused).is_err(), "{refused}");
        }
    }
}
