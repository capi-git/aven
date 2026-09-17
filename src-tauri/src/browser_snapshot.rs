//! A one-shot image of an owned preview for the brief time a host popup covers it.
//! No desktop capture, file output, retained snapshot cache, or background work.

use tauri::Webview;

#[tauri::command]
pub async fn browser_snapshot(caller: Webview, id: String) -> Result<String, String> {
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        let result = crate::browser::preview(&caller, &id)?
            .command(serde_json::json!({"action":"snapshot"}))
            .await?;
        let data = result
            .as_str()
            .or_else(|| result.get("data").and_then(serde_json::Value::as_str))
            .ok_or("Chromium did not return an image")?;
        if data.len() > 12 * 1024 * 1024 {
            return Err("Browser image exceeds the size limit".into());
        }
        Ok(if data.starts_with("data:image/") {
            data.to_string()
        } else {
            format!("data:image/png;base64,{data}")
        })
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
