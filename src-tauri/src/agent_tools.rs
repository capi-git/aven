//! Read-only native tool status and links to macOS privacy settings.
use serde::Serialize;
use std::process::{Command, Stdio};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStatus {
    browser_available: bool,
    desktop: crate::desktop_control::DesktopStatus,
}

#[tauri::command]
pub async fn agent_tool_status(caller: tauri::Webview) -> Result<AgentToolStatus, String> {
    crate::browser::label(&caller, "tool-status")?;
    let app = caller.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(AgentToolStatus {
            browser_available: cfg!(target_os = "macos"),
            desktop: crate::desktop_control::status(&app)?,
        })
    })
    .await
    .map_err(|_| "Tool status could not be checked. Try again.".to_string())?
}

#[tauri::command]
pub fn open_computer_use_settings(
    caller: tauri::Webview,
    permission: String,
) -> Result<(), String> {
    crate::browser::label(&caller, "tool-settings")?;
    let pane = match permission.as_str() {
        "screenRecording" => "Privacy_ScreenCapture",
        "accessibility" => "Privacy_Accessibility",
        _ => return Err("Unknown permission settings pane".into()),
    };
    if !cfg!(target_os = "macos") {
        return Err("Desktop control requires macOS.".into());
    }
    Command::new("/usr/bin/open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        })
        .map_err(|_| "Could not open macOS privacy settings.".into())
}
