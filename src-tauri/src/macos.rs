//! macOS chrome: traffic lights and WindowServer background blur.
//!
//! The overlay titlebar is ~28pt. Our HTML tab bar is 40px (`h-10`), so the
//! native `NSTitlebarContainerView` has to be stretched to match or the
//! traffic-light strip looks shorter than the rest of the chrome.
//!
//! Tao's `trafficLightPosition` re-runs `setFrame` on the titlebar *every
//! drawRect* using `window.frame().height`. That is why the buttons jumped
//! during live resize. We never set that option. Buttons are Auto Layout
//! pinned once. The container is `setFrame`'d to 40px on install,
//! resize, and focus — not from `drawRect`.
//!
//! Sidebar glass uses a transparent NSWindow plus
//! `CGSSetWindowBackgroundBlurRadius` (private WindowServer API). That
//! blurs the desktop behind the window; CSS only tints the sidebar on top.
//!
//! Fully clear `NSColor.clearColor` (alpha 0) plus a native shadow makes
//! macOS draw a chamfered gap at the corners. Tiny alpha (0.01) keeps the
//! shadow without that outline.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{
    define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSColor, NSMenu, NSMenuItem, NSRequestUserAttentionType,
    NSTitlebarSeparatorStyle, NSWindow,
};
use objc2_foundation::NSString;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Manager, Window, WindowEvent};

/// Must match the HTML title bar (`h-10` = 40px).
const TAB_BAR_HEIGHT: f64 = 40.0;
const BUTTON_SIZE: f64 = 14.0;
const LEFT_MARGIN: f64 = 12.0;
const BUTTON_SPACING: f64 = 6.0;
/// Vertically center 14pt buttons in the tab bar: (40 - 14) / 2.
const TOP_INSET: f64 = (TAB_BAR_HEIGHT - BUTTON_SIZE) / 2.0;

pub const BLUR_MIN: u8 = 0;
pub const BLUR_MAX: u8 = 64;
pub const BLUR_DEFAULT: u8 = 0;

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

static PINNED: AtomicBool = AtomicBool::new(false);
static WINDOW_BLUR_STATES: OnceLock<Mutex<HashMap<String, WindowBlurState>>> = OnceLock::new();
static WINDOW_BADGES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static GLASS_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

// Match CGSConnectionID, CGSWindowID and NSUInteger in iTerm's CGS declarations.
type CgsConnection = c_int;
type SetBlurFn = unsafe extern "C" fn(CgsConnection, u32, usize) -> c_int;
type ConnectionFn = unsafe extern "C" fn() -> CgsConnection;

#[derive(Default)]
struct WindowBlurState {
    requested_radius: u8,
    has_blurred: bool,
}

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

pub fn install(window: &Window) {
    // Opaque for the dock bounce so the first frames are a solid field,
    // not a frosted desktop. Glass turns on after the first UI paint.
    prepare_launch(window);
    let _ = pin(window);

    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            pin(&event_window);
        }
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            stretch_titlebar(&event_window);
        }
        WindowEvent::Destroyed => {
            set_window_badge(&event_window, 0);
            set_glass_enabled(&event_window, false);
            forget_window_blur(event_window.label());
        }
        _ => {}
    });
}

/// Slack-style red count on the Dock icon. `count` is this window's pending
/// approvals; the tile shows the sum across windows.
pub fn set_window_badge(window: &Window, count: u32) {
    let label = window.label().to_string();
    let apply = move || paint_window_badge(&label, count);
    if MainThreadMarker::new().is_some() {
        apply();
        return;
    }
    let _ = window.app_handle().run_on_main_thread(apply);
}

fn window_badges() -> &'static Mutex<HashMap<String, u32>> {
    WINDOW_BADGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn paint_window_badge(label: &str, count: u32) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let mut map = window_badges()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let previous: u32 = map.values().copied().sum();
    if count == 0 {
        map.remove(label);
    } else {
        map.insert(label.to_string(), count);
    }
    let total: u32 = map.values().copied().sum();
    drop(map);

    let ns_app = NSApplication::sharedApplication(mtm);
    let tile = ns_app.dockTile();
    tile.setShowsApplicationBadge(total > 0);
    if total == 0 {
        tile.setBadgeLabel(None);
    } else {
        let text = if total > 99 {
            "99+".to_string()
        } else {
            total.to_string()
        };
        tile.setBadgeLabel(Some(&NSString::from_str(&text)));
    }
    tile.display();

    if total > previous && !ns_app.isActive() {
        ns_app.requestUserAttention(NSRequestUserAttentionType::InformationalRequest);
    }
}

pub fn set_visible(window: &Window, visible: bool) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    for kind in button_kinds() {
        if let Some(button) = ns_window.standardWindowButton(kind) {
            button.setHidden(!visible);
        }
    }
}

pub fn set_background_blur_radius(window: &Window, radius: u8) {
    let radius = remember_window_blur(window.label(), radius);
    if glass_enabled(window) {
        apply_blur(window, radius);
    }
}

fn glass_windows() -> &'static Mutex<HashSet<String>> {
    GLASS_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn window_blur_states() -> &'static Mutex<HashMap<String, WindowBlurState>> {
    WINDOW_BLUR_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_window_blur(label: &str, radius: u8) -> u8 {
    let radius = radius.clamp(BLUR_MIN, BLUR_MAX);
    window_blur_states()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .entry(label.to_string())
        .or_default()
        .requested_radius = radius;
    radius
}

fn window_blur_radius(label: &str) -> u8 {
    window_blur_states()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(label)
        .map(|state| state.requested_radius)
        .unwrap_or(BLUR_DEFAULT)
}

fn native_window_blur_radius(label: &str, requested: u8) -> u8 {
    // WindowServer can permanently lose blur after a positive -> zero radius
    // transition. iTerm retains a 1px minimum once blur has been used:
    // https://github.com/gnachman/iTerm2/blob/master/sources/TerminalView/iTermWindowImpl.m
    // Keep the default free of this blur effect until the user first enables it.
    let has_blurred = window_blur_states()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(label)
        .is_some_and(|state| state.has_blurred);
    if has_blurred {
        requested.max(1)
    } else {
        requested
    }
}

fn remember_applied_blur(label: &str, radius: u8, status: c_int) {
    if radius == 0 || status != 0 {
        return;
    }
    window_blur_states()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .entry(label.to_string())
        .or_default()
        .has_blurred = true;
}

fn forget_window_blur(label: &str) {
    window_blur_states()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(label);
}

#[cfg(test)]
mod blur_tests {
    use super::*;

    #[test]
    fn each_window_restores_its_own_blur_and_closed_windows_forget_it() {
        let first = "blur-test-personal-window";
        let second = "blur-test-work-window";
        assert_eq!(window_blur_radius(first), 0);
        remember_window_blur(first, 24);
        remember_window_blur(second, 0);
        assert_eq!(window_blur_radius(first), 24);
        assert_eq!(window_blur_radius(second), 0);
        assert_eq!(remember_window_blur(second, 255), BLUR_MAX);
        assert_eq!(window_blur_radius(first), 24);
        forget_window_blur(first);
        assert_eq!(window_blur_radius(first), BLUR_DEFAULT);
        assert_eq!(window_blur_radius(second), BLUR_MAX);
        forget_window_blur(second);
    }

    #[test]
    fn zero_does_not_disable_future_blur_after_a_positive_radius() {
        let label = "blur-test-zero-transition";
        assert_eq!(native_window_blur_radius(label, 0), 0);
        remember_window_blur(label, 24);
        remember_applied_blur(label, 24, 0);
        remember_window_blur(label, 0);
        assert_eq!(window_blur_radius(label), 0);
        assert_eq!(native_window_blur_radius(label, 0), 1);
        assert_eq!(native_window_blur_radius(label, 48), 48);
        forget_window_blur(label);
        assert_eq!(native_window_blur_radius(label, 0), 0);
    }

    #[test]
    fn failed_or_other_window_blur_does_not_raise_a_clear_windows_minimum() {
        let first = "blur-test-positive-only";
        let second = "blur-test-failed-only";
        remember_applied_blur(first, 24, 0);
        remember_applied_blur(second, 24, 1000);
        assert_eq!(native_window_blur_radius(first, 0), 1);
        assert_eq!(native_window_blur_radius(second, 0), 0);
        forget_window_blur(first);
        forget_window_blur(second);
    }
}

fn glass_enabled(window: &Window) -> bool {
    glass_windows()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .contains(window.label())
}

fn set_glass_enabled(window: &Window, enabled: bool) {
    let mut windows = glass_windows()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if enabled {
        windows.insert(window.label().to_string());
    } else {
        windows.remove(window.label());
    }
}

/// Solid field behind the dock bounce. Same colour as the HTML sheet.
fn prepare_launch(window: &Window) {
    set_launch_background(window, 16, 20, 22);
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    ns_window.setHasShadow(true);
    ns_window.invalidateShadow();
    ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
}

fn set_launch_background(window: &Window, r: u8, g: u8, b: u8) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    ns_window.setOpaque(true);
    ns_window.setBackgroundColor(Some(&NSColor::colorWithRed_green_blue_alpha(
        r as f64 / 255.0,
        g as f64 / 255.0,
        b as f64 / 255.0,
        1.0,
    )));
}

/// Turn on desktop blur after the first UI paint.
pub fn enable_glass(window: &Window) {
    set_glass_enabled(window, true);
    prepare_glass(window);
    apply_blur(window, window_blur_radius(window.label()));
}

/// Light mode stays opaque because pale desktop content makes translucent UI illegible.
pub fn disable_glass(window: &Window) {
    set_glass_enabled(window, false);
    apply_blur(window, 0);
    set_launch_background(window, 247, 247, 247);
}

fn prepare_glass(window: &Window) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    ns_window.setOpaque(false);
    // Fully clear + shadow leaves a jagged gap at the corners.
    ns_window.setBackgroundColor(Some(&NSColor::clearColor().colorWithAlphaComponent(0.01)));
    ns_window.setHasShadow(true);
    ns_window.invalidateShadow();
    ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
}

fn apply_blur(window: &Window, radius: u8) {
    let native_radius = native_window_blur_radius(window.label(), radius);
    let Some(ns_window) = ns_window(window) else {
        diagnose_blur(window, radius, native_radius, "no-window");
        return;
    };
    let Some(set_blur) = set_blur_fn() else {
        diagnose_blur(window, radius, native_radius, "missing-symbol");
        return;
    };
    let Some(connection) = cgs_connection() else {
        diagnose_blur(window, radius, native_radius, "no-connection");
        return;
    };
    let window_number = ns_window.windowNumber();
    if window_number <= 0 || window_number > u32::MAX as isize {
        diagnose_blur(window, radius, native_radius, "invalid-window-number");
        return;
    }
    let status = unsafe { set_blur(connection, window_number as u32, native_radius as usize) };
    remember_applied_blur(window.label(), native_radius, status);
    if blur_diagnostics_enabled() {
        eprintln!(
            "[aven-glass] window={} requested={} applied={} status={} opaque={} main_thread={}",
            window.label(),
            radius,
            native_radius,
            status,
            ns_window.isOpaque(),
            MainThreadMarker::new().is_some()
        );
    }
}

fn blur_diagnostics_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED
        .get_or_init(|| std::env::var_os("SUPERMONO_GLASS_DIAGNOSTICS").is_some_and(|v| v == "1"))
}

fn diagnose_blur(window: &Window, requested: u8, applied: u8, outcome: &str) {
    if blur_diagnostics_enabled() {
        eprintln!(
            "[aven-glass] window={} requested={requested} applied={applied} outcome={outcome}",
            window.label()
        );
    }
}

fn pin(window: &Window) -> bool {
    let Some(ns_window) = ns_window(window) else {
        return PINNED.load(Ordering::Relaxed);
    };
    unsafe {
        if !PINNED.load(Ordering::Relaxed) && !pin_ns_window(&ns_window) {
            return false;
        }
        stretch_ns_window(&ns_window);
    }
    true
}

fn stretch_titlebar(window: &Window) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    unsafe { stretch_ns_window(&ns_window) }
}

pub(crate) fn ns_window(window: &Window) -> Option<objc2::rc::Retained<NSWindow>> {
    let Ok(handle) = window.window_handle() else {
        return None;
    };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        return None;
    };
    let ns_view: *mut objc2::runtime::AnyObject = appkit.ns_view.as_ptr().cast();
    if ns_view.is_null() {
        return None;
    }
    let view = unsafe { &*ns_view.cast::<objc2_app_kit::NSView>() };
    view.window()
}

fn button_kinds() -> [objc2_app_kit::NSWindowButton; 3] {
    use objc2_app_kit::NSWindowButton;
    [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
}

unsafe fn pin_ns_window(window: &NSWindow) -> bool {
    let kinds = button_kinds();
    let Some(close) = window.standardWindowButton(kinds[0]) else {
        return false;
    };
    let Some(titlebar) = close.superview() else {
        return false;
    };

    titlebar.setClipsToBounds(false);
    if let Some(container) = titlebar.superview() {
        container.setClipsToBounds(false);
    }

    for (i, kind) in kinds.iter().enumerate() {
        let Some(button) = window.standardWindowButton(*kind) else {
            continue;
        };
        button.setTranslatesAutoresizingMaskIntoConstraints(false);
        let x = LEFT_MARGIN + i as f64 * (BUTTON_SIZE + BUTTON_SPACING);
        let w = button.widthAnchor().constraintEqualToConstant(BUTTON_SIZE);
        let h = button.heightAnchor().constraintEqualToConstant(BUTTON_SIZE);
        let leading = button
            .leadingAnchor()
            .constraintEqualToAnchor_constant(&titlebar.leadingAnchor(), x);
        let top = button
            .topAnchor()
            .constraintEqualToAnchor_constant(&titlebar.topAnchor(), TOP_INSET);
        w.setActive(true);
        h.setActive(true);
        leading.setActive(true);
        top.setActive(true);
    }

    PINNED.store(true, Ordering::Relaxed);
    true
}

unsafe fn stretch_ns_window(window: &NSWindow) {
    let kinds = button_kinds();
    let Some(close) = window.standardWindowButton(kinds[0]) else {
        return;
    };
    let Some(titlebar) = close.superview() else {
        return;
    };
    let Some(container) = titlebar.superview() else {
        return;
    };

    let parent_height = container
        .superview()
        .map(|parent| parent.frame().size.height)
        .unwrap_or_else(|| window.frame().size.height);

    let mut frame = container.frame();
    frame.size.height = TAB_BAR_HEIGHT;
    frame.origin.y = parent_height - TAB_BAR_HEIGHT;
    container.setFrame(frame);

    let mut inner = titlebar.frame();
    inner.origin.y = 0.0;
    inner.size.height = TAB_BAR_HEIGHT;
    inner.size.width = frame.size.width;
    titlebar.setFrame(inner);
}

fn set_blur_fn() -> Option<SetBlurFn> {
    static FN: OnceLock<Option<SetBlurFn>> = OnceLock::new();
    *FN.get_or_init(|| dlsym_fn(b"CGSSetWindowBackgroundBlurRadius\0"))
}

fn cgs_connection() -> Option<CgsConnection> {
    static FN: OnceLock<Option<ConnectionFn>> = OnceLock::new();
    let function = (*FN.get_or_init(|| {
        dlsym_fn(b"CGSDefaultConnectionForThread\0").or_else(|| dlsym_fn(b"CGSMainConnectionID\0"))
    }))?;
    let connection = unsafe { function() };
    (connection != 0).then_some(connection)
}

fn dlsym_fn<T>(symbol: &[u8]) -> Option<T> {
    unsafe {
        let ptr = dlsym(RTLD_DEFAULT, symbol.as_ptr().cast());
        if ptr.is_null() {
            None
        } else {
            Some(std::mem::transmute_copy(&ptr))
        }
    }
}

struct DockMenuTargetIvars {
    app: AppHandle,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "AvenDockMenuTarget"]
    #[ivars = DockMenuTargetIvars]
    struct DockMenuTarget;

    impl DockMenuTarget {
        #[unsafe(method(newWindow:))]
        fn new_window(&self, _sender: Option<&NSMenuItem>) {
            let _ = crate::window::open_new_window(&self.ivars().app);
        }
    }
);

thread_local! {
    static DOCK_MENU_TARGET: RefCell<Option<Retained<DockMenuTarget>>> =
        const { RefCell::new(None) };
}

/// Since macOS 12, `NSDockTile` badge updates are ignored unless the app has
/// requested `UNUserNotificationCenter` authorization with the badge option.
/// Must run on the main thread after launch (`RunEvent::Ready`), not in setup.
///
/// Only re-requests once the user has already answered the prompt: the
/// one-time system dialog is reserved for the Notifications toggle, so a
/// badge-only request at startup must not consume it. Until then the badge
/// stays off.
pub(crate) fn request_badge_authorization() {
    if MainThreadMarker::new().is_none() {
        return;
    }

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings,
        UNUserNotificationCenter,
    };
    use std::ptr::NonNull;

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let handler = RcBlock::new(|settings: NonNull<UNNotificationSettings>| {
        let settings = unsafe { settings.as_ref() };
        if settings.authorizationStatus() == UNAuthorizationStatus::NotDetermined {
            return;
        }
        let done = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Badge,
                &done,
            );
    });
    center.getNotificationSettingsWithCompletionHandler(&handler);
}

pub(crate) fn install_dock_menu(app: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let target = DockMenuTarget::alloc().set_ivars(DockMenuTargetIvars { app: app.clone() });
    let target: Retained<DockMenuTarget> = unsafe { msg_send![super(target), init] };
    DOCK_MENU_TARGET.with(|slot| {
        *slot.borrow_mut() = Some(target.clone());
    });

    let menu = NSMenu::new(mtm);
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str("New Window"),
            Some(sel!(newWindow:)),
            &NSString::new(),
        )
    };
    unsafe {
        item.setTarget(Some(&target));
    }
    menu.addItem(&item);

    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe {
        let _: () = msg_send![&*ns_app, setDockMenu: Some(&*menu)];
    }
}

/// Development runs use an isolated bundle identity. Chromium needs the
/// development runner to package its framework first; the non-Chromium
/// fallback can wrap a raw `tauri dev` binary in a bundle here.
#[cfg(debug_assertions)]
pub(crate) fn ensure_dev_bundle() {
    if let Err(err) = relaunch_from_dev_bundle() {
        eprintln!("Aven Dev: {err}");
        // Do not continue under a production or legacy macOS bundle identity.
        std::process::exit(1);
    }
}

/// Tauri sets `applicationIconImage` on Ready in dev, which undoes the bundle
/// icon. Clearing it restores Icon Services.
#[cfg(debug_assertions)]
pub(crate) fn prefer_bundle_dock_icon() {
    if !current_exe_is_bundled() {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(None) };
    app.dockTile().display();
    // Tauri assigns the embedded bitmap after Ready. Clear again so Icon
    // Services keeps the bundled ICNS rather than Tauri's runtime bitmap.
    unsafe {
        let _: () = msg_send![
            &app,
            performSelector: sel!(setApplicationIconImage:),
            withObject: None::<&objc2::runtime::AnyObject>,
            afterDelay: 0.3_f64
        ];
    }
}

#[cfg(debug_assertions)]
fn dev_bundle_root(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app")
        .then(|| app.to_path_buf())
}

#[cfg(debug_assertions)]
fn current_exe_is_bundled() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| dev_bundle_root(&exe))
        .is_some()
}

#[cfg(debug_assertions)]
fn validate_dev_bundle_info(info: &serde_json::Value) -> Result<(), String> {
    for (key, expected) in [
        ("CFBundleIdentifier", crate::DEV_BUNDLE_ID),
        ("CFBundleName", crate::DEV_PRODUCT_NAME),
        ("CFBundleDisplayName", crate::DEV_PRODUCT_NAME),
        ("CFBundleExecutable", "aven"),
        ("CFBundleShortVersionString", env!("CARGO_PKG_VERSION")),
    ] {
        if info.get(key).and_then(serde_json::Value::as_str) != Some(expected) {
            return Err(format!(
                "Development bundle {key} must be {expected}. Rebuild it with Aven's native development runner; no installed app was changed."
            ));
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn validate_dev_bundle(app: &std::path::Path) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/plutil")
        .args(["-convert", "json", "-o", "-"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Could not read the development app's Info.plist".into());
    }
    let info = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    validate_dev_bundle_info(&info)?;
    #[cfg(feature = "chromium")]
    {
        let frameworks = app.join("Contents/Frameworks");
        for relative in [
            "Chromium Embedded Framework.framework/Chromium Embedded Framework",
            "Aven Helper.app/Contents/MacOS/Aven Helper",
        ] {
            if !frameworks.join(relative).is_file() {
                return Err("The development app is missing Chromium. Run Aven's native development runner to package its framework and helpers before launch.".into());
            }
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn relaunch_from_dev_bundle() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    if let Some(app) = dev_bundle_root(&exe) {
        // The runner packages and signs CEF before launch. Rewriting the plist
        // or icon here would invalidate that signature and discard its metadata.
        return validate_dev_bundle(&app);
    }
    #[cfg(feature = "chromium")]
    {
        let _ = exe;
        Err("Chromium development requires a packaged Aven Dev.app. Use Aven's native development runner so its framework and helpers are present; raw tauri dev cannot package CEF.".into())
    }
    #[cfg(not(feature = "chromium"))]
    relaunch_raw_dev_binary(&exe)
}

#[cfg(all(debug_assertions, not(feature = "chromium")))]
fn relaunch_raw_dev_binary(exe: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    let app = exe
        .parent()
        .ok_or("missing exe parent")?
        .join(format!("{}.app", crate::DEV_PRODUCT_NAME));
    let macos_dir = app.join("Contents/MacOS");
    std::fs::create_dir_all(&macos_dir).map_err(|error| error.to_string())?;
    write_dev_bundle_icons(&app)?;

    let bundled = macos_dir.join("aven");
    let _ = std::fs::remove_file(&bundled);
    // A copy, not a hard link: re-signing rewrites the running binary otherwise.
    std::fs::copy(exe, &bundled).map_err(|error| error.to_string())?;
    let mut perms = std::fs::metadata(&bundled)
        .map_err(|error| error.to_string())?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&bundled, perms).map_err(|error| error.to_string())?;
    // Keep old saved command paths working after the bundle moves or updates.
    let legacy = macos_dir.join("monocode");
    if std::fs::symlink_metadata(&legacy).is_ok() {
        std::fs::remove_file(&legacy).map_err(|error| error.to_string())?;
    }
    std::os::unix::fs::symlink("aven", &legacy).map_err(|error| error.to_string())?;

    let signed = Command::new("/usr/bin/codesign")
        .args([
            "--force",
            "--sign",
            "-",
            "--identifier",
            crate::DEV_BUNDLE_ID,
        ])
        .arg(&app)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !signed {
        return Err("Could not sign the isolated Aven Dev bundle".into());
    }
    let err = Command::new(&bundled)
        .args(std::env::args_os().skip(1))
        .exec();
    Err(err.to_string())
}

#[cfg(all(debug_assertions, not(feature = "chromium")))]
fn write_dev_bundle_icons(app: &std::path::Path) -> Result<(), String> {
    let resources = app.join("Contents/Resources");
    std::fs::create_dir_all(&resources).map_err(|error| error.to_string())?;
    std::fs::write(app.join("Contents/Info.plist"), dev_bundle_plist())
        .map_err(|error| error.to_string())?;
    std::fs::write(
        resources.join("AppIcon.icns"),
        include_bytes!("../icons/icon.icns"),
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(all(debug_assertions, any(test, not(feature = "chromium"))))]
fn dev_bundle_plist() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>{name}</string>
    <key>CFBundleExecutable</key><string>aven</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>{identifier}</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>{name}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>{version}</string>
    <key>CFBundleVersion</key><string>{version}</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"#,
        name = crate::DEV_PRODUCT_NAME,
        identifier = crate::DEV_BUNDLE_ID,
        version = env!("CARGO_PKG_VERSION")
    )
}

#[cfg(all(test, debug_assertions))]
mod development_bundle_tests {
    use super::*;
    use serde_json::json;

    fn info() -> serde_json::Value {
        json!({
            "CFBundleIdentifier": crate::DEV_BUNDLE_ID,
            "CFBundleName": crate::DEV_PRODUCT_NAME,
            "CFBundleDisplayName": crate::DEV_PRODUCT_NAME,
            "CFBundleExecutable": "aven",
            "CFBundleShortVersionString": env!("CARGO_PKG_VERSION"),
        })
    }

    #[test]
    fn development_bundle_accepts_only_its_own_identity_and_current_version() {
        assert!(validate_dev_bundle_info(&info()).is_ok());
        for (key, wrong) in [
            ("CFBundleIdentifier", "com.capi.monocode.personal"),
            ("CFBundleIdentifier", "com.monocode.desktop"),
            ("CFBundleName", "Aven"),
            ("CFBundleDisplayName", "CoveCode"),
            ("CFBundleExecutable", "another-app"),
            ("CFBundleShortVersionString", "0.0.0"),
        ] {
            let mut candidate = info();
            candidate[key] = json!(wrong);
            assert!(validate_dev_bundle_info(&candidate).is_err(), "{key}");
        }
    }

    #[test]
    fn only_recognizes_standard_application_bundle_layouts() {
        use std::path::Path;
        let bundle = "/repo/target/debug/Aven Dev.app";
        assert_eq!(
            dev_bundle_root(Path::new(&format!("{bundle}/Contents/MacOS/aven"))),
            Some(Path::new(bundle).to_path_buf()),
        );
        assert!(dev_bundle_root(Path::new("/repo/target/debug/aven")).is_none());
        assert!(dev_bundle_root(Path::new("/repo/app/Contents/MacOS/aven")).is_none());
    }

    #[test]
    fn fallback_plist_uses_current_cargo_version_and_isolated_identity() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("/usr/bin/plutil")
            .args(["-convert", "json", "-o", "-", "--", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("plutil");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(dev_bundle_plist().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(validate_dev_bundle_info(&parsed).is_ok());
        assert_eq!(parsed["CFBundleVersion"], env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn validating_a_packaged_development_bundle_preserves_its_bytes() {
        let directory =
            std::env::temp_dir().join(format!("aven-dev-bundle-test-{}", uuid::Uuid::new_v4()));
        let app = directory.join("Aven Dev.app");
        let contents = app.join("Contents");
        std::fs::create_dir_all(&contents).unwrap();
        let plist = contents.join("Info.plist");
        let original = dev_bundle_plist();
        std::fs::write(&plist, &original).unwrap();
        #[cfg(feature = "chromium")]
        for relative in [
            "Chromium Embedded Framework.framework/Chromium Embedded Framework",
            "Aven Helper.app/Contents/MacOS/Aven Helper",
        ] {
            let file = contents.join("Frameworks").join(relative);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"test runtime placeholder").unwrap();
        }
        let validation = validate_dev_bundle(&app);
        let unchanged = std::fs::read(&plist).unwrap() == original.as_bytes();
        std::fs::remove_dir_all(&directory).unwrap();
        assert!(validation.is_ok(), "{validation:?}");
        assert!(unchanged, "startup must not invalidate packaged signatures");
    }
}
