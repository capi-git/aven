//! Non-activating native controls. Policy stays in desktop_presence; this
//! adapter only renders models and reports genuine user input.
//!
//! The bar is a pill of dark glass at the top of the screen with one row:
//! the agent that acted last, with Bot in its project's colour, its work dots
//! and what it is doing. While more agents are at work the row ends with a
//! count, and the pill opens to a row for each while it is pointed at. The
//! dots are that agent's Stop: pointed at, their middle nine light as a
//! square. Pause shows while the pill is pointed at. A question (may
//! this agent use the Mac?), a pause and a stop notice are one agent's
//! sentence with its buttons. A thin white frame sits right behind each
//! window an agent is using, so windows in front still cover it.
use super::{agent_cursor, marks, CGDisplayBounds, CGMainDisplayID};
use crate::desktop_presence::{
    self as presence, BarKind, BarModel, BarRow, ButtonAction, ButtonStyle, Dots, Faces, Mood,
};
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Allocated;
use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, sel, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSButton, NSColor, NSFont, NSPanel, NSScreen, NSStatusWindowLevel,
    NSTextField, NSView, NSVisualEffectView, NSWindowCollectionBehavior, NSWindowSharingType,
    NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::CALayer;
use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    mpsc, Mutex,
};
use std::time::{Duration, Instant};

/// One agent's row on the pill, and the pill's padding above and below.
const ROW: f64 = 30.0;
const PAD: f64 = 3.0;
/// Bot's screen on a row, which is its Stop, and the room around it to
/// press.
const SCREEN: f64 = 24.0;
const STOP_WIDTH: f64 = SCREEN + 4.0;
const STOP_HEIGHT: f64 = ROW - 6.0;
/// Where a row's name starts.
const NAME_X: f64 = 8.0 + STOP_WIDTH + 6.0;
/// A row's words get at least this much room, so they rarely cut short as
/// the agent moves from step to step.
const TEXT_MIN: f64 = 200.0;
const PILL_MAX: f64 = 600.0;
/// A one-agent sentence: Bot, a title, a detail and any further lines.
const CARD_HEIGHT: f64 = 56.0;
const CARD_SCREEN: f64 = 30.0;
const CARD_TEXT_X: f64 = 14.0 + CARD_SCREEN + 12.0;
const CARD_MIN: f64 = 320.0;
const CARD_MAX: f64 = 640.0;
/// Each further line (an upload's files) adds this much height.
const LINE_HEIGHT: f64 = 16.0;
const BUTTON_HEIGHT: f64 = 24.0;
const BUTTON_GAP: f64 = 6.0;
/// The frame sits this far outside the window it outlines.
const FRAME_OUTSET: f64 = 3.0;
const FRAME_RADIUS: f64 = 16.0;
/// How often a framed window is checked for moving.
const FRAME_TRACK: Duration = Duration::from_millis(250);

/// Text on the dark glass: primary and muted.
const INK: [f64; 3] = [0.93, 0.93, 0.94];
const MUTED: [f64; 3] = [0.63, 0.63, 0.66];
/// A prominent button's fill and its text.
const PROMINENT: [f64; 3] = [0.93, 0.93, 0.94];
const ON_PROMINENT: [f64; 3] = [0.08, 0.08, 0.09];

static WINDOW_ID: AtomicU32 = AtomicU32::new(0);
static REVISION: AtomicU64 = AtomicU64::new(0);
static FRAME_TICK: AtomicU64 = AtomicU64::new(0);
/// The frames' own window numbers: they are never agent targets and never
/// count as covering another window.
static FRAME_IDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventGetIntegerValueField(event: *const c_void, field: u32) -> i64;
    fn CGEventGetType(event: *const c_void) -> u32;
}

define_class!(
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopPresencePanel"]
    struct PresencePanel;
    unsafe impl NSObjectProtocol for PresencePanel {}
    impl PresencePanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool { false }
        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool { false }
        #[unsafe(method(avenPresenceAction:))]
        fn action(&self, sender: &NSButton) {
            // Only the user answers: a click Aven's own desktop control posted
            // (to any window of this process) never presses these buttons.
            if posted_by_aven() {
                return;
            }
            let action = BAR.with(|slot| {
                slot.try_borrow().ok().and_then(|bar| {
                    bar.as_ref().and_then(|bar| bound_action(&bar.actions, bar.button_base, sender.tag()).cloned())
                })
            });
            if let Some(action) = action {
                // Pausing or stopping a chat's use of tabs leaves desktop
                // control, and its pointer, as they are.
                let tabs_only = matches!(action, ButtonAction::PauseTabs | ButtonAction::StopTabs(_));
                let stopped = match &action {
                    ButtonAction::Stop(scope) => Some(scope.clone()),
                    _ => None,
                };
                presence::with(|state| match action {
                    ButtonAction::Pause => state.pause(presence::Pause::ByUser),
                    ButtonAction::PauseTabs => state.pause_tabs(Instant::now()),
                    ButtonAction::Resume => state.resume(),
                    ButtonAction::Stop(scope) => state.stop(&scope, Instant::now()),
                    ButtonAction::StopTabs(scope) => state.stop_tabs(&scope, Instant::now()),
                    ButtonAction::Allow(id) => { state.answer(id, true); },
                    ButtonAction::Deny(id) => { state.answer(id, false); },
                });
                if !tabs_only {
                    // Stopping one agent takes only its pointer away.
                    agent_cursor::clear_scope(stopped.as_deref());
                }
                changed();
            }
        }
    }
);

define_class!(
    /// The pill's content: Pause shows while it is pointed at.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopPresencePill"]
    struct PillView;
    unsafe impl NSObjectProtocol for PillView {}
    impl PillView {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &AnyObject) { pill_hover(true); }
        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &AnyObject) { pill_hover(false); }
    }
);

define_class!(
    /// An agent's screen on the bar, which is its Stop.
    #[unsafe(super(NSButton))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopPresenceStop"]
    struct StopButton;
    unsafe impl NSObjectProtocol for StopButton {}
    impl StopButton {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &AnyObject) { stop_hover(self, true); }
        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &AnyObject) { stop_hover(self, false); }
    }
);

/// Whether the event being handled was posted by this process (desktop
/// control marks its events and posts them as Aven). Answers by assistive
/// technology arrive without an event and are the user's.
fn posted_by_aven() -> bool {
    unsafe {
        let class = objc2::class!(NSApplication);
        let app: Option<Retained<AnyObject>> = msg_send![class, sharedApplication];
        let Some(app) = app else {
            return false;
        };
        let event: Option<Retained<AnyObject>> = msg_send![&*app, currentEvent];
        let Some(event) = event else {
            return false;
        };
        let cg: *const c_void = msg_send![&*event, CGEvent];
        !cg.is_null()
            && presence::posted_by_aven(
                CGEventGetIntegerValueField(cg, 42), // kCGEventSourceUserData
                CGEventGetIntegerValueField(cg, 41), // kCGEventSourceUnixProcessID
                i64::from(std::process::id()),
            )
    }
}

/// One agent's row as drawn, kept between renders so a new step updates its
/// words and screen in place rather than rebuilding the bar under the
/// pointer.
struct RowViews {
    button: Retained<StopButton>,
    /// The screen sits in a plain view behind its button: a button's own
    /// layer is flipped, which would turn the face upside down.
    screen_view: Retained<NSView>,
    screen: marks::Screen,
    faces: Faces,
    tone: [f64; 3],
    mode: Dots,
    hover: bool,
    name: Retained<NSTextField>,
    text: Retained<NSTextField>,
}

struct BarButtonView {
    button: Retained<NSButton>,
    width: f64,
    /// Pause shows only while the pill is pointed at.
    on_hover: bool,
}

/// What a render can update in place: the same rows (by their Stop) and the
/// same buttons. Anything else builds the bar again.
#[derive(Clone, PartialEq)]
struct Shape {
    kind: BarKind,
    stops: Vec<ButtonAction>,
    buttons: Vec<(&'static str, ButtonAction)>,
}

impl Shape {
    fn of(model: &BarModel) -> Self {
        Self {
            kind: model.kind,
            stops: model.rows.iter().map(|row| row.stop.clone()).collect(),
            buttons: model
                .buttons
                .iter()
                .map(|button| (button.label, button.action.clone()))
                .collect(),
        }
    }
}

struct Bar {
    panel: Retained<PresencePanel>,
    model: Option<BarModel>,
    shape: Option<Shape>,
    actions: Vec<ButtonAction>,
    button_base: isize,
    rows: Vec<RowViews>,
    buttons: Vec<BarButtonView>,
    /// How many more agents are at work, at the end of the one row shown
    /// while the pill is not pointed at.
    more: Option<Retained<NSTextField>>,
    /// The pill's width; it grows while its rows stay, and never shrinks
    /// under the pointer.
    width: f64,
    hovering: bool,
    reduce_motion: bool,
    anchor: Option<(f64, f64)>,
    suppressed: bool,
    monitor: Option<Monitor>,
}
struct Monitor {
    global: Retained<AnyObject>,
    local: Retained<AnyObject>,
}
impl Drop for Monitor {
    fn drop(&mut self) {
        unsafe {
            let class = objc2::class!(NSEvent);
            let _: () = msg_send![class, removeMonitor: &*self.global];
            let _: () = msg_send![class, removeMonitor: &*self.local];
        }
    }
}
thread_local! { static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) }; }

/// A frame behind the window `target`.
struct FrameWindow {
    target: u32,
    panel: Retained<NSPanel>,
}
thread_local! { static FRAMES: RefCell<Vec<FrameWindow>> = const { RefCell::new(Vec::new()) }; }

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}
fn color(rgb: [f64; 3], alpha: f64) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(rgb[0], rgb[1], rgb[2], alpha)
}
fn main_top() -> f64 {
    unsafe {
        let r = CGDisplayBounds(CGMainDisplayID());
        r.origin.y + r.size.height
    }
}
fn main<T: Send + 'static>(
    operation: impl FnOnce(MainThreadMarker) -> T + Send + 'static,
) -> Result<T, String> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Ok(operation(mtm));
    }
    let (tx, rx) = mpsc::sync_channel(1);
    DispatchQueue::main().exec_async(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = tx.send(operation(mtm));
        }
    });
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Desktop controls could not be shown. No input was sent.".into())
}

fn user_event(event: &AnyObject) {
    // The user's clicks on Pause/Resume/Allow are controls, not interference.
    unsafe {
        let window: Option<Retained<AnyObject>> = msg_send![event, window];
        if let Some(window) = window {
            let id: isize = msg_send![&*window, windowNumber];
            if id as u32 == WINDOW_ID.load(Ordering::Acquire) {
                return;
            }
        }
        let cg: *const c_void = msg_send![event, CGEvent];
        if cg.is_null() {
            return;
        }
        let kind = CGEventGetType(cg);
        #[cfg(debug_assertions)]
        {
            let window: isize = msg_send![event, windowNumber];
            let point: NSPoint = msg_send![event, locationInWindow];
            super::self_test::record_event(serde_json::json!({
                "kind":kind,
                "marked":CGEventGetIntegerValueField(cg,42)==presence::EVENT_MARKER,
                "sourcePid":CGEventGetIntegerValueField(cg,41),
                "frontmostPid":super::frontmost_pid_on_main().ok().flatten(),
                "eventWindow":window,"eventLocation":{"x":point.x,"y":point.y},
                "windowUnderPointer":CGEventGetIntegerValueField(cg,91),
                "windowHandlingEvent":CGEventGetIntegerValueField(cg,92)
            }));
        }
        let classified = presence::classify(
            kind,
            CGEventGetIntegerValueField(cg, 42), // kCGEventSourceUserData
            CGEventGetIntegerValueField(cg, 41), // kCGEventSourceUnixProcessID
            i64::from(std::process::id()),
            CGEventGetIntegerValueField(cg, 9), // keycode
            CGEventGetIntegerValueField(cg, 8) != 0,
        );
        if let Some(event) = classified {
            let effect = presence::with(|state| {
                state.user_input_in_app(
                    event,
                    Instant::now(),
                    super::frontmost_pid_on_main().ok().flatten(),
                )
            });
            if effect != presence::InputEffect::None {
                let stopped = match &effect {
                    presence::InputEffect::Stopped(scope) => Some(scope.clone()),
                    _ => None,
                };
                agent_cursor::clear_scope(stopped.as_deref());
                changed();
            }
        }
    }
}
fn monitor() -> Result<Monitor, String> {
    unsafe {
        let class = objc2::class!(NSEvent);
        // NSEvent masks: left/right/other down/up, moved/dragged, keyDown,
        // flagsChanged, scrollWheel. Observe only; never swallow user events.
        let mask: u64 = [1, 2, 3, 4, 5, 6, 7, 10, 12, 22, 25, 26, 27]
            .iter()
            .fold(0, |mask, n| mask | (1 << n));
        let global = RcBlock::new(|event: *mut AnyObject| {
            if let Some(event) = event.as_ref() {
                user_event(event);
            }
        });
        let local = RcBlock::new(|event: *mut AnyObject| -> *mut AnyObject {
            if let Some(event) = event.as_ref() {
                user_event(event);
            }
            event
        });
        let global: Option<Retained<AnyObject>> =
            msg_send![class, addGlobalMonitorForEventsMatchingMask: mask, handler: &*global];
        let global = global.ok_or("Could not observe user input. No desktop input was sent.")?;
        let local: Option<Retained<AnyObject>> =
            msg_send![class, addLocalMonitorForEventsMatchingMask: mask, handler: &*local];
        match local {
            Some(local) => Ok(Monitor { global, local }),
            None => {
                let _: () = msg_send![class, removeMonitor: &*global];
                Err("Could not observe user input. No desktop input was sent.".into())
            }
        }
    }
}

/// Pointer tracking for `view`, kept to its visible area by AppKit.
fn track(view: &NSView) {
    unsafe {
        // MouseEnteredAndExited | ActiveAlways | InVisibleRect.
        let options: usize = 0x01 | 0x80 | 0x200;
        let area: Allocated<AnyObject> = msg_send![objc2::class!(NSTrackingArea), alloc];
        let area: Retained<AnyObject> = msg_send![
            area,
            initWithRect: rect(0.0, 0.0, 0.0, 0.0),
            options: options,
            owner: view,
            userInfo: Option::<&AnyObject>::None
        ];
        let _: () = msg_send![view, addTrackingArea: &*area];
    }
}

/// Aven's dark glass, whatever the system appearance.
fn dark(panel: &NSPanel) {
    unsafe {
        let name = NSString::from_str("NSAppearanceNameDarkAqua");
        let appearance: Option<Retained<AnyObject>> =
            msg_send![objc2::class!(NSAppearance), appearanceNamed: &*name];
        if let Some(appearance) = appearance {
            let _: () = msg_send![panel, setAppearance: &*appearance];
        }
    }
}

fn label(
    mtm: MainThreadMarker,
    text: &str,
    size: f64,
    weight: f64,
    ink: [f64; 3],
) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    label.setFont(Some(&NSFont::systemFontOfSize_weight(size, weight)));
    label.setTextColor(Some(&color(ink, 1.0)));
    unsafe {
        let _: () = msg_send![&*label, setLineBreakMode: 4_usize]; // truncate the end
    }
    label.sizeToFit();
    label
}

fn text_width(label: &NSTextField) -> f64 {
    label.sizeToFit();
    label.frame().size.width.ceil()
}

/// A button drawn on the glass: a quiet fill, or a light one for the answer
/// the bar expects (Allow, Resume).
fn bar_button(
    mtm: MainThreadMarker,
    panel: &PresencePanel,
    title: &str,
    style: ButtonStyle,
    tag: isize,
) -> (Retained<NSButton>, f64) {
    let button = NSButton::initWithFrame(NSButton::alloc(mtm), rect(0.0, 0.0, 60.0, BUTTON_HEIGHT));
    button.setBordered(false);
    button.setTitle(&NSString::from_str(title));
    button.setTag(tag);
    let prominent = style == ButtonStyle::Prominent;
    button.setFont(Some(&NSFont::systemFontOfSize_weight(
        12.0,
        if prominent { 0.23 } else { 0.0 },
    )));
    button.setContentTintColor(Some(&color(
        if prominent { ON_PROMINENT } else { INK },
        1.0,
    )));
    unsafe {
        button.setTarget(Some(panel));
        button.setAction(Some(sel!(avenPresenceAction:)));
    }
    button.setWantsLayer(true);
    if let Some(layer) = button.layer() {
        layer.setCornerRadius(6.0);
        let fill = if prominent {
            color(PROMINENT, 1.0)
        } else {
            color([1.0; 3], 0.10)
        };
        layer.setBackgroundColor(Some(&fill.CGColor()));
    }
    // The title's own width, plus room on both sides.
    let measure = label(mtm, title, 12.0, if prominent { 0.23 } else { 0.0 }, INK);
    let width = (text_width(&measure) + 22.0).max(56.0);
    (button, width)
}

/// Hosts a Core Animation layer (Bot) as a view.
fn host(mtm: MainThreadMarker, layer: &CALayer, frame: NSRect) -> Retained<NSView> {
    let view = NSView::initWithFrame(NSView::alloc(mtm), frame);
    view.setWantsLayer(true);
    if let Some(root) = view.layer() {
        root.addSublayer(layer);
    }
    view
}

fn glass(mtm: MainThreadMarker, content: &NSView, width: f64, height: f64, radius: f64) {
    content.setWantsLayer(true);
    if let Some(layer) = content.layer() {
        layer.setCornerRadius(radius);
        layer.setMasksToBounds(true);
        layer.setBorderWidth(0.5);
        layer.setBorderColor(Some(&color([1.0; 3], 0.12).CGColor()));
    }
    let blur = NSVisualEffectView::initWithFrame(
        NSVisualEffectView::alloc(mtm),
        rect(0.0, 0.0, width, height),
    );
    unsafe {
        let _: () = msg_send![&*blur, setMaterial: 13_isize]; // HUDWindow
        let _: () = msg_send![&*blur, setBlendingMode: 0_isize]; // behind window
        let _: () = msg_send![&*blur, setState: 1_isize]; // active
        let _: () = msg_send![&*blur, setAutoresizingMask: 18_usize]; // width and height
    }
    content.addSubview(&blur);
    // Nearly solid, so words behind never show through even without blur.
    let solid = NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    let tint = NSView::initWithFrame(NSView::alloc(mtm), rect(0.0, 0.0, width, height));
    tint.setWantsLayer(true);
    unsafe {
        let _: () = msg_send![&*tint, setAutoresizingMask: 18_usize];
    }
    if let Some(layer) = tint.layer() {
        layer.setBackgroundColor(Some(
            &color([0.086, 0.086, 0.094], if solid { 1.0 } else { 0.62 }).CGColor(),
        ));
    }
    content.addSubview(&tint);
}

impl Bar {
    fn new(mtm: MainThreadMarker) -> Self {
        let panel: Retained<PresencePanel> = unsafe {
            msg_send![PresencePanel::alloc(mtm), initWithContentRect: rect(0.0,0.0,CARD_MIN,CARD_HEIGHT), styleMask: NSWindowStyleMask::NonactivatingPanel, backing: NSBackingStoreType::Buffered, defer: false]
        };
        unsafe {
            panel.setReleasedWhenClosed(false);
        }
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(true);
        panel.setHidesOnDeactivate(false);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setLevel(NSStatusWindowLevel);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        dark(&panel);
        let sharing = NSWindowSharingType::None;
        #[cfg(debug_assertions)]
        let sharing = if preview_enabled() {
            NSWindowSharingType::ReadOnly
        } else {
            sharing
        };
        panel.setSharingType(sharing);
        WINDOW_ID.store(panel.windowNumber() as u32, Ordering::Release);
        Self {
            panel,
            model: None,
            shape: None,
            actions: vec![],
            button_base: 0,
            rows: vec![],
            buttons: vec![],
            more: None,
            width: 0.0,
            hovering: false,
            reduce_motion: false,
            anchor: None,
            suppressed: false,
            monitor: None,
        }
    }

    fn hide(&mut self) {
        if self.model.is_some()
            && !NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
        {
            unsafe {
                let animator: Retained<AnyObject> = msg_send![&*self.panel, animator];
                let _: () = msg_send![&*animator, setAlphaValue: 0.0_f64];
            }
            let _ = DispatchQueue::main().after(
                DispatchTime::try_from(Duration::from_millis(300)).expect("fixed delay"),
                || {
                    BAR.with(|slot| {
                        if let Ok(slot) = slot.try_borrow() {
                            if let Some(bar) = slot.as_ref().filter(|bar| bar.model.is_none()) {
                                bar.panel.orderOut(None);
                            }
                        }
                    });
                },
            );
        } else {
            self.panel.orderOut(None);
        }
        self.model = None;
        self.shape = None;
        self.rows.clear();
        self.buttons.clear();
        self.more = None;
        self.hovering = false;
        self.monitor = None;
    }

    fn render(&mut self, mtm: MainThreadMarker, model: Option<BarModel>) {
        let Some(model) = model else {
            self.hide();
            return;
        };
        self.reduce_motion =
            NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion();
        let shape = Shape::of(&model);
        let size = if model.kind == BarKind::Acting {
            if self.shape.as_ref() != Some(&shape) {
                self.build_pill(mtm, &model);
            }
            self.update_pill(&model.rows)
        } else if self.model.as_ref() != Some(&model) {
            self.build_card(mtm, &model)
        } else {
            self.panel.frame().size
        };
        self.shape = Some(shape);
        self.model = Some(model);
        if !self.place(mtm, size) {
            return;
        }
        if !self.suppressed {
            if !self.panel.isVisible()
                && !NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
            {
                self.panel.setAlphaValue(0.0);
                self.panel.orderFrontRegardless();
                unsafe {
                    let animator: Retained<AnyObject> = msg_send![&*self.panel, animator];
                    let _: () = msg_send![&*animator,setAlphaValue:1.0_f64];
                }
            } else {
                self.panel.setAlphaValue(1.0);
                self.panel.orderFrontRegardless();
            }
        }
    }

    /// Puts the bar on the screen the agent is using, clear of its target.
    fn place(&mut self, mtm: MainThreadMarker, size: NSSize) -> bool {
        let main_top = main_top();
        let screens = NSScreen::screens(mtm);
        let screen = screens
            .iter()
            .find(|screen| {
                self.anchor.is_some_and(|(x, y)| {
                    let f = screen.frame();
                    x >= f.origin.x
                        && x <= f.origin.x + f.size.width
                        && main_top - y >= f.origin.y
                        && main_top - y <= f.origin.y + f.size.height
                })
            })
            .or_else(|| screens.firstObject());
        let Some(screen) = screen else {
            return false;
        };
        let visible = screen.visibleFrame();
        let area = presence::Frame {
            x: visible.origin.x,
            y: main_top - visible.origin.y - visible.size.height,
            width: visible.size.width,
            height: visible.size.height,
        };
        let avoid = self.anchor.into_iter().collect::<Vec<_>>();
        // A pill is placed as its one row at rest. Open, it hangs from that
        // row (or stands on it, at the bottom of the screen), so pointing
        // at it never moves it from under the pointer.
        let rest = if self.rows.is_empty() {
            size.height
        } else {
            ROW + PAD * 2.0
        };
        let Some((frame, bottom)) = presence::place_bar(area, size.width, rest, false, &avoid)
        else {
            self.panel.orderOut(None);
            return false;
        };
        let y = if bottom {
            frame.y + frame.height - size.height
        } else {
            frame.y
        };
        self.panel.setFrame_display(
            rect(
                frame.x,
                main_top - y - size.height,
                frame.width,
                size.height,
            ),
            true,
        );
        true
    }

    fn content(
        &self,
        mtm: MainThreadMarker,
        width: f64,
        height: f64,
        radius: f64,
        pill: bool,
    ) -> Retained<NSView> {
        let content: Retained<NSView> = if pill {
            let view = PillView::alloc(mtm).set_ivars(());
            let view: Retained<PillView> =
                unsafe { msg_send![super(view), initWithFrame: rect(0.0, 0.0, width, height)] };
            track(&view);
            Retained::into_super(view)
        } else {
            NSView::initWithFrame(NSView::alloc(mtm), rect(0.0, 0.0, width, height))
        };
        glass(mtm, &content, width, height, radius);
        content
    }

    fn next_base(&mut self) -> isize {
        self.button_base = self.button_base.checked_add(64).unwrap_or(64);
        self.button_base
    }

    /// A pill with a row per agent, of which only the first shows until the
    /// pill is pointed at: the views are made here; `update_pill` fills and
    /// lays them out.
    fn build_pill(&mut self, mtm: MainThreadMarker, model: &BarModel) {
        let base = self.next_base();
        self.actions = model
            .buttons
            .iter()
            .map(|button| button.action.clone())
            .chain(model.rows.iter().map(|row| row.stop.clone()))
            .collect();
        self.rows.clear();
        self.buttons.clear();
        self.width = 0.0;
        let content = self.content(mtm, 1.0, 1.0, 1.0, true);
        self.more = presence::others_label(model.rows.len()).map(|count| {
            let count = label(mtm, &count, 12.5, 0.0, MUTED);
            content.addSubview(&count);
            count
        });
        for (index, button) in model.buttons.iter().enumerate() {
            let (view, width) = bar_button(
                mtm,
                &self.panel,
                button.label,
                button.style,
                base + index as isize,
            );
            let on_hover = matches!(button.action, ButtonAction::Pause | ButtonAction::PauseTabs);
            if on_hover {
                view.setAlphaValue(if self.hovering { 1.0 } else { 0.0 });
            }
            content.addSubview(&view);
            self.buttons.push(BarButtonView {
                button: view,
                width,
                on_hover,
            });
        }
        for (index, row) in model.rows.iter().enumerate() {
            let mut screen = marks::Screen::new(SCREEN);
            screen.show(
                &row.faces,
                row.dots.mood(),
                row.tone,
                false,
                self.reduce_motion,
            );
            screen.layer().setFrame(rect(
                (STOP_WIDTH - SCREEN) / 2.0,
                (STOP_HEIGHT - marks::screen_height(SCREEN)) / 2.0,
                SCREEN,
                marks::screen_height(SCREEN),
            ));
            let screen_view = host(mtm, screen.layer(), rect(0.0, 0.0, STOP_WIDTH, STOP_HEIGHT));
            content.addSubview(&screen_view);
            let button = StopButton::alloc(mtm).set_ivars(());
            let button: Retained<StopButton> = unsafe {
                msg_send![super(button), initWithFrame: rect(0.0, 0.0, STOP_WIDTH, STOP_HEIGHT)]
            };
            button.setBordered(false);
            button.setTitle(&NSString::new());
            button.setTag(base + (model.buttons.len() + index) as isize);
            unsafe {
                button.setTarget(Some(&self.panel));
                button.setAction(Some(sel!(avenPresenceAction:)));
                let tip = NSString::from_str(&format!("Stop {}", row.name));
                let _: () = msg_send![&*button, setToolTip: &*tip];
                let _: () = msg_send![&*button, setAccessibilityLabel: &*tip];
            }
            track(&button);
            content.addSubview(&button);
            let name = label(mtm, &row.name, 13.0, 0.23, INK);
            let text = label(mtm, &row.text, 12.5, 0.0, MUTED);
            content.addSubview(&name);
            content.addSubview(&text);
            self.rows.push(RowViews {
                button,
                screen_view,
                screen,
                faces: row.faces,
                tone: row.tone,
                mode: row.dots,
                hover: false,
                name,
                text,
            });
        }
        self.panel.setContentView(Some(&content));
    }

    /// Fills the rows with their agents' words, screens and colours, and
    /// lays out the pill: its first row and the count of the others, or
    /// every row while it is pointed at. Returns its size.
    fn update_pill(&mut self, rows: &[BarRow]) -> NSSize {
        let mut words: f64 = TEXT_MIN;
        let mut names: f64 = 0.0;
        for (view, row) in self.rows.iter_mut().zip(rows) {
            view.name.setStringValue(&NSString::from_str(&row.name));
            view.text.setStringValue(&NSString::from_str(&row.text));
            names = names.max(text_width(&view.name));
            words = words.max(text_width(&view.text));
            view.tone = row.tone;
            view.faces = row.faces;
            view.mode = row.dots;
            view.screen.show(
                &view.faces,
                view.mode.mood(),
                view.tone,
                view.hover,
                self.reduce_motion,
            );
        }
        let buttons: f64 = self
            .buttons
            .iter()
            .map(|button| button.width + BUTTON_GAP)
            .sum();
        // The count takes Pause's place while the pill is not pointed at;
        // a button that always shows (Resume) keeps its own.
        let count = self.more.as_ref().map_or(0.0, |more| text_width(more));
        let fades = self.buttons.iter().all(|button| button.on_hover);
        let tail = if fades {
            buttons.max(count + 6.0)
        } else {
            buttons + count + 8.0
        };
        let needed = NAME_X + names + 5.0 + words + 12.0 + tail + 6.0;
        self.width = self.width.max(needed).min(PILL_MAX);
        let width = self.width;
        let open = self.hovering || self.rows.len() < 2;
        let shown = if open { self.rows.len() } else { 1 };
        // The other rows lie below the pill's edge until it opens: out of
        // sight, and still there for VoiceOver.
        let height = ROW * shown as f64 + PAD * 2.0;
        let radius = if shown == 1 { height / 2.0 } else { 16.0 };
        if let Some(content) = self.panel.contentView() {
            content.setFrame(rect(0.0, 0.0, width, height));
            if let Some(layer) = content.layer() {
                layer.setCornerRadius(radius);
            }
        }
        let mut x = width - 6.0;
        for button in self.buttons.iter().rev() {
            x -= button.width;
            let top = height - PAD - ROW / 2.0;
            button.button.setFrame(rect(
                x,
                top - BUTTON_HEIGHT / 2.0,
                button.width,
                BUTTON_HEIGHT,
            ));
            x -= BUTTON_GAP;
        }
        let buttons_left = x;
        let mut first_right = buttons_left - 6.0;
        if let Some(more) = &self.more {
            more.setHidden(open);
            if !open {
                let right = if fades { width - 12.0 } else { first_right };
                let count_height = more.frame().size.height;
                more.setFrame(rect(
                    right - count,
                    height - PAD - ROW / 2.0 - count_height / 2.0,
                    count,
                    count_height,
                ));
                first_right = first_right.min(right - count - 8.0);
            }
        }
        for (index, view) in self.rows.iter().enumerate() {
            let middle = height - PAD - ROW * (index as f64 + 0.5);
            let stop = rect(8.0, middle - STOP_HEIGHT / 2.0, STOP_WIDTH, STOP_HEIGHT);
            view.screen_view.setFrame(stop);
            view.button.setFrame(stop);
            let name_width = text_width(&view.name);
            let name_height = view.name.frame().size.height;
            view.name.setFrame(rect(
                NAME_X,
                middle - name_height / 2.0,
                name_width,
                name_height,
            ));
            let text_x = NAME_X + name_width + 5.0;
            let right = if index == 0 {
                first_right
            } else {
                width - 12.0
            };
            let text_height = view.text.frame().size.height;
            view.text.setFrame(rect(
                text_x,
                middle - text_height / 2.0,
                (right - text_x).max(0.0),
                text_height,
            ));
        }
        NSSize::new(width, height)
    }

    /// One agent's sentence with its buttons: a question, a pause or a
    /// stop notice. Returns its size.
    fn build_card(&mut self, mtm: MainThreadMarker, model: &BarModel) -> NSSize {
        let base = self.next_base();
        self.actions = model
            .buttons
            .iter()
            .map(|button| button.action.clone())
            .collect();
        self.rows.clear();
        self.buttons.clear();
        self.more = None;
        self.width = 0.0;
        let title = label(mtm, &model.title, 13.0, 0.23, INK);
        let detail = label(mtm, &model.detail, 11.5, 0.0, MUTED);
        let lines: Vec<Retained<NSTextField>> = model
            .lines
            .iter()
            .map(|line| {
                let line = label(mtm, line, 11.0, 0.0, MUTED);
                unsafe {
                    // Long folders lose their middle; the name at the start stays.
                    let _: () = msg_send![&*line, setLineBreakMode: 5_usize];
                }
                line
            })
            .collect();
        let buttons: Vec<(Retained<NSButton>, f64)> = model
            .buttons
            .iter()
            .enumerate()
            .map(|(index, button)| {
                bar_button(
                    mtm,
                    &self.panel,
                    button.label,
                    button.style,
                    base + index as isize,
                )
            })
            .collect();
        let buttons_width: f64 = buttons.iter().map(|(_, width)| width + BUTTON_GAP).sum();
        let words = lines
            .iter()
            .map(|line| text_width(line))
            .fold(text_width(&title).max(text_width(&detail)), f64::max);
        let width = (CARD_TEXT_X + words + 18.0 + buttons_width + 8.0).clamp(CARD_MIN, CARD_MAX);
        let height = CARD_HEIGHT + LINE_HEIGHT * lines.len() as f64;
        let content = self.content(mtm, width, height, 14.0, false);
        let middle = height - 28.0;
        // Asking needs you; a pause holds it up; a stop leaves it still.
        let mood = match model.kind {
            BarKind::Consent => Mood::Needs,
            BarKind::Paused => Mood::Watching,
            BarKind::Stopped | BarKind::Acting => Mood::Still,
        };
        let mut screen = marks::Screen::new(CARD_SCREEN);
        screen.show(&model.faces, mood, model.tone, false, self.reduce_motion);
        let screen_height = marks::screen_height(CARD_SCREEN);
        content.addSubview(&host(
            mtm,
            screen.layer(),
            rect(
                14.0,
                middle - screen_height / 2.0,
                CARD_SCREEN,
                screen_height,
            ),
        ));
        let text_right = width - 12.0 - buttons_width - 6.0;
        let text_width = (text_right - CARD_TEXT_X).max(40.0);
        title.setFrame(rect(CARD_TEXT_X, middle + 1.0, text_width, 17.0));
        detail.setFrame(rect(CARD_TEXT_X, middle - 16.0, text_width, 15.0));
        content.addSubview(&title);
        content.addSubview(&detail);
        for (index, line) in lines.iter().enumerate() {
            line.setFrame(rect(
                CARD_TEXT_X,
                middle - 16.0 - LINE_HEIGHT * (index + 1) as f64,
                width - CARD_TEXT_X - 14.0,
                15.0,
            ));
            content.addSubview(line);
        }
        let mut x = width - 12.0;
        for (button, button_width) in buttons.iter().rev() {
            x -= button_width;
            button.setFrame(rect(
                x,
                middle - BUTTON_HEIGHT / 2.0,
                *button_width,
                BUTTON_HEIGHT,
            ));
            content.addSubview(button);
            x -= BUTTON_GAP;
        }
        self.panel.setContentView(Some(&content));
        NSSize::new(width, height)
    }
}

fn pill_hover(inside: bool) {
    BAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        let Some(bar) = slot.as_mut() else {
            return;
        };
        bar.hovering = inside;
        for button in bar.buttons.iter().filter(|button| button.on_hover) {
            unsafe {
                let animator: Retained<AnyObject> = msg_send![&*button.button, animator];
                let _: () =
                    msg_send![&*animator, setAlphaValue: if inside { 1.0_f64 } else { 0.0_f64 }];
            }
        }
        // More agents than the one row: the pill opens to a row for each,
        // and closes again once the pointer leaves.
        if bar.rows.len() > 1 {
            let rows = bar.model.as_ref().map(|model| model.rows.clone());
            if let (Some(rows), Some(mtm)) = (rows, MainThreadMarker::new()) {
                let size = bar.update_pill(&rows);
                bar.place(mtm, size);
            }
        }
    });
}

fn stop_hover(button: &StopButton, inside: bool) {
    BAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        let Some(bar) = slot.as_mut() else {
            return;
        };
        let reduce_motion = bar.reduce_motion;
        if let Some(row) = bar
            .rows
            .iter_mut()
            .find(|row| std::ptr::eq(&*row.button, button))
        {
            row.hover = inside;
            row.screen
                .show(&row.faces, row.mode.mood(), row.tone, inside, reduce_motion);
        }
    });
}

/// Shows a frame behind each window in `frames` and removes the rest.
fn sync_frames(mtm: MainThreadMarker, frames: &[(u32, presence::Frame)]) {
    let top = main_top();
    FRAMES.with(|slot| {
        let Ok(mut shown) = slot.try_borrow_mut() else {
            return;
        };
        shown.retain(|frame| {
            let keep = frames.iter().any(|(id, _)| *id == frame.target);
            if !keep {
                frame.panel.orderOut(None);
            }
            keep
        });
        for (target, bounds) in frames {
            let index = match shown.iter().position(|frame| frame.target == *target) {
                Some(index) => index,
                None => {
                    shown.push(FrameWindow {
                        target: *target,
                        panel: frame_panel(mtm),
                    });
                    shown.len() - 1
                }
            };
            let panel = &shown[index].panel;
            panel.setFrame_display(
                rect(
                    bounds.x - FRAME_OUTSET,
                    top - bounds.y - bounds.height - FRAME_OUTSET,
                    bounds.width + FRAME_OUTSET * 2.0,
                    bounds.height + FRAME_OUTSET * 2.0,
                ),
                false,
            );
            // Right behind its window: whatever covers the window covers it.
            unsafe {
                let _: () =
                    msg_send![&**panel, orderWindow: -1_isize, relativeTo: *target as isize];
            }
        }
        let mut ids = FRAME_IDS.lock().unwrap_or_else(|error| error.into_inner());
        *ids = shown
            .iter()
            .filter_map(|frame| u32::try_from(frame.panel.windowNumber()).ok())
            .collect();
    });
    if !frames.is_empty() {
        track_frames();
    }
}

fn frame_panel(mtm: MainThreadMarker) -> Retained<NSPanel> {
    let panel: Retained<NSPanel> = unsafe {
        msg_send![NSPanel::alloc(mtm), initWithContentRect: rect(0.0, 0.0, 10.0, 10.0), styleMask: NSWindowStyleMask::NonactivatingPanel | NSWindowStyleMask::Borderless, backing: NSBackingStoreType::Buffered, defer: false]
    };
    unsafe {
        panel.setReleasedWhenClosed(false);
    }
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::IgnoresCycle | NSWindowCollectionBehavior::Transient,
    );
    // Never in an agent's screenshot, never a target.
    panel.setSharingType(NSWindowSharingType::None);
    let view = NSView::initWithFrame(NSView::alloc(mtm), rect(0.0, 0.0, 10.0, 10.0));
    view.setWantsLayer(true);
    unsafe {
        let _: () = msg_send![&*view, setAutoresizingMask: 18_usize];
    }
    if let Some(layer) = view.layer() {
        // White, with a faint dark edge outside so it shows on light windows.
        layer.setCornerRadius(FRAME_RADIUS);
        layer.setBorderWidth(0.5);
        layer.setBorderColor(Some(&color([0.0; 3], 0.35).CGColor()));
        let ring = CALayer::new();
        ring.setCornerRadius(FRAME_RADIUS - 0.5);
        ring.setBorderWidth(1.5);
        ring.setBorderColor(Some(&color([1.0; 3], 0.85).CGColor()));
        ring.setAutoresizingMask(
            objc2_quartz_core::CAAutoresizingMask::LayerWidthSizable
                | objc2_quartz_core::CAAutoresizingMask::LayerHeightSizable,
        );
        ring.setFrame(rect(0.5, 0.5, 9.0, 9.0));
        layer.addSublayer(&ring);
    }
    panel.setContentView(Some(&view));
    panel
}

/// While frames show, follows their windows as the user moves them.
fn track_frames() {
    let tick = FRAME_TICK.fetch_add(1, Ordering::AcqRel) + 1;
    let Ok(when) = DispatchTime::try_from(FRAME_TRACK) else {
        return;
    };
    let _ = DispatchQueue::main().after(when, move || {
        if FRAME_TICK.load(Ordering::Acquire) != tick {
            return;
        }
        let targets: Vec<u32> = FRAMES.with(|slot| {
            slot.try_borrow()
                .map(|shown| shown.iter().map(|frame| frame.target).collect())
                .unwrap_or_default()
        });
        if targets.is_empty() {
            return;
        }
        let mut moved = false;
        for target in targets {
            if let Ok(bounds) = super::window_bounds(target) {
                let frame = presence::Frame {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                };
                moved |= presence::with(|state| state.move_window(target, frame));
            }
        }
        match MainThreadMarker::new() {
            Some(mtm) if moved => refresh(mtm),
            _ => track_frames(),
        }
    });
}

fn refresh(mtm: MainThreadMarker) {
    let now = Instant::now();
    let (model, next, frames) =
        presence::with(|state| (state.model(now), state.next_refresh(now), state.frames(now)));
    BAR.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        if slot.is_none() && model.is_none() {
            return;
        }
        slot.get_or_insert_with(|| Bar::new(mtm)).render(mtm, model);
    });
    sync_frames(mtm, &frames);
    let revision = REVISION.fetch_add(1, Ordering::AcqRel) + 1;
    if let Some(delay) = next {
        let _ = DispatchQueue::main().after(
            DispatchTime::try_from(delay).expect("bounded presence delay"),
            move || {
                if REVISION.load(Ordering::Acquire) == revision {
                    if let Some(mtm) = MainThreadMarker::new() {
                        refresh(mtm);
                    }
                }
            },
        );
    }
}
pub(super) fn show(anchor: Option<(f64, f64)>, input: bool) -> Result<(), String> {
    main(move |mtm| {
        BAR.with(|slot| {
            let mut slot = slot
                .try_borrow_mut()
                .map_err(|_| "Desktop controls are busy. No input was sent.".to_owned())?;
            let bar = slot.get_or_insert_with(|| Bar::new(mtm));
            bar.anchor = anchor;
            if input && bar.monitor.is_none() {
                bar.monitor = Some(monitor()?);
            }
            Ok::<_, String>(())
        })?;
        refresh(mtm);
        Ok(())
    })?
}
pub(super) fn changed() {
    DispatchQueue::main().exec_async(|| {
        if let Some(mtm) = MainThreadMarker::new() {
            refresh(mtm);
        }
    });
}
pub(super) fn shutdown() {
    REVISION.fetch_add(1, Ordering::AcqRel);
    FRAME_TICK.fetch_add(1, Ordering::AcqRel);
    let _ = main(|mtm| {
        BAR.with(|slot| {
            if let Ok(mut slot) = slot.try_borrow_mut() {
                if let Some(bar) = slot.take() {
                    bar.panel.orderOut(None);
                }
            }
            WINDOW_ID.store(0, Ordering::Release);
        });
        sync_frames(mtm, &[]);
    });
}
pub(super) fn suppress(hidden: bool) -> Result<(), String> {
    main(move |mtm| {
        BAR.with(|slot| {
            if let Ok(mut slot) = slot.try_borrow_mut() {
                if let Some(bar) = slot.as_mut() {
                    bar.suppressed = hidden;
                    if hidden {
                        bar.panel.orderOut(None);
                    }
                }
            }
        });
        if !hidden {
            refresh(mtm);
        }
    })
}
pub(super) fn window_id() -> Option<u32> {
    let id = WINDOW_ID.load(Ordering::Acquire);
    (id != 0).then_some(id)
}
/// Whether `id` is one of the frames drawn behind agents' windows.
pub(super) fn is_frame(id: u32) -> bool {
    FRAME_IDS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(&id)
}
/// Whether `id` is the bar or a frame: drawings of desktop control, never
/// windows an agent may read or act in.
pub(super) fn is_overlay(id: u32) -> bool {
    window_id() == Some(id) || is_frame(id)
}
#[cfg(debug_assertions)]
fn preview_enabled() -> bool {
    std::env::var("AVEN_DEV_PRESENCE_PREVIEW").as_deref() == Ok("1")
}
/// Dev preview only: a question, then two agents at once, then a pause.
/// Nothing is sent to any app.
#[cfg(debug_assertions)]
pub(super) fn preview() {
    use presence::Step;
    std::thread::sleep(Duration::from_secs(4));
    let scopes = [
        (
            "aven-dev-presence-preview",
            "claude",
            "purple",
            Step::Clicking,
        ),
        ("aven-dev-presence-preview-2", "codex", "teal", Step::Typing),
    ];
    for (scope, harness, tone, _) in scopes {
        presence::with(|state| {
            state.bind(
                scope,
                Some(presence::resolve_actor(&presence::ActorInput {
                    harness: Some(harness.into()),
                    title: Some("Desktop control preview · no input".into()),
                    tone: Some(tone.into()),
                    faces: None,
                })),
            )
        });
    }
    let app = presence::AppIdentity::new("aven-dev-preview", "Aven Dev");
    let id = presence::with(|state| {
        state.admit(scopes[0].0, true, Some(&app), true, true, Instant::now())
    });
    let _ = show(None, false);
    std::thread::sleep(Duration::from_secs(12));
    if let presence::Admission::Ask(id) = id {
        presence::with(|state| {
            state.answer(id, true);
            state.take_outcome(id, Instant::now());
        });
    }
    let tickets: Vec<_> = scopes
        .iter()
        .map(|(scope, _, _, step)| {
            presence::with(|state| {
                state.begin(scope, *step, Some("Aven Dev".into()), Instant::now())
            })
        })
        .collect();
    // Exercise the actual native interruption monitor without posting input.
    let _ = show(None, true);
    std::thread::sleep(Duration::from_secs(30));
    presence::with(|state| {
        for ticket in &tickets {
            state.end(ticket, Instant::now());
        }
    });
    changed();
    std::thread::sleep(Duration::from_secs(20));
    presence::with(|state| state.pause(presence::Pause::ByUser));
    changed();
    std::thread::sleep(Duration::from_secs(12));
    presence::with(|state| state.forget(None));
    changed();
}

/// Dev builds only: draws the bar's states into PNG files, off screen,
/// over a green like the user's wallpaper. The views are made exactly as on
/// screen; only the blur behind the glass is missing.
#[cfg(debug_assertions)]
pub(super) fn snapshot(folder: &std::path::Path) -> Result<(), String> {
    use presence::{ActorInput, Presence, Step};
    let mtm = MainThreadMarker::new().ok_or("Run the snapshot on the main thread.")?;
    let now = Instant::now();
    let bind = |state: &mut Presence, scope: &str, harness: &str, tone: &str, title: &str| {
        state.bind(
            scope,
            Some(presence::resolve_actor(&ActorInput {
                harness: Some(harness.into()),
                title: Some(title.into()),
                tone: Some(tone.into()),
                faces: None,
            })),
        );
    };
    let mut cases: Vec<(&str, BarModel, bool)> = Vec::new();
    let mut state = Presence::default();
    bind(&mut state, "a", "claude", "purple", "Export the report");
    bind(&mut state, "b", "codex", "teal", "Check the app");
    let app = presence::AppIdentity::new("com.apple.iWork.Pages:1", "Pages");
    if let presence::Admission::Ask(id) = state.admit("a", true, Some(&app), true, true, now) {
        cases.push(("bar-ask", state.model(now).ok_or("no prompt")?, false));
        state.answer(id, true);
        state.take_outcome(id, now);
    }
    let a = state.begin("a", Step::Clicking, Some("Pages".into()), now);
    state.set_element(&a, Some("Next\u{2026}".into()));
    cases.push(("bar-one", state.model(now).ok_or("no bar")?, false));
    cases.push(("bar-one-pointed", state.model(now).ok_or("no bar")?, true));
    let b = state.begin("b", Step::Typing, Some("Simulator".into()), now);
    state.set_element(&b, Some("Search".into()));
    cases.push(("bar-two", state.model(now).ok_or("no bar")?, false));
    cases.push(("bar-two-pointed", state.model(now).ok_or("no bar")?, true));
    state.end(&a, now);
    state.end(&b, now);
    cases.push(("bar-thinking", state.model(now).ok_or("no bar")?, false));
    state.pause(presence::Pause::ByUser);
    cases.push(("bar-paused", state.model(now).ok_or("no bar")?, false));
    state.resume();
    state.stop("a", now);
    cases.push(("bar-stopped", state.model(now).ok_or("no bar")?, false));
    for (name, model, pointed) in cases {
        let mut bar = Bar::new(mtm);
        bar.reduce_motion = true; // a still picture of each mode
        bar.hovering = pointed;
        let size = if model.kind == BarKind::Acting {
            bar.build_pill(mtm, &model);
            bar.update_pill(&model.rows)
        } else {
            bar.build_card(mtm, &model)
        };
        // One agent's bar is pointed at on its Stop; several agents' is open.
        if pointed && bar.rows.len() == 1 {
            if let Some(row) = bar.rows.first_mut() {
                row.hover = true;
                row.screen
                    .show(&row.faces, row.mode.mood(), row.tone, true, true);
            }
        }
        // Fully transparent and far off screen: AppKit assembles the
        // layers only for a window taking part in drawing.
        bar.panel.setAlphaValue(0.0);
        bar.panel
            .setFrame_display(rect(-30_000.0, -30_000.0, size.width, size.height), false);
        bar.panel.orderFrontRegardless();
        let content = bar.panel.contentView().ok_or("no content")?;
        content.setFrame(rect(0.0, 0.0, size.width, size.height));
        content.layoutSubtreeIfNeeded();
        bar.panel.display();
        objc2_quartz_core::CATransaction::flush();
        let layer = content.layer().ok_or("no layer")?;
        let written = marks::write_png(
            &layer,
            size,
            [0.17, 0.23, 0.19],
            &folder.join(format!("{name}.png")),
        );
        bar.panel.orderOut(None);
        bar.panel.close();
        written?;
    }
    Ok(())
}

pub(super) fn covers(point: super::Point) -> Result<bool, String> {
    main(move |_| {
        BAR.with(|slot| {
            slot.try_borrow().ok().is_some_and(|slot| {
                slot.as_ref().is_some_and(|bar| {
                    if !bar.panel.isVisible() {
                        return false;
                    }
                    let f = bar.panel.frame();
                    let top = main_top();
                    point.x >= f.origin.x
                        && point.x < f.origin.x + f.size.width
                        && top - point.y >= f.origin.y
                        && top - point.y < f.origin.y + f.size.height
                })
            })
        })
    })
}

pub(super) fn frontmost_pid() -> Result<Option<i32>, String> {
    main(|_| unsafe { super::frontmost_pid_on_main() })?
}

// A mouse-up queued for an old Stop button must never become Allow on a newly
// rendered consent prompt. Native senders carry the binding generation.
fn bound_action(actions: &[ButtonAction], base: isize, tag: isize) -> Option<&ButtonAction> {
    actions.get(usize::try_from(tag.checked_sub(base)?).ok()?)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_control_events_cannot_authorize_a_new_prompt() {
        let prompt = [ButtonAction::Deny(2), ButtonAction::Allow(2)];
        assert_eq!(bound_action(&prompt, 16, 9), None);
        assert_eq!(bound_action(&prompt, 16, 16), Some(&ButtonAction::Deny(2)));
        assert_eq!(bound_action(&prompt, 16, 17), Some(&ButtonAction::Allow(2)));
        assert_eq!(bound_action(&prompt, 16, isize::MIN), None);
    }
}
