use crate::display_rate::FullRefreshRate;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::window::Color;
#[cfg(target_os = "windows")]
use tauri::window::{Effect, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewWindowBuilder, Window};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
#[cfg(all(feature = "chromium", target_os = "macos"))]
static QUIT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

const QUIT_REQUESTED: &str = "quit_requested";
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

pub fn is_workspace_label(label: &str) -> bool {
    label == "main"
        || label.strip_prefix("window-").is_some_and(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
        })
}

/// On macOS the configured main window is built here rather than by Tauri, so
/// its WebKit document can render at the display's full refresh rate. Other
/// platforms replace the window list and still create it from configuration.
#[cfg(target_os = "macos")]
pub fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
    else {
        return Ok(());
    };
    WebviewWindowBuilder::from_config(app, config)?
        .full_refresh_rate(app)
        .build()?;
    Ok(())
}

pub fn open_new_window(app: &AppHandle) -> Result<(), String> {
    let _work = begin_runtime_work(app)?;
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("missing main window config")?
        .clone();

    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    config.label = format!("window-{id}");

    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|err| err.to_string())?
        .full_refresh_rate(app)
        .build()
        .map_err(|err| err.to_string())?;

    #[cfg(target_os = "macos")]
    crate::macos::install(&window.as_ref().window());

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_decorations(false);
        let _ = window.set_shadow(true);
    }

    let _ = window.set_focus();
    Ok(())
}

/// The dark workspace shell colour the page hands to macOS: sRGB channels and
/// the shell's opacity (0..1). AppKit paints it as the window background.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
pub struct GlassTint {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub alpha: f64,
}

impl GlassTint {
    /// Fully clear plus a native shadow leaves a jagged gap at the corners,
    /// so the native tint never drops below the former near-clear backing.
    pub const MIN_ALPHA: f64 = 0.01;

    /// The usable native alpha, or `None` for a malformed value so the page
    /// keeps painting its own tint.
    pub fn native_alpha(self) -> Option<f64> {
        self.alpha
            .is_finite()
            .then(|| self.alpha.clamp(Self::MIN_ALPHA, 1.0))
    }
}

/// Desktop blur goes on after the first UI paint and only in dark mode.
/// Returns whether the native window now paints the page's glass tint, so the
/// page can stop painting the same translucent colour twice. Only macOS does.
#[tauri::command]
pub fn set_window_glass_enabled(
    window: Window,
    webview: Webview,
    enabled: bool,
    tint: Option<GlassTint>,
) -> bool {
    // Preserve the former WebviewWindow color update on both the native window
    // and its UI webview, including when native browser children are attached.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let set_background = |color| {
        let _ = window
            .set_background_color(Some(color))
            .and_then(|()| webview.set_background_color(Some(color)));
    };
    #[cfg(target_os = "macos")]
    {
        if enabled {
            // Tint updates arrive while glass is already on; the webview's
            // near-clear backing only needs setting when glass turns on.
            if !crate::macos::glass_enabled(&window) {
                set_background(Color(0, 0, 0, 3));
            }
            return crate::macos::enable_glass(&window, tint);
        }
        crate::macos::disable_glass(&window);
    }
    #[cfg(target_os = "windows")]
    {
        if enabled {
            set_background(Color(0, 0, 0, 0));
            let _ = window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build());
        } else {
            let _ = window.set_effects(None);
            set_background(Color(247, 247, 247, 255));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, webview, enabled);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = tint;
    false
}

/// Close with a running chat hides the webview so the harness child keeps going.
#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String> {
    let _work = begin_runtime_work(window.app_handle())?;
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    window.hide().map_err(|err| err.to_string())
}

/// Finish an idle close. `destroy` skips CloseRequested so the JS handler
/// does not loop; `close` would fire it again.
#[tauri::command]
pub async fn destroy_window(window: Window) -> Result<(), String> {
    let _work = begin_runtime_work(window.app_handle())?;
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    crate::browser::close_window_pages(window.app_handle(), Some(window.label())).await?;
    window.destroy().map_err(|err| err.to_string())
}

/// Dock click / Cmd-click with no visible windows: bring hidden ones back.
pub fn show_hidden_or_open_new(app: &AppHandle) -> Result<(), String> {
    let mut windows: Vec<Window> = app
        .windows()
        .into_values()
        .filter(|window| is_workspace_label(window.label()))
        .collect();
    if windows.is_empty() {
        return open_new_window(app);
    }
    windows.sort_by(|a, b| a.label().cmp(b.label()));
    for window in &windows {
        let _ = window.unminimize();
        let _ = window.show();
    }
    windows
        .first()
        .ok_or_else(|| "missing window".to_string())?
        .set_focus()
        .map_err(|err| err.to_string())
}

/// window-state can restore a window as hidden after a quit-while-hidden.
pub fn ensure_launch_window_visible(app: &AppHandle) {
    let windows: Vec<Window> = app
        .windows()
        .into_values()
        .filter(|window| is_workspace_label(window.label()))
        .collect();
    if windows.is_empty() {
        return;
    }
    let any_visible = windows
        .iter()
        .any(|window| window.is_visible().unwrap_or(false));
    if any_visible {
        return;
    }
    let _ = show_hidden_or_open_new(app);
}

pub fn allow_exit() -> bool {
    ALLOW_EXIT.load(Ordering::SeqCst)
}

/// Ask the UI to persist in-flight chats, then call `confirm_quit`.
pub fn request_quit(app: &AppHandle) {
    let Ok(_work) = begin_runtime_work(app) else {
        return;
    };
    let windows = app.windows();
    let target = crate::browser::focused_floating_owner(app)
        .and_then(|owner| windows.get(&owner).cloned())
        .or_else(|| {
            windows
                .values()
                .find(|window| {
                    is_workspace_label(window.label()) && window.is_focused().unwrap_or(false)
                })
                .cloned()
        })
        .or_else(|| windows.get("main").cloned())
        .or_else(|| {
            windows
                .values()
                .find(|window| is_workspace_label(window.label()))
                .cloned()
        });
    match target {
        Some(window) => {
            if app
                .emit_to(
                    tauri::EventTarget::webview(window.label()),
                    QUIT_REQUESTED,
                    (),
                )
                .is_err()
            {
                confirm_quit(app.clone());
            }
        }
        None => confirm_quit(app.clone()),
    }
}

/// Persist already happened in JS. Show windows so window-state doesn't save hidden.
#[tauri::command]
pub fn confirm_quit(app: AppHandle) {
    let Ok(work) = begin_runtime_work(&app) else {
        return;
    };
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        // INITIALIZED becomes false as native shutdown starts, before CEF has
        // finished. A second quit must not mistake that state for completion.
        if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            let _work = work;
            if let Err(error) = crate::browser::close_window_pages(&app, None).await {
                eprintln!("[aven] Browser close before quit: {error}");
                // Keep windows alive for a retry; do not destroy a Chromium
                // parent while a renderer is still finishing its close.
                QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
            if let Err(error) = crate::browser::prepare_shutdown(&app).await {
                eprintln!("[aven] Browser shutdown: {error}");
                QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
            finish_quit(app);
        });
    }
    #[cfg(not(all(feature = "chromium", target_os = "macos")))]
    {
        let _work = work;
        finish_quit(app);
    }
}

fn finish_quit(app: AppHandle) {
    prepare_process_exit(&app);
    app.exit(0);
}

fn prepare_process_exit(app: &AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    for window in app.windows().values() {
        if is_workspace_label(window.label()) {
            let _ = window.show();
        }
    }
    // Belt and braces. `RunEvent::Exit` reaps too, and it also runs before the
    // process is gone, but a macOS terminate that skips the run loop would not
    // reach it — and `kill_all`'s SIGKILL wait only works while we're alive.
    if let Some(host) = app.try_state::<crate::harness::HarnessHost>() {
        host.kill_all();
    }
    if let Some(host) = app.try_state::<crate::pty::PtyHost>() {
        host.kill_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glass_tint_clamps_to_a_usable_native_alpha() {
        let tint = |alpha| GlassTint {
            r: 1,
            g: 2,
            b: 3,
            alpha,
        };
        assert_eq!(tint(0.52).native_alpha(), Some(0.52));
        assert_eq!(tint(0.0).native_alpha(), Some(GlassTint::MIN_ALPHA));
        assert_eq!(tint(-1.0).native_alpha(), Some(GlassTint::MIN_ALPHA));
        assert_eq!(tint(4.0).native_alpha(), Some(1.0));
        assert_eq!(tint(f64::NAN).native_alpha(), None);
        assert_eq!(tint(f64::INFINITY).native_alpha(), None);
    }

    #[test]
    fn glass_tint_reads_the_page_payload() {
        let tint: GlassTint =
            serde_json::from_str(r#"{"r":10,"g":20,"b":30,"alpha":0.4}"#).unwrap();
        assert_eq!(
            tint,
            GlassTint {
                r: 10,
                g: 20,
                b: 30,
                alpha: 0.4
            }
        );
    }

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

    #[test]
    fn only_persisted_owner_windows_count_as_workspaces() {
        for label in ["main", "window-1", "window-123"] {
            assert!(is_workspace_label(label));
        }
        for label in [
            "window-",
            "window-site",
            "preview-main-site",
            "preview-float-1",
            "preview-popup-1",
            "pip-session-abc",
            "main-child",
        ] {
            assert!(!is_workspace_label(label));
        }
    }
}
