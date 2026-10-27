//! Safe wrappers over the iPhone pane's Objective-C bridge
//! (`macos/ios_simulator.m`). macOS only.

use std::ffi::{c_char, c_void, CStr, CString};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct DisplayInfo {
    /// Portrait framebuffer points.
    pub width: f64,
    pub height: f64,
    /// Pixels per point.
    pub scale: f64,
    /// UIKit interface orientation: 1 portrait, 2 upside down, 3 and 4 landscape.
    pub orientation: u32,
}

type EventCallback = unsafe extern "C" fn(json: *const c_char, context: *mut c_void);

extern "C" {
    fn aven_sim_framework_versions(
        developer_dir: *const c_char,
        core: *mut c_char,
        core_len: usize,
        kit: *mut c_char,
        kit_len: usize,
    ) -> i32;
    fn aven_sim_probe(developer_dir: *const c_char, error: *mut c_char, error_len: usize) -> i32;
    fn aven_sim_display_info(
        udid: *const c_char,
        info: *mut DisplayInfo,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_screenshot_png(
        udid: *const c_char,
        quarter_turns: u32,
        png: *mut *mut u8,
        png_len: *mut usize,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_free(pointer: *mut c_void);
    fn aven_sim_touch(
        udid: *const c_char,
        phase: i32,
        x: f64,
        y: f64,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_button(
        udid: *const c_char,
        button: i32,
        phase: i32,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_key(
        udid: *const c_char,
        usage: u32,
        phase: i32,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_reset(udid: *const c_char);
    fn aven_sim_set_event_callback(callback: Option<EventCallback>, context: *mut c_void);
    fn aven_sim_view_attach(
        view_id: *const c_char,
        content_view: *mut c_void,
        webview: *mut c_void,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    fn aven_sim_view_set_device(
        view_id: *const c_char,
        udid: *const c_char,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    #[allow(clippy::too_many_arguments)]
    fn aven_sim_view_layout(
        view_id: *const c_char,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        visible: i32,
        viewport_height: f64,
        clip_left: f64,
        clip_right: f64,
        holes: *const f64,
        hole_count: i32,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
    #[allow(clippy::too_many_arguments)]
    fn aven_sim_view_marker(
        view_id: *const c_char,
        x: f64,
        y: f64,
        name: *const c_char,
        red: f64,
        green: f64,
        blue: f64,
        action: i32,
    ) -> i32;
    fn aven_sim_view_focus(view_id: *const c_char) -> i32;
    fn aven_sim_view_debug_click(view_id: *const c_char, x: f64, y: f64) -> i32;
    fn aven_sim_view_debug_key(
        view_id: *const c_char,
        key_code: u16,
        characters: *const c_char,
        modifiers: u64,
    ) -> i32;
    fn aven_sim_view_detach(view_id: *const c_char);
    fn aven_sim_copy_png(
        png: *const u8,
        png_len: usize,
        error: *mut c_char,
        error_len: usize,
    ) -> i32;
}

const ERROR_LEN: usize = 512;

fn c(text: &str) -> Result<CString, String> {
    CString::new(text).map_err(|_| "Invalid text".to_string())
}

/// Runs a bridge call with an error buffer; `ok` decides what counts as success.
fn call(
    run: impl FnOnce(*mut c_char, usize) -> i32,
    ok: impl Fn(i32) -> bool,
) -> Result<i32, String> {
    let mut buffer = vec![0 as c_char; ERROR_LEN];
    let code = run(buffer.as_mut_ptr(), buffer.len());
    if ok(code) {
        return Ok(code);
    }
    let message = unsafe { CStr::from_ptr(buffer.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    Err(if message.is_empty() {
        "The simulator did not respond".into()
    } else {
        message
    })
}

/// The CFBundleVersion of CoreSimulator and of this Xcode's SimulatorKit,
/// read without loading either.
pub(crate) fn framework_versions(developer_dir: &str) -> Option<(String, String)> {
    let dir = c(developer_dir).ok()?;
    let mut core = vec![0 as c_char; 64];
    let mut kit = vec![0 as c_char; 64];
    let code = unsafe {
        aven_sim_framework_versions(
            dir.as_ptr(),
            core.as_mut_ptr(),
            core.len(),
            kit.as_mut_ptr(),
            kit.len(),
        )
    };
    if code != 0 {
        return None;
    }
    let read = |buffer: &[c_char]| {
        unsafe { CStr::from_ptr(buffer.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    };
    Some((read(&core), read(&kit)))
}

/// Loads Xcode's simulator frameworks and checks the private interfaces.
pub(crate) fn probe(developer_dir: &str) -> Result<(), String> {
    let dir = c(developer_dir)?;
    call(
        |error, len| unsafe { aven_sim_probe(dir.as_ptr(), error, len) },
        |code| code == 0,
    )
    .map(|_| ())
}

pub(crate) fn display_info(udid: &str) -> Result<DisplayInfo, String> {
    let udid = c(udid)?;
    let mut info = DisplayInfo::default();
    call(
        |error, len| unsafe { aven_sim_display_info(udid.as_ptr(), &mut info, error, len) },
        |code| code == 0,
    )?;
    Ok(info)
}

/// The screen as PNG, turned upright.
pub(crate) fn screenshot_png(udid: &str, quarter_turns: u32) -> Result<Vec<u8>, String> {
    let udid = c(udid)?;
    let mut bytes: *mut u8 = std::ptr::null_mut();
    let mut len = 0usize;
    call(
        |error, error_len| unsafe {
            aven_sim_screenshot_png(
                udid.as_ptr(),
                quarter_turns,
                &mut bytes,
                &mut len,
                error,
                error_len,
            )
        },
        |code| code == 0,
    )?;
    if bytes.is_null() {
        return Err("The simulator returned no picture".into());
    }
    let png = unsafe { std::slice::from_raw_parts(bytes, len) }.to_vec();
    unsafe { aven_sim_free(bytes.cast()) };
    Ok(png)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TouchPhase {
    Down = 1,
    Up = 2,
    Moved = 6,
}

/// Sends a touch at portrait framebuffer points. A move SimulatorKit drops
/// (closer than 16 ms to the last) is not an error.
pub(crate) fn touch(udid: &str, phase: TouchPhase, x: f64, y: f64) -> Result<(), String> {
    let udid = c(udid)?;
    call(
        |error, len| unsafe { aven_sim_touch(udid.as_ptr(), phase as i32, x, y, error, len) },
        |code| code >= 0,
    )
    .map(|_| ())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Button {
    Home = 0,
    Lock = 1,
}

pub(crate) fn button(udid: &str, button: Button, down: bool) -> Result<(), String> {
    let udid = c(udid)?;
    call(
        |error, len| unsafe {
            aven_sim_button(
                udid.as_ptr(),
                button as i32,
                if down { 1 } else { 2 },
                error,
                len,
            )
        },
        |code| code == 0,
    )
    .map(|_| ())
}

pub(crate) fn key(udid: &str, usage: u32, down: bool) -> Result<(), String> {
    let udid = c(udid)?;
    call(
        |error, len| unsafe {
            aven_sim_key(udid.as_ptr(), usage, if down { 1 } else { 2 }, error, len)
        },
        |code| code == 0,
    )
    .map(|_| ())
}

pub(crate) fn reset(udid: &str) {
    if let Ok(udid) = c(udid) {
        unsafe { aven_sim_reset(udid.as_ptr()) };
    }
}

static EVENT_HANDLER: std::sync::OnceLock<Box<dyn Fn(String) + Send + Sync>> =
    std::sync::OnceLock::new();

unsafe extern "C" fn on_event(json: *const c_char, _context: *mut c_void) {
    if json.is_null() {
        return;
    }
    let text = unsafe { CStr::from_ptr(json) }
        .to_string_lossy()
        .into_owned();
    if let Some(handler) = EVENT_HANDLER.get() {
        handler(text);
    }
}

/// Native view events (focus, pasted text, orientation) as JSON; set once.
pub(crate) fn set_event_handler(handler: impl Fn(String) + Send + Sync + 'static) {
    if EVENT_HANDLER.set(Box::new(handler)).is_ok() {
        unsafe { aven_sim_set_event_callback(Some(on_event), std::ptr::null_mut()) };
    }
}

// View functions: main thread only.

pub(crate) unsafe fn view_attach(
    view_id: &str,
    content_view: *mut c_void,
    webview: *mut c_void,
) -> Result<(), String> {
    let id = c(view_id)?;
    call(
        |error, len| unsafe {
            aven_sim_view_attach(id.as_ptr(), content_view, webview, error, len)
        },
        |code| code == 0,
    )
    .map(|_| ())
}

pub(crate) fn view_set_device(view_id: &str, udid: Option<&str>) -> Result<(), String> {
    let id = c(view_id)?;
    let udid = udid.map(c).transpose()?;
    call(
        |error, len| unsafe {
            aven_sim_view_set_device(
                id.as_ptr(),
                udid.as_ref().map_or(std::ptr::null(), |u| u.as_ptr()),
                error,
                len,
            )
        },
        |code| code == 0,
    )
    .map(|_| ())
}

/// Where the pane's screen goes, in the webview's points.
pub(crate) struct ViewLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    pub viewport_height: f64,
    pub clip_left: f64,
    pub clip_right: f64,
    /// Flattened `[x, y, width, height, radius]` cut-outs.
    pub holes: Vec<f64>,
}

pub(crate) fn view_layout(view_id: &str, layout: &ViewLayout) -> Result<(), String> {
    let id = c(view_id)?;
    call(
        |error, len| unsafe {
            aven_sim_view_layout(
                id.as_ptr(),
                layout.x,
                layout.y,
                layout.width,
                layout.height,
                layout.visible as i32,
                layout.viewport_height,
                layout.clip_left,
                layout.clip_right,
                layout.holes.as_ptr(),
                (layout.holes.len() / 5) as i32,
                error,
                len,
            )
        },
        |code| code == 0,
    )
    .map(|_| ())
}

/// The agent's ring at a framebuffer point; `action` 0 tap, 1 type, 2 key, 3 scroll.
pub(crate) fn view_marker(
    view_id: &str,
    x: f64,
    y: f64,
    name: &str,
    color: [f64; 3],
    action: i32,
) -> bool {
    let (Ok(id), Ok(name)) = (c(view_id), c(name)) else {
        return false;
    };
    unsafe {
        aven_sim_view_marker(
            id.as_ptr(),
            x,
            y,
            name.as_ptr(),
            color[0],
            color[1],
            color[2],
            action,
        ) == 0
    }
}

pub(crate) fn view_focus(view_id: &str) -> bool {
    c(view_id).is_ok_and(|id| unsafe { aven_sim_view_focus(id.as_ptr()) } == 0)
}

/// Aven Dev's iPhone check: a click on the live view at a framebuffer point,
/// through its hit test and mouse handlers. Main thread.
#[cfg(debug_assertions)]
pub(crate) fn view_debug_click(view_id: &str, x: f64, y: f64) -> Result<(), String> {
    let id = c(view_id)?;
    match unsafe { aven_sim_view_debug_click(id.as_ptr(), x, y) } {
        0 => Ok(()),
        2 => Err("The click did not reach the iPhone's screen".into()),
        _ => Err("The iPhone pane is not showing a live screen".into()),
    }
}

/// Aven Dev's iPhone check: a key press through the live view's key handler.
#[cfg(debug_assertions)]
pub(crate) fn view_debug_key(
    view_id: &str,
    key_code: u16,
    characters: &str,
    modifiers: u64,
) -> Result<(), String> {
    let (id, text) = (c(view_id)?, c(characters)?);
    match unsafe { aven_sim_view_debug_key(id.as_ptr(), key_code, text.as_ptr(), modifiers) } {
        0 => Ok(()),
        _ => Err("The iPhone pane has no device".into()),
    }
}

pub(crate) fn view_detach(view_id: &str) {
    if let Ok(id) = c(view_id) {
        unsafe { aven_sim_view_detach(id.as_ptr()) };
    }
}

pub(crate) fn copy_png(png: &[u8]) -> Result<(), String> {
    call(
        |error, len| unsafe { aven_sim_copy_png(png.as_ptr(), png.len(), error, len) },
        |code| code == 0,
    )
    .map(|_| ())
}
