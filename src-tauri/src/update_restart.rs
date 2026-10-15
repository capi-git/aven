//! Restart-to-update guard. While an update restart is being prepared, new
//! native work is refused, so nothing can start between the final checks and
//! the restart itself.
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, Webview};

use crate::window::{is_workspace_label, prepare_process_exit};
const UPDATE_BUSY: &str =
    "Aven is preparing an update. Finish or cancel the update before starting new work.";
pub(crate) const UPDATE_BROWSER_BUSY: &str = "Save and close your browser tabs before restarting to update. The update will stay downloaded and ready.";

#[derive(Default)]
pub(crate) struct UpdateRestartState {
    inner: Arc<Mutex<UpdateRestartInner>>,
}

#[derive(Default)]
struct UpdateRestartInner {
    owner: Option<String>,
    ready: bool,
    restarting: bool,
    operations: usize,
    close_terminals: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRestartPreparation {
    browser_states: Vec<crate::browser::BrowserState>,
    open_terminals: usize,
}

/// Held only while a native operation starts or performs work, not throughout
/// the lifetime of an idle provider process. Reservation and operation starts
/// share one lock, so neither can slip between the other's check and mutation.
pub(crate) struct RuntimeWorkPermit {
    inner: Arc<Mutex<UpdateRestartInner>>,
}

impl Drop for RuntimeWorkPermit {
    fn drop(&mut self) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .operations -= 1;
    }
}

impl UpdateRestartState {
    fn begin_work(&self) -> Result<RuntimeWorkPermit, String> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.is_some() {
            return Err(UPDATE_BUSY.into());
        }
        state.operations += 1;
        Ok(RuntimeWorkPermit {
            inner: self.inner.clone(),
        })
    }

    fn reserve(&self, owner: &str) -> Result<(), String> {
        if !is_workspace_label(owner) {
            return Err("Update restart must be requested from the workspace window".into());
        }
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.is_some() {
            return Err(UPDATE_BUSY.into());
        }
        if state.operations != 0 {
            return Err("Wait for current activity to finish before restarting to update. The update will stay downloaded and ready.".into());
        }
        state.owner = Some(owner.into());
        state.ready = false;
        state.restarting = false;
        state.close_terminals = false;
        Ok(())
    }

    fn ready(&self, owner: &str, close_terminals: bool) -> Result<(), String> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.as_deref() != Some(owner) || state.restarting {
            return Err("Update restart preparation is no longer active in this window".into());
        }
        state.ready = true;
        state.close_terminals = close_terminals;
        Ok(())
    }

    fn start_restart(&self, owner: &str) -> Result<bool, String> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.as_deref() != Some(owner) || !state.ready || state.restarting {
            return Err("Save the workspace and prepare the update before restarting".into());
        }
        state.restarting = true;
        Ok(state.close_terminals)
    }

    fn cancel(&self, owner: &str) -> Result<(), String> {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.is_none() {
            return Ok(());
        }
        if state.owner.as_deref() != Some(owner) {
            return Err("Another workspace owns the update restart".into());
        }
        if state.restarting {
            return Err("The update restart is already in progress".into());
        }
        state.owner = None;
        state.ready = false;
        state.close_terminals = false;
        Ok(())
    }

    fn restart_failed(&self, owner: &str) {
        let mut state = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if state.owner.as_deref() == Some(owner) {
            state.owner = None;
            state.ready = false;
            state.restarting = false;
            state.close_terminals = false;
        }
    }

    fn owns(&self, owner: &str) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .owner
            .as_deref()
            == Some(owner)
    }
}

pub(crate) fn update_window_event(app: &AppHandle, label: &str, event: &tauri::WindowEvent) {
    let Some(state) = app.try_state::<UpdateRestartState>() else {
        return;
    };
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } if state.owns(label) => api.prevent_close(),
        tauri::WindowEvent::Destroyed => {
            // Unexpected owner destruction must not strand the app in a
            // prepared state. A normal restart already owns final shutdown.
            let _ = state.cancel(label);
        }
        _ => {}
    }
}

pub(crate) fn begin_runtime_work(app: &AppHandle) -> Result<RuntimeWorkPermit, String> {
    app.try_state::<UpdateRestartState>()
        .ok_or("Update restart guard is unavailable")?
        .begin_work()
}

fn update_caller(caller: &Webview) -> Result<&str, String> {
    if !is_workspace_label(caller.label()) || caller.window().label() != caller.label() {
        return Err("Update restart must be requested from the workspace window".into());
    }
    Ok(caller.label())
}

fn check_update_windows(owner: &str, labels: &[String]) -> Result<(), String> {
    let content: Vec<_> = labels
        .iter()
        .filter(|label| {
            !label.starts_with("access-panel-")
                && !label.starts_with("usage-panel-")
                && !label.starts_with("workspace-menu-panel-")
        })
        .collect();
    if content.len() != 1 || content[0] != owner {
        return Err("Return Picture in Picture and detached tabs, then close other Aven windows before restarting to update. The update will stay downloaded and ready.".into());
    }
    Ok(())
}

async fn check_update_idle(
    app: &AppHandle,
    owner: &str,
    close_terminals: bool,
) -> Result<usize, String> {
    check_update_windows(owner, &app.windows().into_keys().collect::<Vec<_>>())?;
    app.try_state::<crate::control::ControlHost>()
        .ok_or("Agent activity could not be checked")?
        .ensure_update_idle()?;
    app.try_state::<crate::pty::PtyHost>()
        .ok_or("Terminal activity could not be checked")?
        .ensure_update_idle(close_terminals)
}

#[tauri::command]
pub async fn prepare_update_restart(caller: Webview) -> Result<UpdateRestartPreparation, String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    state.reserve(owner)?;
    // Reservation prevents terminal creation/input while the frontend asks for
    // consent. Existing terminals keep running until the actual restart.
    let open_terminals = match check_update_idle(app, owner, true).await {
        Ok(count) => count,
        Err(error) => {
            let _ = state.cancel(owner);
            return Err(error);
        }
    };
    match crate::browser::prepare_update_restart(app).await {
        Ok(browser_states) => Ok(UpdateRestartPreparation {
            browser_states,
            open_terminals,
        }),
        Err(error) => {
            // Always leave update mode, even if a tab could not be restored:
            // a held reservation blocks every later task and browser action.
            let _ = crate::browser::cancel_update_restart(app).await;
            let _ = state.cancel(owner);
            Err(error)
        }
    }
}

/// The frontend calls this after strict persistence, before installing bytes.
/// Browser tabs are closed without overriding a page's unsaved-work warning.
#[tauri::command]
pub async fn finish_update_restart_preparation(
    caller: Webview,
    close_terminals: Option<bool>,
) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    if !state.owns(owner) {
        return Err("Update restart preparation is no longer active in this window".into());
    }
    let close_terminals = close_terminals.unwrap_or(false);
    if let Err(error) = check_update_idle(app, owner, close_terminals).await {
        let _ = crate::browser::cancel_update_restart(app).await;
        let _ = state.cancel(owner);
        return Err(error);
    }
    if let Err(error) = crate::browser::finish_update_restart(app).await {
        let _ = crate::browser::cancel_update_restart(app).await;
        let _ = state.cancel(owner);
        return Err(error);
    }
    state.ready(owner, close_terminals)
}

#[tauri::command]
pub async fn cancel_update_restart(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let restored = if app.state::<UpdateRestartState>().owns(owner) {
        crate::browser::cancel_update_restart(app).await
    } else {
        Ok(())
    };
    app.state::<UpdateRestartState>().cancel(owner)?;
    restored
}

#[tauri::command]
pub async fn relaunch_after_update(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    let close_terminals = state.start_restart(owner)?;
    let result = async {
        ensure_restart_idle(app, owner, close_terminals).await?;
        #[cfg(all(feature = "chromium", target_os = "macos"))]
        crate::browser::prepare_shutdown(app).await?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        state.restart_failed(owner);
        return Err(error);
    }
    prepare_process_exit(app);
    // Unlike a raw plugin/process restart, this delivers the normal Exit event
    // after Chromium shutdown and lets Tauri own the one replacement process.
    app.request_restart();
    Ok(())
}

async fn ensure_restart_idle(
    app: &AppHandle,
    owner: &str,
    close_terminals: bool,
) -> Result<(), String> {
    check_update_idle(app, owner, close_terminals).await?;
    crate::browser::ensure_update_idle(app).await
}

/// Windows installs through the NSIS installer: Tauri's updater starts it and
/// exits Aven at once, then the installer reopens Aven. The final idle checks a
/// macOS restart makes therefore run here, before the installer is started.
/// Agent and terminal processes belong to Aven's kill-on-close job object, so
/// the process exit stops them without a separate shutdown pass.
#[tauri::command]
pub async fn prepare_update_install(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    let close_terminals = state.start_restart(owner)?;
    if let Err(error) = ensure_restart_idle(app, owner, close_terminals).await {
        state.restart_failed(owner);
        return Err(error);
    }
    Ok(())
}

/// Leave update mode when the Windows installer could not be started, so new
/// work is accepted again and the downloaded update stays ready to retry.
#[tauri::command]
pub async fn abandon_update_install(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    if !state.owns(owner) {
        return Ok(());
    }
    let restored = crate::browser::cancel_update_restart(app).await;
    state.restart_failed(owner);
    restored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_reservation_excludes_work_until_owner_cancels() {
        let guard = UpdateRestartState::default();
        let operation = guard.begin_work().unwrap();
        assert!(guard.reserve("main").is_err());
        drop(operation);
        guard.reserve("main").unwrap();
        assert!(guard.begin_work().is_err());
        assert!(guard.reserve("main").is_err());
        assert!(guard.cancel("window-2").is_err());
        assert!(guard.begin_work().is_err());
        guard.cancel("main").unwrap();
        guard.cancel("main").unwrap();
        assert!(guard.begin_work().is_ok());
    }

    #[test]
    fn update_requires_saved_preparation_and_correct_owner_before_relaunch() {
        let guard = UpdateRestartState::default();
        assert!(guard.reserve("pip-session-a").is_err());
        assert!(guard.start_restart("main").is_err());
        guard.reserve("main").unwrap();
        assert!(guard.start_restart("main").is_err());
        assert!(guard.ready("window-2", true).is_err());
        guard.ready("main", false).unwrap();
        assert!(guard.start_restart("window-2").is_err());
        assert!(!guard.start_restart("main").unwrap());
        assert!(guard.start_restart("main").is_err());
        assert!(guard.cancel("main").is_err());
        assert!(guard.begin_work().is_err());
        guard.restart_failed("window-2");
        assert!(guard.begin_work().is_err());
        guard.restart_failed("main");
        assert!(guard.begin_work().is_ok());
    }

    #[test]
    fn abandoned_installer_start_returns_to_normal_work_and_must_prepare_again() {
        // Windows: prepare_update_install starts the restart, then a failed
        // installer launch abandons it. Ordinary cancel cannot undo a started
        // restart, so the dedicated abandon path must release the guard.
        let guard = UpdateRestartState::default();
        guard.reserve("main").unwrap();
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("main").unwrap());
        assert!(guard.begin_work().is_err());
        assert!(guard.cancel("main").is_err());
        assert!(guard.owns("main"));
        guard.restart_failed("main");
        assert!(!guard.owns("main"));
        assert!(guard.begin_work().is_ok());
        guard.reserve("main").unwrap();
        assert!(guard.start_restart("main").is_err());
    }

    #[test]
    fn cancelled_update_must_persist_again_before_another_restart() {
        let guard = UpdateRestartState::default();
        guard.reserve("main").unwrap();
        guard.ready("main", true).unwrap();
        guard.cancel("main").unwrap();
        guard.reserve("main").unwrap();
        assert!(guard.start_restart("main").is_err());
    }

    #[test]
    fn terminal_close_consent_belongs_to_the_prepared_owner() {
        let guard = UpdateRestartState::default();
        guard.reserve("main").unwrap();
        assert!(guard.ready("window-2", true).is_err());
        assert!(guard.start_restart("main").is_err());
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("window-2").is_err());
        assert!(guard.start_restart("main").unwrap());
    }

    #[test]
    fn cancelling_or_failing_an_update_does_not_reuse_terminal_close_consent() {
        let guard = UpdateRestartState::default();
        guard.reserve("main").unwrap();
        guard.ready("main", true).unwrap();
        guard.cancel("main").unwrap();

        guard.reserve("main").unwrap();
        guard.ready("main", false).unwrap();
        assert!(!guard.start_restart("main").unwrap());
        guard.restart_failed("main");

        guard.reserve("main").unwrap();
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("main").unwrap());
        guard.restart_failed("main");

        guard.reserve("window-2").unwrap();
        guard.ready("window-2", false).unwrap();
        assert!(!guard.start_restart("window-2").unwrap());
    }

    #[test]
    fn update_blocks_extra_content_windows_but_not_ephemeral_panels() {
        let labels = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert!(check_update_windows("main", &labels(&["main"])).is_ok());
        assert!(check_update_windows(
            "main",
            &labels(&[
                "main",
                "usage-panel-a",
                "access-panel-b",
                "workspace-menu-panel-c"
            ])
        )
        .is_ok());
        for extra in [
            "window-2",
            "pip-session-a",
            "workspace-detached-a",
            "preview-float-1",
            "unknown-window",
        ] {
            assert!(check_update_windows("main", &labels(&["main", extra])).is_err());
        }
        assert!(check_update_windows("main", &[]).is_err());
        assert!(check_update_windows("main", &labels(&["window-2"])).is_err());
    }

    #[test]
    fn operation_permit_holds_exclusion_on_a_worker_thread() {
        let guard = UpdateRestartState::default();
        let permit = guard.begin_work().unwrap();
        let (release, released) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _permit = permit;
            released.recv().unwrap();
        });
        assert!(guard.reserve("main").is_err());
        release.send(()).unwrap();
        worker.join().unwrap();
        guard.reserve("main").unwrap();
        assert!(guard.begin_work().is_err());
    }
}
