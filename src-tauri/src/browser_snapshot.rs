//! A one-shot image of an owned preview for the brief time a host popup covers it.
//! No desktop capture, file output, retained snapshot cache, or background work.
//!
//! `browser_capture` is the lossless picture the person marks up before
//! sending it to a chat. It reuses the agent screenshot path, so it copies the
//! page as shown without moving or resizing it, and it writes nothing to disk.

use tauri::Webview;

/// A lossless PNG of what the page shows, as a data URL plus its pixel size.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageCapture {
    data_url: String,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn browser_capture(caller: Webview, id: String) -> Result<PageCapture, String> {
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        let page = crate::browser::preview(&caller, &id)?;
        // The helper refuses while the page loads or another capture or zoom
        // change runs; those refusals become plain advice to try again.
        let result = page
            .command(serde_json::json!({"action":"agent-screenshot"}))
            .await
            .map_err(|error| plain_capture_error(&error))?;
        page_capture(&result)
    }
    #[cfg(all(target_os = "macos", not(feature = "chromium")))]
    {
        // WebKit has no separate lossless path; its snapshot is already a PNG.
        let data_url = capture(crate::browser::preview(&caller, &id)?)
            .await
            .map_err(|error| plain_capture_error(&error))?;
        page_capture(&serde_json::Value::String(data_url))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (caller, id);
        Err("Marking up a page is only available on macOS".into())
    }
}

/// The largest picture accepted for marking up. These match the Chromium
/// helper's own bounds for page captures, and keep the export canvas small
/// enough for WebKit to draw.
#[cfg(any(test, target_os = "macos"))]
const CAPTURE_MAX_EDGE: u32 = 4096;
#[cfg(any(test, target_os = "macos"))]
const CAPTURE_MAX_PIXELS: u64 = 8 * 1024 * 1024;
#[cfg(any(test, target_os = "macos"))]
const CAPTURE_MAX_BASE64: usize = 12 * 1024 * 1024;

/// Accept only a bounded PNG, from either `{data, mimeType, width, height}`
/// or a `data:image/png;base64,` string, and report its real pixel size.
#[cfg(any(test, target_os = "macos"))]
fn page_capture(result: &serde_json::Value) -> Result<PageCapture, String> {
    use base64::Engine;

    const PREFIX: &str = "data:image/png;base64,";
    const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    let unusable = || "Could not capture this page. Try again.".to_string();
    let raw = result
        .as_str()
        .or_else(|| result.get("data").and_then(serde_json::Value::as_str))
        .ok_or_else(unusable)?;
    let data = match raw.strip_prefix(PREFIX) {
        Some(data) => data,
        None if raw.starts_with("data:") => return Err(unusable()),
        None => raw,
    };
    if result
        .get("mimeType")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|mime| mime != "image/png")
    {
        return Err(unusable());
    }
    if data.len() > CAPTURE_MAX_BASE64 {
        return Err(too_large());
    }
    if data.len() < 32
        || data.len() % 4 != 0
        || !data
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return Err(unusable());
    }
    // The signature and IHDR chunk sit in the first 24 bytes (32 characters).
    let header = base64::engine::general_purpose::STANDARD
        .decode(&data[..32])
        .map_err(|_| unusable())?;
    if header[..8] != SIGNATURE || &header[8..16] != b"\0\0\0\rIHDR" {
        return Err(unusable());
    }
    let number = |at: usize| {
        u32::from_be_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]])
    };
    let (width, height) = (number(16), number(20));
    if width == 0 || height == 0 {
        return Err(unusable());
    }
    if width > CAPTURE_MAX_EDGE
        || height > CAPTURE_MAX_EDGE
        || u64::from(width) * u64::from(height) > CAPTURE_MAX_PIXELS
    {
        return Err(too_large());
    }
    let reported = |key: &str| result.get(key).and_then(serde_json::Value::as_u64);
    if reported("width").is_some_and(|value| value != u64::from(width))
        || reported("height").is_some_and(|value| value != u64::from(height))
    {
        return Err(unusable());
    }
    Ok(PageCapture {
        data_url: format!("{PREFIX}{data}"),
        width,
        height,
    })
}

#[cfg(any(test, target_os = "macos"))]
fn too_large() -> String {
    "This page is too large to capture. Make the browser pane smaller and try again.".into()
}

/// The helper explains refusals for agents ("Retry the screenshot"). Say the
/// same thing to a person in plain words.
#[cfg(any(test, target_os = "macos"))]
fn plain_capture_error(error: &str) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("still loading") {
        "The page is still loading. Try again in a moment.".into()
    } else if lower.contains("another image") || lower.contains("zoom change") {
        "The browser is finishing another picture. Try again in a moment.".into()
    } else if lower.contains("moved or closed while capturing") {
        "The page moved while it was being captured. Try again.".into()
    } else if lower.contains("limit") {
        too_large()
    } else if lower.contains("closed") {
        "This page closed before it could be captured.".into()
    } else if error.trim().is_empty() {
        "Could not capture this page. Try again.".into()
    } else {
        format!("Could not capture this page: {error}")
    }
}

#[tauri::command]
pub async fn browser_snapshot(caller: Webview, id: String) -> Result<String, String> {
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        let result = crate::browser::preview(&caller, &id)?
            .command(serde_json::json!({"action":"snapshot"}))
            .await?;
        chromium_data_url(&result)
    }
    #[cfg(all(target_os = "macos", not(feature = "chromium")))]
    {
        capture(crate::browser::preview(&caller, &id)?).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (caller, id);
        Err("Preview snapshots are only available on macOS".into())
    }
}

#[cfg(any(test, all(feature = "chromium", target_os = "macos")))]
fn chromium_data_url(result: &serde_json::Value) -> Result<String, String> {
    let data = result
        .as_str()
        .or_else(|| result.get("data").and_then(serde_json::Value::as_str))
        .ok_or("Chromium did not return an image")?;
    if data.is_empty() || data.len() > 12 * 1024 * 1024 {
        return Err("Browser image exceeds the size limit".into());
    }
    if data.starts_with("data:image/png;base64,") || data.starts_with("data:image/jpeg;base64,") {
        return Ok(data.to_string());
    }
    if data.starts_with("data:") {
        return Err("Unsupported browser image format".into());
    }
    let mime = result
        .get("mimeType")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("image/png");
    if !matches!(mime, "image/png" | "image/jpeg") {
        return Err("Unsupported browser image format".into());
    }
    Ok(format!("data:{mime};base64,{data}"))
}

#[cfg(test)]
mod chromium_tests {
    use super::chromium_data_url;
    use serde_json::json;

    #[test]
    fn temporary_cover_uses_the_returned_mime_type() {
        assert_eq!(
            chromium_data_url(&json!({"data":"aW1hZ2U=","mimeType":"image/jpeg"})).unwrap(),
            "data:image/jpeg;base64,aW1hZ2U="
        );
        assert_eq!(
            chromium_data_url(&json!({"data":"aW1hZ2U="})).unwrap(),
            "data:image/png;base64,aW1hZ2U="
        );
        assert_eq!(
            chromium_data_url(&json!("data:image/png;base64,aW1hZ2U=")).unwrap(),
            "data:image/png;base64,aW1hZ2U="
        );
    }

    #[test]
    fn rejects_missing_oversized_and_unsupported_images() {
        for value in [
            json!({}),
            json!({"data":""}),
            json!({"data":"a","mimeType":"image/svg+xml"}),
            json!("data:text/html;base64,a"),
            json!("a".repeat(12 * 1024 * 1024 + 1)),
        ] {
            assert!(chromium_data_url(&value).is_err());
        }
    }
}

#[cfg(test)]
mod capture_tests {
    use super::{page_capture, plain_capture_error, PageCapture};
    use base64::Engine;
    use serde_json::json;

    /// A PNG signature and IHDR header for the given size, plus some bytes.
    fn png(width: u32, height: u32) -> String {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0, 1, 2, 3, 4]);
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn returns_the_helper_png_as_a_data_url_with_its_real_size() {
        let data = png(1200, 800);
        let capture = page_capture(&json!({
            "data": data,
            "mimeType": "image/png",
            "width": 1200,
            "height": 800,
            "visible": true,
        }))
        .unwrap();
        assert_eq!(
            capture,
            PageCapture {
                data_url: format!("data:image/png;base64,{data}"),
                width: 1200,
                height: 800,
            }
        );
        assert_eq!(
            serde_json::to_value(&capture).unwrap(),
            json!({"dataUrl": format!("data:image/png;base64,{data}"), "width": 1200, "height": 800})
        );
        // WebKit's fallback hands over a finished data URL.
        let webkit = page_capture(&json!(format!("data:image/png;base64,{}", png(640, 400))));
        assert_eq!(webkit.unwrap().width, 640);
    }

    #[test]
    fn refuses_anything_but_a_bounded_png() {
        let ok = png(10, 10);
        for value in [
            json!({}),
            json!({"data": ""}),
            json!({"data": "iVBORw0KGgo="}),
            json!({"data": ok, "mimeType": "image/jpeg"}),
            json!(format!("data:image/jpeg;base64,{ok}")),
            json!({"data": format!("{}!", &ok[..ok.len() - 1])}),
            json!({"data": format!("{ok}A")}),
            json!({"data": base64::engine::general_purpose::STANDARD.encode([0u8; 40])}),
            json!({"data": png(0, 10)}),
            json!({"data": ok, "width": 11, "height": 10}),
        ] {
            assert_eq!(
                page_capture(&value),
                Err("Could not capture this page. Try again.".into()),
                "{value}"
            );
        }
        for value in [
            json!({"data": png(4097, 10)}),
            json!({"data": png(4096, 4096)}),
            json!({"data": "A".repeat(12 * 1024 * 1024 + 4)}),
        ] {
            assert!(page_capture(&value).unwrap_err().contains("too large"));
        }
        assert_eq!(
            page_capture(&json!({"data": png(4096, 2048)}))
                .unwrap()
                .height,
            2048
        );
    }

    #[test]
    fn explains_helper_refusals_in_plain_words() {
        assert_eq!(
            plain_capture_error(
                "The page is still loading. Retry the screenshot after it finishes."
            ),
            "The page is still loading. Try again in a moment."
        );
        assert_eq!(
            plain_capture_error(
                "The browser is finishing another image or zoom change. Retry shortly."
            ),
            "The browser is finishing another picture. Try again in a moment."
        );
        assert_eq!(
            plain_capture_error("The page moved or closed while capturing. Retry the screenshot."),
            "The page moved while it was being captured. Try again."
        );
        assert!(plain_capture_error(
            "Could not capture this page within the image limit. Make the browser pane smaller and retry."
        )
        .contains("too large"));
        assert_eq!(
            plain_capture_error("Browser is closed"),
            "This page closed before it could be captured."
        );
        assert_eq!(
            plain_capture_error("Renderer crashed"),
            "Could not capture this page: Renderer crashed"
        );
    }
}

#[cfg(all(target_os = "macos", not(feature = "chromium")))]
const MAX_PIXEL_EDGE: f64 = 1280.0;
#[cfg(all(target_os = "macos", not(feature = "chromium")))]
const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;

/// WKSnapshotConfiguration uses points; account for Retina so the temporary
/// image is at most one pixel per logical view point, and 1280 on either edge.
#[cfg(all(target_os = "macos", not(feature = "chromium")))]
fn snapshot_width(width: f64, height: f64, display_scale: f64) -> Result<f64, String> {
    if [width, height, display_scale]
        .iter()
        .any(|value| !value.is_finite() || *value <= 0.0)
    {
        return Err("Preview has no drawable bounds".into());
    }
    let ratio = (MAX_PIXEL_EDGE / width)
        .min(MAX_PIXEL_EDGE / height)
        .min(1.0);
    if width * ratio < 1.0 || height * ratio < 1.0 {
        return Err("Preview is too narrow to snapshot".into());
    }
    Ok(width * ratio / display_scale)
}

#[cfg(all(target_os = "macos", not(feature = "chromium")))]
async fn capture(view: Webview) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_app_kit::NSImage;
    use objc2_foundation::{NSError, NSNumber, NSRect};
    use std::sync::mpsc;
    use std::time::Duration;

    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    view.with_webview(move |platform| {
        // WKWebView and the configuration are borrowed/owned solely on the
        // main thread. WebKit copies the completion block before returning;
        // only a byte vector crosses the channel into the async command.
        unsafe {
            let wk = &*platform.inner().cast::<AnyObject>();
            let bounds: NSRect = msg_send![wk, bounds];
            let window: *mut AnyObject = msg_send![wk, window];
            if window.is_null() {
                let _ = sender.send(Err("Preview is not attached to a window".into()));
                return;
            }
            let scale: f64 = msg_send![&*window, backingScaleFactor];
            let width = match snapshot_width(bounds.size.width, bounds.size.height, scale) {
                Ok(width) => width,
                Err(error) => {
                    let _ = sender.send(Err(error));
                    return;
                }
            };
            let Some(class) = AnyClass::get(c"WKSnapshotConfiguration") else {
                let _ = sender.send(Err("WebKit snapshots are unavailable".into()));
                return;
            };
            let configuration: Retained<AnyObject> = msg_send![class, new];
            let width = NSNumber::numberWithDouble(width);
            let _: () = msg_send![&*configuration, setRect: bounds];
            let _: () = msg_send![&*configuration, setSnapshotWidth: &*width];
            // Capture the current page without waiting for a later animation
            // frame, which may be throttled while host chrome has focus.
            let _: () = msg_send![&*configuration, setAfterScreenUpdates: Bool::NO];
            let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = if !error.is_null() || image.is_null() {
                    Err("WebKit could not snapshot this preview".into())
                } else {
                    png_bytes(&*image)
                };
                // A closed preview or expired receiver needs no retry.
                let _ = sender.send(result);
            });
            let _: () = msg_send![wk,
                takeSnapshotWithConfiguration: &*configuration,
                completionHandler: &*completion
            ];
        }
    })
    .map_err(|error| error.to_string())?;

    let bytes = tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "Preview snapshot timed out".to_string())?
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(all(target_os = "macos", not(feature = "chromium")))]
fn png_bytes(image: &objc2_app_kit::NSImage) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "Preview snapshot has no image data".to_string())?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "Preview snapshot could not be decoded".to_string())?;
    // An empty typed dictionary supplies no potentially invalid properties.
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or_else(|| "Preview snapshot could not be encoded".to_string())?;
    if png.is_empty() || png.len() > MAX_PNG_BYTES {
        return Err("Preview snapshot exceeds the image limit".into());
    }
    Ok(png.to_vec())
}

#[cfg(all(test, target_os = "macos", not(feature = "chromium")))]
mod tests {
    use super::snapshot_width;

    #[test]
    fn bounds_images_on_retina_and_tall_previews() {
        assert_eq!(snapshot_width(900.0, 600.0, 2.0).unwrap(), 450.0);
        assert_eq!(snapshot_width(2400.0, 1600.0, 2.0).unwrap(), 640.0);
        assert_eq!(snapshot_width(600.0, 2400.0, 2.0).unwrap(), 160.0);
    }

    #[test]
    fn rejects_empty_and_non_finite_geometry() {
        for (width, height, scale) in [
            (0.0, 900.0, 2.0),
            (900.0, f64::NAN, 2.0),
            (900.0, 600.0, f64::INFINITY),
            (900.0, 600.0, 0.0),
            (1.0, 100_000.0, 2.0),
        ] {
            assert!(snapshot_width(width, height, scale).is_err());
        }
    }
}
