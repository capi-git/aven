//! Explicit app delivery, with no silent fall back to the shared pointer.
use super::*;
use std::cell::RefCell;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventPostToPid(pid: i32, event: Event);
    fn CGEventCreateCopy(event: Event) -> Event;
    fn CGEventSetType(event: Event, kind: u32);
    fn CGEventGetIntegerValueField(event: Cf, field: u32) -> i64;
}
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCopyElementAtPosition(app: Cf, x: f32, y: f32, element: *mut Cf) -> i32;
    fn AXUIElementCopyActionNames(element: Cf, actions: *mut Cf) -> i32;
    fn AXUIElementPerformAction(element: Cf, action: Cf) -> i32;
    fn AXUIElementGetPid(element: Cf, pid: *mut i32) -> i32;
}
#[derive(Clone)]
struct Route {
    ticket: presence::Ticket,
    target: PresenceTarget,
}
thread_local! { static ROUTE: RefCell<Option<Route>> = const { RefCell::new(None) }; }
pub(super) struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        ROUTE.with(|slot| slot.borrow_mut().take());
    }
}
pub(super) fn enter(ticket: &presence::Ticket, target: &PresenceTarget) -> Guard {
    ROUTE.with(|slot| {
        *slot.borrow_mut() = Some(Route {
            ticket: ticket.clone(),
            target: target.clone(),
        })
    });
    Guard
}
pub(super) fn check() -> Result<(), String> {
    ROUTE.with(|slot| {
        let slot = slot.borrow();
        let Some(route) = slot.as_ref() else {
            return Ok(());
        };
        presence::with(|state| state.check(&route.ticket))?;
        if let Some(id) = route.target.window_id {
            let current = windows()?.into_iter().find(|w| w.window_id == id);
            if current.is_none_or(|w| Some(w.pid) != route.target.pid) {
                return Err(
                    "The target app or window changed. Take a fresh screenshot before retrying."
                        .into(),
                );
            }
        }
        Ok(())
    })
}

pub(super) fn mouse_event(kind: u32, point: Point) -> Option<Result<OwnedCf, String>> {
    let target = current_app_target()?;
    Some((|| unsafe {
        let bounds = target.bounds.ok_or(INPUT_WINDOW_UNAVAILABLE)?;
        let window = target.window_id.ok_or(INPUT_WINDOW_UNAVAILABLE)?;
        // NSEvent converts the supplied point to window-local Quartz data.
        // It resolves only this process's NSWindows; for a foreign window
        // its CGEvent conversion uses the main display's flip height.
        // Keep x/y relative to the observed destination in both cases.
        let location = if target.pid == Some(std::process::id() as i32) {
            objc2_foundation::NSPoint::new(point.x - bounds.x, bounds.height - (point.y - bounds.y))
        } else {
            let main = CGDisplayBounds(CGMainDisplayID());
            objc2_foundation::NSPoint::new(
                point.x - bounds.x,
                main.origin.y + main.size.height - (point.y - bounds.y),
            )
        };
        let class = objc2::class!(NSEvent);
        let native: Option<Retained<AnyObject>> = msg_send![class,
            mouseEventWithType: kind as usize,
            location: location,
            modifierFlags: 0_usize,
            timestamp: 0.0_f64,
            windowNumber: window as isize,
            context: std::ptr::null::<AnyObject>(),
            eventNumber: 0_isize,
            clickCount: 1_isize,
            pressure: 1.0_f32
        ];
        let native = native.ok_or("Could not create input for the target window.")?;
        let cg: Event = msg_send![&*native, CGEvent];
        if cg.is_null() {
            return Err("Could not create input for the target window.".into());
        }
        let event = OwnedCf::new(
            CGEventCreateCopy(cg),
            "Could not retain target window input.",
        )?;
        Ok(event)
    })())
}

pub(super) fn scroll_event(point: Point, source: &OwnedCf) -> Result<Option<OwnedCf>, String> {
    let Some(event) = mouse_event(5, point) else {
        unsafe {
            CGEventSetLocation(source.event(), point);
        }
        return Ok(None);
    };
    let event = event?;
    unsafe {
        CGEventSetType(event.event(), 22);
        // Preserve the public scroll fields from the pixel-based CG event.
        for field in [11, 12, 13, 88, 93, 94, 95, 96, 97, 98, 99, 100, 123] {
            CGEventSetIntegerValueField(
                event.event(),
                field,
                CGEventGetIntegerValueField(source.event(), field),
            );
        }
    }
    Ok(Some(event))
}
/// Every down event is checked by its caller. Release events deliberately keep
/// the original route even after cancellation, so no button can remain held.
pub(super) unsafe fn post(event: Event) {
    CGEventSetIntegerValueField(event, 42, presence::EVENT_MARKER);
    ROUTE.with(|slot| {
        let slot = slot.borrow();
        if let Some(target) = slot
            .as_ref()
            .map(|route| &route.target)
            .filter(|target| !target.shared_input)
        {
            if let Some(pid) = target.pid {
                CGEventSetIntegerValueField(event, 40, i64::from(pid));
                if let Some(window) = target.window_id {
                    CGEventSetIntegerValueField(event, 91, i64::from(window));
                    CGEventSetIntegerValueField(event, 92, i64::from(window));
                }
                CGEventPostToPid(pid, event);
            }
        } else if slot.as_ref().is_some_and(|route| route.target.shared_input) {
            CGEventPost(0, event);
        }
    });
}
pub(super) fn app_targets(
    points: &[(f64, f64)],
    window_id: Option<u32>,
) -> Option<Result<Vec<InputTarget>, String>> {
    ROUTE.with(|slot| {
        let slot = slot.borrow();
        let target = &slot.as_ref()?.target;
        if target.shared_input {
            return None;
        }
        Some((|| {
            if target.window_id != window_id || window_id.is_none() {
                return Err("App-directed input requires the observed windowId.".into());
            }
            check()?;
            let bounds = target.bounds.ok_or(INPUT_WINDOW_UNAVAILABLE)?;
            if window_bounds(window_id.ok_or(INPUT_WINDOW_UNAVAILABLE)?)? != bounds {
                return Err("The target window moved. Take a fresh screenshot and retry.".into());
            }
            points
                .iter()
                .map(|&(x, y)| {
                    let (x, y) = global_point(x, y, Some(bounds))?;
                    let point = Point { x, y };
                    if presence_ui::covers(point)? {
                        return Err("Agent input cannot target Aven's desktop controls.".into());
                    }
                    Ok(InputTarget {
                        point,
                        bounds: Some(bounds),
                    })
                })
                .collect()
        })())
    })
}

pub(super) fn target(
    app: &AppHandle,
    scope: &str,
    request: &Request,
) -> Result<PresenceTarget, String> {
    if !presence::is_input(request) {
        return Ok(PresenceTarget::default());
    }
    let mode = request.input_mode();
    let id = request.input_window();
    let mut window = None;
    if let Some(id) = id {
        if presence_ui::window_id() == Some(id) || agent_cursor::window_id() == Some(id) {
            return Err("Agent input cannot target Aven's desktop controls.".into());
        }
        window = Some(
            windows()?
                .into_iter()
                .find(|w| w.window_id == id)
                .ok_or(INPUT_WINDOW_UNAVAILABLE)?,
        );
    } else if mode == InputMode::App {
        return Err("App-directed input requires windowId from a fresh windows/screenshot observation. Shared pointer fallback requires inputMode: pointer and the user's separate approval.".into());
    }
    let specified = match request {
        Request::Activate { pid, app } => (*pid, app.clone()),
        _ => (None, None),
    };
    let pid = if let Some(window) = &window {
        window.pid
    } else if let Some(pid) = specified.0 {
        pid
    } else if let Some(name) = specified.1 {
        let matches: Vec<_> = windows()?
            .into_iter()
            .filter(|w| w.app.eq_ignore_ascii_case(&name))
            .map(|w| w.pid)
            .collect();
        let unique: std::collections::HashSet<_> = matches.into_iter().collect();
        if unique.len() != 1 {
            return Err("Use an unambiguous pid from windows to activate an app.".into());
        }
        *unique.iter().next().ok_or(INPUT_WINDOW_UNAVAILABLE)?
    } else {
        activation_on_main(app, Instant::now() + Duration::from_secs(2), || unsafe {
            frontmost_pid_on_main()
        })?
        .ok_or("No foreground app is available. Use windowId.")?
    };
    let (key, name) = activation_on_main(
        app,
        Instant::now() + Duration::from_secs(2),
        move || unsafe {
            let class =
                AnyClass::get(c"NSRunningApplication").ok_or("App identity is unavailable.")?;
            let running: Option<Retained<AnyObject>> =
                msg_send![class,runningApplicationWithProcessIdentifier:pid];
            let running = running.ok_or("That app is no longer running.")?;
            let name: Option<Retained<NSString>> = msg_send![&*running, localizedName];
            let bundle: Option<Retained<NSString>> = msg_send![&*running, bundleIdentifier];
            Ok((
                format!(
                    "{}:{pid}",
                    bundle.map_or_else(|| "process".into(), |s| s.to_string())
                ),
                name.map_or_else(|| "this app".into(), |s| s.to_string()),
            ))
        },
    )?;
    let bounds = window.as_ref().map(DesktopWindow::bounds);
    let centre = bounds.map(|b| (b.x + b.width / 2.0, b.y + b.height / 2.0));
    let mut label = None;
    let anchor = if let (Some((index, state_id)), Some(id), Some(bounds)) =
        (request.element(), id, bounds)
    {
        // Indexes resolve against this chat's latest appState before any
        // prompt, so a stale index never asks the user for consent.
        let element = ax::anchor(scope, id, state_id, index, bounds)?;
        label = element.label;
        element.point.or(centre)
    } else {
        match request {
            Request::Move { x, y, .. }
            | Request::Click {
                x: Some(x),
                y: Some(y),
                ..
            }
            | Request::Scroll {
                x: Some(x),
                y: Some(y),
                ..
            } => Some(global_point(*x, *y, bounds)?),
            Request::Drag { from, .. } => Some(global_point(from.x, from.y, bounds)?),
            _ => centre,
        }
    };
    let shared_input = mode == InputMode::Pointer;
    let identity = if shared_input && id.is_none() && !matches!(request, Request::Activate { .. }) {
        presence::AppIdentity::new("pointer:desktop", "your Mac")
    } else if shared_input {
        presence::AppIdentity::new(
            &format!(
                "{}:{key}",
                if matches!(request, Request::Activate { .. }) {
                    "focus"
                } else {
                    "pointer"
                }
            ),
            &name,
        )
    } else {
        presence::AppIdentity::new(&key, &name)
    };
    Ok(PresenceTarget {
        app: Some(identity),
        anchor,
        pid: Some(pid),
        window_id: id,
        bounds,
        shared_input,
        label,
    })
}

fn cf_string(value: &str) -> Retained<NSString> {
    NSString::from_str(value)
}
unsafe fn attribute(element: Cf, name: &str) -> Result<OwnedCf, String> {
    let name = cf_string(name);
    let mut value = std::ptr::null();
    if AXUIElementCopyAttributeValue(element, Retained::as_ptr(&name).cast(), &mut value) != 0 {
        return Err("The app does not expose the required accessibility target. Observe it again; ask before shared-pointer fallback.".into());
    }
    OwnedCf::new(value, "The accessibility target is no longer available.")
}
fn current_app_target() -> Option<PresenceTarget> {
    ROUTE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|r| r.target.clone())
            .filter(|t| !t.shared_input)
    })
}
/// Keys go only to the requested app's focused window. Process-directed events
/// do not promise a particular window merely because a window number is set.
pub(super) fn keyboard_target() -> Result<(), String> {
    let Some(target) = current_app_target() else {
        let expected = ROUTE.with(|slot| slot.borrow().as_ref().and_then(|r| r.target.pid));
        if expected.is_some() && presence_ui::frontmost_pid()? != expected {
            return Err("The foreground app changed. No keyboard input was sent.".into());
        }
        return Ok(());
    };
    check()?;
    unsafe {
        let app = OwnedCf::new(
            AXUIElementCreateApplication(target.pid.ok_or(INPUT_WINDOW_UNAVAILABLE)?),
            "App accessibility is unavailable.",
        )?;
        AXUIElementSetMessagingTimeout(app.0, 0.3);
        let focused = attribute(app.0, "AXFocusedWindow")?;
        verify_window(focused.0, &target)
    }
}
unsafe fn verify_window(window: Cf, target: &PresenceTarget) -> Result<(), String> {
    let mut pid = 0;
    if CFGetTypeID(window) != AXUIElementGetTypeID() {
        return Err("Invalid accessibility window.".into());
    }
    if AXUIElementGetPid(window, &mut pid) != 0 || Some(pid) != target.pid {
        return Err("The app focus changed. No input was sent.".into());
    }
    let position = attribute(window, "AXPosition")?;
    let size = attribute(window, "AXSize")?;
    let mut point = Point { x: 0.0, y: 0.0 };
    let mut dimensions = Size {
        width: 0.0,
        height: 0.0,
    };
    if CFGetTypeID(position.0) != AXValueGetTypeID()
        || CFGetTypeID(size.0) != AXValueGetTypeID()
        || !AXValueGetValue(position.0, 1, std::ptr::from_mut(&mut point).cast())
        || !AXValueGetValue(size.0, 2, std::ptr::from_mut(&mut dimensions).cast())
        || target.bounds
            != Some(Region {
                x: point.x,
                y: point.y,
                width: dimensions.width,
                height: dimensions.height,
            })
    {
        return Err("The target is not this app's focused window. Click an input in that window and observe it before typing. No input was sent.".into());
    }
    Ok(())
}
/// Prefer a semantic press for an accessible control. Once attempted, even an
/// AX timeout is never retried as a click: the action may already have run.
pub(super) fn accessible_click(point: Point, button: Button, count: u8) -> Result<bool, String> {
    let Some(target) = current_app_target() else {
        return Ok(false);
    };
    if !matches!(button, Button::Left) || count != 1 {
        return Ok(false);
    }
    check()?;
    unsafe {
        let app = OwnedCf::new(
            AXUIElementCreateApplication(target.pid.ok_or(INPUT_WINDOW_UNAVAILABLE)?),
            "App accessibility is unavailable.",
        )?;
        AXUIElementSetMessagingTimeout(app.0, 0.3);
        let mut element = std::ptr::null();
        if AXUIElementCopyElementAtPosition(app.0, point.x as f32, point.y as f32, &mut element)
            != 0
        {
            return Ok(false);
        }
        let element = OwnedCf::new(element, "The clicked control is unavailable.")?;
        let Ok(window) = attribute(element.0, "AXWindow") else {
            return Ok(false);
        };
        if verify_window(window.0, &target).is_err() {
            return Ok(false);
        }
        let mut actions = std::ptr::null();
        if AXUIElementCopyActionNames(element.0, &mut actions) != 0 {
            return Ok(false);
        }
        let actions = OwnedCf::new(actions, "The clicked control has no accessible actions.")?;
        if CFGetTypeID(actions.0) != CFArrayGetTypeID() {
            return Ok(false);
        }
        let count = CFArrayGetCount(actions.0);
        if !(0..=128).contains(&count) {
            return Ok(false);
        }
        let has_press = (0..count).any(|index| {
            let action = CFArrayGetValueAtIndex(actions.0, index);
            !action.is_null()
                && CFGetTypeID(action) == CFStringGetTypeID()
                && (&*action.cast::<NSString>()).to_string() == "AXPress"
        });
        if !has_press {
            return Ok(false);
        }
        check()?;
        let press = cf_string("AXPress");
        let result = AXUIElementPerformAction(element.0, Retained::as_ptr(&press).cast());
        if result != 0 {
            return Err(format!("The app did not confirm the accessibility action (AX error {result}). It may have completed; inspect a fresh screenshot before deciding whether to retry."));
        }
        Ok(true)
    }
}
