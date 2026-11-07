//! Aven Dev's real-app check (`scripts/dev-aven.py --smoke`): presses,
//! drags and releases the mouse in the workspace's own web view, as AppKit
//! hands a person's mouse to it. WebKit turns these into trusted pointer and
//! mouse events with their default actions (a press focuses a field unless
//! the page prevents it), which events made by the page's script never have.
//!
//! The events go straight to the web view, not through the system or the
//! window's key handling, so no privacy permission is involved and the
//! window need not be key. Debug builds only, and only while the check's
//! marked throwaway folder exists; release builds do not contain this.
//! `dev_smoke_scroll` does the same for a two-finger trackpad swipe.
#![cfg(all(debug_assertions, target_os = "macos"))]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSRect};
use std::ffi::c_void;
use std::time::Duration;
use tauri::Webview;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateScrollWheelEvent2(
        source: *const c_void,
        units: u32,
        wheels: u32,
        y: i32,
        x: i32,
        z: i32,
    ) -> *mut c_void;
    fn CGEventSetIntegerValueField(event: *mut c_void, field: u32, value: i64);
    fn CGEventSetDoubleValueField(event: *mut c_void, field: u32, value: f64);
    fn CGEventSetLocation(event: *mut c_void, location: NSPoint);
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *const c_void);
}

/// NSEventType: left mouse down, up, dragged and moved.
fn event_type(kind: &str) -> Option<usize> {
    match kind {
        "down" => Some(1),
        "up" => Some(2),
        "drag" => Some(6),
        "move" => Some(5),
        _ => None,
    }
}

/// One mouse event at (x, y), the page's client pixels; `zoom` is the
/// interface's page zoom (CSS pixels to the web view's points).
#[tauri::command]
pub async fn dev_smoke_pointer(
    caller: Webview,
    kind: String,
    x: f64,
    y: f64,
    zoom: f64,
) -> Result<(), String> {
    crate::dev_smoke::smoke_dir().ok_or("Only during Aven Dev's real-app check")?;
    let kind_code = event_type(&kind).ok_or("Unknown pointer event")?;
    if !(x.is_finite() && y.is_finite() && zoom.is_finite() && zoom > 0.0) {
        return Err("Invalid pointer position".into());
    }
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    caller
        .with_webview(move |platform| {
            let result = unsafe { post(platform.inner().cast(), &kind, kind_code, x, y, zoom) };
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "The workspace did not respond".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

/// On the main thread: build the event in the web view's window and hand it
/// to the web view, as AppKit routes a real one.
unsafe fn post(
    view: *mut AnyObject,
    kind: &str,
    kind_code: usize,
    x: f64,
    y: f64,
    zoom: f64,
) -> Result<(), String> {
    if view.is_null() {
        return Err("The workspace has no web view".into());
    }
    let view = &*view;
    let window: *mut AnyObject = msg_send![view, window];
    if window.is_null() {
        return Err("The workspace is not in a window".into());
    }
    // The web view's own points: CSS pixels times the page zoom, from its
    // top edge if it is flipped, else from its bottom.
    let flipped: bool = msg_send![view, isFlipped];
    let bounds: NSRect = msg_send![view, bounds];
    let local = NSPoint::new(
        x * zoom,
        if flipped {
            y * zoom
        } else {
            bounds.size.height - y * zoom
        },
    );
    let location: NSPoint =
        msg_send![view, convertPoint: local, toView: std::ptr::null_mut::<AnyObject>()];
    let number: isize = msg_send![window, windowNumber];
    let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
    let timestamp: f64 = msg_send![info, systemUptime];
    let event: Option<Retained<AnyObject>> = msg_send![class!(NSEvent),
        mouseEventWithType: kind_code,
        location: location,
        modifierFlags: 0_usize,
        timestamp: timestamp,
        windowNumber: number,
        context: std::ptr::null::<AnyObject>(),
        eventNumber: 0_isize,
        clickCount: 1_isize,
        pressure: if kind == "up" { 0.0_f32 } else { 1.0_f32 }
    ];
    let event = event.ok_or("Could not create the mouse event")?;
    match kind {
        "down" => {
            let _: () = msg_send![view, mouseDown: &*event];
        }
        "drag" => {
            let _: () = msg_send![view, mouseDragged: &*event];
        }
        // Through the app's event loop, where the hover sidebar's monitor
        // watches the pointer as it does a person's.
        "move" => {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, postEvent: &*event, atStart: false];
        }
        _ => {
            let _: () = msg_send![view, mouseUp: &*event];
        }
    }
    Ok(())
}

/// A trackpad's scroll phases: the fingers' (`kCGScrollWheelEventScrollPhase`)
/// and the momentum's after they lift (`kCGScrollWheelEventMomentumPhase`).
fn scroll_phases(phase: &str) -> Option<(i64, i64)> {
    match phase {
        "began" => Some((1, 0)),
        "changed" => Some((2, 0)),
        "ended" => Some((4, 0)),
        "momentum-begin" => Some((0, 1)),
        "momentum" => Some((0, 2)),
        "momentum-end" => Some((0, 3)),
        _ => None,
    }
}

/// One two-finger trackpad scroll event at (x, y), the page's client pixels,
/// moving the content under it `dx` CSS pixels to the left (as a swipe to
/// the next page does), in `phase`. Successive calls make one gesture.
#[tauri::command]
pub async fn dev_smoke_scroll(
    caller: Webview,
    x: f64,
    y: f64,
    zoom: f64,
    dx: f64,
    phase: String,
) -> Result<(), String> {
    crate::dev_smoke::smoke_dir().ok_or("Only during Aven Dev's real-app check")?;
    let phases = scroll_phases(&phase).ok_or("Unknown scroll phase")?;
    if !(x.is_finite() && y.is_finite() && dx.is_finite() && zoom.is_finite() && zoom > 0.0) {
        return Err("Invalid scroll".into());
    }
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    caller
        .with_webview(move |platform| {
            let result = unsafe { post_scroll(platform.inner().cast(), x, y, zoom, dx, phases) };
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "The workspace did not respond".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

/// On the main thread: a continuous (trackpad) scroll event in the web view's
/// window, handed to the web view as AppKit routes a real one.
unsafe fn post_scroll(
    view: *mut AnyObject,
    x: f64,
    y: f64,
    zoom: f64,
    dx: f64,
    (phase, momentum): (i64, i64),
) -> Result<(), String> {
    if view.is_null() {
        return Err("The workspace has no web view".into());
    }
    let view = &*view;
    let window: *mut AnyObject = msg_send![view, window];
    if window.is_null() {
        return Err("The workspace is not in a window".into());
    }
    let flipped: bool = msg_send![view, isFlipped];
    let bounds: NSRect = msg_send![view, bounds];
    let local = NSPoint::new(
        x * zoom,
        if flipped {
            y * zoom
        } else {
            bounds.size.height - y * zoom
        },
    );
    let in_window: NSPoint =
        msg_send![view, convertPoint: local, toView: std::ptr::null_mut::<AnyObject>()];
    // Quartz places events in global display points from the top of the
    // primary display; AppKit's screen points count from its bottom.
    let on_screen: NSPoint = msg_send![window, convertPointToScreen: in_window];
    let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
    let primary: *mut AnyObject = msg_send![screens, firstObject];
    if primary.is_null() {
        return Err("No display".into());
    }
    let primary_frame: NSRect = msg_send![primary, frame];
    let global = NSPoint::new(on_screen.x, primary_frame.size.height - on_screen.y);
    let number: isize = msg_send![window, windowNumber];
    let ns_event = scroll_event(global, number, dx * zoom, phase, momentum)?;
    let target: *mut AnyObject = msg_send![&*ns_event, window];
    // AppKit leaves an event made this way without a window, so its location
    // stays in screen points. WebKit reads it as the window's, so place it
    // where the screen point equals the point in the window.
    let ns_event = if target.is_null() {
        scroll_event(
            NSPoint::new(in_window.x, primary_frame.size.height - in_window.y),
            number,
            dx * zoom,
            phase,
            momentum,
        )?
    } else {
        ns_event
    };
    let target: *mut AnyObject = msg_send![&*ns_event, window];
    let located: NSPoint = msg_send![&*ns_event, locationInWindow];
    if !(target.is_null() || target == window)
        || (located.x - in_window.x).abs() > 1.0
        || (located.y - in_window.y).abs() > 1.0
    {
        return Err(format!(
            "The scroll event landed at ({:.1}, {:.1}) in {}, not ({:.1}, {:.1}) in the workspace",
            located.x,
            located.y,
            if target.is_null() {
                "no window"
            } else {
                "another window"
            },
            in_window.x,
            in_window.y,
        ));
    }
    let _: () = msg_send![view, scrollWheel: &*ns_event];
    Ok(())
}

/// A continuous (trackpad) scroll event at `global`, Quartz's display points,
/// moving content `points` to the left, in the given phases.
unsafe fn scroll_event(
    global: NSPoint,
    window_number: isize,
    points: f64,
    phase: i64,
    momentum: i64,
) -> Result<Retained<AnyObject>, String> {
    // AppKit's scrollingDeltaX: the page's deltaX reversed, so content
    // moving left (scrolling towards the next page) is negative.
    let delta = -points;
    let event = CGEventCreateScrollWheelEvent2(std::ptr::null(), 0, 2, 0, delta.round() as i32, 0);
    if event.is_null() {
        return Err("Could not create the scroll event".into());
    }
    // kCGScrollWheelEventIsContinuous, the precise point and fixed-point
    // deltas a trackpad reports, its phases, and the window under the pointer.
    CGEventSetIntegerValueField(event, 88, 1);
    CGEventSetIntegerValueField(event, 97, delta.round() as i64);
    CGEventSetDoubleValueField(event, 94, delta);
    CGEventSetIntegerValueField(event, 99, phase);
    CGEventSetIntegerValueField(event, 123, momentum);
    CGEventSetLocation(event, global);
    CGEventSetIntegerValueField(event, 91, window_number as i64);
    CGEventSetIntegerValueField(event, 92, window_number as i64);
    let ns_event: Option<Retained<AnyObject>> = msg_send![class!(NSEvent), eventWithCGEvent: event];
    CFRelease(event);
    ns_event.ok_or_else(|| "Could not create the scroll event".to_string())
}
