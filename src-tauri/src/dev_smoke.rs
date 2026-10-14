//! Aven Dev's real-app check. `scripts/dev-aven.py --smoke` creates a
//! throwaway folder (a marker file, a home folder whose `.local/bin` holds a
//! stand-in `claude`, and a project),
//! launches the debug app with `AVEN_DEV_SMOKE_DIR` pointing at it, and waits.
//! The workspace then sends one real turn, drives the floating sidebar,
//! reports here and quits.
//!
//! Release builds never enable it: both commands answer as if no check were
//! running unless this is a debug build and the marked folder exists.
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{State, Webview};

const MARKER: &str = ".aven-smoke";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeConfig {
    /// An existing, empty project folder for the check's task.
    project_path: String,
    /// Where the stand-in provider lives; a resolved provider outside it
    /// means the check must not send anything.
    bin_dir: String,
}

fn smoke_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = PathBuf::from(std::env::var_os("AVEN_DEV_SMOKE_DIR")?);
    dir.join(MARKER).is_file().then_some(dir)
}

/// Whether this run is the check, and where its folders are.
#[tauri::command]
pub fn dev_smoke_config() -> Option<SmokeConfig> {
    let dir = smoke_dir()?;
    Some(SmokeConfig {
        project_path: dir.join("project").to_string_lossy().into_owned(),
        bin_dir: dir.join("home/.local/bin").to_string_lossy().into_owned(),
    })
}

/// Record the result for the runner and quit. Only the workspace reports.
#[tauri::command]
pub fn dev_smoke_finish(
    webview: Webview,
    harness: State<'_, crate::harness::HarnessHost>,
    result: Value,
) -> Result<(), String> {
    let dir = smoke_dir().ok_or("The real-app check is not running")?;
    if webview.label() != "main" {
        return Err("Only the workspace reports the real-app check".into());
    }
    let text = serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?;
    std::fs::write(dir.join("result.json"), text).map_err(|error| error.to_string())?;
    // The stand-in provider must not outlive the run.
    harness.kill_all();
    let passed = result.get("passed").and_then(Value::as_bool) == Some(true);
    // The throwaway profile holds nothing to save, and a quit request could be
    // held by the app's own confirmation, so leave at once.
    std::process::exit(if passed { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unmarked_folder_never_enables_the_check() {
        let dir = std::env::temp_dir().join(format!("aven-smoke-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("AVEN_DEV_SMOKE_DIR", &dir);
        assert!(smoke_dir().is_none());
        std::fs::write(dir.join(MARKER), "").unwrap();
        assert_eq!(smoke_dir(), Some(dir.clone()));
        let config = dev_smoke_config().unwrap();
        assert!(config.project_path.ends_with("project"));
        assert!(config.bin_dir.ends_with("home/.local/bin"));
        std::env::remove_var("AVEN_DEV_SMOKE_DIR");
        assert!(smoke_dir().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
