//! The one way to build Aven's popup windows: the usage panel, the access
//! picker and the workspace menu. Each is a borderless, transparent child
//! window of a workspace that hosts one webview of this app's own page.
//!
//! The rules every popup used to rediscover live here:
//! - Taking the keyboard never makes the popup the app's *main* window, so the
//!   workspace behind it keeps its active look instead of flashing inactive on
//!   every open and close.
//! - It is put back under its workspace before every show: hiding a child
//!   window detaches it on macOS, after which a click on the workspace covers
//!   it and it no longer follows the workspace.
//! - Its page may only show its own entry point and may not open windows.
//! - Work runs on the main queue, outside Tao's event-handler lock, because
//!   AppKit can re-enter Tao while showing or creating a window.
//!
//! Overlays that live *inside* a workspace window (the macOS floating
//! sidebar) are a different shape; the control commands accept them through
//! `control::owning_window`, and a test there rejects `WebviewWindow`
//! command arguments.
use crate::display_rate::FullRefreshRate;
use tauri::{
    window::{Color, WindowBuilder},
    AppHandle, LogicalPosition, LogicalSize, PhysicalPosition, Url, Webview, WebviewBuilder,
    WebviewUrl, Window,
};

/// What a popup shows and where it first appears.
pub struct PopupSpec<'a> {
    pub label: &'a str,
    pub title: &'a str,
    /// The page inside this app, such as `index.html?usagePanel=1`.
    pub entry: &'a str,
    /// The owner's URL joined with `entry`; navigation anywhere else is refused.
    pub expected: Url,
    pub position: PhysicalPosition<i32>,
    pub size: LogicalSize<f64>,
}

/// Run `operation` on the main queue and wait for its result.
pub(crate) async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let run = move || {
        let _ = send.send(operation());
    };
    // AppKit may synchronously reenter Tao while showing or creating a window.
    // The main queue runs outside Tao's event-handler lock (as in pip_group).
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        dispatch2::DispatchQueue::main().exec_async(run);
    }
    #[cfg(not(target_os = "macos"))]
    app.run_on_main_thread(run)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv()
            .map_err(|_| "Panel operation was interrupted".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Build the hidden popup window and its webview under `owner`. Call from the
/// main thread; the caller destroys the label if this fails.
pub fn build(app: &AppHandle, owner: &Window, spec: PopupSpec<'_>) -> Result<Window, String> {
    let window = WindowBuilder::new(app, spec.label)
        .title(spec.title)
        .inner_size(spec.size.width, spec.size.height)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .shadow(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .parent(owner)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    // Only costs the workspace's active look if it fails, so log and go on.
    #[cfg(target_os = "macos")]
    if let Err(error) = never_main::mark(&window) {
        eprintln!("[aven-popup] {}: {error}", spec.label);
    }
    window
        .set_position(spec.position)
        .map_err(|error| error.to_string())?;
    window
        .set_size(spec.size)
        .map_err(|error| error.to_string())?;
    let expected = spec.expected;
    let child = WebviewBuilder::new(spec.label, WebviewUrl::App(spec.entry.into()))
        .full_refresh_rate(app)
        .focused(false)
        .auto_resize()
        .disable_drag_drop_handler()
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .on_navigation(move |url| allowed_url(url, &expected))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    window
        .add_child(child, LogicalPosition::new(0.0, 0.0), spec.size)
        .map_err(|error| error.to_string())?;
    Ok(window)
}

/// Show the popup above its workspace and give it the keyboard, so Escape and
/// arrow keys work at once. The workspace stays the main window.
pub fn show_focused(
    window: &Window,
    webview: &Webview,
    owner: Option<&Window>,
) -> tauri::Result<()> {
    touch(window.label());
    #[cfg(target_os = "macos")]
    if let Some(owner) = owner {
        reattach(window, owner);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = owner;
    window.show()?;
    window.set_focus()?;
    webview.set_focus()
}

/// How long a hidden popup stays ready for a quick reopen before it is
/// released, along with the WebKit process that draws it (tens of MB).
const RELEASE_HIDDEN_AFTER: std::time::Duration = std::time::Duration::from_secs(120);

/// Counts each show and hide per popup, so a pending release can tell
/// whether the popup has been used since.
static GENERATIONS: std::sync::Mutex<std::collections::BTreeMap<String, u64>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

fn touch(label: &str) -> u64 {
    let mut generations = GENERATIONS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let generation = generations.entry(label.to_string()).or_default();
    *generation += 1;
    *generation
}

/// Hide the popup for reuse.
pub fn hide(window: &Window) {
    touch(window.label());
    let _ = window.hide();
}

/// Hide the popup for reuse, and release it if it stays unused. `release`
/// runs on the main thread; it must check its own state (the popup may be
/// opening again) before destroying anything.
pub fn hide_then_release(window: &Window, release: impl FnOnce(&AppHandle, &str) + Send + 'static) {
    hide(window);
    let app = tauri::Manager::app_handle(window).clone();
    let label = window.label().to_string();
    let generation = touch(&label);
    let _ = std::thread::Builder::new()
        .name("popup-release".into())
        .spawn(move || {
            std::thread::sleep(RELEASE_HIDDEN_AFTER);
            let current = GENERATIONS
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get(&label)
                .copied();
            if current != Some(generation) {
                return;
            }
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || release(&handle, &label));
        });
}

/// Destroy the popup for good.
pub fn destroy(window: &Window) {
    GENERATIONS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(window.label());
    #[cfg(target_os = "macos")]
    never_main::unmark(window);
    let _ = window.destroy();
}

/// Only the popup's own page, ignoring the fragment it uses for state.
pub fn allowed_url(url: &Url, expected: &Url) -> bool {
    let mut url = url.clone();
    url.set_fragment(None);
    let mut expected = expected.clone();
    expected.set_fragment(None);
    url == expected
}

/// Put `child` back under `owner`. Ordering a child window out detaches it
/// from its parent on macOS.
#[cfg(target_os = "macos")]
fn reattach(child: &Window, owner: &Window) {
    let (Some(child), Some(owner)) = (
        crate::macos::ns_window(child),
        crate::macos::ns_window(owner),
    ) else {
        return;
    };
    if child.parentWindow().is_none() {
        // SAFETY: both are live windows owned by this app, on the main thread.
        unsafe { owner.addChildWindow_ordered(&child, objc2_app_kit::NSWindowOrderingMode::Above) };
    }
}

/// AppKit makes a window that takes the keyboard the main window too, and
/// the workspace behind it then draws inactive. Popups answer NO to
/// `canBecomeMainWindow`; Tauri gives every window one class, so the method
/// is replaced once and every other window keeps the original answer.
#[cfg(target_os = "macos")]
mod never_main {
    use objc2::runtime::{AnyObject, Bool, Imp, Sel};
    use objc2::sel;
    use std::{
        collections::BTreeSet,
        sync::{Mutex, OnceLock},
    };
    use tauri::Window;

    type CanBecomeMain = extern "C-unwind" fn(&AnyObject, Sel) -> Bool;

    /// Windows that never become main, by NSWindow address.
    static NEVER_MAIN: Mutex<BTreeSet<usize>> = Mutex::new(BTreeSet::new());
    /// The window class's own `canBecomeMainWindow`, kept for other windows.
    static ORIGINAL: OnceLock<CanBecomeMain> = OnceLock::new();

    extern "C-unwind" fn can_become_main(this: &AnyObject, cmd: Sel) -> Bool {
        let address = this as *const AnyObject as usize;
        let never = NEVER_MAIN
            .lock()
            .map(|set| set.contains(&address))
            .unwrap_or(false);
        if never {
            return Bool::NO;
        }
        match ORIGINAL.get() {
            Some(original) => original(this, cmd),
            None => Bool::YES,
        }
    }

    fn address(window: &Window) -> Result<usize, String> {
        window
            .ns_window()
            .map(|pointer| pointer as usize)
            .map_err(|error| error.to_string())
    }

    /// Keep `window` from ever becoming main. Main thread only.
    pub fn mark(window: &Window) -> Result<(), String> {
        let address = address(window)?;
        if ORIGINAL.get().is_none() {
            // SAFETY: Tauri returns this window's live NSWindow.
            let object = unsafe { &*(address as *const AnyObject) };
            let class = object.class();
            let selector = sel!(canBecomeMainWindow);
            let method = class
                .instance_method(selector)
                .ok_or("The window class has no canBecomeMainWindow")?;
            // Only patch a method the window class defines itself; replacing
            // an inherited one would change every NSWindow in the process.
            let inherited = class
                .superclass()
                .and_then(|parent| parent.instance_method(selector))
                .is_some_and(|parent_method| std::ptr::eq(parent_method, method));
            if inherited {
                return Err("The window class inherits canBecomeMainWindow".into());
            }
            let original = method.implementation();
            // SAFETY: `-[NSWindow canBecomeMainWindow]` takes no arguments and
            // returns BOOL, which is exactly `CanBecomeMain`.
            let original: CanBecomeMain =
                unsafe { std::mem::transmute::<Imp, CanBecomeMain>(original) };
            let _ = ORIGINAL.set(original);
            // SAFETY: the replacement has the same signature as the original.
            unsafe {
                method
                    .set_implementation(std::mem::transmute::<CanBecomeMain, Imp>(can_become_main));
            }
        }
        NEVER_MAIN
            .lock()
            .map_err(|_| "Popup window state is unavailable")?
            .insert(address);
        Ok(())
    }

    /// Forget `window` before it is destroyed, so a later window at the same
    /// address is unaffected.
    pub fn unmark(window: &Window) {
        if let Ok(address) = address(window) {
            if let Ok(mut set) = NEVER_MAIN.lock() {
                set.remove(&address);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popup_pages_cannot_leave_their_entry_point() {
        let expected = Url::parse("tauri://localhost/index.html?usagePanel=1").unwrap();
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html?usagePanel=1#open").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("https://example.com/index.html?usagePanel=1").unwrap(),
            &expected
        ));
    }

    /// Child windows of a workspace are popups, and popups are built here so
    /// they keep the focus and re-attach rules above. A new module building
    /// its own (`.parent(&owner)`) would rediscover the flash and the
    /// vanishing popup.
    #[test]
    fn only_this_module_builds_workspace_child_windows() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|ext| ext != "rs")
                || path
                    .file_name()
                    .is_some_and(|name| name == "native_popup.rs")
            {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            for (index, line) in text.lines().enumerate() {
                let line = line.trim();
                if line.starts_with("//") {
                    continue;
                }
                if line.starts_with(".parent(&") {
                    found.push(format!("{}:{}", path.display(), index + 1));
                }
            }
        }
        assert!(
            found.is_empty(),
            "Build popups with native_popup::build: {found:?}"
        );
    }
}
