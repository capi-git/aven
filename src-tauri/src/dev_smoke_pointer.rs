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
#![cfg(all(debug_assertions, target_os = "macos"))]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSRect};
use std::time::Duration;
use tauri::Webview;

/// NSEventType: left mouse down, up and dragged.
fn event_type(kind: &str) -> Option<usize> {
    match kind {
        "down" => Some(1),
        "up" => Some(2),
        "drag" => Some(6),
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
        _ => {
            let _: () = msg_send![view, mouseUp: &*event];
        }
    }
    Ok(())
}
