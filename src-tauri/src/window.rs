use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

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

pub fn is_workspace_label(label: &str) -> bool {
    label == "main"
        || label.strip_prefix("window-").is_some_and(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
        })
}

pub fn open_new_window(app: &AppHandle) -> Result<(), String> {
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

/// Desktop blur goes on after the first UI paint and only in dark mode.
#[tauri::command]
pub fn set_window_glass_enabled(window: Window, webview: Webview, enabled: bool) {
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
            set_background(Color(0, 0, 0, 3));
            crate::macos::enable_glass(&window);
        } else {
            crate::macos::disable_glass(&window);
        }
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
}

/// Close with a running chat hides the webview so the harness child keeps going.
#[tauri::command]
pub fn hide_window(window: Window) -> Result<(), String> {
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    if window.label().starts_with("pip-session-") {
        return crate::session_pip::request_return(window.app_handle(), window.label());
    }
    window.hide().map_err(|err| err.to_string())
}

/// Finish an idle close. `destroy` skips CloseRequested so the JS handler
/// does not loop; `close` would fire it again.
#[tauri::command]
pub async fn destroy_window(window: Window) -> Result<(), String> {
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    if window.label().starts_with("pip-session-") {
        return crate::session_pip::request_return(window.app_handle(), window.label());
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
    if let Some(label) = crate::session_pip::focused_label(app) {
        if crate::session_pip::request_quit(app, &label).is_ok() {
            return;
        }
    }
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
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        // INITIALIZED becomes false as native shutdown starts, before CEF has
        // finished. A second quit must not mistake that state for completion.
        if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            if let Err(error) = crate::browser::close_window_pages(&app, None).await {
                eprintln!("[supermono] Browser close before quit: {error}");
                // Keep windows alive for a retry; do not destroy a Chromium
                // parent while a renderer is still finishing its close.
                QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
            if let Err(error) = crate::browser::prepare_shutdown(&app).await {
                eprintln!("[supermono] Browser shutdown: {error}");
                QUIT_IN_PROGRESS.store(false, Ordering::SeqCst);
                return;
            }
            finish_quit(app);
        });
    }
    #[cfg(not(all(feature = "chromium", target_os = "macos")))]
    finish_quit(app);
}

fn finish_quit(app: AppHandle) {
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
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::is_workspace_label;

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
