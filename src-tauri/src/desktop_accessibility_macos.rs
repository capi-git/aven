//! Accessibility-element observation and background actions for the macOS
//! host. Every call runs on a socket worker with a bounded AX messaging
//! timeout. Nothing here posts CGEvents, moves the pointer, activates an app,
//! or waits on the main thread; callers receive a [`Next`] when a fallback to
//! the existing app-directed event path is needed.
//!
//! Policy (bounds, redaction, staleness, fallbacks) lives in the platform-
//! independent `accessibility` module; this file only reads and writes AX.
use super::*;
use crate::desktop_control::accessibility::{
    self as rules, AfterWrite, ClickStep, KeyStep, KeyTarget, NodeInfo, NodeValue, Outcome,
    ScrollDirection,
};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCopyMultipleAttributeValues(
        element: Cf,
        attributes: Cf,
        options: u32,
        values: *mut Cf,
    ) -> i32;
    fn AXUIElementCopyActionNames(element: Cf, actions: *mut Cf) -> i32;
    fn AXUIElementPerformAction(element: Cf, action: Cf) -> i32;
    fn AXUIElementGetPid(element: Cf, pid: *mut i32) -> i32;
    fn AXValueCreate(kind: u32, value: *const c_void) -> Cf;
    fn AXValueGetType(value: Cf) -> u32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRetain(value: Cf) -> Cf;
    fn CFEqual(a: Cf, b: Cf) -> bool;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: Cf) -> bool;
    fn CFNumberCreate(allocator: Cf, kind: isize, value: *const c_void) -> Cf;
    fn CFStringGetLength(string: Cf) -> isize;
    static kCFBooleanFalse: Cf;
}

// AXError values (HIServices/AXError.h).
const AX_INVALID_ELEMENT: i32 = -25202;
const AX_CANNOT_COMPLETE: i32 = -25204;
const AX_ATTRIBUTE_UNSUPPORTED: i32 = -25205;
const AX_ACTION_UNSUPPORTED: i32 = -25206;
const AX_NOT_IMPLEMENTED: i32 = -25208;
const AX_FAILURE: i32 = -25200;
// AXValueType values.
const AX_POINT: u32 = 1;
const AX_SIZE: u32 = 2;
const AX_RANGE: u32 = 4;
const AX_ERROR_VALUE: u32 = 5;

/// Whole-capture budget for appState, and per-message bounds.
const CAPTURE_BUDGET: Duration = Duration::from_millis(3000);
/// Extra budget for telling repeated and unlabelled elements apart.
const CONTEXT_BUDGET: Duration = Duration::from_millis(1500);
const LOOKUP_BUDGET: Duration = Duration::from_millis(1500);
const READ_TIMEOUT: f32 = 0.25;
/// Actions can take longer than reads; a menu opened by an action keeps the
/// app's handler busy, which is reported as an unconfirmed result.
const ACTION_TIMEOUT: f32 = 1.0;
/// Chromium builds its tree asynchronously after the switch is turned on.
const ENGINE_SETTLE: Duration = Duration::from_millis(350);
const MAX_VALUE_CHARS: usize = 1000;
/// Read-backs after a write some apps apply asynchronously.
const POLL_INTERVAL: Duration = Duration::from_millis(30);
const FOCUS_POLLS: usize = 7;
const MAX_MENUS: usize = 4;
const MAX_ANCESTORS: usize = 8;

const NO_WINDOW: &str =
    "Could not find that window through Accessibility. Run windows and call appState again.";
const DISABLED: &str = "That control is disabled. Call appState again after the app enables it.";
const NO_FRAME: &str = "That element has no on-screen position, so there is no fallback for it. Call appState again or choose another element.";
const UNCONFIRMED: &str = "The app did not confirm in time; the action may have completed (for example, a menu may be open). Call appState before acting again.";
const ACCEPTED: &str = "The app accepted the text but had not shown the change yet; some apps apply it a moment later. Call appState to check before typing again; never repeat the text blindly.";
/// Read-backs after an accepted text write (about 300 ms in total).
const WRITE_POLLS: usize = 10;

const ATTRIBUTES: &[&str] = &[
    "AXRole",
    "AXSubrole",
    "AXTitle",
    "AXDescription",
    "AXPlaceholderValue",
    "AXIdentifier",
    "AXEnabled",
    "AXFocused",
    "AXSelected",
    "AXPosition",
    "AXSize",
];

/// A retained AXUIElementRef. Accessibility client calls are thread-safe; the
/// reference only keeps the remote element's identity alive.
pub(super) struct Element(Cf);
unsafe impl Send for Element {}
unsafe impl Sync for Element {}

impl Element {
    /// Retains a borrowed reference (from an array the caller still owns).
    unsafe fn retain(value: Cf) -> Option<Self> {
        if value.is_null() || CFGetTypeID(value) != AXUIElementGetTypeID() {
            return None;
        }
        CFRetain(value);
        Some(Self(value))
    }
    /// Takes ownership of a Copy/Create result.
    unsafe fn owned(value: OwnedCf) -> Option<Self> {
        if CFGetTypeID(value.0) != AXUIElementGetTypeID() {
            return None;
        }
        let pointer = value.0;
        std::mem::forget(value);
        Some(Self(pointer))
    }
}
impl Clone for Element {
    fn clone(&self) -> Self {
        unsafe {
            CFRetain(self.0);
        }
        Self(self.0)
    }
}
impl Drop for Element {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

fn ns(name: &str) -> Retained<NSString> {
    NSString::from_str(name)
}

unsafe fn set_timeout(element: Cf, seconds: f32) {
    AXUIElementSetMessagingTimeout(element, seconds);
}

unsafe fn is_ax_error(value: Cf) -> bool {
    CFGetTypeID(value) == AXValueGetTypeID() && AXValueGetType(value) == AX_ERROR_VALUE
}

unsafe fn string_of(value: Cf, limit: usize) -> Option<String> {
    if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
        return None;
    }
    let text: String = (&*value.cast::<NSString>())
        .to_string()
        .chars()
        .take(limit)
        .collect();
    Some(text)
}

unsafe fn number_of(value: Cf) -> Option<f64> {
    if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
        return None;
    }
    let mut output = 0.0_f64;
    CFNumberGetValue(value, 13, std::ptr::from_mut(&mut output).cast())
        .then_some(output)
        .filter(|value| value.is_finite())
}

unsafe fn bool_of(value: Cf) -> Option<bool> {
    if value.is_null() {
        return None;
    }
    if CFGetTypeID(value) == CFBooleanGetTypeID() {
        return Some(CFBooleanGetValue(value));
    }
    number_of(value).map(|number| number != 0.0)
}

unsafe fn geometry<T: Copy>(value: Cf, kind: u32, empty: T) -> Option<T> {
    if value.is_null() || CFGetTypeID(value) != AXValueGetTypeID() {
        return None;
    }
    let mut output = empty;
    AXValueGetValue(value, kind, std::ptr::from_mut(&mut output).cast()).then_some(output)
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CfRange {
    location: isize,
    length: isize,
}

unsafe fn range_of(value: Cf) -> Option<(usize, usize)> {
    let range = geometry(
        value,
        AX_RANGE,
        CfRange {
            location: 0,
            length: 0,
        },
    )?;
    Some((
        usize::try_from(range.location).ok()?,
        usize::try_from(range.length).ok()?,
    ))
}

fn frame(origin: Option<Point>, size: Option<Size>) -> Option<Region> {
    let (origin, size) = (origin?, size?);
    let region = Region {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    };
    [region.x, region.y, region.width, region.height]
        .iter()
        .all(|value| value.is_finite() && value.abs() <= 1_000_000.0)
        .then_some(region)
}

/// Copies one attribute with a short, deadline-bounded timeout.
unsafe fn copy(element: Cf, name: &str, deadline: Instant) -> Option<OwnedCf> {
    ax_attribute(element, name, deadline)
}

unsafe fn element_frame(element: Cf, deadline: Instant) -> Option<Region> {
    let position = copy(element, "AXPosition", deadline)?;
    let size = copy(element, "AXSize", deadline)?;
    frame(
        geometry(position.0, AX_POINT, Point { x: 0.0, y: 0.0 }),
        geometry(
            size.0,
            AX_SIZE,
            Size {
                width: 0.0,
                height: 0.0,
            },
        ),
    )
}

unsafe fn action_names(element: Cf) -> Vec<String> {
    let mut names: Cf = std::ptr::null();
    let result = AXUIElementCopyActionNames(element, &mut names);
    let Ok(names) = OwnedCf::new(names, "") else {
        return Vec::new();
    };
    if result != 0 || CFGetTypeID(names.0) != CFArrayGetTypeID() {
        return Vec::new();
    }
    let count = CFArrayGetCount(names.0).clamp(0, 64);
    (0..count)
        .filter_map(|index| string_of(CFArrayGetValueAtIndex(names.0, index), 64))
        .filter(|name| name.starts_with("AX") && name.len() < 64)
        .take(rules::MAX_ACTIONS)
        .collect()
}

/// Reads an element through one batched request, its value (never for a
/// secure field) and its action names.
unsafe fn read_info(element: Cf, batch: &NSArray<NSString>, deadline: Instant) -> Option<NodeInfo> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return None;
    }
    set_timeout(element, remaining.as_secs_f32().min(READ_TIMEOUT));
    let mut values: Cf = std::ptr::null();
    let result = AXUIElementCopyMultipleAttributeValues(
        element,
        std::ptr::from_ref(batch).cast(),
        0,
        &mut values,
    );
    let values = OwnedCf::new(values, "").ok()?;
    if result != 0
        || CFGetTypeID(values.0) != CFArrayGetTypeID()
        || CFArrayGetCount(values.0) != ATTRIBUTES.len() as isize
    {
        return None;
    }
    let get = |index: usize| {
        let value = CFArrayGetValueAtIndex(values.0, index as isize);
        if value.is_null() || is_ax_error(value) {
            std::ptr::null()
        } else {
            value
        }
    };
    let text = |index: usize| string_of(get(index), 512).filter(|text| !text.is_empty());
    let role = text(0)?;
    let subrole = text(1);
    let secure = rules::is_secure(&role, subrole.as_deref());
    let mut info = NodeInfo {
        role,
        subrole,
        title: text(2),
        description: text(3),
        placeholder: text(4),
        identifier: text(5),
        enabled: bool_of(get(6)),
        focused: bool_of(get(7)).unwrap_or(false),
        selected: bool_of(get(8)).unwrap_or(false),
        frame: frame(
            geometry(get(9), AX_POINT, Point { x: 0.0, y: 0.0 }),
            geometry(
                get(10),
                AX_SIZE,
                Size {
                    width: 0.0,
                    height: 0.0,
                },
            ),
        ),
        ..NodeInfo::default()
    };
    // The secure value is never requested, so it cannot leak into a response.
    info.value = if secure {
        Some(NodeValue::Redacted)
    } else {
        read_value(element, deadline)
    };
    info.actions = action_names(element);
    Some(info)
}

unsafe fn read_value(element: Cf, deadline: Instant) -> Option<NodeValue> {
    let value = copy(element, "AXValue", deadline)?;
    let kind = CFGetTypeID(value.0);
    if kind == CFStringGetTypeID() {
        string_of(value.0, MAX_VALUE_CHARS).map(NodeValue::Text)
    } else if kind == CFBooleanGetTypeID() {
        Some(NodeValue::Bool(CFBooleanGetValue(value.0)))
    } else {
        number_of(value.0).map(NodeValue::Number)
    }
}

/// The full, current text of a non-secure element (for edits). Text longer
/// than the rewrite limit is never read: a truncated copy must never be
/// written back or used to compute an edit.
unsafe fn full_text(element: Cf, deadline: Instant) -> Option<String> {
    let value = copy(element, "AXValue", deadline)?;
    if CFGetTypeID(value.0) != CFStringGetTypeID()
        || usize::try_from(CFStringGetLength(value.0)).ok()? > rules::REWRITE_LIMIT
    {
        return None;
    }
    string_of(value.0, usize::MAX)
}

/// The exact length of an element's text in UTF-16 units, without reading it.
unsafe fn text_length(element: Cf, deadline: Instant) -> Option<usize> {
    let value = copy(element, "AXValue", deadline)?;
    if CFGetTypeID(value.0) != CFStringGetTypeID() {
        return None;
    }
    usize::try_from(CFStringGetLength(value.0)).ok()
}

/// Whether an element lies inside web content (a few ancestors up).
unsafe fn in_web_area(element: Cf, deadline: Instant) -> bool {
    let mut current = copy(element, "AXParent", deadline).and_then(|parent| Element::owned(parent));
    for _ in 0..12 {
        let Some(node) = current else {
            return false;
        };
        let role = copy(node.0, "AXRole", deadline).and_then(|role| string_of(role.0, 64));
        match role.as_deref() {
            Some("AXWebArea") => return true,
            Some("AXWindow") | None => return false,
            _ => {}
        }
        current = copy(node.0, "AXParent", deadline).and_then(|parent| Element::owned(parent));
    }
    // Too deep to tell: treat as web content, which is never rewritten.
    true
}

unsafe fn element_array(array: &OwnedCf, limit: usize) -> Vec<Element> {
    if CFGetTypeID(array.0) != CFArrayGetTypeID() {
        return Vec::new();
    }
    let count = CFArrayGetCount(array.0).max(0) as usize;
    (0..count.min(limit))
        .filter_map(|index| Element::retain(CFArrayGetValueAtIndex(array.0, index as isize)))
        .collect()
}

unsafe fn children(element: Cf, info: &NodeInfo, deadline: Instant) -> Vec<Element> {
    // Large tables expose only their visible rows to keep reads bounded.
    if matches!(info.role.as_str(), "AXTable" | "AXOutline") {
        if let Some(rows) = copy(element, "AXVisibleRows", deadline) {
            let rows = element_array(&rows, rules::MAX_CHILDREN + 1);
            if !rows.is_empty() {
                return rows;
            }
        }
    }
    copy(element, "AXChildren", deadline)
        .map(|children| element_array(&children, rules::MAX_CHILDREN + 1))
        .unwrap_or_default()
}

/// The live app, read with one shared deadline.
struct Live {
    deadline: Instant,
    batch: Retained<NSArray<NSString>>,
}

impl Live {
    fn new(budget: Duration) -> Self {
        let names: Vec<Retained<NSString>> = ATTRIBUTES.iter().map(|name| ns(name)).collect();
        Self {
            deadline: Instant::now() + budget,
            batch: NSArray::from_retained_slice(&names),
        }
    }
}

impl rules::Source for Live {
    type Node = Element;
    fn read(&mut self, node: &Element) -> Option<NodeInfo> {
        unsafe { read_info(node.0, &self.batch, self.deadline) }
    }
    fn children(&mut self, node: &Element, info: &NodeInfo) -> Vec<Element> {
        unsafe { children(node.0, info, self.deadline) }
    }
    fn parent(&mut self, node: &Element) -> Option<Element> {
        unsafe { copy(node.0, "AXParent", self.deadline).and_then(|parent| Element::owned(parent)) }
    }
    fn same(&self, a: &Element, b: &Element) -> bool {
        unsafe { CFEqual(a.0, b.0) }
    }
    fn expired(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

type GetWindow = unsafe extern "C" fn(Cf, *mut u32) -> i32;

/// The long-standing private HIServices mapping from an AX window to its
/// CGWindowID. Looked up at run time so a missing symbol only disables it.
fn window_number_function() -> Option<GetWindow> {
    static ADDRESS: OnceLock<usize> = OnceLock::new();
    let address = *ADDRESS.get_or_init(|| unsafe {
        libc::dlsym(libc::RTLD_DEFAULT, c"_AXUIElementGetWindow".as_ptr()) as usize
    });
    (address != 0).then(|| unsafe { std::mem::transmute::<usize, GetWindow>(address) })
}

unsafe fn window_number(element: Cf) -> Option<u32> {
    let function = window_number_function()?;
    let mut id = 0_u32;
    (function(element, &mut id) == 0 && id != 0).then_some(id)
}

unsafe fn application(pid: i32) -> Result<OwnedCf, String> {
    OwnedCf::new(
        AXUIElementCreateApplication(pid),
        "Could not access that app through Accessibility.",
    )
}

/// Finds the AX element of an observed window: by window number when macOS
/// provides it, otherwise by a unique exact frame match.
unsafe fn window_element(
    pid: i32,
    window_id: u32,
    bounds: Region,
    deadline: Instant,
) -> Result<Element, String> {
    let app = application(pid)?;
    let windows = copy(app.0, "AXWindows", deadline).ok_or(NO_WINDOW)?;
    let windows = element_array(&windows, 256);
    let mut by_frame = Vec::new();
    for window in windows {
        match window_number(window.0) {
            Some(id) if id == window_id => return Ok(window),
            Some(_) => continue,
            None => {
                if element_frame(window.0, deadline) == Some(bounds) {
                    by_frame.push(window);
                }
            }
        }
    }
    if by_frame.len() == 1 {
        return Ok(by_frame.remove(0));
    }
    Err(NO_WINDOW.into())
}

/// Menus the app currently shows (context and pop-up menus), as extra roots.
unsafe fn open_menus(pid: i32, deadline: Instant) -> Vec<Element> {
    let Ok(app) = application(pid) else {
        return Vec::new();
    };
    let Some(children) = copy(app.0, "AXChildren", deadline) else {
        return Vec::new();
    };
    element_array(&children, 64)
        .into_iter()
        .filter(|child| {
            copy(child.0, "AXRole", deadline)
                .and_then(|role| string_of(role.0, 64))
                .is_some_and(|role| role == "AXMenu")
        })
        .take(MAX_MENUS)
        .collect()
}

fn store() -> &'static Mutex<rules::Store<Element>> {
    static STORE: OnceLock<Mutex<rules::Store<Element>>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}

fn lock_store() -> std::sync::MutexGuard<'static, rules::Store<Element>> {
    store().lock().unwrap_or_else(|error| error.into_inner())
}

fn flags() -> std::sync::MutexGuard<'static, rules::FlagRegistry> {
    static FLAGS: OnceLock<Mutex<rules::FlagRegistry>> = OnceLock::new();
    FLAGS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// Serialises turning switches on (read, write, record), so two chats never
/// both believe they found an app's switch in its original state.
fn preparing() -> std::sync::MutexGuard<'static, ()> {
    static PREPARING: Mutex<()> = Mutex::new(());
    PREPARING.lock().unwrap_or_else(|error| error.into_inner())
}

/// Where switches Aven turned on are saved, set once at launch.
static SWITCH_FILE: OnceLock<PathBuf> = OnceLock::new();
const SWITCH_FILE_LIMIT: u64 = 64 * 1024;

/// Saves the switches to restore if Aven stops unexpectedly. Called with the
/// registry locked, after every change. Best effort.
fn save_switches(registry: &rules::FlagRegistry) {
    let Some(path) = SWITCH_FILE.get() else {
        return;
    };
    let saved = registry.saved();
    if saved.switches.is_empty() {
        let _ = std::fs::remove_file(path);
    } else {
        let _ = write_private_json(path, &saved);
    }
}

fn read_switches(path: &Path) -> rules::SavedSwitches {
    use std::io::Read;
    let mut bytes = Vec::new();
    let read = std::fs::File::open(path)
        .and_then(|file| file.take(SWITCH_FILE_LIMIT + 1).read_to_end(&mut bytes));
    read.ok()
        .filter(|length| *length as u64 <= SWITCH_FILE_LIMIT)
        .and_then(|_| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// At launch: turns off switches a previous run turned on and never restored
/// (a crash or forced quit), when the same app process is still running.
pub(super) fn restore_saved_switches(path: PathBuf) {
    let _guard = preparing();
    let saved = read_switches(&path);
    let _ = SWITCH_FILE.set(path);
    let restores = {
        let registry = flags();
        let restores = rules::stale_restores(saved, process_id, |pid| registry.holds(pid));
        save_switches(&registry);
        restores
    };
    restore_flags(restores);
}

fn executable(pid: i32) -> Option<String> {
    let mut path = [0_u8; 4096];
    let length = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), 4096) };
    let length = usize::try_from(length).ok().filter(|length| *length > 0)?;
    String::from_utf8(path[..length].to_vec()).ok()
}

/// A running process's PID, executable and start time.
fn process_id(pid: i32) -> Option<rules::ProcessId> {
    let executable = executable(pid)?;
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            std::ptr::from_mut(&mut info).cast(),
            size,
        )
    };
    (read == size && info.pbi_pid == pid as u32).then(|| rules::ProcessId {
        pid,
        executable,
        started: info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
    })
}

type ResponsibleFor = unsafe extern "C" fn(i32) -> i32;

/// The process macOS holds responsible for another (the app for its XPC
/// services). Looked up at run time; None when unavailable.
fn responsible_pid(pid: i32) -> Option<i32> {
    static ADDRESS: OnceLock<usize> = OnceLock::new();
    let address = *ADDRESS.get_or_init(|| unsafe {
        libc::dlsym(
            libc::RTLD_DEFAULT,
            c"responsibility_get_pid_responsible_for_pid".as_ptr(),
        ) as usize
    });
    if address == 0 {
        return None;
    }
    let function = unsafe { std::mem::transmute::<usize, ResponsibleFor>(address) };
    let responsible = unsafe { function(pid) };
    (responsible > 0).then_some(responsible)
}

/// Whether an element's window (or top-level element) is the target window
/// of the target app.
unsafe fn in_window(
    element: &Element,
    pid: i32,
    window_id: u32,
    bounds: Region,
    deadline: Instant,
) -> bool {
    let window = copy(element.0, "AXWindow", deadline)
        .or_else(|| copy(element.0, "AXTopLevelUIElement", deadline))
        .and_then(|window| Element::owned(window));
    let Some(window) = window else {
        return false;
    };
    let mut owner = 0;
    if AXUIElementGetPid(window.0, &mut owner) != 0 || owner != pid {
        return false;
    }
    match window_number(window.0) {
        Some(id) => id == window_id,
        None => element_frame(window.0, deadline) == Some(bounds),
    }
}

fn engine(executable: &str) -> Option<rules::Engine> {
    let bundle = &executable[..executable.find(".app/Contents/")? + 4];
    let names: Vec<String> = std::fs::read_dir(Path::new(bundle).join("Contents/Frameworks"))
        .ok()?
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .take(512)
        .collect();
    rules::engine_for(&names)
}

/// Whether Aven turned an app's accessibility switch on for this chat.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Prepared {
    NotNeeded,
    AlreadyOn(&'static str),
    TurnedOn(&'static str),
}

impl Prepared {
    pub(super) fn attribute(self) -> Option<&'static str> {
        match self {
            Self::NotNeeded => None,
            Self::AlreadyOn(attribute) | Self::TurnedOn(attribute) => Some(attribute),
        }
    }
}

/// Electron and Chromium apps only build a full tree once an assistive client
/// asks for it. Turn their switch on once per app, remember its previous
/// value, and restore it when the last chat using it ends. `alive` reports
/// whether the chat still exists; it is checked under the registry lock, so a
/// chat that ended meanwhile never leaves a switch recorded and on.
pub(super) fn prepare(scope: &str, pid: i32, alive: &dyn Fn() -> bool) -> Prepared {
    if pid == std::process::id() as i32 {
        return Prepared::NotNeeded;
    }
    let Some(process) = process_id(pid) else {
        return Prepared::NotNeeded;
    };
    let Some(engine) = engine(&process.executable) else {
        return Prepared::NotNeeded;
    };
    let attribute = engine.attribute();
    let guard = preparing();
    {
        let mut registry = flags();
        if !alive() {
            return Prepared::NotNeeded;
        }
        if registry.join(scope, &process) {
            return Prepared::AlreadyOn(attribute);
        }
    }
    let deadline = Instant::now() + Duration::from_millis(600);
    let result = objc2::rc::autoreleasepool(|_| unsafe {
        let app = application(pid).ok()?;
        let previous = copy(app.0, attribute, deadline).and_then(|value| bool_of(value.0));
        if previous == Some(true) {
            return Some((previous, false));
        }
        set_timeout(app.0, READ_TIMEOUT);
        let name = ns(attribute);
        (AXUIElementSetAttributeValue(app.0, Retained::as_ptr(&name).cast(), kCFBooleanTrue) == 0)
            .then_some((previous, true))
    });
    let Some((previous, changed)) = result else {
        return Prepared::NotNeeded;
    };
    let recorded = {
        let mut registry = flags();
        let recorded = registry.record_if(alive, scope, &process, attribute, previous, changed);
        save_switches(&registry);
        recorded
    };
    drop(guard);
    if !recorded {
        if changed {
            restore_flags(vec![rules::Restore { process, attribute }]);
        }
        return Prepared::NotNeeded;
    }
    if changed {
        std::thread::sleep(ENGINE_SETTLE);
        Prepared::TurnedOn(attribute)
    } else {
        Prepared::AlreadyOn(attribute)
    }
}

fn restore_flags(restores: Vec<rules::Restore>) {
    for restore in restores {
        // A reused PID belongs to another process: never write to it.
        if process_id(restore.process.pid).as_ref() != Some(&restore.process) {
            continue;
        }
        objc2::rc::autoreleasepool(|_| unsafe {
            if let Ok(app) = application(restore.process.pid) {
                set_timeout(app.0, READ_TIMEOUT);
                let name = ns(restore.attribute);
                AXUIElementSetAttributeValue(
                    app.0,
                    Retained::as_ptr(&name).cast(),
                    kCFBooleanFalse,
                );
            }
        });
    }
}

/// Ends a chat's element state: forgets its indexes and restores app switches
/// no other chat needs. Shutdown restores synchronously; a single chat's
/// cleanup runs off the caller's thread. Callers revoke the chat's session
/// first, so a concurrent `prepare` sees it as ended.
pub(super) fn forget(scope: Option<&str>) {
    lock_store().forget(scope);
    let restores = {
        let mut registry = flags();
        let restores = registry.release(scope);
        save_switches(&registry);
        restores
    };
    if restores.is_empty() {
        return;
    }
    if scope.is_none() {
        restore_flags(restores);
    } else {
        tauri::async_runtime::spawn_blocking(move || restore_flags(restores));
    }
}

/// Captures and stores an indexed tree of one window plus any open menus.
pub(super) fn capture_state(
    scope: &str,
    pid: i32,
    window_id: u32,
    window: Region,
    max_nodes: u32,
) -> Result<Value, String> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let mut source = Live::new(CAPTURE_BUDGET);
        let root = window_element(pid, window_id, window, source.deadline)?;
        let mut roots = vec![root.clone()];
        let mut capture = rules::capture(&mut source, &[(root, Some(window))], max_nodes as usize);
        // Most menus appear under the control that opened them. Some apps
        // attach an open context menu to the application instead.
        let has_menu = capture.nodes.iter().any(|node| node.info.role == "AXMenu");
        let room = (max_nodes as usize).saturating_sub(capture.nodes.len());
        if !has_menu && room > 0 && capture.truncated.is_none() {
            let menus: Vec<_> = open_menus(pid, source.deadline)
                .into_iter()
                .map(|menu| (menu, None))
                .collect();
            if !menus.is_empty() {
                let extra = rules::capture(&mut source, &menus, room);
                capture.truncated = capture.truncated.or(extra.truncated);
                capture.offscreen += extra.offscreen;
                capture
                    .nodes
                    .extend(extra.nodes.into_iter().map(|mut node| {
                        node.root += roots.len();
                        node
                    }));
                roots.extend(menus.into_iter().map(|(menu, _)| menu));
            }
        }
        let (outline, cut) = rules::outline(&mut capture.nodes, (window.x, window.y));
        let truncated = if cut {
            Some("size limit")
        } else {
            capture.truncated
        };
        let count = capture.nodes.len();
        // Repeated and unlabelled elements record what surrounds them, so a
        // list that changes underneath an index is refused, not misread.
        rules::assign_contexts(&mut Live::new(CONTEXT_BUDGET), &mut capture.nodes);
        let ambiguous: Vec<usize> = capture
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node.context == rules::Context::Ambiguous)
            .map(|(index, _)| index)
            .collect();
        let focused = capture.nodes.iter().position(|node| node.info.focused);
        // Menus appear under their control or, for some apps, the application.
        let open_menus = capture
            .nodes
            .iter()
            .filter(|node| node.info.role == "AXMenu")
            .count();
        let snapshot = rules::Snapshot {
            id: 0,
            pid,
            window_id,
            window,
            roots,
            nodes: capture.nodes,
            consumed: false,
        };
        let id = lock_store().insert(scope, snapshot);
        let mut state = json!({
            "stateId": id,
            "elements": outline,
            "count": count,
            "focusedElement": focused,
            "openMenus": open_menus,
            "offscreenOmitted": capture.offscreen,
            "truncated": truncated,
        });
        if !ambiguous.is_empty() {
            state["ambiguous"] = json!(ambiguous);
        }
        Ok(state)
    })
}

/// Ends a window's indexes after an action in it.
pub(super) fn invalidate(scope: &str, window_id: u32) {
    lock_store().invalidate(scope, window_id);
}

/// Where Aven's bar and ring refer to an indexed element.
pub(super) struct ElementAnchor {
    /// The element's global centre, following a moved window.
    pub(super) point: Option<(f64, f64)>,
    /// The element's title for the bar; never a value or typed text.
    pub(super) label: Option<String>,
}

/// Reads an indexed element's anchor from the stored snapshot without
/// contacting the app.
pub(super) fn anchor(
    scope: &str,
    window_id: u32,
    state_id: Option<u64>,
    index: u32,
    window: Region,
) -> Result<ElementAnchor, String> {
    let store = lock_store();
    let (snapshot, node) = store.lookup(scope, window_id, state_id, index)?;
    Ok(ElementAnchor {
        point: snapshot.anchor(index as usize, window),
        label: rules::element_label(&node.info),
    })
}

/// A live element an action targets, re-validated against the app.
pub(super) struct Located {
    pub(super) element: Element,
    pub(super) info: NodeInfo,
    pub(super) reresolved: bool,
}

/// Resolves an index from the chat's latest snapshot of this window and
/// checks it is still the same control, in the same place, in the same
/// process. `window` is the window's current bounds.
pub(super) fn locate(
    scope: &str,
    window_id: u32,
    state_id: Option<u64>,
    index: u32,
    pid: i32,
    window: Region,
) -> Result<Located, String> {
    let (roots, stored, shift) = {
        let store = lock_store();
        let (snapshot, node) = store.lookup(scope, window_id, state_id, index)?;
        if snapshot.pid != pid {
            return Err(rules::STALE.into());
        }
        let shift = (window.x - snapshot.window.x, window.y - snapshot.window.y);
        (snapshot.roots.clone(), node.clone(), shift)
    };
    objc2::rc::autoreleasepool(|_| unsafe {
        let mut source = Live::new(LOOKUP_BUDGET);
        let (element, info, reresolved) = rules::resolve(&mut source, &roots, &stored, shift)?;
        let mut owner = 0;
        if AXUIElementGetPid(element.0, &mut owner) != 0 {
            return Err(rules::STALE.into());
        }
        rules::owner_allowed(pid, owner, || rules::Helper {
            executable: executable(owner),
            responsible: responsible_pid(owner),
            in_window: in_window(&element, pid, window_id, window, source.deadline),
        })?;
        Ok(Located {
            element,
            info,
            reresolved,
        })
    })
}

/// The app's focused element, only when it lies in the target window.
pub(super) fn focused(pid: i32, window_id: u32, bounds: Region) -> Option<Located> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let mut source = Live::new(LOOKUP_BUDGET);
        let deadline = source.deadline;
        let app = application(pid).ok()?;
        let element = Element::owned(copy(app.0, "AXFocusedUIElement", deadline)?)?;
        let window = Element::owned(copy(element.0, "AXWindow", deadline)?)?;
        let in_window = match window_number(window.0) {
            Some(id) => id == window_id,
            None => element_frame(window.0, deadline) == Some(bounds),
        };
        if !in_window {
            return None;
        }
        let info = rules::Source::read(&mut source, &element)?;
        Some(Located {
            element,
            info,
            reresolved: false,
        })
    })
}

/// What happened, or which existing app-directed event path must finish it.
pub(super) enum Next {
    Done(Value),
    /// App-directed mouse events at a global point.
    ClickAt {
        point: (f64, f64),
        button: Button,
        count: u8,
    },
    /// An app-directed wheel event at a global point.
    ScrollAt {
        point: (f64, f64),
        delta_x: i32,
        delta_y: i32,
    },
    /// App-directed key events (requires the app's focused window).
    Keys,
    /// App-directed Unicode typing (requires the app's focused window).
    TypeKeys,
}

/// Called immediately before every mutation; it refuses after pause, stop,
/// a changed target, or a revoked chat.
pub(super) type Gate<'a> = &'a dyn Fn() -> Result<(), String>;

fn result_json(mut value: Value, outcome: Outcome) -> Value {
    value["confirmed"] = json!(outcome == Outcome::Confirmed);
    match outcome {
        Outcome::Confirmed => {}
        Outcome::Unconfirmed => value["note"] = json!(UNCONFIRMED),
        Outcome::Accepted => value["note"] = json!(ACCEPTED),
    }
    value
}

/// Polls an element's text for a change after a write it accepted. Secure
/// text is never read, so its writes are taken as applied.
unsafe fn text_changed(
    element: &Element,
    secure: bool,
    changed: impl Fn(Option<&str>) -> bool,
) -> bool {
    secure
        || rules::settle(WRITE_POLLS, POLL_INTERVAL, || {
            changed(full_text(element.0, deadline()).as_deref())
        })
}

/// Performs an action. Ok(None) means the element does not support it, so
/// the next fallback may run. Once attempted, a timeout is never retried.
unsafe fn perform(element: &Element, action: &str, gate: Gate) -> Result<Option<Outcome>, String> {
    gate()?;
    set_timeout(element.0, ACTION_TIMEOUT);
    let name = ns(action);
    match AXUIElementPerformAction(element.0, Retained::as_ptr(&name).cast()) {
        0 => Ok(Some(Outcome::Confirmed)),
        AX_CANNOT_COMPLETE => Ok(Some(Outcome::Unconfirmed)),
        AX_ACTION_UNSUPPORTED | AX_ATTRIBUTE_UNSUPPORTED | AX_NOT_IMPLEMENTED => Ok(None),
        AX_INVALID_ELEMENT => Err(rules::STALE.into()),
        code => Err(format!("The app rejected the {} action (AX error {code}). Call appState before deciding whether to retry.", action.trim_start_matches("AX"))),
    }
}

unsafe fn settable(element: &Element, attribute: &str) -> bool {
    set_timeout(element.0, READ_TIMEOUT);
    let name = ns(attribute);
    let mut settable = 0;
    AXUIElementIsAttributeSettable(element.0, Retained::as_ptr(&name).cast(), &mut settable) == 0
        && settable != 0
}

/// Sets an attribute when the element reports it settable. Ok(None) means the
/// app does not accept it, so the next fallback may run.
unsafe fn set(
    element: &Element,
    attribute: &str,
    value: Cf,
    gate: Gate,
) -> Result<Option<Outcome>, String> {
    if !settable(element, attribute) {
        return Ok(None);
    }
    gate()?;
    set_timeout(element.0, ACTION_TIMEOUT);
    let name = ns(attribute);
    match AXUIElementSetAttributeValue(element.0, Retained::as_ptr(&name).cast(), value) {
        0 => Ok(Some(Outcome::Confirmed)),
        AX_CANNOT_COMPLETE => Ok(Some(Outcome::Unconfirmed)),
        AX_ATTRIBUTE_UNSUPPORTED | AX_NOT_IMPLEMENTED | AX_FAILURE => Ok(None),
        AX_INVALID_ELEMENT => Err(rules::STALE.into()),
        code => Err(format!(
            "The app rejected the change (AX error {code}). Call appState before retrying."
        )),
    }
}

unsafe fn set_bool(
    element: &Element,
    attribute: &str,
    value: bool,
    gate: Gate,
) -> Result<Option<Outcome>, String> {
    set(
        element,
        attribute,
        if value {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        },
        gate,
    )
}

unsafe fn set_text(
    element: &Element,
    attribute: &str,
    text: &str,
    gate: Gate,
) -> Result<Option<Outcome>, String> {
    let value = ns(text);
    set(element, attribute, Retained::as_ptr(&value).cast(), gate)
}

unsafe fn set_number(element: &Element, value: f64, gate: Gate) -> Result<Option<Outcome>, String> {
    let number = OwnedCf::new(
        CFNumberCreate(std::ptr::null(), 13, std::ptr::from_ref(&value).cast()),
        "Could not create a number value.",
    )?;
    set(element, "AXValue", number.0, gate)
}

unsafe fn set_range(
    element: &Element,
    location: usize,
    length: usize,
    gate: Gate,
) -> Result<Option<Outcome>, String> {
    let range = CfRange {
        location: location as isize,
        length: length as isize,
    };
    let value = OwnedCf::new(
        AXValueCreate(AX_RANGE, std::ptr::from_ref(&range).cast()),
        "Could not create a text range.",
    )?;
    set(element, "AXSelectedTextRange", value.0, gate)
}

unsafe fn selection(element: &Element, deadline: Instant) -> Option<(usize, usize)> {
    copy(element.0, "AXSelectedTextRange", deadline).and_then(|value| range_of(value.0))
}

fn deadline() -> Instant {
    Instant::now() + LOOKUP_BUDGET
}

fn require_enabled(info: &NodeInfo) -> Result<(), String> {
    if info.enabled == Some(false) {
        Err(DISABLED.into())
    } else {
        Ok(())
    }
}

/// Gives a text input keyboard focus inside its own app. This makes it the
/// window's first responder; it never activates the app.
unsafe fn focus(located: &Located, gate: Gate) -> Result<(), String> {
    if !located.info.focused {
        set_bool(&located.element, "AXFocused", true, gate)?;
    }
    Ok(())
}

/// Focuses the element inside its app (never activating it) and confirms by
/// reading AXFocused back from the same element. Some apps apply focus
/// asynchronously, so the read-back is retried briefly.
unsafe fn focus_confirmed(located: &Located, gate: Gate) -> Result<bool, String> {
    focus(located, gate)?;
    let element = &located.element;
    Ok(rules::settle(FOCUS_POLLS, POLL_INTERVAL, || {
        copy(element.0, "AXFocused", deadline()).and_then(|value| bool_of(value.0)) == Some(true)
    }))
}

/// Refuses key events for a named element unless it holds focus.
unsafe fn keys_for(located: Option<&Located>, targeted: bool, gate: Gate) -> Result<(), String> {
    let mut failure = None;
    rules::require_key_focus(targeted, || match located {
        Some(located) => focus_confirmed(located, gate).unwrap_or_else(|error| {
            failure = Some(error);
            false
        }),
        None => false,
    })
    .map_err(|error| failure.unwrap_or(error))
}

pub(super) fn click(
    located: &Located,
    button: Button,
    count: u8,
    gate: Gate,
) -> Result<Next, String> {
    require_enabled(&located.info)?;
    let right = matches!(button, Button::Right);
    objc2::rc::autoreleasepool(|_| unsafe {
        for step in rules::click_plan(&located.info, right, count) {
            let (method, outcome) = match step {
                ClickStep::Perform(action) => (action, perform(&located.element, action, gate)?),
                ClickStep::Focus => (
                    "AXFocused",
                    set_bool(&located.element, "AXFocused", true, gate)?,
                ),
                ClickStep::Select => (
                    "AXSelected",
                    set_bool(&located.element, "AXSelected", true, gate)?,
                ),
                ClickStep::Events => {
                    let point = located.info.centre().ok_or(NO_FRAME)?;
                    return Ok(Next::ClickAt {
                        point,
                        button,
                        count,
                    });
                }
            };
            if let Some(outcome) = outcome {
                return Ok(Next::Done(result_json(
                    json!({"clicked": true, "method": method}),
                    outcome,
                )));
            }
        }
        Err(NO_FRAME.into())
    })
}

pub(super) fn secondary(located: &Located, name: Option<&str>, gate: Gate) -> Result<Next, String> {
    let action = rules::secondary_action(name)?;
    objc2::rc::autoreleasepool(|_| unsafe {
        if located.info.has_action(action) {
            if let Some(outcome) = perform(&located.element, action, gate)? {
                return Ok(Next::Done(result_json(
                    json!({"performed": action, "method": action}),
                    outcome,
                )));
            }
        }
        if action == "AXShowMenu" {
            let point = located.info.centre().ok_or(NO_FRAME)?;
            return Ok(Next::ClickAt {
                point,
                button: Button::Right,
                count: 1,
            });
        }
        let available: Vec<&str> = located
            .info
            .actions
            .iter()
            .map(|action| action.trim_start_matches("AX"))
            .collect();
        Err(format!(
            "That element does not offer {}. Its actions: {}.",
            action.trim_start_matches("AX"),
            if available.is_empty() {
                "none".into()
            } else {
                available.join(", ")
            }
        ))
    })
}

const CHECKED_ROLES: &[&str] = &["AXCheckBox", "AXRadioButton", "AXSwitch", "AXToggle"];

pub(super) fn set_value(
    located: &Located,
    value: &ElementValue,
    gate: Gate,
) -> Result<Next, String> {
    require_enabled(&located.info)?;
    let element = &located.element;
    let secure = located.info.is_secure();
    objc2::rc::autoreleasepool(|_| unsafe {
        let outcome = match value {
            ElementValue::Text(text) => {
                let before = (!secure)
                    .then(|| full_text(element.0, deadline()))
                    .flatten();
                let changed = || {
                    text_changed(element, secure, |now| {
                        now != before.as_deref() || now == Some(text.as_str())
                    })
                };
                match rules::after_write(set_text(element, "AXValue", text, gate)?, changed) {
                    AfterWrite::Done(outcome) => Some(outcome),
                    // Some editors only accept replacing their selection.
                    // That needs the exact length; secure text is never measured.
                    AfterWrite::Fallback => {
                        let length = (!secure)
                            .then(|| text_length(element.0, deadline()))
                            .flatten();
                        let replaced = match length {
                            Some(length)
                                if settable(element, "AXSelectedText")
                                    && set_range(element, 0, length, gate)?.is_some() =>
                            {
                                rules::after_write(
                                    set_text(element, "AXSelectedText", text, gate)?,
                                    changed,
                                )
                            }
                            _ => AfterWrite::Fallback,
                        };
                        match replaced {
                            AfterWrite::Done(outcome) => Some(outcome),
                            AfterWrite::Fallback => return Err("That element did not accept a text value. Try typeText, or click it and observe again.".into()),
                        }
                    }
                }
            }
            ElementValue::Number(number) => set_number(element, *number, gate)?,
            ElementValue::Bool(flag) => {
                if CHECKED_ROLES.contains(&located.info.role.as_str()) {
                    set_number(element, if *flag { 1.0 } else { 0.0 }, gate)?
                } else {
                    set_bool(element, "AXValue", *flag, gate)?
                }
            }
        };
        let outcome = outcome.ok_or("That element's value cannot be set through Accessibility. Use click, pressKey or typeText instead.")?;
        Ok(Next::Done(result_json(
            json!({"set": true, "method": "AXValue"}),
            outcome,
        )))
    })
}

/// Inserts at the caret: replace the selection through AXSelectedText, else
/// (only for short plain single-line inputs) rewrite AXValue around the
/// selection. None when neither is supported, so key events at the caret are
/// the remaining way. A write the app accepted is never repeated.
unsafe fn insert(
    located: &Located,
    text: &str,
    gate: Gate,
) -> Result<Option<(&'static str, Outcome)>, String> {
    let element = &located.element;
    let secure = located.info.is_secure();
    let before = (!secure)
        .then(|| full_text(element.0, deadline()))
        .flatten();
    let range = selection(element, deadline());
    let changed = || text_changed(element, secure, |now| now != before.as_deref());
    if let AfterWrite::Done(outcome) =
        rules::after_write(set_text(element, "AXSelectedText", text, gate)?, changed)
    {
        return Ok(Some(("AXSelectedText", outcome)));
    }
    // Rewriting the whole value from the original text inserts exactly once,
    // but only where nothing else (formatting, text past the read limit)
    // could be lost.
    let (Some(before_text), Some((location, length))) = (before.as_deref(), range) else {
        return Ok(None);
    };
    if !rules::rewrite_allowed(
        &located.info,
        text_length(element.0, deadline()),
        in_web_area(element.0, deadline()),
    ) {
        return Ok(None);
    }
    let Some((value, caret)) = rules::splice_utf16(before_text, location, length, text) else {
        return Ok(None);
    };
    match rules::after_write(set_text(element, "AXValue", &value, gate)?, changed) {
        AfterWrite::Done(outcome) => {
            // Best effort: put the caret after the inserted text.
            let _ = set_range(element, caret, 0, gate);
            Ok(Some(("AXValue", outcome)))
        }
        AfterWrite::Fallback => Ok(None),
    }
}

/// `targeted` is true when the agent named the element by index; key-event
/// typing then requires that element to hold focus.
pub(super) fn type_text(
    located: Option<&Located>,
    targeted: bool,
    text: &str,
    gate: Gate,
) -> Result<Next, String> {
    let Some(located) = located else {
        return Ok(Next::TypeKeys);
    };
    require_enabled(&located.info)?;
    objc2::rc::autoreleasepool(|_| unsafe {
        focus(located, gate)?;
        Ok(match insert(located, text, gate)? {
            Some((method, outcome)) => Next::Done(result_json(
                json!({"typed": true, "method": method}),
                outcome,
            )),
            None => {
                keys_for(Some(located), targeted, gate)?;
                Next::TypeKeys
            }
        })
    })
}

unsafe fn delete(located: &Located, backward: bool, gate: Gate) -> Result<Option<Outcome>, String> {
    let element = &located.element;
    let Some(before) = full_text(element.0, deadline()) else {
        return Ok(None);
    };
    let Some((caret, length)) = selection(element, deadline()) else {
        return Ok(None);
    };
    let (location, length) = if length > 0 {
        (caret, length)
    } else {
        match rules::char_range(&before, caret, backward) {
            Some(range) => range,
            // Nothing to delete at the start/end: like the key, a no-op.
            None => return Ok(Some(Outcome::Confirmed)),
        }
    };
    let changed = || text_changed(element, false, |now| now != Some(before.as_str()));
    if set_range(element, location, length, gate)?.is_some() {
        if let AfterWrite::Done(outcome) =
            rules::after_write(set_text(element, "AXSelectedText", "", gate)?, changed)
        {
            return Ok(Some(outcome));
        }
    }
    if !rules::rewrite_allowed(
        &located.info,
        Some(rules::utf16_len(&before)),
        in_web_area(element.0, deadline()),
    ) {
        return Ok(None);
    }
    let Some((value, caret)) = rules::splice_utf16(&before, location, length, "") else {
        return Ok(None);
    };
    match rules::after_write(set_text(element, "AXValue", &value, gate)?, changed) {
        AfterWrite::Done(outcome) => {
            let _ = set_range(element, caret, 0, gate);
            Ok(Some(outcome))
        }
        AfterWrite::Fallback => Ok(None),
    }
}

unsafe fn window_button(
    pid: i32,
    window_id: u32,
    bounds: Region,
    attribute: &str,
) -> Option<Element> {
    let deadline = deadline();
    let window = window_element(pid, window_id, bounds, deadline).ok()?;
    Element::owned(copy(window.0, attribute, deadline)?)
}

/// `targeted` is true when the agent named the element by index; key events
/// then require that element to hold focus.
pub(super) fn press_key(
    located: Option<&Located>,
    targeted: bool,
    key: &str,
    modifiers: bool,
    window: (i32, u32, Region),
    gate: Gate,
) -> Result<Next, String> {
    let info = located.map(|located| &located.info);
    objc2::rc::autoreleasepool(|_| unsafe {
        for step in rules::key_plan(key, modifiers, info) {
            let done = |method: &str, outcome: Outcome| {
                Ok(Next::Done(result_json(
                    json!({"pressed": true, "method": method}),
                    outcome,
                )))
            };
            match step {
                KeyStep::Perform(KeyTarget::Element, action) => {
                    let Some(located) = located else { continue };
                    require_enabled(&located.info)?;
                    if let Some(outcome) = perform(&located.element, action, gate)? {
                        return done(action, outcome);
                    }
                }
                KeyStep::Perform(target, action) => {
                    let attribute = if target == KeyTarget::DefaultButton {
                        "AXDefaultButton"
                    } else {
                        "AXCancelButton"
                    };
                    let (pid, window_id, bounds) = window;
                    let Some(button) = window_button(pid, window_id, bounds, attribute) else {
                        continue;
                    };
                    if let Some(outcome) = perform(&button, action, gate)? {
                        return done(attribute, outcome);
                    }
                }
                KeyStep::Insert(text) => {
                    let Some(located) = located else { continue };
                    if let Some((method, outcome)) = insert(located, text, gate)? {
                        return done(method, outcome);
                    }
                }
                KeyStep::DeleteBackward | KeyStep::DeleteForward => {
                    let Some(located) = located else { continue };
                    if let Some(outcome) = delete(located, step == KeyStep::DeleteBackward, gate)? {
                        return done("AXSelectedText", outcome);
                    }
                }
                KeyStep::Events => break,
            }
        }
        keys_for(located, targeted, gate)?;
        Ok(Next::Keys)
    })
}

pub(super) fn select_text(
    located: &Located,
    text: Option<&str>,
    range: Option<(u32, u32)>,
    gate: Gate,
) -> Result<Next, String> {
    let element = &located.element;
    objc2::rc::autoreleasepool(|_| unsafe {
        let (location, length) = match (text, range) {
            (Some(text), _) => {
                if located.info.is_secure() {
                    return Err(
                        "Secure text cannot be searched. Use start and length, or ask the user."
                            .into(),
                    );
                }
                let value =
                    full_text(element.0, deadline()).ok_or("That element has no readable text.")?;
                rules::find_utf16(&value, text).ok_or(
                    "That text is not in the element. Call appState again to check its value.",
                )?
            }
            (None, Some((start, length))) => {
                let (start, length) = (start as usize, length as usize);
                if let Some(value) = (!located.info.is_secure())
                    .then(|| full_text(element.0, deadline()))
                    .flatten()
                {
                    if start + length > rules::utf16_len(&value) {
                        return Err("That range is outside the element's text.".into());
                    }
                }
                (start, length)
            }
            (None, None) => return Err("selectText needs text, or start and length.".into()),
        };
        focus(located, gate)?;
        let outcome = set_range(element, location, length, gate)?
            .ok_or("That element's selection cannot be set through Accessibility.")?;
        let confirmed = selection(element, deadline()) == Some((location, length));
        Ok(Next::Done(result_json(
            json!({"selected": true, "start": location, "length": length, "method": "AXSelectedTextRange"}),
            if confirmed {
                outcome
            } else {
                Outcome::Unconfirmed
            },
        )))
    })
}

unsafe fn ancestors(element: &Element, deadline: Instant) -> Vec<(Element, String, Vec<String>)> {
    let mut chain = Vec::new();
    let mut current = element.clone();
    for _ in 0..=MAX_ANCESTORS {
        let role = copy(current.0, "AXRole", deadline)
            .and_then(|role| string_of(role.0, 64))
            .unwrap_or_default();
        let actions = action_names(current.0);
        let stop = role == "AXScrollArea" || role == "AXWindow";
        chain.push((current.clone(), role, actions));
        if stop {
            break;
        }
        match copy(current.0, "AXParent", deadline).and_then(|parent| Element::owned(parent)) {
            Some(parent) => current = parent,
            None => break,
        }
    }
    chain
}

pub(super) fn scroll(
    located: &Located,
    direction: Option<ScrollDirection>,
    pages: u8,
    delta: Option<(i32, i32)>,
    gate: Gate,
) -> Result<Next, String> {
    let element = &located.element;
    objc2::rc::autoreleasepool(|_| unsafe {
        if let Some((delta_x, delta_y)) = delta {
            let point = located.info.centre().ok_or(NO_FRAME)?;
            return Ok(Next::ScrollAt {
                point,
                delta_x,
                delta_y,
            });
        }
        let Some(direction) = direction else {
            return match perform(element, "AXScrollToVisible", gate)? {
                Some(outcome) => Ok(Next::Done(result_json(
                    json!({"scrolled": true, "method": "AXScrollToVisible"}),
                    outcome,
                ))),
                None => Err("That element cannot scroll itself into view. Scroll its scroll area with direction instead.".into()),
            };
        };
        let deadline = deadline();
        let chain = ancestors(element, deadline);
        let action = direction.page_action();
        for (candidate, _, actions) in &chain {
            if actions.iter().any(|name| name == action) {
                let mut last = None;
                for _ in 0..pages {
                    match perform(candidate, action, gate)? {
                        Some(outcome) => last = Some(outcome),
                        None => break,
                    }
                }
                if let Some(outcome) = last {
                    return Ok(Next::Done(result_json(
                        json!({"scrolled": true, "method": action}),
                        outcome,
                    )));
                }
            }
        }
        let area = chain.iter().find(|(_, role, _)| role == "AXScrollArea");
        if let Some((area, _, _)) = area {
            let bar_attribute = if direction.vertical() {
                "AXVerticalScrollBar"
            } else {
                "AXHorizontalScrollBar"
            };
            let visible = element_frame(area.0, deadline);
            let content = copy(area.0, "AXContents", deadline)
                .and_then(|contents| element_array(&contents, 1).into_iter().next())
                .and_then(|content| element_frame(content.0, deadline));
            if let (Some(bar), Some(visible), Some(content)) = (
                copy(area.0, bar_attribute, deadline).and_then(|bar| Element::owned(bar)),
                visible,
                content,
            ) {
                let (visible, content) = if direction.vertical() {
                    (visible.height, content.height)
                } else {
                    (visible.width, content.width)
                };
                let current = copy(bar.0, "AXValue", deadline).and_then(|value| number_of(value.0));
                if let Some(next) = current.and_then(|current| {
                    rules::scrollbar_value(current, visible, content, pages, direction.sign())
                }) {
                    if let Some(outcome) = set_number(&bar, next, gate)? {
                        return Ok(Next::Done(result_json(
                            json!({"scrolled": true, "method": "AXScrollBar"}),
                            outcome,
                        )));
                    }
                }
            }
        }
        // Wheel events at the scroll area's (or element's) centre.
        let target = area
            .and_then(|(area, _, _)| element_frame(area.0, deadline))
            .or(located.info.frame)
            .filter(|frame| frame.width > 0.0 && frame.height > 0.0)
            .ok_or(NO_FRAME)?;
        let visible = if direction.vertical() {
            target.height
        } else {
            target.width
        };
        let (delta_x, delta_y) = rules::event_delta(visible, pages, direction);
        Ok(Next::ScrollAt {
            point: (
                target.x + target.width / 2.0,
                target.y + target.height / 2.0,
            ),
            delta_x,
            delta_y,
        })
    })
}

#[cfg(test)]
#[path = "desktop_accessibility_live_tests.rs"]
mod live_tests;
