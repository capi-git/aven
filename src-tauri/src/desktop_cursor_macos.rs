//! A visible agent pointer. This is an AppKit drawing, not a second input device.
//! Objective-C objects stay on the main thread; workers only exchange points,
//! deadlines and generations. Stale work can never bring a revoked cursor back.
use super::{CGDisplayBounds, CGMainDisplayID, OwnedCf, Point};
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::{define_class, msg_send, rc::Retained, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSBezierPath, NSColor, NSFont, NSGraphicsContext, NSLineCapStyle,
    NSLineJoinStyle, NSPanel, NSShadow, NSStatusWindowLevel, NSTextField, NSView,
    NSWindowCollectionBehavior, NSWindowSharingType, NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const WIDTH: f64 = 112.0;
const HEIGHT: f64 = 66.0;
const TIP_X: f64 = 18.0;
const TIP_Y: f64 = 18.0;
const TRAVEL: Duration = Duration::from_millis(190);
const LINGER: Duration = Duration::from_secs(2);
const UI_TIMEOUT: Duration = Duration::from_secs(1);
const FRAME: Duration = Duration::from_millis(16);
const CANCELLED: &str =
    "The desktop cursor action was cancelled. Observe the desktop before retrying.";
const TIMED_OUT: &str =
    "The desktop cursor could not be shown in time. Observe the desktop before retrying.";

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> Point;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Feedback {
    Move,
    Click,
    Scroll,
}

struct Gate {
    owner: Option<String>,
    revoked: Option<Arc<AtomicBool>>,
    generation: u64,
    suspended: bool,
    expires: Option<Instant>,
    last_point: Option<Point>,
}

impl Gate {
    const fn new() -> Self {
        Self {
            owner: None,
            revoked: None,
            generation: 0,
            suspended: false,
            expires: None,
            last_point: None,
        }
    }

    fn authorized(&self, generation: u64) -> bool {
        self.generation == generation
            && self.owner.is_some()
            && self
                .revoked
                .as_ref()
                .is_some_and(|revoked| !revoked.load(Ordering::Acquire))
    }

    fn current(&self, generation: u64, now: Instant) -> bool {
        self.authorized(generation) && self.expires.is_some_and(|expires| now < expires)
    }

    fn visible(&self, generation: u64, now: Instant) -> bool {
        !self.suspended && self.current(generation, now)
    }

    fn start(
        &mut self,
        scope: &str,
        revoked: Arc<AtomicBool>,
        now: Instant,
    ) -> Result<(u64, Option<Point>), String> {
        // This is the exact session's token, shared with desktop authorization.
        // A revoke may precede this call after the original socket check.
        if revoked.load(Ordering::Acquire) {
            return Err(CANCELLED.into());
        }
        let from = if self.owner.as_deref() == Some(scope) {
            self.last_point
        } else {
            None
        };
        self.generation = self.generation.wrapping_add(1);
        self.owner = Some(scope.to_owned());
        self.revoked = Some(revoked);
        self.suspended = false;
        self.expires = Some(now + UI_TIMEOUT + TRAVEL + LINGER);
        self.last_point = from;
        Ok((self.generation, from))
    }

    fn clear(&mut self, scope: Option<&str>) -> Option<u64> {
        if scope.is_some_and(|scope| self.owner.as_deref() != Some(scope)) {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        self.owner = None;
        self.revoked = None;
        self.expires = None;
        self.last_point = None;
        self.suspended = false;
        Some(self.generation)
    }
}

static GATE: Mutex<Gate> = Mutex::new(Gate::new());
// Only the exact mouse-transparent window we created is exempted from the
// desktop targeting guard. Do not exempt an app, owner PID or window layer.
static WINDOW_ID: AtomicU32 = AtomicU32::new(0);

struct Drawing {
    feedback: Cell<Feedback>,
    pulse: Cell<f64>,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopCursorView"]
    #[ivars = Drawing]
    struct CursorView;

    unsafe impl NSObjectProtocol for CursorView {}

    impl CursorView {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool { true }

        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool { false }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            let ink = NSColor::colorWithSRGBRed_green_blue_alpha(0.07, 0.07, 0.08, 1.0);
            let paper = NSColor::colorWithSRGBRed_green_blue_alpha(0.98, 0.98, 0.99, 1.0);
            let progress = self.ivars().pulse.get();
            if self.ivars().feedback.get() == Feedback::Click && progress < 1.0 {
                let radius = 3.0 + 11.0 * progress;
                let ring = NSBezierPath::bezierPathWithOvalInRect(rect(TIP_X - radius, TIP_Y - radius, radius * 2.0, radius * 2.0));
                // A fine light line inside a dark halo stays legible on both
                // black glass and white documents, without a coloured flash.
                NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.35 * (1.0 - progress)).setStroke();
                ring.setLineWidth(3.0);
                ring.stroke();
                NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.9 * (1.0 - progress)).setStroke();
                ring.setLineWidth(1.1);
                ring.stroke();
            }

            // The compact pointer keeps its exact hotspot. A soft shadow and
            // charcoal edge separate the white face from any app underneath.
            let arrow = NSBezierPath::bezierPath();
            arrow.moveToPoint(NSPoint::new(TIP_X, TIP_Y));
            for (x, y) in [(18.0, 40.0), (23.2, 35.5), (27.7, 44.5), (31.3, 42.6), (26.8, 33.8), (36.0, 33.7)] {
                arrow.lineToPoint(NSPoint::new(x, y));
            }
            arrow.closePath();
            arrow.setLineJoinStyle(NSLineJoinStyle::Round);
            NSGraphicsContext::saveGraphicsState_class();
            let shadow = NSShadow::new();
            shadow.setShadowOffset(NSSize::new(0.0, -1.0));
            shadow.setShadowBlurRadius(2.5);
            shadow.setShadowColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.3)));
            shadow.set();
            paper.setFill();
            arrow.fill();
            ink.setStroke();
            arrow.setLineWidth(1.15);
            arrow.stroke();

            let badge = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(rect(42.0, 39.0, 57.0, 20.0), 10.0, 10.0);
            NSColor::colorWithSRGBRed_green_blue_alpha(0.08, 0.08, 0.09, 0.96).setFill();
            badge.fill();
            NSGraphicsContext::restoreGraphicsState_class();
            NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.24).setStroke();
            badge.setLineWidth(0.65);
            badge.stroke();

            // Aven's actual asymmetric left-facing mark, scaled from its
            // 24-unit brand artwork into a 12-point glyph box.
            let mark = NSBezierPath::bezierPath();
            mark.moveToPoint(NSPoint::new(55.3, 45.3));
            mark.lineToPoint(NSPoint::new(50.7, 49.0));
            mark.lineToPoint(NSPoint::new(54.8, 52.5));
            mark.setLineCapStyle(NSLineCapStyle::Round);
            mark.setLineJoinStyle(NSLineJoinStyle::Round);
            mark.setLineWidth(1.5);
            paper.setStroke();
            mark.stroke();

            if self.ivars().feedback.get() == Feedback::Scroll && progress < 1.0 {
                let arrows = NSBezierPath::bezierPath();
                arrows.moveToPoint(NSPoint::new(102.0, 44.0));
                arrows.lineToPoint(NSPoint::new(105.0, 41.0));
                arrows.lineToPoint(NSPoint::new(108.0, 44.0));
                arrows.moveToPoint(NSPoint::new(102.0, 51.0));
                arrows.lineToPoint(NSPoint::new(105.0, 54.0));
                arrows.lineToPoint(NSPoint::new(108.0, 51.0));
                arrows.setLineCapStyle(NSLineCapStyle::Round);
                arrows.setLineJoinStyle(NSLineJoinStyle::Round);
                NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.4 * (1.0 - progress)).setStroke();
                arrows.setLineWidth(3.0);
                arrows.stroke();
                NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 1.0 - progress).setStroke();
                arrows.setLineWidth(1.2);
                arrows.stroke();
            }
        }
    }
);

define_class!(
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopCursorPanel"]
    struct CursorPanel;

    unsafe impl NSObjectProtocol for CursorPanel {}

    impl CursorPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool { false }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool { false }
    }
);

struct Overlay {
    panel: Retained<CursorPanel>,
    view: Retained<CursorView>,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn frame_origin(point: Point, main_display_top: f64) -> NSPoint {
    // Quartz has its origin at the primary display's top left. AppKit has it
    // at that display's bottom left. This global flip also handles displays
    // above or left of the primary, without any backing-scale conversion.
    NSPoint::new(
        point.x - TIP_X,
        main_display_top - point.y - (HEIGHT - TIP_Y),
    )
}

fn motion(from: Point, to: Point, fraction: f64) -> Point {
    let fraction = fraction.clamp(0.0, 1.0);
    let eased = fraction * fraction * (3.0 - 2.0 * fraction);
    Point {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
    }
}

fn create(mtm: MainThreadMarker) -> Overlay {
    let panel: Retained<CursorPanel> = unsafe {
        msg_send![CursorPanel::alloc(mtm), initWithContentRect: rect(0.0, 0.0, WIDTH, HEIGHT), styleMask: NSWindowStyleMask::NonactivatingPanel, backing: NSBackingStoreType::Buffered, defer: false]
    };
    // The thread-local Retained is the sole lifetime owner; AppKit must not
    // release that retain separately when the panel is closed at process exit.
    unsafe {
        panel.setReleasedWhenClosed(false);
    }
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    panel.setAcceptsMouseMovedEvents(false);
    panel.setHidesOnDeactivate(false);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setLevel(NSStatusWindowLevel);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    // suspend() also orders the panel out for every authenticated screenshot.
    // The visual-only Dev demo permits an external host to photograph it; a
    // release build always retains the additional window-sharing exclusion.
    let sharing = NSWindowSharingType::None;
    #[cfg(debug_assertions)]
    let sharing = if std::env::var("AVEN_DEV_CURSOR_PREVIEW").as_deref() == Ok("1") {
        NSWindowSharingType::ReadOnly
    } else {
        sharing
    };
    panel.setSharingType(sharing);
    let view = CursorView::alloc(mtm).set_ivars(Drawing {
        feedback: Cell::new(Feedback::Move),
        pulse: Cell::new(1.0),
    });
    let view: Retained<CursorView> =
        unsafe { msg_send![super(view), initWithFrame: rect(0.0, 0.0, WIDTH, HEIGHT)] };
    let label = NSTextField::labelWithString(&NSString::from_str("Aven"), mtm);
    label.setFrame(rect(60.0, 40.0, 34.0, 17.0));
    label.setFont(Some(&NSFont::systemFontOfSize_weight(11.0, 0.5)));
    label.setTextColor(Some(&NSColor::whiteColor()));
    label.setSelectable(false);
    view.addSubview(&label);
    panel.setContentView(Some(&view));
    WINDOW_ID.store(
        u32::try_from(panel.windowNumber()).unwrap_or(0),
        Ordering::Release,
    );
    Overlay { panel, view }
}

fn with_overlay<T>(operation: impl FnOnce(&Overlay) -> T) -> Result<T, String> {
    let mtm =
        MainThreadMarker::new().ok_or("The desktop cursor must be drawn on the main thread.")?;
    OVERLAY.with(|slot| {
        let mut slot = slot.borrow_mut();
        let overlay = slot.get_or_insert_with(|| create(mtm));
        Ok(operation(overlay))
    })
}

fn order_out() {
    OVERLAY.with(|slot| {
        if let Some(overlay) = slot.borrow().as_ref() {
            overlay.panel.orderOut(None);
        }
    });
}

fn on_main<T: Send + 'static>(
    deadline: Instant,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if Instant::now() >= deadline {
        return Err(TIMED_OUT.into());
    }
    if MainThreadMarker::new().is_some() {
        return operation();
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    // Run outside Tao's event-handler lock. Showing native panels may draw a
    // window synchronously; nothing here retains a pointer across this dispatch.
    DispatchQueue::main().exec_async(move || {
        if Instant::now() >= deadline {
            return;
        }
        let result = objc2::rc::autoreleasepool(|_| operation());
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| TIMED_OUT.to_owned())?
}

fn paint(generation: u64, point: Point, feedback: Feedback, pulse: f64) -> Result<(), String> {
    let mut gate = GATE
        .lock()
        .map_err(|_| "The desktop cursor is unavailable.")?;
    if !gate.visible(generation, Instant::now()) {
        return Err(CANCELLED.into());
    }
    let primary = unsafe { CGDisplayBounds(CGMainDisplayID()) };
    with_overlay(|overlay| {
        overlay
            .panel
            .setFrameOrigin(frame_origin(point, primary.origin.y + primary.size.height));
        overlay.panel.setAlphaValue(1.0);
        overlay.view.ivars().feedback.set(feedback);
        overlay.view.ivars().pulse.set(pulse);
        overlay.view.setNeedsDisplay(true);
        overlay.panel.orderFrontRegardless();
        WINDOW_ID.store(
            u32::try_from(overlay.panel.windowNumber()).unwrap_or(0),
            Ordering::Release,
        );
        overlay.view.displayIfNeeded();
    })?;
    gate.last_point = Some(point);
    Ok(())
}

fn schedule_after(duration: Duration, operation: impl FnOnce() + Send + 'static) {
    if let Ok(when) = DispatchTime::try_from(duration) {
        let _ = DispatchQueue::main().after(when, operation);
    }
}

fn schedule_feedback(generation: u64, point: Point, feedback: Feedback) {
    if feedback != Feedback::Move {
        for frame in 1..=15 {
            schedule_after(Duration::from_millis(frame * 16), move || {
                objc2::rc::autoreleasepool(|_| {
                    let _ = paint(generation, point, feedback, frame as f64 / 15.0);
                });
            });
        }
    }
    // A short fade makes the marker ephemeral. Every frame checks generation,
    // expiry and screenshot suppression, so old timers cannot hide a later use.
    for frame in 0..=10 {
        schedule_after(LINGER + Duration::from_millis(frame * 16), move || {
            let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
            if !gate.authorized(generation) || gate.suspended {
                return;
            }
            OVERLAY.with(|slot| {
                if let Some(overlay) = slot.borrow().as_ref() {
                    if frame == 10 {
                        overlay.panel.orderOut(None);
                    } else {
                        overlay.panel.setAlphaValue(1.0 - frame as f64 / 10.0);
                    }
                }
            });
        });
    }
}

fn system_position() -> Result<Point, String> {
    unsafe {
        let event = OwnedCf::new(
            CGEventCreate(std::ptr::null()),
            "Mouse position is unavailable.",
        )?;
        Ok(CGEventGetLocation(event.event()))
    }
}

/// Animate only this drawing. CG input is posted by the desktop-control caller
/// after movement completes and the target has been checked again.
pub(super) fn move_to(
    _app: &AppHandle,
    scope: &str,
    x: f64,
    y: f64,
    feedback: Feedback,
    revoked: Arc<AtomicBool>,
) -> Result<(), String> {
    let started = Instant::now();
    let deadline = started + UI_TIMEOUT + TRAVEL;
    let (generation, previous) = GATE
        .lock()
        .map_err(|_| "The desktop cursor is unavailable.")?
        .start(scope, revoked, started)?;
    let target = Point { x, y };
    let result = (|| {
        let from = previous.unwrap_or_else(|| system_position().unwrap_or(target));
        let stationary = (from.x - target.x).abs() < 0.5 && (from.y - target.y).abs() < 0.5;
        let motion_started = Instant::now();
        loop {
            let elapsed = motion_started.elapsed();
            let fraction = if stationary {
                1.0
            } else {
                (elapsed.as_secs_f64() / TRAVEL.as_secs_f64()).min(1.0)
            };
            let point = motion(from, target, fraction);
            on_main(deadline, move || {
                paint(generation, point, Feedback::Move, 1.0)
            })?;
            if fraction == 1.0 {
                break;
            }
            std::thread::sleep(FRAME.min(TRAVEL.saturating_sub(elapsed)));
        }
        on_main(deadline, move || {
            paint(generation, target, feedback, 0.0)?;
            let mut gate = GATE
                .lock()
                .map_err(|_| "The desktop cursor is unavailable.")?;
            if !gate.visible(generation, Instant::now()) {
                return Err(CANCELLED.into());
            }
            gate.expires = Some(Instant::now() + LINGER);
            drop(gate);
            schedule_feedback(generation, target, feedback);
            Ok(())
        })
    })();
    if result.is_err() {
        // Cancel only our own generation: a concurrent teardown or new owner
        // may already have replaced it while the main queue was blocked.
        let cleanup = {
            let mut gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
            if gate.generation == generation {
                gate.clear(None)
            } else {
                None
            }
        };
        if let Some(cleanup) = cleanup {
            hide_generation(cleanup);
        }
    }
    result
}

/// Follows a native drag. It never waits for AppKit, so a busy main thread
/// cannot stretch how long the mouse button is held. Each call takes a new
/// generation: queued older frames and earlier fade timers become no-ops, so
/// the marker cannot fade or jump back during a long drag. While pressed, the
/// click ring stays small at the hotspot; the release plays the click pulse
/// and then the normal idle fade.
pub(super) fn follow(scope: &str, point: Point, released: bool, revoked: Arc<AtomicBool>) {
    let Ok(mut gate) = GATE.lock() else {
        return;
    };
    let Ok((generation, _)) = gate.start(scope, revoked, Instant::now()) else {
        return;
    };
    drop(gate);
    DispatchQueue::main().exec_async(move || {
        objc2::rc::autoreleasepool(|_| {
            if paint(generation, point, Feedback::Click, 0.0).is_err() || !released {
                return;
            }
            let mut gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
            if !gate.visible(generation, Instant::now()) {
                return;
            }
            gate.expires = Some(Instant::now() + LINGER);
            drop(gate);
            schedule_feedback(generation, point, Feedback::Click);
        });
    });
}

pub(super) fn window_id() -> Option<u32> {
    let id = WINDOW_ID.load(Ordering::Acquire);
    (id != 0).then_some(id)
}

/// Keyboard activity refreshes the visible agent marker without exposing the
/// text being typed or the key being pressed in an on-screen label.
pub(super) fn activity(
    app: &AppHandle,
    scope: &str,
    revoked: Arc<AtomicBool>,
) -> Result<(), String> {
    if revoked.load(Ordering::Acquire) {
        return Err(CANCELLED.into());
    }
    let last = {
        let gate = GATE
            .lock()
            .map_err(|_| "The desktop cursor is unavailable.")?;
        (gate.owner.as_deref() == Some(scope))
            .then_some(gate.last_point)
            .flatten()
    };
    let point = match last {
        Some(point) => point,
        None => system_position()?,
    };
    move_to(app, scope, point.x, point.y, Feedback::Move, revoked)
}

/// The flag is set before dispatch, preventing pulse/fade work from showing the
/// panel while screencapture runs on a worker. Failure stops the capture caller.
pub(super) fn suspend(_app: &AppHandle) -> Result<(), String> {
    GATE.lock()
        .map_err(|_| "The desktop cursor is unavailable.")?
        .suspended = true;
    let result = on_main(Instant::now() + UI_TIMEOUT, || {
        order_out();
        Ok(())
    });
    if result.is_err() {
        clear_scope(None);
    }
    result
}

pub(super) fn resume(_app: &AppHandle) {
    let generation = {
        let mut gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
        gate.suspended = false;
        gate.generation
    };
    DispatchQueue::main().exec_async(move || {
        let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
        if !gate.visible(generation, Instant::now()) {
            return;
        }
        OVERLAY.with(|slot| {
            if let Some(overlay) = slot.borrow().as_ref() {
                overlay.panel.setAlphaValue(1.0);
                overlay.panel.orderFrontRegardless();
            }
        });
    });
}

fn hide_generation(generation: u64) {
    DispatchQueue::main().exec_async(move || {
        let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
        if gate.generation == generation && gate.owner.is_none() {
            order_out();
        }
    });
}

/// Safe under the browser-grant mutex: cancellation is immediate, and AppKit
/// cleanup is queued without waiting for UI work or in-flight input.
pub(super) fn clear_scope(scope: Option<&str>) {
    let generation = GATE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear(scope);
    if let Some(generation) = generation {
        hide_generation(generation);
    }
}

pub(super) fn hide(_app: &AppHandle) {
    let generation = GATE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear(None);
    if let Some(generation) = generation {
        let result = on_main(Instant::now() + UI_TIMEOUT, move || {
            let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
            if gate.generation == generation && gate.owner.is_none() {
                order_out();
            }
            Ok(())
        });
        if result.is_err() {
            hide_generation(generation);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_token() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn coordinate_flip_preserves_hotspot_for_all_display_origins() {
        for point in [
            Point { x: 0.0, y: 0.0 },
            Point {
                x: 1439.0,
                y: 899.0,
            },
            Point {
                x: -1600.0,
                y: -300.0,
            },
            Point {
                x: 200.5,
                y: -1000.5,
            },
        ] {
            let origin = frame_origin(point, 900.0);
            assert_eq!(origin.x + TIP_X, point.x);
            assert_eq!(900.0 - (origin.y + HEIGHT - TIP_Y), point.y);
        }
    }

    #[test]
    fn eased_motion_has_exact_endpoints_and_stays_between_them() {
        let from = Point {
            x: -500.0,
            y: 1000.0,
        };
        let to = Point {
            x: 500.0,
            y: -1000.0,
        };
        assert_eq!(
            (motion(from, to, -1.0).x, motion(from, to, -1.0).y),
            (from.x, from.y)
        );
        assert_eq!(
            (motion(from, to, 2.0).x, motion(from, to, 2.0).y),
            (to.x, to.y)
        );
        let mut last_x = from.x;
        for step in 0..=100 {
            let point = motion(from, to, step as f64 / 100.0);
            assert!((from.x..=to.x).contains(&point.x));
            assert!((to.y..=from.y).contains(&point.y));
            assert!(point.x >= last_x);
            last_x = point.x;
        }
    }

    #[test]
    fn scope_cancel_and_new_owner_invalidate_old_feedback() {
        let now = Instant::now();
        let mut gate = Gate::new();
        let (first, _) = gate.start("first", active_token(), now).unwrap();
        assert!(gate.visible(first, now));
        assert_eq!(gate.clear(Some("other")), None);
        assert!(gate.visible(first, now));
        gate.clear(Some("first"));
        assert!(!gate.visible(first, now));
        let (second, _) = gate.start("second", active_token(), now).unwrap();
        assert!(!gate.visible(first, now));
        assert!(gate.visible(second, now));
        assert_eq!(gate.clear(Some("first")), None);
        assert!(gate.visible(second, now));
    }

    #[test]
    fn screenshots_and_expiry_suppress_restoration() {
        let now = Instant::now();
        let mut gate = Gate::new();
        let (generation, _) = gate.start("task", active_token(), now).unwrap();
        gate.suspended = true;
        assert!(!gate.visible(generation, now));
        gate.suspended = false;
        assert!(gate.visible(generation, now));
        assert!(!gate.visible(generation, now + UI_TIMEOUT + TRAVEL + LINGER));
        gate.clear(None);
        gate.suspended = false;
        assert!(!gate.visible(generation, now));
    }

    #[test]
    fn cursor_positions_are_kept_only_within_the_same_scope() {
        let now = Instant::now();
        let mut gate = Gate::new();
        gate.start("first", active_token(), now).unwrap();
        gate.last_point = Some(Point { x: -200.0, y: 15.0 });
        let (_, prior) = gate.start("first", active_token(), now).unwrap();
        assert_eq!(prior.map(|point| (point.x, point.y)), Some((-200.0, 15.0)));
        assert!(gate
            .start("second", active_token(), now)
            .unwrap()
            .1
            .is_none());
    }

    #[test]
    fn revoked_session_cannot_start_after_socket_authorization() {
        let now = Instant::now();
        let mut gate = Gate::new();
        let (current, _) = gate.start("current", active_token(), now).unwrap();
        let expired = Arc::new(AtomicBool::new(true));
        assert_eq!(gate.start("revoked", expired, now).unwrap_err(), CANCELLED);
        // Rejecting a stale request must not cancel another scope's cursor.
        assert!(gate.visible(current, now));
        assert_eq!(gate.owner.as_deref(), Some("current"));
    }

    #[test]
    fn shared_revocation_invalidates_active_and_queued_visual_work() {
        let now = Instant::now();
        let mut gate = Gate::new();
        let token = active_token();
        let (generation, _) = gate.start("task", Arc::clone(&token), now).unwrap();
        assert!(gate.visible(generation, now));
        token.store(true, Ordering::Release);
        assert!(!gate.authorized(generation));
        assert!(!gate.current(generation, now));
        assert!(!gate.visible(generation, now));
        gate.suspended = true;
        gate.suspended = false;
        assert!(!gate.visible(generation, now));
    }

    #[test]
    fn failed_screenshot_hide_clear_allows_a_later_action() {
        let now = Instant::now();
        let mut gate = Gate::new();
        let (first, _) = gate.start("task", active_token(), now).unwrap();
        gate.suspended = true;
        // suspend() takes this cleanup path when its UI hide times out.
        gate.clear(None);
        assert!(!gate.suspended);
        assert!(!gate.visible(first, now));
        let (next, prior) = gate.start("task", active_token(), now).unwrap();
        assert!(prior.is_none());
        assert!(gate.visible(next, now));
    }
}
