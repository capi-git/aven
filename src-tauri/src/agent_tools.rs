//! Read-only health checks for optional desktop tooling. Never requests a TCC
//! grant, launches a GUI helper, or changes a provider's configuration.
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermission {
    name: String,
    granted: bool,
    required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopToolStatus {
    state: &'static str,
    executable: Option<String>,
    version: Option<String>,
    source: Option<String>,
    permissions: Vec<ToolPermission>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolStatus {
    browser_available: bool,
    desktop: DesktopToolStatus,
}

fn short_text(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect()
}

fn parse_permissions(text: &str) -> Result<(Vec<ToolPermission>, Option<String>), ()> {
    let value: Value = serde_json::from_str(text).map_err(|_| ())?;
    if value.get("success").and_then(Value::as_bool) == Some(false) {
        return Err(());
    }
    let data = value.get("data").unwrap_or(&value);
    let rows = data
        .get("permissions")
        .and_then(Value::as_array)
        .ok_or(())?;
    let mut permissions = Vec::new();
    for row in rows {
        let raw_name = row.get("name").and_then(Value::as_str).ok_or(())?;
        let normalized: String = raw_name
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .flat_map(char::to_lowercase)
            .collect();
        let name = match normalized.as_str() {
            "screenrecording" => "Screen Recording",
            "accessibility" => "Accessibility",
            "eventsynthesizing" => "Event Synthesizing",
            _ => {
                // A newly required permission is not evidence of readiness.
                if row.get("isRequired").and_then(Value::as_bool) != Some(false) {
                    return Err(());
                }
                continue;
            }
        };
        if permissions.iter().any(|p: &ToolPermission| p.name == name) {
            return Err(());
        }
        permissions.push(ToolPermission {
            name: name.into(),
            granted: row.get("isGranted").and_then(Value::as_bool).ok_or(())?,
            required: name != "Event Synthesizing"
                || row.get("isRequired").and_then(Value::as_bool) != Some(false),
        });
    }
    if !["Screen Recording", "Accessibility"]
        .iter()
        .all(|name| permissions.iter().any(|p| p.name == *name))
    {
        return Err(());
    }
    let source = data.get("source").and_then(Value::as_str).map(short_text);
    Ok((permissions, source))
}

fn run_probe(path: &Path, args: &[&str], timeout: Duration) -> Result<String, ()> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::harness::apply_gui_env(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| ())?;
    let output = child.stdout.take().ok_or(())?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = output
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ())
            .and_then(|_| {
                if bytes.len() > 64 * 1024 {
                    Err(())
                } else {
                    String::from_utf8(bytes).map_err(|_| ())
                }
            });
        let _ = tx.send(result);
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                return rx
                    .recv_timeout(Duration::from_millis(200))
                    .map_err(|_| ())?
            }
            Ok(Some(_)) => return Err(()),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err(());
            }
        }
    }
}

fn desktop_status() -> DesktopToolStatus {
    let mut status = DesktopToolStatus {
        state: "unsupported",
        executable: None,
        version: None,
        source: None,
        permissions: Vec::new(),
    };
    if !cfg!(target_os = "macos") {
        return status;
    }
    let Some(path) = crate::harness::resolve_gui_binary("peekaboo") else {
        status.state = "missing";
        return status;
    };
    status.executable = Some(path.to_string_lossy().into_owned());
    status.state = "unverified";
    let Ok(version) = run_probe(&path, &["--version"], Duration::from_secs(3)) else {
        return status;
    };
    status.version = version
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(short_text);
    if let Ok(text) = run_probe(
        &path,
        &["permissions", "status", "--json"],
        Duration::from_secs(5),
    ) {
        if let Ok((permissions, source)) = parse_permissions(&text) {
            status.state = if permissions.iter().filter(|p| p.required).all(|p| p.granted) {
                "ready"
            } else {
                "permissionsRequired"
            };
            status.permissions = permissions;
            status.source = source;
        }
    }
    status
}

#[tauri::command]
pub async fn agent_tool_status(caller: tauri::Webview) -> Result<AgentToolStatus, String> {
    crate::browser::label(&caller, "tool-status")?;
    tauri::async_runtime::spawn_blocking(|| AgentToolStatus {
        browser_available: cfg!(target_os = "macos"),
        desktop: desktop_status(),
    })
    .await
    .map_err(|_| "Tool status could not be checked. Try again.".into())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_are_checked_as_a_complete_snapshot() {
        let text = r#"{"success":true,"data":{"source":"Peekaboo Bridge","permissions":[{"name":"Screen Recording","isRequired":true,"isGranted":true},{"name":"Accessibility","isRequired":true,"isGranted":false},{"name":"Event Synthesizing","isRequired":false,"isGranted":false}]}}"#;
        let (permissions, source) = parse_permissions(text).unwrap();
        assert_eq!(source.as_deref(), Some("Peekaboo Bridge"));
        assert!(!permissions.iter().filter(|p| p.required).all(|p| p.granted));
        assert!(!permissions[2].required);
        let (permissions, _) = parse_permissions(&text.replace(
            "\"Accessibility\",\"isRequired\":true,\"isGranted\":false",
            "\"Accessibility\",\"isRequired\":true,\"isGranted\":true",
        ))
        .unwrap();
        assert!(permissions.iter().filter(|p| p.required).all(|p| p.granted));
    }

    #[test]
    fn missing_malformed_or_failed_status_is_never_ready() {
        for text in [
            "not JSON",
            r#"{"permissions":[]}"#,
            r#"{"success":false,"data":{"permissions":[]}}"#,
            r#"{"permissions":[{"name":"Screen Recording","isGranted":true}]}"#,
        ] {
            assert!(parse_permissions(text).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_stuck_probe_is_bounded_and_reaped() {
        let start = Instant::now();
        assert!(run_probe(
            Path::new("/bin/sh"),
            &["-c", "sleep 10"],
            Duration::from_millis(40)
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
