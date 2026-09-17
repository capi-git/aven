//! Native chrome for a floating remote page; no trusted frontend or page bridge.
use objc2::{
    define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject, NSObject},
    DefinedClass, MainThreadOnly,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use std::cell::RefCell;
use std::collections::HashMap;
#[cfg(not(feature = "chromium"))]
use tauri::Webview;
use tauri::{AppHandle, Manager, Window};

pub struct ControlState {
    app: AppHandle,
    window_label: String,
    root_label: String,
    pin: RefCell<Option<Retained<AnyObject>>>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ControlState]
    struct BrowserFloatingControls;
    unsafe impl NSObjectProtocol for BrowserFloatingControls {}
    impl BrowserFloatingControls {
        #[unsafe(method(returnToWorkspace:))]
        fn return_to_workspace(&self, _sender: &AnyObject) {
            crate::browser::return_floating(&self.ivars().root_label);
        }
        #[unsafe(method(toggleOnTop:))]
        fn toggle_on_top(&self, sender: &AnyObject) {
            let state: isize = unsafe { msg_send![sender, state] };
            if crate::pip_group::set_pinned(&self.ivars().app, &self.ivars().window_label, state != 0).is_err() {
                unsafe { let _: () = msg_send![sender, setState: if state == 0 { 1isize } else { 0isize }]; }
            }
        }
    }
);
thread_local! {
    static CONTROLS: RefCell<HashMap<String, Retained<BrowserFloatingControls>>> = RefCell::new(HashMap::new());
}

pub fn install(window: &Window, root_label: String) -> Result<(), String> {
    let native = window.ns_window().map_err(|e| e.to_string())? as usize;
    let app = window.app_handle().clone();
    let window_label = window.label().to_string();
    window.run_on_main_thread(move || unsafe {
        let Some(mtm) = MainThreadMarker::new() else { return; };
        let Some(view_class) = AnyClass::get(c"NSView") else { return; };
        let Some(button_class) = AnyClass::get(c"NSButton") else { return; };
        let Some(accessory_class) = AnyClass::get(c"NSTitlebarAccessoryViewController") else { return; };
        let controls = mtm.alloc::<BrowserFloatingControls>().set_ivars(ControlState { app, window_label: window_label.clone(), root_label, pin: RefCell::new(None) });
        let controls: Retained<BrowserFloatingControls> = msg_send![super(controls), init];
        let rect = |x, width| NSRect::new(NSPoint::new(x, 1.0), NSSize::new(width, 24.0));
        let view: Allocated<AnyObject> = msg_send![view_class, alloc];
        let view: Retained<AnyObject> = msg_send![view, initWithFrame: rect(0.0, 176.0)];
        let return_title = NSString::from_str("Return");
        let return_button: Retained<AnyObject> = msg_send![button_class, buttonWithTitle: &*return_title, target: &*controls, action: objc2::sel!(returnToWorkspace:)];
        let _: () = msg_send![&*return_button, setFrame: rect(0.0, 76.0)];
        let _: () = msg_send![&*return_button, setBezelStyle: 1usize];
        let _: () = msg_send![&*view, addSubview: &*return_button];
        let pin_title = NSString::from_str("Pin");
        let pin: Retained<AnyObject> = msg_send![button_class, checkboxWithTitle: &*pin_title, target: &*controls, action: objc2::sel!(toggleOnTop:)];
        let _: () = msg_send![&*pin, setFrame: rect(80.0, 96.0)];
        let _: () = msg_send![&*pin, setState: 1isize];
        controls.ivars().pin.replace(Some(pin.clone()));
        let _: () = msg_send![&*view, addSubview: &*pin];
        let accessory: Retained<AnyObject> = msg_send![accessory_class, new];
        let _: () = msg_send![&*accessory, setView: &*view];
        let _: () = msg_send![&*accessory, setLayoutAttribute: 2isize];
        let _: () = msg_send![native as *mut AnyObject, addTitlebarAccessoryViewController: &*accessory];
        CONTROLS.with(|entries| { entries.borrow_mut().insert(window_label, controls); });
    }).map_err(|e| e.to_string())
}

pub fn set_pinned(app: &AppHandle, window_label: &str, pinned: bool) {
    let label = window_label.to_string();
    let _ = app.run_on_main_thread(move || {
        CONTROLS.with(|entries| {
            let entries = entries.borrow();
            if let Some(controls) = entries.get(&label) {
                if let Some(pin) = controls.ivars().pin.borrow().as_ref() {
                    unsafe {
                        let _: () =
                            msg_send![&**pin, setState: if pinned { 1isize } else { 0isize }];
                    }
                }
            }
        });
    });
}

pub fn remove(app: &AppHandle, window_label: &str) {
    let label = window_label.to_string();
    let _ = app.run_on_main_thread(move || {
        CONTROLS.with(|entries| {
            entries.borrow_mut().remove(&label);
        });
    });
}

/// Native points and AppKit autoresizing avoid a second physical/logical
/// conversion when the existing child enters a different content view.
#[cfg(not(feature = "chromium"))]
pub fn set_page_layout(view: &Webview, floating: bool) -> Result<(), String> {
    view.with_webview(move |platform| unsafe {
        let wk = &*platform.inner().cast::<AnyObject>();
        if floating {
            let parent: *mut AnyObject = msg_send![wk, superview];
            if parent.is_null() { return; }
            let bounds: NSRect = msg_send![parent, bounds];
            let _: () = msg_send![wk, setFrame: bounds];
            // NSViewWidthSizable | NSViewHeightSizable. AppKit maintains this
            // directly during live resize, without a frontend or timer.
            let _: () = msg_send![wk, setAutoresizingMask: 18usize];
        } else {
            // Wry's original fixed child mode anchors its top edge while the
            // workspace's coalesced native layout command owns its bounds.
            let _: () = msg_send![wk, setAutoresizingMask: 8usize];
        }
        if std::env::var_os("SUPERMONO_BROWSER_GEOMETRY").is_some() {
            let frame: NSRect = msg_send![wk, frame];
            let window: *mut AnyObject = msg_send![wk, window];
            let scale: f64 = msg_send![window, backingScaleFactor];
            let zoom: f64 = msg_send![wk, pageZoom];
            eprintln!("[supermono-browser-geometry] floating={floating} frame=({},{},{},{}) scale={scale} zoom={zoom}", frame.origin.x, frame.origin.y, frame.size.width, frame.size.height);
        }
    }).map_err(|e| e.to_string())
}
