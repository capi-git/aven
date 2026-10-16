use crate::display_rate::FullRefreshRate;
use crate::update_restart::begin_runtime_work;
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

/// What window-state restores. On macOS restoring visibility would show a
/// window before its interface has drawn, so `window_reveal` shows it
/// instead; other platforms keep the plugin's full restore.
pub fn restored_window_state() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    if cfg!(target_os = "macos") {
        StateFlags::all() - StateFlags::VISIBLE
    } else {
        StateFlags::all()
    }
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
/// On macOS it is built hidden; `window_reveal` shows it once it has drawn.
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
    let _work = begin_runtime_work(app, "opening a window")?;
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

    // Built hidden from the macOS configuration; it appears, focused, once
    // drawn. Other platforms show it as they always did.
    #[cfg(target_os = "macos")]
    crate::window_reveal::conceal(&window.as_ref().window());
    #[cfg(not(target_os = "macos"))]
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
    let _work = begin_runtime_work(window.app_handle(), "closing a window")?;
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    window.hide().map_err(|err| err.to_string())
}

/// Finish an idle close. `destroy` skips CloseRequested so the JS handler
/// does not loop; `close` would fire it again.
#[tauri::command]
pub async fn destroy_window(window: Window) -> Result<(), String> {
    let _work = begin_runtime_work(window.app_handle(), "closing a window")?;
    if window.label().starts_with("workspace-detached-") {
        return crate::workspace_window::request_return(window.app_handle(), window.label());
    }
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    crate::browser::close_window_pages(window.app_handle(), Some(window.label())).await?;
    window.destroy().map_err(|err| err.to_string())
}

/// Dock click / Cmd-click with no visible windows: bring hidden ones back.
/// A window still drawing its interface appears on its own shortly.
pub fn show_hidden_or_open_new(app: &AppHandle) -> Result<(), String> {
    let all: Vec<Window> = app
        .windows()
        .into_values()
        .filter(|window| is_workspace_label(window.label()))
        .collect();
    if all.is_empty() {
        return open_new_window(app);
    }
    let mut windows: Vec<Window> = all
        .into_iter()
        .filter(|window| !crate::window_reveal::is_pending(window.label()))
        .collect();
    if windows.is_empty() {
        return Ok(());
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

/// A safety net: no workspace window may stay hidden after launch.
pub fn ensure_launch_window_visible(app: &AppHandle) {
    let windows: Vec<Window> = app
        .windows()
        .into_values()
        .filter(|window| is_workspace_label(window.label()))
        .collect();
    if windows.is_empty() {
        return;
    }
    let any_visible = windows.iter().any(|window| {
        window.is_visible().unwrap_or(false) || crate::window_reveal::is_pending(window.label())
    });
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
    let Ok(_work) = begin_runtime_work(app, "quitting") else {
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

/// Persist already happened in JS. Outside macOS, windows are shown so
/// window-state does not save them hidden.
#[tauri::command]
pub fn confirm_quit(app: AppHandle) {
    let Ok(work) = begin_runtime_work(&app, "quitting") else {
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

pub(crate) fn prepare_process_exit(app: &AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    // window-state still restores visibility outside macOS.
    #[cfg(not(target_os = "macos"))]
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
    fn only_macos_stops_window_state_restoring_visibility() {
        use tauri_plugin_window_state::StateFlags;
        let flags = restored_window_state();
        assert_eq!(
            flags.contains(StateFlags::VISIBLE),
            !cfg!(target_os = "macos")
        );
        assert!(flags.contains(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED));
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
