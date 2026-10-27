//! Aven Dev's iPhone check (`scripts/dev-aven.py --iphone`): hooks that let
//! the workspace drive its own iPhone pane like a person would, without system
//! input or screen captures. Debug builds only, and only while the check's
//! marked throwaway folder exists; release builds do not contain them.
#![cfg(all(debug_assertions, target_os = "macos"))]

use crate::ios_sim;
use crate::ios_sim_native as native;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Manager, Webview};

fn check_folder() -> Result<std::path::PathBuf, String> {
    crate::dev_smoke::smoke_dir().ok_or_else(|| "Only during Aven Dev's iPhone check".to_string())
}

fn checked_udid(udid: &str) -> Result<(), String> {
    if crate::ios_sim_devices::valid_udid(udid) {
        Ok(())
    } else {
        Err("Not a simulator".into())
    }
}

/// The foreground app's accessibility nodes, from Aven's XCUITest agent.
#[tauri::command]
pub async fn ios_sim_dev_snapshot(
    udid: String,
    bundle_id: Option<String>,
) -> Result<Value, String> {
    check_folder()?;
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::ios_sim_xcuitest::connect(&udid, bundle_id.as_deref())?
            .request(json!({ "action": "snapshot" }))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The screen's upright size in points and UIKit orientation.
#[tauri::command]
pub async fn ios_sim_dev_screen(udid: String) -> Result<Value, String> {
    check_folder()?;
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let screen = ios_sim::screen(&udid)?;
        let (width, height) = screen.size();
        Ok(json!({ "width": width, "height": height, "orientation": screen.info.orientation }))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Clicks a pane's live view at an upright screen point.
#[tauri::command]
pub async fn ios_sim_dev_click(caller: Webview, id: String, x: f64, y: f64) -> Result<(), String> {
    check_folder()?;
    let udid = ios_sim::view_device(&id).ok_or("That iPhone pane shows no device")?;
    let screen = tauri::async_runtime::spawn_blocking(move || ios_sim::screen(&udid))
        .await
        .map_err(|error| error.to_string())??;
    let (fx, fy) = screen.to_device(x, y);
    let app = caller.app_handle().clone();
    ios_sim::on_main(&app, move || native::view_debug_click(&id, fx, fy)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevKey {
    /// macOS virtual key code.
    code: u16,
    #[serde(default)]
    text: String,
    /// NSEvent modifier flags.
    #[serde(default)]
    modifiers: u64,
}

/// Presses keys in a pane's live view, as its keyboard would.
#[tauri::command]
pub async fn ios_sim_dev_keys(
    caller: Webview,
    id: String,
    keys: Vec<DevKey>,
) -> Result<(), String> {
    check_folder()?;
    if keys.len() > 200 {
        return Err("Too many keys".into());
    }
    let app = caller.app_handle().clone();
    for key in keys {
        let id = id.clone();
        ios_sim::on_main(&app, move || {
            native::view_debug_key(&id, key.code, &key.text, key.modifiers)
        })
        .await?;
        tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(40))
        })
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Frames the simulator drew and a pane's live view showed so far, and
/// whether its window is on screen (hidden windows show none).
#[tauri::command]
pub async fn ios_sim_dev_frames(caller: Webview, id: String) -> Result<Value, String> {
    check_folder()?;
    let app = caller.app_handle().clone();
    let (drawn, shown, visible) = ios_sim::on_main(&app, move || {
        native::view_frames(&id).ok_or_else(|| "That iPhone pane is gone".to_string())
    })
    .await?;
    Ok(json!({ "drawn": drawn, "shown": shown, "visible": visible }))
}

/// Saves the screen (upright PNG) into the check's `shots` folder.
#[tauri::command]
pub async fn ios_sim_dev_shot(udid: String, name: String) -> Result<String, String> {
    let folder = check_folder()?.join("shots");
    checked_udid(&udid)?;
    if name.is_empty()
        || name.len() > 64
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid shot name".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (png, _) = ios_sim::screenshot_png(&udid)?;
        std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
        let path = folder.join(format!("{name}.png"));
        std::fs::write(&path, png).map_err(|error| error.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}
