//! macOS-only FFI. All calls originate in the authenticated Aven host.
use super::*;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

type Cf = *const c_void;
type Event = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}

impl From<Rect> for Region {
    fn from(value: Rect) -> Self {
        Self {
            x: value.origin.x,
            y: value.origin.y,
            width: value.size.width,
            height: value.size.height,
        }
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGWindowListCopyWindowInfo(options: u32, relative_to: u32) -> Cf;
    fn CGRectMakeWithDictionaryRepresentation(dictionary: Cf, rect: *mut Rect) -> bool;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(display: u32) -> Rect;
    static kCGWindowNumber: Cf;
    static kCGWindowOwnerName: Cf;
    static kCGWindowOwnerPID: Cf;
    static kCGWindowName: Cf;
    static kCGWindowLayer: Cf;
    static kCGWindowBounds: Cf;
    fn CGEventCreateMouseEvent(source: Cf, kind: u32, position: Point, button: u32) -> Event;
    fn CGEventCreateKeyboardEvent(source: Cf, key: u16, down: bool) -> Event;
    fn CGEventCreateScrollWheelEvent2(
        source: Cf,
        units: u32,
        wheels: u32,
        y: i32,
        x: i32,
        z: i32,
    ) -> Event;
    fn CGEventSetIntegerValueField(event: Event, field: u32, value: i64);
    fn CGEventSetFlags(event: Event, flags: u64);
    fn CGEventSetLocation(event: Event, location: Point);
    fn CGEventKeyboardSetUnicodeString(event: Event, length: usize, text: *const u16);
    fn CGEventPost(tap: u32, event: Event);
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: Cf) -> u8;
    static kAXTrustedCheckOptionPrompt: Cf;
    fn AXUIElementCreateApplication(pid: i32) -> Cf;
    fn AXUIElementSetMessagingTimeout(element: Cf, seconds: f32) -> i32;
    fn AXUIElementIsAttributeSettable(element: Cf, attribute: Cf, settable: *mut u8) -> i32;
    fn AXUIElementSetAttributeValue(element: Cf, attribute: Cf, value: Cf) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: Cf);
    static kCFBooleanTrue: Cf;
    fn CFGetTypeID(value: Cf) -> usize;
    fn CFArrayGetCount(array: Cf) -> isize;
    fn CFArrayGetValueAtIndex(array: Cf, index: isize) -> Cf;
    fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
    fn CFNumberGetTypeID() -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFNumberGetValue(number: Cf, kind: isize, output: *mut i64) -> bool;
}

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}

/// Own every Create/Copy result, including failure paths. Borrowed CF dictionary
/// values and Objective-C message results are never released through this type.
struct OwnedCf(Cf);
impl OwnedCf {
    fn new(value: Cf, error: &str) -> Result<Self, String> {
        if value.is_null() {
            Err(error.into())
        } else {
            Ok(Self(value))
        }
    }
    fn event(&self) -> Event {
        self.0.cast_mut()
    }
}
impl Drop for OwnedCf {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}

pub(super) fn permissions() -> (bool, bool) {
    unsafe { (CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() != 0) }
}

/// Called exclusively by the caller-validated Settings commands. These APIs
/// identify this bundled process, which makes Aven appear in macOS Settings.
pub(super) fn request_permission(permission: Permission) -> Result<(), String> {
    unsafe {
        match permission {
            Permission::ScreenRecording => {
                if !CGPreflightScreenCaptureAccess() {
                    CGRequestScreenCaptureAccess();
                }
            }
            Permission::Accessibility => {
                if AXIsProcessTrusted() == 0 {
                    let key = &*kAXTrustedCheckOptionPrompt.cast::<NSString>();
                    let value = NSNumber::numberWithBool(true);
                    let options = NSDictionary::from_slices(&[key], &[&*value]);
                    AXIsProcessTrustedWithOptions(Retained::as_ptr(&options).cast());
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopWindow {
    window_id: u32,
    app: String,
    pid: i32,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl DesktopWindow {
    fn bounds(&self) -> Region {
        Region {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

unsafe fn number(dictionary: Cf, key: Cf) -> Option<i64> {
    let value = CFDictionaryGetValue(dictionary, key);
    if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
        return None;
    }
    let mut output = 0;
    // kCFNumberSInt64Type = 4. The destination matches its exact C width.
    CFNumberGetValue(value, 4, &mut output).then_some(output)
}

unsafe fn text(dictionary: Cf, key: Cf, max: usize) -> String {
    let value = CFDictionaryGetValue(dictionary, key);
    if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
        return String::new();
    }
    // NSString and CFString are toll-free bridged; the array owns this borrow.
    (&*value.cast::<NSString>())
        .to_string()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}

fn windows() -> Result<Vec<DesktopWindow>, String> {
    objc2::rc::autoreleasepool(|_| unsafe {
        // OnScreenOnly | ExcludeDesktopElements. No screen capture or prompt.
        let list = OwnedCf::new(
            CGWindowListCopyWindowInfo(1 | 16, 0),
            "Could not list desktop windows. Check Aven's Screen Recording permission.",
        )?;
        let count = CFArrayGetCount(list.0);
        if !(0..=10_000).contains(&count) {
            return Err(
                "The macOS window list is too large. Close unused windows and retry.".into(),
            );
        }
        let mut result = Vec::new();
        for index in 0..count {
            let item = CFArrayGetValueAtIndex(list.0, index);
            if item.is_null()
                || CFGetTypeID(item) != CFDictionaryGetTypeID()
                || number(item, kCGWindowLayer) != Some(0)
            {
                continue;
            }
            let Some(window_id) = number(item, kCGWindowNumber)
                .and_then(|value| u32::try_from(value).ok())
                .filter(|id| *id != 0)
            else {
                continue;
            };
            let Some(pid) = number(item, kCGWindowOwnerPID)
                .and_then(|value| i32::try_from(value).ok())
                .filter(|pid| *pid > 0)
            else {
                continue;
            };
            let dictionary = CFDictionaryGetValue(item, kCGWindowBounds);
            if dictionary.is_null() || CFGetTypeID(dictionary) != CFDictionaryGetTypeID() {
                continue;
            }
            let mut rect = Rect {
                origin: Point { x: 0.0, y: 0.0 },
                size: Size {
                    width: 0.0,
                    height: 0.0,
                },
            };
            if !CGRectMakeWithDictionaryRepresentation(dictionary, &mut rect) {
                continue;
            }
            let bounds = Region::from(rect);
            if bounds.validate().is_err() {
                continue;
            }
            if result.len() == 128 {
                return Err(
                    "More than 128 on-screen windows. Close unused windows and retry.".into(),
                );
            }
            result.push(DesktopWindow {
                window_id,
                app: text(item, kCGWindowOwnerName, 160),
                pid,
                title: text(item, kCGWindowName, 256),
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            });
        }
        Ok(result)
    })
}

fn window_bounds(id: u32) -> Result<Region, String> {
    windows()?
        .into_iter()
        .find(|window| window.window_id == id)
        .map(|window| window.bounds())
        .ok_or_else(|| {
            "That window is no longer on screen. Run windows and take a fresh screenshot.".into()
        })
}

const INPUT_WINDOW_UNAVAILABLE: &str =
    "Could not verify the target window's visibility. Run windows and take a fresh screenshot before retrying; do not remove windowId to bypass this check.";
const INPUT_WINDOW_OBSCURED: &str =
    "Another window covers the target point. Bring the intended window forward, observe it again, and retry with its windowId; no input was sent.";

#[derive(Clone, Copy)]
struct InputWindow {
    window_id: u32,
    bounds: Region,
}

/// CoreGraphics returns OnScreenOnly windows from front to back. Include every
/// layer and desktop element: menus, dialogs and system overlays can intercept
/// input even though the agent-facing windows list only exposes ordinary apps.
fn input_window_stack(target: u32) -> Result<Vec<InputWindow>, String> {
    unsafe {
        let list = OwnedCf::new(CGWindowListCopyWindowInfo(1, 0), INPUT_WINDOW_UNAVAILABLE)?;
        let count = CFArrayGetCount(list.0);
        if !(0..=10_000).contains(&count) {
            return Err(INPUT_WINDOW_UNAVAILABLE.into());
        }
        let mut result = Vec::new();
        for index in 0..count {
            let item = CFArrayGetValueAtIndex(list.0, index);
            if item.is_null() || CFGetTypeID(item) != CFDictionaryGetTypeID() {
                return Err(INPUT_WINDOW_UNAVAILABLE.into());
            }
            let window_id = number(item, kCGWindowNumber)
                .and_then(|value| u32::try_from(value).ok())
                .filter(|id| *id != 0)
                .ok_or(INPUT_WINDOW_UNAVAILABLE)?;
            let dictionary = CFDictionaryGetValue(item, kCGWindowBounds);
            if dictionary.is_null() || CFGetTypeID(dictionary) != CFDictionaryGetTypeID() {
                return Err(INPUT_WINDOW_UNAVAILABLE.into());
            }
            let mut rect = Rect {
                origin: Point { x: 0.0, y: 0.0 },
                size: Size {
                    width: 0.0,
                    height: 0.0,
                },
            };
            if !CGRectMakeWithDictionaryRepresentation(dictionary, &mut rect) {
                return Err(INPUT_WINDOW_UNAVAILABLE.into());
            }
            let bounds = Region::from(rect);
            // Empty windows cannot cover a point. All other unknown or invalid
            // geometry fails closed rather than hiding a possible obstruction.
            if bounds.width == 0.0 || bounds.height == 0.0 {
                continue;
            }
            bounds.validate().map_err(|_| INPUT_WINDOW_UNAVAILABLE)?;
            result.push(InputWindow { window_id, bounds });
            // Windows behind the target cannot intercept this targeted point.
            if window_id == target {
                break;
            }
        }
        Ok(result)
    }
}

fn target_point_in_stack(
    x: f64,
    y: f64,
    target: u32,
    windows: &[InputWindow],
) -> Result<Point, String> {
    let bounds = windows
        .iter()
        .find(|window| window.window_id == target)
        .map(|window| window.bounds)
        .ok_or(INPUT_WINDOW_UNAVAILABLE)?;
    let (x, y) = global_point(x, y, Some(bounds))?;
    for window in windows {
        window
            .bounds
            .validate()
            .map_err(|_| INPUT_WINDOW_UNAVAILABLE)?;
        let bounds = window.bounds;
        if x >= bounds.x
            && x < bounds.x + bounds.width
            && y >= bounds.y
            && y < bounds.y + bounds.height
        {
            return if window.window_id == target {
                Ok(Point { x, y })
            } else {
                Err(INPUT_WINDOW_OBSCURED.into())
            };
        }
    }
    Err(INPUT_WINDOW_UNAVAILABLE.into())
}

fn event_point(x: f64, y: f64, window_id: Option<u32>) -> Result<Point, String> {
    if let Some(id) = window_id {
        // This is a conservative rectangular hit test, not atomic input routing.
        // macOS can still change stacking order after this fresh observation.
        return target_point_in_stack(x, y, id, &input_window_stack(id)?);
    }
    let (x, y) = global_point(x, y, None)?;
    Ok(Point { x, y })
}

fn mouse_event(kind: u32, point: Point, button: u32) -> Result<OwnedCf, String> {
    OwnedCf::new(
        unsafe { CGEventCreateMouseEvent(std::ptr::null(), kind, point, button) },
        "Could not create mouse input. Check Aven's Accessibility permission.",
    )
}

fn keyboard_event(code: u16, down: bool) -> Result<OwnedCf, String> {
    OwnedCf::new(
        unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), code, down) },
        "Could not create keyboard input. Check Aven's Accessibility permission.",
    )
}

fn click(point: Point, button: Button, count: u8) -> Result<(), String> {
    let (down_kind, up_kind, button) = match button {
        Button::Left => (1, 2, 0),
        Button::Right => (3, 4, 1),
    };
    // Allocate every event before posting to avoid a failed allocation leaving
    // the mouse button held down. Post at kCGHIDEventTap (0).
    let down = mouse_event(down_kind, point, button)?;
    let up = mouse_event(up_kind, point, button)?;
    let moved = mouse_event(5, point, 0)?;
    unsafe {
        CGEventSetFlags(moved.event(), 0);
        CGEventPost(0, moved.event());
        for click in 1..=count {
            for event in [&down, &up] {
                CGEventSetFlags(event.event(), 0);
                CGEventSetIntegerValueField(event.event(), 1, i64::from(click));
                CGEventPost(0, event.event());
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
    Ok(())
}

fn press(key: &str, modifiers: &[Modifier]) -> Result<(), String> {
    let code = key_code(key)?;
    let flags = modifier_flags(modifiers)?;
    let down = keyboard_event(code, true)?;
    let up = keyboard_event(code, false)?;
    unsafe {
        CGEventSetFlags(down.event(), flags);
        CGEventSetFlags(up.event(), flags);
        CGEventPost(0, down.event());
        CGEventPost(0, up.event());
    }
    Ok(())
}

/// Limit Unicode payloads to 20 UTF-16 units without splitting surrogate pairs.
fn unicode_chunks(text: &str) -> Vec<Vec<u16>> {
    let mut result = Vec::new();
    let mut chunk = Vec::new();
    for character in text.chars() {
        if chunk.len() + character.len_utf16() > 20 {
            result.push(std::mem::take(&mut chunk));
        }
        let mut buffer = [0; 2];
        chunk.extend_from_slice(character.encode_utf16(&mut buffer));
    }
    if !chunk.is_empty() {
        result.push(chunk);
    }
    result
}

fn type_text(text: &str) -> Result<(), String> {
    let down = keyboard_event(0, true)?;
    let up = keyboard_event(0, false)?;
    for chunk in unicode_chunks(text) {
        unsafe {
            for event in [&down, &up] {
                CGEventSetFlags(event.event(), 0);
                CGEventKeyboardSetUnicodeString(event.event(), chunk.len(), chunk.as_ptr());
                CGEventPost(0, event.event());
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

fn scroll(point: Point, delta_x: i32, delta_y: i32) -> Result<(), String> {
    // CG uses positive up/left; CLI uses positive down/right, like the browser.
    let event = OwnedCf::new(
        unsafe { CGEventCreateScrollWheelEvent2(std::ptr::null(), 0, 2, -delta_y, -delta_x, 0) },
        "Could not create scroll input. Check Aven's Accessibility permission.",
    )?;
    let moved = mouse_event(5, point, 0)?;
    unsafe {
        CGEventSetFlags(moved.event(), 0);
        CGEventPost(0, moved.event());
        CGEventSetLocation(event.event(), point);
        CGEventSetFlags(event.event(), 0);
        CGEventPost(0, event.event());
    }
    Ok(())
}

const ACTIVATION_TIMEOUT: &str = "App activation timed out. Observe the desktop before retrying.";
const ACTIVATION_REFUSED: &str =
    "macOS did not allow that app to take focus. Bring Aven to the foreground, observe the desktop, and retry.";

fn activation_on_main<T: Send + 'static>(
    app_handle: &AppHandle,
    deadline: Instant,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if Instant::now() >= deadline {
        return Err(ACTIVATION_TIMEOUT.into());
    }
    let (sender, receiver) = mpsc::channel();
    app_handle
        .run_on_main_thread(move || {
            // A timed-out request must not activate an app later, after the
            // desktop gate has been released or the user has switched it off.
            if Instant::now() >= deadline {
                return;
            }
            let result = objc2::rc::autoreleasepool(|_| operation());
            let _ = sender.send(result);
        })
        .map_err(|_| "Could not activate the app. Keep Aven open and retry.")?;
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| ACTIVATION_TIMEOUT.to_string())?
}

fn confirm_activation(
    pid: i32,
    accepted: bool,
    deadline: Instant,
    mut frontmost: impl FnMut() -> Result<Option<i32>, String>,
) -> Result<Value, String> {
    loop {
        if Instant::now() >= deadline {
            return Err(ACTIVATION_TIMEOUT.into());
        }
        if frontmost()? == Some(pid) {
            return Ok(json!({"activated":true,"pid":pid}));
        }
        if !accepted {
            return Err(ACTIVATION_REFUSED.into());
        }
        // AppKit activation completes asynchronously. Sleep only on the socket
        // worker; each observation is a later main-loop turn, never a busy wait
        // on cached NSRunningApplication.isActive state.
        std::thread::sleep(
            Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn activate(
    app_handle: &AppHandle,
    pid: Option<i32>,
    name: Option<String>,
) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut attempt = activation_on_main(app_handle, deadline, move || unsafe {
        activate_on_main(pid, name.as_deref())
    })?;
    if !attempt.accepted {
        let frontmost =
            activation_on_main(app_handle, deadline, || unsafe { frontmost_pid_on_main() })?;
        if frontmost != Some(attempt.pid) {
            // A background host cannot promise a cooperative focus handoff.
            // Native automation already requires explicit Accessibility access;
            // use its target-specific focus attribute, never a synthetic click
            // or an application launch, then independently observe the result.
            activate_with_accessibility(attempt.pid, deadline)?;
        }
        attempt.accepted = true;
    }
    confirm_activation(attempt.pid, attempt.accepted, deadline, || {
        activation_on_main(app_handle, deadline, || unsafe { frontmost_pid_on_main() })
    })
}

fn accessibility_activation_timeout(deadline: Instant) -> Result<f32, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(ACTIVATION_TIMEOUT.into())
    } else {
        // This is per AX object, not a mutation of the process-wide timeout.
        Ok(remaining.min(Duration::from_millis(500)).as_secs_f32())
    }
}

fn accessibility_activation_steps(
    deadline: Instant,
    mut can_set_frontmost: impl FnMut(f32) -> Result<bool, String>,
    mut set_frontmost: impl FnMut(f32) -> Result<(), String>,
) -> Result<(), String> {
    if !can_set_frontmost(accessibility_activation_timeout(deadline)?)? {
        return Err("That app does not allow its Accessibility focus attribute to be changed. Bring it forward manually and observe it again.".into());
    }
    // Recheck after the query: a slow target cannot receive new input after the
    // shared activation deadline has expired.
    set_frontmost(accessibility_activation_timeout(deadline)?)
}

fn activation_ax_result(result: i32, operation: &str) -> Result<(), String> {
    if result == 0 {
        Ok(())
    } else {
        Err(format!("macOS Accessibility could not {operation} (error {result}). Observe the desktop and retry."))
    }
}

fn activate_with_accessibility(pid: i32, deadline: Instant) -> Result<(), String> {
    // Runs on the socket worker while the desktop-control permission/execution
    // gate is held. No AX round-trip can block the native UI thread.
    objc2::rc::autoreleasepool(|_| unsafe {
        let application = OwnedCf::new(
            AXUIElementCreateApplication(pid),
            "Could not access that running app through Accessibility.",
        )?;
        let attribute_name = NSString::from_str("AXFrontmost");
        let attribute = Retained::as_ptr(&attribute_name).cast();
        accessibility_activation_steps(
            deadline,
            |timeout| {
                activation_ax_result(
                    AXUIElementSetMessagingTimeout(application.0, timeout),
                    "set the target app's focus timeout",
                )?;
                let mut settable = 0;
                activation_ax_result(
                    AXUIElementIsAttributeSettable(application.0, attribute, &mut settable),
                    "check the target app's focus support",
                )?;
                Ok(settable != 0)
            },
            |timeout| {
                activation_ax_result(
                    AXUIElementSetMessagingTimeout(application.0, timeout),
                    "set the target app's focus timeout",
                )?;
                activation_ax_result(
                    AXUIElementSetAttributeValue(application.0, attribute, kCFBooleanTrue),
                    "focus the target app",
                )
            },
        )
    })
}

unsafe fn frontmost_pid_on_main() -> Result<Option<i32>, String> {
    let class = AnyClass::get(c"NSWorkspace").ok_or("macOS workspace is unavailable.")?;
    let workspace: Retained<AnyObject> = msg_send![class, sharedWorkspace];
    let frontmost: Option<Retained<AnyObject>> = msg_send![&*workspace, frontmostApplication];
    Ok(frontmost.map(|application| msg_send![&*application, processIdentifier]))
}

struct ActivationAttempt {
    pid: i32,
    accepted: bool,
}

unsafe fn activate_on_main(
    pid: Option<i32>,
    name: Option<&str>,
) -> Result<ActivationAttempt, String> {
    let class =
        AnyClass::get(c"NSRunningApplication").ok_or("macOS app activation is unavailable.")?;
    let application: Retained<AnyObject> = if let Some(pid) = pid {
        let app: Option<Retained<AnyObject>> =
            msg_send![class, runningApplicationWithProcessIdentifier: pid];
        app.ok_or("That process is no longer a running app. Run windows again.")?
    } else {
        let workspace_class =
            AnyClass::get(c"NSWorkspace").ok_or("macOS workspace is unavailable.")?;
        let workspace: Retained<AnyObject> = msg_send![workspace_class, sharedWorkspace];
        let applications: Retained<NSArray<AnyObject>> =
            msg_send![&*workspace, runningApplications];
        let name = name.ok_or("Provide an app name or pid.")?;
        let mut matching = Vec::new();
        for app in &applications {
            let app_name: Option<Retained<NSString>> = msg_send![&*app, localizedName];
            if app_name.is_some_and(|value| value.to_string().eq_ignore_ascii_case(name)) {
                matching.push(app);
            }
        }
        if matching.len() > 1 {
            return Err(
                "More than one running app has that name. Use its pid from windows.".into(),
            );
        }
        matching
            .pop()
            .ok_or("That app is not running. Open it first or use a pid from windows.")?
    };
    let pid: i32 = msg_send![&*application, processIdentifier];
    let app_class =
        AnyClass::get(c"NSApplication").ok_or("macOS app activation is unavailable.")?;
    let host: Retained<AnyObject> = msg_send![app_class, sharedApplication];
    let current: Retained<AnyObject> = msg_send![class, currentApplication];
    if frontmost_pid_on_main()? == Some(pid) {
        return Ok(ActivationAttempt {
            pid,
            accepted: true,
        });
    }
    // macOS 14+ ignores activateIgnoringOtherApps. Give AppKit an explicit
    // cooperative handoff from this host to the exact existing target. Never
    // launch an app or use an unrelated app as the source of activation.
    let can_yield: Bool =
        msg_send![&*host, respondsToSelector: objc2::sel!(yieldActivationToApplication:)];
    let can_activate_from: Bool =
        msg_send![&*application, respondsToSelector: objc2::sel!(activateFromApplication:options:)];
    let accepted: Bool = if can_yield.as_bool() && can_activate_from.as_bool() {
        let _: () = msg_send![&*host, yieldActivationToApplication: &*application];
        msg_send![&*application, activateFromApplication: &*current, options: 0usize]
    } else {
        // Older macOS has no cooperative API; keep the target-only request.
        msg_send![&*application, activateWithOptions: 2usize]
    };
    Ok(ActivationAttempt {
        pid,
        accepted: accepted.as_bool(),
    })
}

struct Captures {
    directory: PathBuf,
    files: VecDeque<PathBuf>,
}
impl Captures {
    fn retain(&mut self, path: &Path) -> Result<(), String> {
        while self.files.len() >= 20 {
            let oldest = self
                .files
                .front()
                .ok_or("Screenshot history is unavailable.")?;
            match std::fs::remove_file(oldest) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err("Could not remove an old screenshot. Check the temporary directory permissions.".into()),
            }
            self.files.pop_front();
        }
        self.files.push_back(path.to_path_buf());
        Ok(())
    }
}
impl Drop for Captures {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.directory) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Could not remove desktop screenshots: {error}");
            }
        }
    }
}

#[derive(Default)]
struct CaptureSession {
    revoked: AtomicBool,
    cleanup_finished: AtomicBool,
    captures: Mutex<Option<Captures>>,
}

impl CaptureSession {
    fn require_active(&self) -> Result<(), String> {
        if self.revoked.load(Ordering::Acquire) {
            Err("Desktop screenshot session is unavailable.".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
struct CaptureRegistry {
    active: HashMap<String, Arc<CaptureSession>>,
    // Keep revoked scopes reachable until cleanup completes, so normal app exit
    // also drains a capture revoked just before shutdown began.
    retired: Vec<Arc<CaptureSession>>,
}

impl CaptureRegistry {
    fn prune_finished(&mut self) {
        self.retired
            .retain(|session| !session.cleanup_finished.load(Ordering::Acquire));
    }
}

type CaptureSessions = Mutex<CaptureRegistry>;
// Keys are opaque grant generations, not task IDs or filesystem names. A stale
// request cannot acquire a later grant for the same task after revoke/rebind.
static CAPTURES: OnceLock<CaptureSessions> = OnceLock::new();

pub(super) fn bind_session(scope: &str) -> Result<(), String> {
    let mut sessions = CAPTURES
        .get_or_init(CaptureSessions::default)
        .lock()
        .map_err(|_| "Desktop screenshot storage is unavailable.")?;
    sessions.prune_finished();
    sessions
        .active
        .entry(scope.into())
        .or_insert_with(|| Arc::new(CaptureSession::default()));
    Ok(())
}

fn revoke_capture_sessions(
    sessions: &mut CaptureRegistry,
    scope: Option<&str>,
) -> Vec<Arc<CaptureSession>> {
    sessions.prune_finished();
    let mut revoked = Vec::new();
    sessions.active.retain(|id, session| {
        if scope.is_some_and(|scope| scope != id) {
            return true;
        }
        session.revoked.store(true, Ordering::Release);
        revoked.push(Arc::clone(session));
        false
    });
    if scope.is_none() {
        revoked.append(&mut sessions.retired);
    } else {
        sessions.retired.extend(revoked.iter().cloned());
    }
    revoked
}

pub(super) fn remove_captures(scope: Option<&str>) {
    if let Some(sessions) = CAPTURES.get() {
        let revoked = {
            let mut sessions = sessions.lock().unwrap_or_else(|error| error.into_inner());
            revoke_capture_sessions(&mut sessions, scope)
        };
        // Never wait for capture, scaling, or filesystem cleanup in a UI
        // bind/revoke callback. An in-flight capture owns its directory until
        // it finishes, rejects its revoked result, then removes its files.
        if scope.is_none() {
            // Process exit must finish cleanup before the runtime disappears.
            // Capture commands have bounded deadlines. Wait only here, after
            // releasing the registry; ordinary revoke never waits for them.
            finish_capture_cleanup(revoked);
        } else if !revoked.is_empty() {
            tauri::async_runtime::spawn_blocking(move || finish_capture_cleanup(revoked));
        }
    }
}

fn finish_capture_cleanup(revoked: Vec<Arc<CaptureSession>>) {
    for session in revoked {
        let mut captures = session
            .captures
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // Keep this per-scope guard through deletion. A simultaneous shutdown
        // must wait for the worker's cleanup, not just for it to take ownership.
        drop(captures.take());
        session.cleanup_finished.store(true, Ordering::Release);
    }
}

fn with_captures<T>(
    sessions: &CaptureSessions,
    scope: &str,
    work: impl FnOnce(&mut Captures) -> Result<T, String>,
) -> Result<T, String> {
    let session = sessions
        .lock()
        .map_err(|_| "Desktop screenshot storage is unavailable.")?
        .active
        .get(scope)
        .cloned()
        .ok_or("Desktop screenshot session is unavailable.")?;
    let mut captures = session
        .captures
        .lock()
        .map_err(|_| "Desktop screenshot storage is unavailable.")?;
    session.require_active()?;
    if captures.is_none() {
        *captures = Some(Captures {
            directory: capture_directory()?,
            files: VecDeque::new(),
        });
    }
    let result = work(
        captures
            .as_mut()
            .ok_or("Desktop screenshot storage is unavailable.")?,
    );
    session.require_active()?;
    result
}

fn capture_directory() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join(format!("aven-desktop-{}", uuid::Uuid::new_v4()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .map_err(|_| "Could not create a private desktop screenshot directory.")?;
    Ok(directory)
}

fn run_image_command(command: &mut Command, description: &str) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| format!("Could not start {description}."))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("{description} failed. Check Aven's Screen Recording permission in Settings, Skills & tools, then retry."))
                }
            }
            Ok(None) if started.elapsed() < Duration::from_secs(8) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{description} timed out. Try a smaller screenshot region."
                ));
            }
        }
    }
}

fn png_dimensions(path: &Path) -> Result<(u32, u32), String> {
    use std::io::Read;
    let mut header = [0; 24];
    std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| "The screenshot image could not be read.")?;
    if &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
        return Err("macOS did not return a PNG screenshot.".into());
    }
    let width = u32::from_be_bytes(header[16..20].try_into().expect("four bytes"));
    let height = u32::from_be_bytes(header[20..24].try_into().expect("four bytes"));
    Ok((width, height))
}

/// A clipped image cannot safely be stretched back to the requested bounds:
/// its coordinates would no longer identify the same on-screen points.
fn validate_capture_scale(pixels: (u32, u32), points: (u32, u32)) -> Result<(), String> {
    let (width, height) = pixels;
    let (point_width, point_height) = points;
    if point_width == 0
        || point_height == 0
        || width < point_width
        || height < point_height
        || u64::from(width) * u64::from(point_height) != u64::from(height) * u64::from(point_width)
        || width / point_width > 4
        || height / point_height > 4
    {
        return Err("The screenshot was clipped or has unexpected dimensions. Choose a region fully on screen and retry.".into());
    }
    Ok(())
}

fn screenshot(
    scope: &str,
    window_id: Option<u32>,
    region: Option<Region>,
) -> Result<Value, String> {
    let bounds = match (window_id, region) {
        (Some(id), None) => window_bounds(id)?,
        (None, Some(region)) => region,
        (None, None) => unsafe { CGDisplayBounds(CGMainDisplayID()).into() },
        _ => return Err("Choose windowId or region, not both.".into()),
    };
    bounds.validate()?;
    // Explicit integer point bounds make -R rounding and the returned pixel
    // geometry agree. CG window/main-display bounds are already integral.
    if [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .any(|value| value.fract() != 0.0)
    {
        return Err("Screenshot bounds must use whole screen points.".into());
    }
    let width = bounds.width as u32;
    let height = bounds.height as u32;
    with_captures(
        CAPTURES.get_or_init(CaptureSessions::default),
        scope,
        |captures| {
            let path = captures
                .directory
                .join(format!("{}.png", uuid::Uuid::new_v4()));
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(|_| "Could not create a private screenshot file.")?;
            let result = (|| {
                // Spawn directly from Aven, so the responsible process for TCC is Aven.
                let mut command = Command::new("/usr/sbin/screencapture");
                command.args(["-x", "-o", "-t", "png"]);
                if let Some(id) = window_id {
                    command.arg("-l").arg(id.to_string());
                } else if region.is_some() {
                    command
                        .arg("-R")
                        .arg(format!("{},{},{},{}", bounds.x, bounds.y, width, height));
                } else {
                    command.arg("-m");
                }
                run_image_command(command.arg(&path), "Screen capture")?;
                if let Some(id) = window_id {
                    let current = window_bounds(id)?;
                    if current.x != bounds.x
                        || current.y != bounds.y
                        || current.width != bounds.width
                        || current.height != bounds.height
                    {
                        return Err(
                            "The window moved during capture. Take a new screenshot.".into()
                        );
                    }
                }
                let native_dimensions = png_dimensions(&path)?;
                validate_capture_scale(native_dimensions, (width, height))?;
                if native_dimensions != (width, height) {
                    run_image_command(
                        Command::new("/usr/bin/sips")
                            .arg("-z")
                            .arg(height.to_string())
                            .arg(width.to_string())
                            .arg(&path),
                        "Screenshot scaling",
                    )?;
                }
                if png_dimensions(&path)? != (width, height) {
                    return Err(
                        "Screenshot scaling returned unexpected dimensions. Retry the screenshot."
                            .into(),
                    );
                }
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| "Could not protect the screenshot file.")?;
                captures.retain(&path)?;
                Ok(
                    json!({"path":path,"width":width,"height":height,"originX":bounds.x,"originY":bounds.y}),
                )
            })();
            if result.is_err() {
                let _ = std::fs::remove_file(&path);
            }
            result
        },
    )
}

pub(super) fn execute(app: &AppHandle, scope: &str, request: Request) -> Result<Value, String> {
    match request {
        Request::Status {} => {
            Err("Status must be checked through the desktop control gate.".into())
        }
        Request::Windows {} => Ok(json!({"windows":windows()?})),
        Request::Screenshot { window_id, region } => screenshot(scope, window_id, region),
        Request::Click {
            x,
            y,
            window_id,
            button,
            count,
        } => {
            click(event_point(x, y, window_id)?, button, count)?;
            Ok(json!({"clicked":true}))
        }
        Request::Type { text } => {
            type_text(&text)?;
            Ok(json!({"typed":true}))
        }
        Request::Press { key, modifiers } => {
            press(&key, &modifiers)?;
            Ok(json!({"pressed":true}))
        }
        Request::Scroll {
            x,
            y,
            window_id,
            delta_x,
            delta_y,
        } => {
            scroll(event_point(x, y, window_id)?, delta_x, delta_y)?;
            Ok(json!({"scrolled":true}))
        }
        Request::Activate { pid, app: name } => activate(app, pid, name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input_window(id: u32, x: f64, y: f64, width: f64, height: f64) -> InputWindow {
        InputWindow {
            window_id: id,
            bounds: Region {
                x,
                y,
                width,
                height,
            },
        }
    }

    #[test]
    fn targeted_input_uses_frontmost_window_at_the_point_not_just_matching_bounds() {
        let target = input_window(10, 100.0, 200.0, 300.0, 200.0);
        let overlapping = input_window(20, 110.0, 205.0, 50.0, 50.0);
        let point = target_point_in_stack(20.0, 10.0, 10, &[target, overlapping]).unwrap();
        assert_eq!((point.x, point.y), (120.0, 210.0));
        assert_eq!(
            target_point_in_stack(20.0, 10.0, 10, &[overlapping, target]).unwrap_err(),
            INPUT_WINDOW_OBSCURED,
        );
        // A partially covered window is still usable at its uncovered points.
        let point = target_point_in_stack(200.0, 100.0, 10, &[overlapping, target]).unwrap();
        assert_eq!((point.x, point.y), (300.0, 300.0));
    }

    #[test]
    fn targeted_input_refuses_system_overlays_and_unknown_window_geometry() {
        let target = input_window(10, 100.0, 200.0, 300.0, 200.0);
        // The stack includes nonzero-layer windows such as menus and dialogs;
        // there is deliberately no layer or application exemption in the guard.
        let overlay = input_window(99, 0.0, 0.0, 1000.0, 1000.0);
        assert_eq!(
            target_point_in_stack(20.0, 10.0, 10, &[overlay, target]).unwrap_err(),
            INPUT_WINDOW_OBSCURED,
        );
        let unknown = input_window(99, f64::NAN, 0.0, 1000.0, 1000.0);
        assert_eq!(
            target_point_in_stack(20.0, 10.0, 10, &[unknown, target]).unwrap_err(),
            INPUT_WINDOW_UNAVAILABLE,
        );
        assert_eq!(
            target_point_in_stack(20.0, 10.0, 10, &[overlay]).unwrap_err(),
            INPUT_WINDOW_UNAVAILABLE,
        );
    }

    #[test]
    fn targeted_input_enforces_half_open_bounds_and_negative_display_origins() {
        let target = input_window(10, -500.0, -100.0, 300.0, 200.0);
        let point = target_point_in_stack(0.0, 0.0, 10, &[target]).unwrap();
        assert_eq!((point.x, point.y), (-500.0, -100.0));
        for (x, y) in [(-1.0, 0.0), (0.0, -1.0), (300.0, 0.0), (0.0, 200.0)] {
            assert!(target_point_in_stack(x, y, 10, &[target]).is_err());
        }
        let overlay = input_window(20, -490.0, -90.0, 10.0, 10.0);
        assert_eq!(
            target_point_in_stack(10.0, 10.0, 10, &[overlay, target]).unwrap_err(),
            INPUT_WINDOW_OBSCURED,
        );
        for (x, y) in [(20.0, 10.0), (10.0, 20.0)] {
            assert!(target_point_in_stack(x, y, 10, &[overlay, target]).is_ok());
        }
    }

    #[test]
    fn removing_capture_directories_is_scoped_and_shutdown_removes_the_rest() {
        let first = capture_directory().unwrap();
        let second = capture_directory().unwrap();
        let mut sessions = CaptureRegistry::default();
        for (id, directory) in [("first", &first), ("second", &second)] {
            let path = directory.join("capture.png");
            std::fs::write(&path, b"test capture").unwrap();
            sessions.active.insert(
                id.into(),
                Arc::new(CaptureSession {
                    revoked: AtomicBool::new(false),
                    cleanup_finished: AtomicBool::new(false),
                    captures: Mutex::new(Some(Captures {
                        directory: directory.clone(),
                        files: VecDeque::from([path]),
                    })),
                }),
            );
        }
        sessions
            .active
            .insert("no-captures".into(), Arc::new(CaptureSession::default()));
        let removed = revoke_capture_sessions(&mut sessions, Some("first"));
        assert!(
            first.exists(),
            "registry mutation must not perform filesystem cleanup"
        );
        assert!(!sessions.active.contains_key("first"));
        finish_capture_cleanup(removed);
        assert!(!first.exists());
        assert!(second.join("capture.png").exists());
        assert!(sessions.active.contains_key("no-captures"));
        finish_capture_cleanup(revoke_capture_sessions(&mut sessions, Some("first")));
        finish_capture_cleanup(revoke_capture_sessions(&mut sessions, None));
        assert!(sessions.active.is_empty());
        assert!(sessions.retired.is_empty());
        assert!(!second.exists());
    }

    #[test]
    fn blocked_capture_does_not_block_bind_or_revoke_and_cannot_publish_after_rebind() {
        let sessions = Arc::new(Mutex::new(CaptureRegistry {
            active: HashMap::from([("old-grant".into(), Arc::new(CaptureSession::default()))]),
            ..CaptureRegistry::default()
        }));
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let capture_sessions = Arc::clone(&sessions);
        let capture = std::thread::spawn(move || {
            with_captures(&capture_sessions, "old-grant", |captures| {
                let path = captures.directory.join("in-flight.png");
                std::fs::write(&path, b"test capture").unwrap();
                started_tx.send(path.clone()).unwrap();
                finish_rx.recv().unwrap();
                captures.retain(&path)?;
                Ok(path)
            })
        });
        let old_path = started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (revoked_tx, revoked_rx) = mpsc::channel();
        let revoke_sessions = Arc::clone(&sessions);
        let revoke = std::thread::spawn(move || {
            let removed = {
                let mut sessions = revoke_sessions.lock().unwrap();
                sessions
                    .active
                    .insert("other-task".into(), Arc::new(CaptureSession::default()));
                let removed = revoke_capture_sessions(&mut sessions, Some("old-grant"));
                sessions
                    .active
                    .insert("new-grant".into(), Arc::new(CaptureSession::default()));
                removed
            };
            // Revocation finishes without waiting for this cleanup job.
            revoked_tx.send(removed).unwrap();
        });
        let promptly_revoked = revoked_rx.recv_timeout(Duration::from_secs(2));
        // Always release the fake slow command, including when this regression
        // fails, so the test cannot leave a blocked worker behind.
        finish_tx.send(()).unwrap();
        let result = capture.join().unwrap();
        revoke.join().unwrap();
        let removed = promptly_revoked.expect("bind/revoke waited for the in-flight capture");
        finish_capture_cleanup(removed);
        assert!(result.unwrap_err().contains("session is unavailable"));
        assert!(!old_path.parent().unwrap().exists());
        assert!(with_captures(&sessions, "old-grant", |_| Ok(())).is_err());
        let new_path = with_captures(&sessions, "new-grant", |captures| {
            Ok(captures.directory.clone())
        })
        .unwrap();
        assert!(new_path.exists());
        assert_ne!(old_path.parent().unwrap(), new_path);
        drop(sessions);
        assert!(!new_path.exists());
    }

    #[test]
    fn shutdown_drains_previously_revoked_in_flight_captures_even_before_cleanup_worker_starts() {
        let sessions = Arc::new(Mutex::new(CaptureRegistry {
            active: HashMap::from([("shutdown-grant".into(), Arc::new(CaptureSession::default()))]),
            ..CaptureRegistry::default()
        }));
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let capture_sessions = Arc::clone(&sessions);
        let capture = std::thread::spawn(move || {
            with_captures(&capture_sessions, "shutdown-grant", |captures| {
                let path = captures.directory.join("in-flight.png");
                std::fs::write(&path, b"test capture").unwrap();
                started_tx.send(path).unwrap();
                finish_rx.recv().unwrap();
                Ok(())
            })
        });
        let path = started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let queued_cleanup =
            revoke_capture_sessions(&mut sessions.lock().unwrap(), Some("shutdown-grant"));
        // Simulate the blocking pool not starting the prior revoke's job yet.
        assert_eq!(sessions.lock().unwrap().retired.len(), 1);
        let revoked = revoke_capture_sessions(&mut sessions.lock().unwrap(), None);
        assert!(sessions.lock().unwrap().active.is_empty());
        assert!(sessions.lock().unwrap().retired.is_empty());
        let shutdown = std::thread::spawn(move || finish_capture_cleanup(revoked));
        finish_tx.send(()).unwrap();
        shutdown.join().unwrap();
        // Shutdown owns cleanup even if another Arc survives until this join.
        assert!(!path.parent().unwrap().exists());
        assert!(capture.join().unwrap().is_err());
        finish_capture_cleanup(queued_cleanup);
        assert!(!path.parent().unwrap().exists());
    }

    #[test]
    fn accessibility_focus_does_not_write_when_target_refuses_or_query_fails() {
        for query in [Ok(false), Err("query failed".into())] {
            let result = accessibility_activation_steps(
                Instant::now() + Duration::from_secs(1),
                |_| query.clone(),
                |_| panic!("focus must not be written without target support"),
            );
            assert!(result.is_err());
        }
        let result = accessibility_activation_steps(
            Instant::now() + Duration::from_secs(1),
            |timeout| {
                assert!(timeout > 0.0 && timeout <= 0.5);
                Ok(true)
            },
            |timeout| {
                assert!(timeout > 0.0 && timeout <= 0.5);
                Err("focus denied".into())
            },
        );
        assert_eq!(result.unwrap_err(), "focus denied");
    }

    #[test]
    fn accessibility_focus_rechecks_deadline_before_writing() {
        let result = accessibility_activation_steps(
            Instant::now() + Duration::from_millis(10),
            |_| {
                std::thread::sleep(Duration::from_millis(20));
                Ok(true)
            },
            |_| panic!("expired request must not change focus"),
        );
        assert_eq!(result.unwrap_err(), ACTIVATION_TIMEOUT);
        assert_eq!(
            accessibility_activation_steps(
                Instant::now(),
                |_| panic!("expired request must not query the target"),
                |_| panic!("expired request must not change focus"),
            )
            .unwrap_err(),
            ACTIVATION_TIMEOUT,
        );
    }

    #[test]
    fn accessibility_focus_success_still_requires_foreground_confirmation() {
        accessibility_activation_steps(
            Instant::now() + Duration::from_secs(1),
            |_| Ok(true),
            |_| Ok(()),
        )
        .unwrap();
        let result =
            confirm_activation(10, true, Instant::now() + Duration::from_millis(10), || {
                Ok(Some(20))
            });
        assert_eq!(result.unwrap_err(), ACTIVATION_TIMEOUT);
    }

    #[test]
    fn activation_success_requires_observed_foreground_not_an_accepted_request() {
        let mut observations = VecDeque::from([Some(20), None, Some(10)]);
        let result = confirm_activation(10, true, Instant::now() + Duration::from_secs(1), || {
            Ok(observations
                .pop_front()
                .expect("unexpected extra observation"))
        })
        .unwrap();
        assert!(observations.is_empty());
        assert_eq!(result, json!({"activated":true,"pid":10}));
    }

    #[test]
    fn activation_refusal_never_reports_success_for_the_wrong_app() {
        let error = confirm_activation(10, false, Instant::now() + Duration::from_secs(1), || {
            Ok(Some(20))
        })
        .unwrap_err();
        assert_eq!(error, ACTIVATION_REFUSED);
        // The requested app may already be active even when no new activation
        // request was accepted; observed focus remains the success criterion.
        assert!(
            confirm_activation(10, false, Instant::now() + Duration::from_secs(1), || {
                Ok(Some(10))
            })
            .is_ok()
        );
    }

    #[test]
    fn activation_deadline_stops_observing_and_propagates_observation_failure() {
        assert_eq!(
            confirm_activation(10, true, Instant::now(), || panic!(
                "expired activation observed"
            ))
            .unwrap_err(),
            ACTIVATION_TIMEOUT,
        );
        assert_eq!(
            confirm_activation(10, true, Instant::now() + Duration::from_secs(1), || {
                Err("native observation failed".into())
            })
            .unwrap_err(),
            "native observation failed",
        );
    }

    #[test]
    fn unicode_chunks_preserve_surrogate_pairs_and_bound_event_payloads() {
        let text = format!("{}😀é{}", "x".repeat(19), "文".repeat(45));
        let chunks = unicode_chunks(&text);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.len() <= 20 && String::from_utf16(chunk).is_ok()));
        assert_eq!(String::from_utf16(&chunks.concat()).unwrap(), text);
        assert!(unicode_chunks("").is_empty());
    }
    #[test]
    fn capture_scale_accepts_retina_but_rejects_clipping_and_upscaling() {
        for pixels in [(800, 600), (1600, 1200), (2400, 1800)] {
            assert!(validate_capture_scale(pixels, (800, 600)).is_ok());
        }
        for pixels in [(400, 300), (1500, 1200), (1600, 1100), (0, 0), (4800, 3600)] {
            assert!(validate_capture_scale(pixels, (800, 600)).is_err());
        }
        assert!(validate_capture_scale((800, 600), (0, 0)).is_err());
    }
    #[test]
    fn capture_retention_removes_only_the_oldest_files_in_its_session() {
        let directory = capture_directory().unwrap();
        let mut captures = Captures {
            directory: directory.clone(),
            files: VecDeque::new(),
        };
        let other_directory = capture_directory().unwrap();
        let other = other_directory.join("other.png");
        std::fs::write(&other, b"other session").unwrap();
        for index in 0..25 {
            let path = directory.join(format!("{index}.png"));
            std::fs::write(&path, b"test screenshot").unwrap();
            captures.retain(&path).unwrap();
        }
        assert_eq!(captures.files.len(), 20);
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 20);
        assert_eq!(captures.files.front().unwrap(), &directory.join("5.png"));
        for index in 0..5 {
            assert!(!directory.join(format!("{index}.png")).exists());
        }
        assert!(other.exists());
        std::fs::remove_dir_all(directory).unwrap();
        std::fs::remove_dir_all(other_directory).unwrap();
    }
    #[test]
    fn screenshot_directory_is_private() {
        let directory = capture_directory().unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::remove_dir(directory).unwrap();
    }
}
