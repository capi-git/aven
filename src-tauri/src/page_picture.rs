//! A picture of a page of the user's running app, at a phone's or a
//! desktop's size, for the before and after pictures in Avos's Review.
//!
//! The page loads in a borderless WebKit window placed off screen, with no
//! saved cookies or storage (a private data store), no access to Aven (its
//! label has no capability) and no address but a local one, then WebKit
//! snapshots it and the window goes. Nothing is written to disk.
//!
//! Before the picture, a script in a WebKit world of Aven's own (the page's
//! scripts can't see it) reads where things are: the spots the Builder
//! named, and what you might click to leave Avos a note.

use crate::browser_snapshot::PageCapture;
use tauri::AppHandle;
use tauri::Url;

/// Spots looked up on a page at most, and a selector's longest.
const MARKS_MAX: usize = 6;
const MARK_CHARS: usize = 200;
/// The layout's largest reply from the page.
const LAYOUT_BYTES: usize = 256 * 1024;

/// A picture and where things are in it.
#[derive(Debug, serde::Serialize)]
pub struct PagePicture {
    #[serde(flatten)]
    capture: PageCapture,
    /// `{spots, parts}` from `page_picture.js`, or null when unreadable.
    layout: serde_json::Value,
}

/// The selectors to look up: a few, each one line and not too long.
fn marks(selectors: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let selectors = selectors.unwrap_or_default();
    if selectors.len() > MARKS_MAX
        || selectors
            .iter()
            .any(|mark| mark.is_empty() || mark.chars().count() > MARK_CHARS || mark.contains('\n'))
    {
        return Err("Invalid spots for a picture".into());
    }
    Ok(selectors)
}

/// The page's answer, if it is the shape `page_picture.js` returns.
fn layout(reply: &str) -> serde_json::Value {
    if reply.len() > LAYOUT_BYTES {
        return serde_json::Value::Null;
    }
    match serde_json::from_str::<serde_json::Value>(reply) {
        Ok(value)
            if value.get("spots").is_some_and(|v| v.is_array())
                && value.get("parts").is_some_and(|v| v.is_array()) =>
        {
            value
        }
        _ => serde_json::Value::Null,
    }
}

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
    marks: Option<Vec<String>>,
) -> Result<PagePicture, String> {
    let url = local_page(&url)?;
    if !WIDTH.contains(&width) || !HEIGHT.contains(&height) {
        return Err("Invalid picture size".into());
    }
    let marks = self::marks(marks)?;
    #[cfg(target_os = "macos")]
    {
        take(app, url, width, height, marks).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, url, marks);
        Err("Pictures of pages are only taken on macOS".into())
    }
}

#[cfg(target_os = "macos")]
async fn take(
    app: AppHandle,
    url: Url,
    width: u32,
    height: u32,
    marks: Vec<String>,
) -> Result<PagePicture, String> {
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
        // Where things are, then the picture: nothing moves in between.
        let reply = read_layout(webview.clone(), &marks).await;
        let data_url = crate::browser_snapshot::capture(webview).await?;
        Ok(PagePicture {
            capture: crate::browser_snapshot::page_capture(&serde_json::Value::String(data_url))?,
            layout: reply
                .as_deref()
                .map(layout)
                .unwrap_or(serde_json::Value::Null),
        })
    }
    .await;
    let _ = window.destroy();
    result
}

#[cfg(target_os = "macos")]
thread_local! {
    // WebKit keeps named worlds weakly: hold ours between pictures.
    static WORLD: std::cell::RefCell<Option<objc2::rc::Retained<objc2::runtime::AnyObject>>> =
        const { std::cell::RefCell::new(None) };
}

/// `page_picture.js` run on the page, in Aven's own world; None when the
/// page wouldn't answer (the picture is still taken).
#[cfg(target_os = "macos")]
async fn read_layout(view: tauri::Webview, marks: &[String]) -> Option<String> {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::{NSError, NSString};
    use std::{sync::mpsc, time::Duration};

    let marks = serde_json::to_string(marks).ok()?;
    let script = format!("{}({})", include_str!("page_picture.js"), marks);
    let (sender, receiver) = mpsc::channel::<Option<String>>();
    view.with_webview(move |platform| unsafe {
        let wk = &*platform.inner().cast::<AnyObject>();
        let world = WORLD.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_none() {
                let class = AnyClass::get(c"WKContentWorld")?;
                let name = NSString::from_str("com.capi.aven.review-picture");
                *slot = Some(msg_send![class, worldWithName: &*name]);
            }
            slot.clone()
        });
        let Some(world) = world else {
            let _ = sender.send(None);
            return;
        };
        let script = NSString::from_str(&script);
        let completion = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
            let reply = (error.is_null() && !result.is_null())
                .then(|| (*(result.cast::<NSString>())).to_string());
            let _ = sender.send(reply);
        });
        let frame: *const AnyObject = std::ptr::null();
        let _: () = msg_send![wk, evaluateJavaScript: &*script, inFrame: frame, inContentWorld: &*world, completionHandler: &*completion];
    })
    .ok()?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(3)).ok().flatten()
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::{layout, local_page, marks};

    #[test]
    fn looks_up_a_few_one_line_spots() {
        assert_eq!(marks(None).unwrap(), Vec::<String>::new());
        assert!(marks(Some(vec!["main .cta".into()])).is_ok());
        assert!(marks(Some(vec!["a".into(); 7])).is_err());
        assert!(marks(Some(vec!["a\nb".into()])).is_err());
        assert!(marks(Some(vec!["x".repeat(201)])).is_err());
        assert!(marks(Some(vec![String::new()])).is_err());
    }

    #[test]
    fn keeps_only_a_layout_of_the_expected_shape() {
        assert!(layout(r#"{"spots":[null],"parts":[]}"#).is_object());
        assert!(layout(r#"{"spots":1,"parts":[]}"#).is_null());
        assert!(layout("not json").is_null());
        let big = format!(r#"{{"spots":[],"parts":["{}"]}}"#, "x".repeat(300 * 1024));
        assert!(layout(&big).is_null());
    }

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
