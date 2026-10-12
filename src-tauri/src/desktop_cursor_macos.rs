//! A visible agent marker. This is a Core Animation drawing, not a second
//! input device: a soft ring in the acting agent's colour with a small name
//! tag, so it reads as "an agent is working here" rather than a system arrow.
//!
//! Objective-C objects stay on the main thread; workers only exchange points,
//! deadlines and generations. Stale work can never bring a revoked cursor back.
//! Motion is driven by a display link only while something is changing; an
//! idle or hidden marker runs no timers and does no work.
use super::{CGDisplayBounds, CGMainDisplayID, OwnedCf, Point};
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, rc::Retained, sel, MainThreadOnly};
use objc2_app_kit::{
    NSAttributedStringNSStringDrawing, NSBackingStoreType, NSColor, NSFont, NSFontAttributeName,
    NSForegroundColorAttributeName, NSPanel, NSScreen, NSStatusWindowLevel, NSView,
    NSWindowCollectionBehavior, NSWindowSharingType, NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSAttributedString, NSDictionary, NSNumber, NSObjectProtocol,
    NSPoint, NSRect, NSRunLoop, NSRunLoopCommonModes, NSSize, NSString, NSTimer,
};
use objc2_quartz_core::{
    kCAFillModeBoth, kCATruncationEnd, CAAnimation, CAAnimationGroup, CABasicAnimation,
    CACurrentMediaTime, CADisplayLink, CAKeyframeAnimation, CALayer, CAMediaTiming,
    CAMediaTimingFunction, CATextLayer, CATransaction, CATransform3D,
};
use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// The panel is generous and transparent so the name tag can sit on either
/// side of the ring near screen edges. It ignores the mouse entirely.
const WIDTH: f64 = 340.0;
const HEIGHT: f64 = 80.0;
/// The action point (ring centre), measured from the panel's top left.
const TIP_X: f64 = 170.0;
const TIP_Y: f64 = 36.0;

const RING: f64 = 16.0;
const TAG_HEIGHT: f64 = 20.0;
const TAG_PADDING: f64 = 8.0;
const TAG_TEXT_MAX: f64 = 136.0;
/// Horizontal offset of the tag's near edge from the ring centre.
const TAG_GAP: f64 = 10.0;
/// Vertical offset of the tag's near edge from the ring centre.
const TAG_DROP: f64 = 7.0;
const NAME_MAX_CHARS: usize = 24;

/// The longest glide. Short hops are quicker; see `travel_seconds`.
const TRAVEL: Duration = Duration::from_millis(280);
const LINGER: Duration = Duration::from_millis(2400);
const UI_TIMEOUT: Duration = Duration::from_secs(1);
const FRAME: Duration = Duration::from_millis(16);
const FADE_IN: f64 = 0.16;
const FADE_OUT: f64 = 0.42;
const CROSSFADE: f64 = 0.18;
/// Shape of the critically damped glide; higher settles harder.
const STIFFNESS: f64 = 6.0;

const DEFAULT_NAME: &str = "Agent";
/// Aven's default accent (#57b5ff).
const DEFAULT_COLOR: [f64; 3] = [0.341, 0.710, 1.0];
const WHITE: [f64; 3] = [1.0, 1.0, 1.0];
const INK: [f64; 3] = [0.07, 0.07, 0.08];

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
    /// Typing or a key press: a subtle pulse, never the text itself.
    Key,
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

// ---------------------------------------------------------------------------
// Acting agent: name and colour, set from any thread.

#[derive(Clone, Debug, PartialEq)]
struct Actor {
    name: String,
    color: [f64; 3],
}

struct ActorSlot {
    actor: Option<Actor>,
    version: u64,
}

static ACTOR: Mutex<ActorSlot> = Mutex::new(ActorSlot {
    actor: None,
    version: 0,
});

fn is_hidden_char(c: char) -> bool {
    // Bidirectional overrides and isolates could visually disguise a name.
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}'
        )
}

/// Collapse whitespace, drop invisible and direction-changing characters, and
/// cap the length so a long or hostile name cannot dominate the screen.
fn sanitize_name(name: &str) -> String {
    let words: Vec<&str> = name
        .split(|c: char| c.is_whitespace() || is_hidden_char(c))
        .filter(|word| !word.is_empty())
        .collect();
    let joined = words.join(" ");
    if joined.is_empty() {
        return DEFAULT_NAME.to_owned();
    }
    if joined.chars().count() <= NAME_MAX_CHARS {
        return joined;
    }
    let mut capped: String = joined.chars().take(NAME_MAX_CHARS - 1).collect();
    capped.truncate(capped.trim_end().len());
    capped.push('\u{2026}');
    capped
}

fn sanitize_color(color: [f64; 3]) -> [f64; 3] {
    if color.iter().any(|channel| !channel.is_finite()) {
        return DEFAULT_COLOR;
    }
    color.map(|channel| channel.clamp(0.0, 1.0))
}

fn sanitize_actor(name: &str, color: [f64; 3]) -> Actor {
    Actor {
        name: sanitize_name(name),
        color: sanitize_color(color),
    }
}

fn neutral_actor() -> Actor {
    Actor {
        name: DEFAULT_NAME.to_owned(),
        color: DEFAULT_COLOR,
    }
}

/// Label and colour the marker for the agent acting next. Thread-safe; the
/// change applies from the next drawn action. Colour channels are sRGB 0–1.
#[allow(dead_code)] // Wired by the desktop-control integration.
pub(crate) fn set_actor(name: &str, color: [f64; 3]) {
    store_actor(Some(sanitize_actor(name, color)));
}

/// Return to the neutral "Agent" label in Aven's accent colour.
#[allow(dead_code)] // Wired by the desktop-control integration.
pub(crate) fn reset_actor() {
    store_actor(None);
}

fn store_actor(actor: Option<Actor>) {
    let mut slot = ACTOR.lock().unwrap_or_else(|error| error.into_inner());
    if slot.actor != actor {
        slot.actor = actor;
        slot.version = slot.version.wrapping_add(1);
    }
}

fn current_actor() -> (Actor, u64) {
    let slot = ACTOR.lock().unwrap_or_else(|error| error.into_inner());
    (
        slot.actor.clone().unwrap_or_else(neutral_actor),
        slot.version,
    )
}

// ---------------------------------------------------------------------------
// Pure colour, motion and layout logic.

fn linear(channel: f64) -> f64 {
    if channel <= 0.040_45 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

fn luminance(color: [f64; 3]) -> f64 {
    0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
}

fn contrast(a: [f64; 3], b: [f64; 3]) -> f64 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn mix(a: [f64; 3], b: [f64; 3], amount: f64) -> [f64; 3] {
    [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * amount)
}

/// The tag's fill and text colours. White text on the agent colour, deepened
/// only as far as needed for legibility; very light colours keep their hue
/// and take dark text instead.
fn tag_palette(color: [f64; 3], high_contrast: bool) -> ([f64; 3], [f64; 3]) {
    let required = if high_contrast { 7.0 } else { 4.5 };
    let deepest = if high_contrast { 0.5 } else { 0.36 };
    for step in 0..=40 {
        let amount = f64::from(step) * 0.0125;
        if amount > deepest {
            break;
        }
        let fill = mix(color, [0.0; 3], amount);
        if contrast(fill, WHITE) >= required {
            return (fill, WHITE);
        }
    }
    for step in 0..=40 {
        let fill = mix(color, WHITE, f64::from(step) * 0.025);
        if contrast(fill, INK) >= required {
            return (fill, INK);
        }
    }
    (INK, WHITE)
}

/// Glide duration in seconds: brisk for short hops, never longer than TRAVEL.
fn travel_seconds(distance: f64) -> f64 {
    (0.16 + distance.max(0.0) * 0.0001).clamp(0.16, TRAVEL.as_secs_f64())
}

fn ease(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    let norm = 1.0 - (1.0 + STIFFNESS) * (-STIFFNESS).exp();
    (1.0 - (1.0 + STIFFNESS * u) * (-STIFFNESS * u).exp()) / norm
}

fn ease_rate(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    let norm = 1.0 - (1.0 + STIFFNESS) * (-STIFFNESS).exp();
    STIFFNESS * STIFFNESS * u * (-STIFFNESS * u).exp() / norm
}

/// Carries the velocity of an interrupted glide into the next one, decaying
/// to exactly zero offset at the end so the landing point stays exact.
fn carry(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    u * ((-STIFFNESS * u).exp() - (-STIFFNESS).exp())
}

fn carry_rate(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    (-STIFFNESS * u).exp() * (1.0 - STIFFNESS * u) - (-STIFFNESS).exp()
}

/// A critically damped approach with a fixed, short duration: it starts from
/// the current velocity, never overshoots a still target, and lands exactly.
#[derive(Clone, Copy, Debug)]
struct Glide {
    from: Point,
    to: Point,
    velocity: Point,
    start: f64,
    duration: f64,
}

impl Glide {
    fn sample(&self, now: f64) -> (Point, Point) {
        let u = ((now - self.start) / self.duration).clamp(0.0, 1.0);
        let (e, c) = (ease(u), carry(u) * self.duration);
        let (er, cr) = (ease_rate(u) / self.duration, carry_rate(u));
        (
            Point {
                x: self.from.x + (self.to.x - self.from.x) * e + self.velocity.x * c,
                y: self.from.y + (self.to.y - self.from.y) * e + self.velocity.y * c,
            },
            Point {
                x: (self.to.x - self.from.x) * er + self.velocity.x * cr,
                y: (self.to.y - self.from.y) * er + self.velocity.y * cr,
            },
        )
    }

    fn finished(&self, now: f64) -> bool {
        now >= self.start + self.duration
    }
}

#[derive(Clone, Copy, Debug)]
struct Fade {
    from: f64,
    to: f64,
    start: f64,
    duration: f64,
}

impl Fade {
    fn new(from: f64, to: f64, start: f64, duration: f64) -> Self {
        Self {
            from: from.clamp(0.0, 1.0),
            to: to.clamp(0.0, 1.0),
            start,
            duration: duration.max(1e-3),
        }
    }

    fn sample(&self, now: f64) -> f64 {
        let u = ((now - self.start) / self.duration).clamp(0.0, 1.0);
        self.from + (self.to - self.from) * (u * u * (3.0 - 2.0 * u))
    }

    fn finished(&self, now: f64) -> bool {
        now >= self.start + self.duration
    }
}

const ZERO: Point = Point { x: 0.0, y: 0.0 };

/// Main-thread animation state, kept free of AppKit so it can be tested.
#[derive(Debug)]
struct Motion {
    generation: u64,
    position: Point,
    glide: Option<Glide>,
    fade: Option<Fade>,
    alpha: f64,
    shown: bool,
    pressed: bool,
    last_follow: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Approach {
    /// A deliberate move before input: glide and report the travel time.
    Glide,
    /// A drag sample: trail the stream smoothly; never delays input.
    Follow,
}

impl Motion {
    const fn new() -> Self {
        Self {
            generation: 0,
            position: ZERO,
            glide: None,
            fade: None,
            alpha: 0.0,
            shown: false,
            pressed: false,
            last_follow: f64::NEG_INFINITY,
        }
    }

    fn current(&self, now: f64) -> (Point, Point) {
        match self.glide {
            Some(glide) if !glide.finished(now) => glide.sample(now),
            Some(glide) => (glide.to, ZERO),
            None => (self.position, ZERO),
        }
    }

    /// Point the marker at `target`. Returns how long the caller should let
    /// the glide run before acting, in seconds.
    fn approach(
        &mut self,
        target: Point,
        continuing: bool,
        how: Approach,
        reduce_motion: bool,
        now: f64,
    ) -> f64 {
        let mut travel = 0.0;
        if continuing && self.shown {
            let (position, velocity) = self.current(now);
            let distance = (target.x - position.x).hypot(target.y - position.y);
            if distance < 0.5 {
                self.position = target;
                self.glide = None;
            } else if reduce_motion {
                // Jump, then crossfade in at the new place instead of gliding.
                self.position = target;
                self.glide = None;
                self.fade = Some(Fade::new(self.alpha.min(0.25), 1.0, now, CROSSFADE));
                self.alpha = self.alpha.min(0.25);
            } else {
                let duration = match how {
                    Approach::Glide => travel_seconds(distance),
                    Approach::Follow => (now - self.last_follow).clamp(0.03, 0.12),
                };
                self.position = position;
                self.glide = Some(Glide {
                    from: position,
                    to: target,
                    velocity,
                    start: now,
                    duration,
                });
                if how == Approach::Glide {
                    travel = duration;
                }
            }
            if self.alpha < 1.0 && self.fade.is_none_or(|fade| fade.to < 1.0) {
                self.fade = Some(Fade::new(self.alpha, 1.0, now, FADE_IN));
            }
        } else {
            self.position = target;
            self.glide = None;
            self.alpha = 0.0;
            self.fade = Some(Fade::new(0.0, 1.0, now, FADE_IN));
            self.shown = true;
        }
        if how == Approach::Follow {
            self.last_follow = now;
        }
        travel
    }

    fn fade_out(&mut self, now: f64) {
        if self.shown {
            self.fade = Some(Fade::new(self.alpha, 0.0, now, FADE_OUT));
        }
    }

    fn animating(&self) -> bool {
        self.glide.is_some() || self.fade.is_some()
    }

    /// Advance to `now`. Returns true when a fade-out has just completed.
    fn advance(&mut self, now: f64) -> bool {
        if let Some(glide) = self.glide {
            if glide.finished(now) {
                self.position = glide.to;
                self.glide = None;
            } else {
                self.position = glide.sample(now).0;
            }
        }
        if let Some(fade) = self.fade {
            self.alpha = fade.sample(now);
            if fade.finished(now) {
                self.alpha = fade.to;
                self.fade = None;
                if fade.to <= 0.0 {
                    self.shown = false;
                    self.glide = None;
                    return true;
                }
            }
        }
        false
    }

    fn reset(&mut self) {
        *self = Self {
            generation: self.generation,
            position: self.position,
            ..Self::new()
        };
    }
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

/// Keep the tag on screen: right and below by default, flipped near an edge.
/// `point` is in AppKit global coordinates; `screen` is that display's frame.
fn tag_side(point: NSPoint, tag: NSSize, screen: NSRect) -> (bool, bool) {
    let right = point.x + TAG_GAP + tag.width + 4.0 <= screen.origin.x + screen.size.width;
    let below = point.y - TAG_DROP - tag.height - 4.0 >= screen.origin.y;
    (right, below)
}

/// The tag's frame within the panel's (unflipped) root layer.
fn tag_frame(tag: NSSize, right: bool, below: bool) -> NSRect {
    let (cx, cy) = (TIP_X, HEIGHT - TIP_Y);
    let x = if right {
        cx + TAG_GAP
    } else {
        cx - TAG_GAP - tag.width
    };
    let y = if below {
        cy - TAG_DROP - tag.height
    } else {
        cy + TAG_DROP
    };
    rect(x, y, tag.width, tag.height)
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

// ---------------------------------------------------------------------------
// AppKit and Core Animation, main thread only.

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "AvenDesktopCursorView"]
    struct CursorView;

    unsafe impl NSObjectProtocol for CursorView {}

    impl CursorView {
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool { false }

        #[unsafe(method(avenTick:))]
        fn aven_tick(&self, sender: &AnyObject) { tick(sender); }
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

enum Ticker {
    Link(Retained<CADisplayLink>),
    Timer(Retained<NSTimer>),
}

#[derive(Clone, Copy, PartialEq)]
struct Style {
    actor_version: u64,
    high_contrast: bool,
    scale: f64,
}

struct Overlay {
    panel: Retained<CursorPanel>,
    view: Retained<CursorView>,
    /// Ring container; scaled for press, pulse and appearance.
    group: Retained<CALayer>,
    outline: Retained<CALayer>,
    halo: Retained<CALayer>,
    ring: Retained<CALayer>,
    flash: Retained<CALayer>,
    dot: Retained<CALayer>,
    ripple: Retained<CALayer>,
    tag: Retained<CALayer>,
    text: Retained<CATextLayer>,
    tag_size: NSSize,
    tag_side: (bool, bool),
    style: Option<Style>,
    reduce_motion: bool,
    main_top: f64,
    motion: Motion,
    ticker: Option<Ticker>,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn color(rgb: [f64; 3], alpha: f64) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(rgb[0], rgb[1], rgb[2], alpha)
}

fn circle(parent: &CALayer, diameter: f64) -> Retained<CALayer> {
    let layer = CALayer::new();
    layer.setBounds(rect(0.0, 0.0, diameter, diameter));
    layer.setPosition(NSPoint::new(0.0, 0.0));
    layer.setCornerRadius(diameter / 2.0);
    parent.addSublayer(&layer);
    layer
}

fn resize_circle(layer: &CALayer, diameter: f64) {
    layer.setBounds(rect(0.0, 0.0, diameter, diameter));
    layer.setCornerRadius(diameter / 2.0);
}

fn without_actions(operation: impl FnOnce()) {
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    operation();
    CATransaction::commit();
}

fn number(value: f64) -> Retained<NSNumber> {
    NSNumber::new_f64(value)
}

fn timing(c1x: f32, c1y: f32, c2x: f32, c2y: f32) -> Retained<CAMediaTimingFunction> {
    CAMediaTimingFunction::functionWithControlPoints(c1x, c1y, c2x, c2y)
}

fn basic(key: &str, from: f64, to: f64) -> Retained<CABasicAnimation> {
    let animation = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str(key)));
    unsafe {
        animation.setFromValue(Some(&number(from)));
        animation.setToValue(Some(&number(to)));
    }
    animation
}

fn keyframes(
    key: &str,
    values: &[f64],
    times: &[f64],
    duration: f64,
) -> Retained<CAKeyframeAnimation> {
    let animation = CAKeyframeAnimation::animationWithKeyPath(Some(&NSString::from_str(key)));
    let values: Vec<Retained<NSNumber>> = values.iter().copied().map(number).collect();
    let objects: Vec<&AnyObject> = values.iter().map(|value| -> &AnyObject { value }).collect();
    let times: Vec<Retained<NSNumber>> = times.iter().copied().map(number).collect();
    unsafe { animation.setValues(Some(&NSArray::from_slice(&objects))) };
    animation.setKeyTimes(Some(&NSArray::from_retained_slice(&times)));
    animation.setDuration(duration);
    animation.setTimingFunction(Some(&timing(0.33, 0.0, 0.25, 1.0)));
    animation
}

impl Overlay {
    fn create(mtm: MainThreadMarker) -> Self {
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
        panel.setAlphaValue(0.0);

        let view = CursorView::alloc(mtm).set_ivars(());
        let view: Retained<CursorView> =
            unsafe { msg_send![super(view), initWithFrame: rect(0.0, 0.0, WIDTH, HEIGHT)] };
        // A layer-hosting view: we own the whole tree and nothing is redrawn
        // by AppKit. Moving the window does not re-render any layer.
        let root = CALayer::new();
        root.setFrame(rect(0.0, 0.0, WIDTH, HEIGHT));
        view.setLayer(Some(&root));
        view.setWantsLayer(true);

        let (cx, cy) = (TIP_X, HEIGHT - TIP_Y);
        let overlay = without_actions_create(|| {
            let ripple = circle(&root, RING);
            ripple.setPosition(NSPoint::new(cx, cy));
            ripple.setOpacity(0.0);

            let group = CALayer::new();
            group.setBounds(rect(0.0, 0.0, 0.0, 0.0));
            group.setPosition(NSPoint::new(cx, cy));
            root.addSublayer(&group);
            let outline = circle(&group, RING + 4.0);
            let halo = circle(&group, RING + 2.0);
            let ring = circle(&group, RING);
            ring.setShadowOffset(NSSize::new(0.0, 0.0));
            let flash = circle(&group, RING);
            flash.setOpacity(0.0);
            let dot = circle(&group, 3.0);

            let tag = CALayer::new();
            tag.setCornerRadius(TAG_HEIGHT / 2.0);
            tag.setShadowOffset(NSSize::new(0.0, -1.0));
            tag.setShadowRadius(2.5);
            tag.setShadowColor(Some(&color([0.0; 3], 1.0).CGColor()));
            root.addSublayer(&tag);
            let text = CATextLayer::new();
            text.setTruncationMode(unsafe { kCATruncationEnd });
            tag.addSublayer(&text);

            Overlay {
                panel: panel.clone(),
                view: view.clone(),
                group,
                outline,
                halo,
                ring,
                flash,
                dot,
                ripple,
                tag,
                text,
                tag_size: NSSize::new(0.0, TAG_HEIGHT),
                tag_side: (true, true),
                style: None,
                reduce_motion: false,
                main_top: 0.0,
                motion: Motion::new(),
                ticker: None,
            }
        });
        panel.setContentView(Some(&view));
        WINDOW_ID.store(
            u32::try_from(panel.windowNumber()).unwrap_or(0),
            Ordering::Release,
        );
        overlay
    }

    /// Re-read accessibility settings and the acting agent; restyle only when
    /// something changed. No per-frame allocation happens here or in `step`.
    fn refresh_style(&mut self) {
        let workspace = NSWorkspace::sharedWorkspace();
        self.reduce_motion = workspace.accessibilityDisplayShouldReduceMotion();
        let high_contrast = workspace.accessibilityDisplayShouldIncreaseContrast();
        let (actor, actor_version) = current_actor();
        let style = Style {
            actor_version,
            high_contrast,
            scale: self.panel.backingScaleFactor().max(1.0),
        };
        if self.style == Some(style) {
            return;
        }
        self.style = Some(style);
        let tint = actor.color;
        let (fill, ink) = tag_palette(tint, high_contrast);
        let font = NSFont::systemFontOfSize_weight(11.0, if high_contrast { 0.4 } else { 0.3 });
        let ink = color(ink, 1.0);
        let ink_cg = ink.CGColor();
        // CATextLayer renders through Core Text; supply both colour keys.
        let ink_cf: &AnyObject = unsafe { &*((&*ink_cg) as *const _ as *const AnyObject) };
        let label = unsafe {
            let keys = [
                NSFontAttributeName,
                NSForegroundColorAttributeName,
                &*NSString::from_str("CTForegroundColor"),
            ];
            let values: [&AnyObject; 3] = [&font, &ink, ink_cf];
            NSAttributedString::new_with_attributes(
                &NSString::from_str(&actor.name),
                &NSDictionary::from_slices(&keys, &values),
            )
        };
        let measured = label.size();
        let text_width = measured.width.ceil().min(TAG_TEXT_MAX);
        let text_height = measured.height.ceil();
        self.tag_size = NSSize::new(text_width + TAG_PADDING * 2.0, TAG_HEIGHT);

        without_actions(|| {
            let ring_width = if high_contrast { 2.75 } else { 2.0 };
            self.ring.setBorderWidth(ring_width);
            self.ring.setBorderColor(Some(&color(tint, 1.0).CGColor()));
            self.ring.setBackgroundColor(Some(
                &color(tint, if high_contrast { 0.26 } else { 0.16 }).CGColor(),
            ));
            // A soft glow in the agent's colour.
            self.ring.setShadowColor(Some(&color(tint, 1.0).CGColor()));
            self.ring.setShadowRadius(5.0);
            self.ring
                .setShadowOpacity(if high_contrast { 0.35 } else { 0.55 });
            // A light and a dark hairline outside the ring keep it legible on
            // any background, including one in the agent's own colour.
            resize_circle(&self.halo, RING + 2.0);
            self.halo.setBorderWidth(1.0);
            self.halo.setBorderColor(Some(
                &color(WHITE, if high_contrast { 1.0 } else { 0.85 }).CGColor(),
            ));
            resize_circle(&self.outline, RING + 4.0);
            self.outline.setBorderWidth(1.0);
            self.outline.setBorderColor(Some(
                &color([0.0; 3], if high_contrast { 0.7 } else { 0.22 }).CGColor(),
            ));
            self.flash
                .setBackgroundColor(Some(&color(tint, 1.0).CGColor()));
            resize_circle(&self.dot, if high_contrast { 4.0 } else { 3.0 });
            self.dot
                .setBackgroundColor(Some(&color(tint, 1.0).CGColor()));
            self.ripple
                .setBorderColor(Some(&color(tint, 1.0).CGColor()));
            self.ripple.setBorderWidth(2.0);

            self.tag
                .setBackgroundColor(Some(&color(fill, 1.0).CGColor()));
            self.tag
                .setBorderWidth(if high_contrast { 1.25 } else { 1.0 });
            self.tag.setBorderColor(Some(
                &color(WHITE, if high_contrast { 0.9 } else { 0.45 }).CGColor(),
            ));
            self.tag
                .setShadowOpacity(if high_contrast { 0.45 } else { 0.28 });
            self.text.setContentsScale(style.scale);
            unsafe { self.text.setString(Some(&label)) };
            self.text.setFrame(rect(
                TAG_PADDING,
                ((TAG_HEIGHT - text_height) / 2.0).round(),
                text_width,
                text_height,
            ));
            self.tag
                .setFrame(tag_frame(self.tag_size, self.tag_side.0, self.tag_side.1));
        });
    }

    fn place_tag(&mut self, mtm: MainThreadMarker, target: Point) {
        let point = NSPoint::new(target.x, self.main_top - target.y);
        let screens = NSScreen::screens(mtm);
        let screen = screens.iter().map(|screen| screen.frame()).find(|frame| {
            point.x >= frame.origin.x
                && point.x < frame.origin.x + frame.size.width
                && point.y >= frame.origin.y
                && point.y < frame.origin.y + frame.size.height
        });
        let side = screen.map_or((true, true), |frame| tag_side(point, self.tag_size, frame));
        if side != self.tag_side {
            self.tag_side = side;
            without_actions(|| {
                self.tag.setFrame(tag_frame(self.tag_size, side.0, side.1));
            });
        }
    }

    fn approach(
        &mut self,
        mtm: MainThreadMarker,
        generation: u64,
        target: Point,
        continuing: bool,
        how: Approach,
    ) -> f64 {
        let primary = unsafe { CGDisplayBounds(CGMainDisplayID()) };
        self.main_top = primary.origin.y + primary.size.height;
        self.refresh_style();
        let now = CACurrentMediaTime();
        let appearing = !(continuing && self.motion.shown);
        self.motion.generation = generation;
        let travel = self
            .motion
            .approach(target, continuing, how, self.reduce_motion, now);
        if appearing {
            self.group.removeAllAnimations();
            self.ripple.removeAllAnimations();
            if !self.reduce_motion {
                let grow = basic("transform.scale", 0.45, 1.0);
                grow.setDuration(0.34);
                grow.setTimingFunction(Some(&timing(0.3, 1.4, 0.5, 1.0)));
                self.group
                    .addAnimation_forKey(&grow, Some(&NSString::from_str("appear")));
            }
        }
        self.place_tag(mtm, target);
        self.apply_frame();
        self.panel.orderFrontRegardless();
        WINDOW_ID.store(
            u32::try_from(self.panel.windowNumber()).unwrap_or(0),
            Ordering::Release,
        );
        self.start_ticker();
        travel
    }

    fn apply_frame(&self) {
        self.panel
            .setFrameOrigin(frame_origin(self.motion.position, self.main_top));
        self.panel.setAlphaValue(self.motion.alpha);
    }

    fn set_pressed(&mut self, pressed: bool) {
        if self.motion.pressed == pressed {
            return;
        }
        self.motion.pressed = pressed;
        CATransaction::begin();
        CATransaction::setAnimationDuration(if pressed { 0.12 } else { 0.22 });
        CATransaction::setAnimationTimingFunction(Some(&timing(0.25, 0.1, 0.25, 1.0)));
        if !self.reduce_motion {
            let scale = if pressed { 0.78 } else { 1.0 };
            self.group
                .setTransform(CATransform3D::new_scale(scale, scale, 1.0));
        }
        // The fill deepens while the button is held, with or without motion.
        self.flash.setOpacity(if pressed { 0.3 } else { 0.0 });
        CATransaction::commit();
    }

    fn feedback(&self, feedback: Feedback) {
        let key = NSString::from_str("feedback");
        match (feedback, self.reduce_motion) {
            (Feedback::Move, _) => {}
            (Feedback::Click, false) => {
                // One soft ripple out from the ring, plus a small press dip.
                let grow = basic("transform.scale", 1.0, 2.8);
                let fade = basic("opacity", 0.65, 0.0);
                let thin = basic("borderWidth", 2.0, 0.4);
                let group = CAAnimationGroup::animation();
                let parts: [&CAAnimation; 3] = [&grow, &fade, &thin];
                group.setAnimations(Some(&NSArray::from_slice(&parts)));
                group.setDuration(0.52);
                group.setTimingFunction(Some(&timing(0.16, 0.8, 0.3, 1.0)));
                group.setFillMode(unsafe { kCAFillModeBoth });
                self.ripple.addAnimation_forKey(&group, Some(&key));
                let dip = keyframes("transform.scale", &[1.0, 0.84, 1.0], &[0.0, 0.3, 1.0], 0.26);
                self.group.addAnimation_forKey(&dip, Some(&key));
            }
            (Feedback::Click, true) => {
                let glow = keyframes("opacity", &[0.0, 0.55, 0.0], &[0.0, 0.25, 1.0], 0.36);
                self.flash.addAnimation_forKey(&glow, Some(&key));
            }
            (Feedback::Key | Feedback::Scroll, false) => {
                let pulse = keyframes("transform.scale", &[1.0, 1.16, 1.0], &[0.0, 0.4, 1.0], 0.32);
                self.group.addAnimation_forKey(&pulse, Some(&key));
                let glow = keyframes("opacity", &[0.0, 0.3, 0.0], &[0.0, 0.4, 1.0], 0.32);
                self.flash.addAnimation_forKey(&glow, Some(&key));
            }
            (Feedback::Key | Feedback::Scroll, true) => {
                let glow = keyframes("opacity", &[0.0, 0.3, 0.0], &[0.0, 0.4, 1.0], 0.32);
                self.flash.addAnimation_forKey(&glow, Some(&key));
            }
        }
    }

    fn start_ticker(&mut self) {
        if self.ticker.is_some() || !self.motion.animating() {
            return;
        }
        let target: &AnyObject = &self.view;
        let modes = unsafe { NSRunLoopCommonModes };
        // NSView's display link follows the panel's display and refresh rate
        // (macOS 14+). Older systems use a common-mode 60 Hz timer.
        if self
            .view
            .respondsToSelector(sel!(displayLinkWithTarget:selector:))
        {
            let link = unsafe {
                self.view
                    .displayLinkWithTarget_selector(target, sel!(avenTick:))
            };
            unsafe { link.addToRunLoop_forMode(&NSRunLoop::mainRunLoop(), modes) };
            self.ticker = Some(Ticker::Link(link));
        } else {
            let timer = unsafe {
                NSTimer::timerWithTimeInterval_target_selector_userInfo_repeats(
                    1.0 / 60.0,
                    target,
                    sel!(avenTick:),
                    None,
                    true,
                )
            };
            unsafe { NSRunLoop::mainRunLoop().addTimer_forMode(&timer, modes) };
            self.ticker = Some(Ticker::Timer(timer));
        }
    }

    fn stop_ticker(&mut self) {
        match self.ticker.take() {
            Some(Ticker::Link(link)) => link.invalidate(),
            Some(Ticker::Timer(timer)) => timer.invalidate(),
            None => {}
        }
    }

    fn step(&mut self, now: f64) {
        let finished = self.motion.advance(now);
        self.apply_frame();
        if finished {
            self.panel.orderOut(None);
            self.clear_animations();
        }
        if !self.motion.animating() {
            self.stop_ticker();
        }
    }

    fn clear_animations(&self) {
        self.group.removeAllAnimations();
        self.ripple.removeAllAnimations();
        self.flash.removeAllAnimations();
    }

    /// Hide immediately and forget all motion. Nothing keeps running.
    fn reset(&mut self) {
        self.stop_ticker();
        self.panel.orderOut(None);
        self.panel.setAlphaValue(0.0);
        self.clear_animations();
        self.motion.reset();
        without_actions(|| {
            self.group
                .setTransform(CATransform3D::new_scale(1.0, 1.0, 1.0));
            self.flash.setOpacity(0.0);
        });
    }
}

fn without_actions_create<T>(operation: impl FnOnce() -> T) -> T {
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    let result = operation();
    CATransaction::commit();
    result
}

fn tick(sender: &AnyObject) {
    let now = sender
        .downcast_ref::<CADisplayLink>()
        .map_or_else(|| CACurrentMediaTime(), |link| link.targetTimestamp());
    objc2::rc::autoreleasepool(|_| {
        OVERLAY.with(|slot| {
            let Ok(mut slot) = slot.try_borrow_mut() else {
                return;
            };
            let Some(overlay) = slot.as_mut() else {
                return;
            };
            let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
            if !gate.authorized(overlay.motion.generation) || gate.suspended {
                // Freeze rather than hide: a newer action takes over from
                // here, and revocation hides through `hide_generation`.
                overlay.stop_ticker();
                return;
            }
            overlay.step(now);
        });
    });
}

fn with_overlay<T>(
    operation: impl FnOnce(MainThreadMarker, &mut Overlay) -> T,
) -> Result<T, String> {
    let mtm =
        MainThreadMarker::new().ok_or("The desktop cursor must be drawn on the main thread.")?;
    OVERLAY.with(|slot| {
        let mut slot = slot
            .try_borrow_mut()
            .map_err(|_| "The desktop cursor is busy.")?;
        let overlay = slot.get_or_insert_with(|| Overlay::create(mtm));
        Ok(operation(mtm, overlay))
    })
}

fn existing_overlay(operation: impl FnOnce(&mut Overlay)) {
    OVERLAY.with(|slot| {
        if let Ok(mut slot) = slot.try_borrow_mut() {
            if let Some(overlay) = slot.as_mut() {
                operation(overlay);
            }
        }
    });
}

fn order_out() {
    existing_overlay(Overlay::reset);
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

/// Main thread: show or move the marker for `generation`. Returns the glide
/// time the caller should wait before acting.
fn show(generation: u64, target: Point, continuing: bool, how: Approach) -> Result<f64, String> {
    let mut gate = GATE
        .lock()
        .map_err(|_| "The desktop cursor is unavailable.")?;
    if !gate.visible(generation, Instant::now()) {
        return Err(CANCELLED.into());
    }
    let travel =
        with_overlay(|mtm, overlay| overlay.approach(mtm, generation, target, continuing, how))?;
    gate.last_point = Some(target);
    Ok(travel)
}

/// Main thread: play the action's feedback and start the idle countdown.
fn arrive(generation: u64, feedback: Feedback, pressed: bool) -> Result<(), String> {
    let mut gate = GATE
        .lock()
        .map_err(|_| "The desktop cursor is unavailable.")?;
    if !gate.visible(generation, Instant::now()) {
        return Err(CANCELLED.into());
    }
    with_overlay(|_, overlay| {
        overlay.set_pressed(pressed);
        overlay.feedback(feedback);
    })?;
    if !pressed {
        gate.expires = Some(Instant::now() + LINGER);
        drop(gate);
        schedule_fade(generation, LINGER);
    }
    Ok(())
}

fn schedule_after(duration: Duration, operation: impl FnOnce() + Send + 'static) {
    if let Ok(when) = DispatchTime::try_from(duration) {
        let _ = DispatchQueue::main().after(when, operation);
    }
}

/// One one-shot timer per action. It checks generation and screenshot
/// suppression, so an old countdown can never hide or revive a later use.
fn schedule_fade(generation: u64, delay: Duration) {
    schedule_after(delay, move || {
        let gate = GATE.lock().unwrap_or_else(|error| error.into_inner());
        if !gate.authorized(generation) || gate.suspended {
            return;
        }
        existing_overlay(|overlay| {
            if overlay.motion.generation == generation {
                overlay.motion.fade_out(CACurrentMediaTime());
                overlay.start_ticker();
            }
        });
    });
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

/// Lets the glide play on the main thread while this worker waits, without a
/// round trip per frame. A revoke or screenshot during the glide cancels it.
fn wait_for(generation: u64, travel: Duration) -> Result<(), String> {
    let until = Instant::now() + travel;
    loop {
        let now = Instant::now();
        let visible = GATE
            .lock()
            .map_err(|_| "The desktop cursor is unavailable.")?
            .visible(generation, now);
        if !visible {
            return Err(CANCELLED.into());
        }
        if now >= until {
            return Ok(());
        }
        std::thread::sleep(FRAME.min(until - now));
    }
}

#[cfg(debug_assertions)]
const PREVIEW_SCOPE: &str = "aven-dev-visual-preview";

/// Dev preview only: rotate through sample agents so QA sees each colour and
/// name tag. It changes nothing but this drawing.
#[cfg(debug_assertions)]
fn preview_actor(scope: &str) {
    static MOVES: AtomicU32 = AtomicU32::new(0);
    if scope != PREVIEW_SCOPE {
        return;
    }
    let moves = MOVES.fetch_add(1, Ordering::Relaxed);
    if !moves.is_multiple_of(3) {
        return;
    }
    match (moves / 3) % 3 {
        0 => set_actor("Claude", [0.851, 0.467, 0.341]),
        1 => set_actor("Codex", [0.45, 0.42, 0.96]),
        _ => reset_actor(),
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
    #[cfg(debug_assertions)]
    preview_actor(scope);
    let (generation, previous) = GATE
        .lock()
        .map_err(|_| "The desktop cursor is unavailable.")?
        .start(scope, revoked, started)?;
    let target = Point { x, y };
    let result = (|| {
        let continuing = previous.is_some();
        let travel = on_main(deadline, move || {
            show(generation, target, continuing, Approach::Glide)
        })?;
        wait_for(generation, Duration::from_secs_f64(travel.clamp(0.0, 1.0)))?;
        on_main(deadline, move || arrive(generation, feedback, false))
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
/// ring tightens; the release plays the click ripple and then the idle fade.
pub(super) fn follow(scope: &str, point: Point, released: bool, revoked: Arc<AtomicBool>) {
    let Ok(mut gate) = GATE.lock() else {
        return;
    };
    let Ok((generation, previous)) = gate.start(scope, revoked, Instant::now()) else {
        return;
    };
    drop(gate);
    let continuing = previous.is_some();
    DispatchQueue::main().exec_async(move || {
        objc2::rc::autoreleasepool(|_| {
            if show(generation, point, continuing, Approach::Follow).is_err() {
                return;
            }
            let feedback = if released {
                Feedback::Click
            } else {
                Feedback::Move
            };
            let _ = arrive(generation, feedback, !released);
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
    move_to(app, scope, point.x, point.y, Feedback::Key, revoked)
}

/// The flag is set before dispatch, preventing pulse/fade work from showing the
/// panel while screencapture runs on a worker. Failure stops the capture caller.
pub(super) fn suspend(_app: &AppHandle) -> Result<(), String> {
    GATE.lock()
        .map_err(|_| "The desktop cursor is unavailable.")?
        .suspended = true;
    let result = on_main(Instant::now() + UI_TIMEOUT, || {
        existing_overlay(|overlay| {
            overlay.stop_ticker();
            overlay.panel.orderOut(None);
        });
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
        let now = Instant::now();
        if !gate.visible(generation, now) {
            return;
        }
        let remaining = gate.expires.map_or(Duration::ZERO, |expires| {
            expires.saturating_duration_since(now)
        });
        drop(gate);
        let mut restored = false;
        existing_overlay(|overlay| {
            if overlay.motion.generation == generation && overlay.motion.shown {
                overlay.apply_frame();
                overlay.panel.orderFrontRegardless();
                overlay.start_ticker();
                restored = true;
            }
        });
        // A fade countdown that fired during the capture was skipped.
        if restored {
            schedule_fade(generation, remaining);
        }
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

    fn distance(a: Point, b: Point) -> f64 {
        (a.x - b.x).hypot(a.y - b.y)
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
    fn glide_lands_exactly_and_never_overshoots_a_still_target() {
        let from = Point {
            x: -500.0,
            y: 1000.0,
        };
        let to = Point {
            x: 500.0,
            y: -1000.0,
        };
        let glide = Glide {
            from,
            to,
            velocity: ZERO,
            start: 10.0,
            duration: 0.25,
        };
        assert_eq!(glide.sample(9.0).0, from);
        assert_eq!(glide.sample(10.0).0, from);
        let end = glide.sample(10.25).0;
        assert!(distance(end, to) < 1e-9);
        assert!(!glide.finished(10.2499));
        assert!(glide.finished(10.25));
        let mut last = from;
        for step in 0..=250 {
            let point = glide.sample(10.0 + f64::from(step) * 0.001).0;
            assert!((from.x..=to.x).contains(&point.x));
            assert!((to.y..=from.y).contains(&point.y));
            assert!(point.x >= last.x - 1e-9, "progress must be monotonic");
            last = point;
        }
        // Critically damped: starts at rest and arrives almost at rest, with
        // most of the distance covered by the middle of the glide.
        assert!(glide.sample(10.0).1.x.abs() < 1e-9);
        let landing_speed = glide.sample(10.25).1.x.abs();
        let average_speed = 1000.0 / 0.25;
        assert!(landing_speed < average_speed * 0.1);
        let midway = glide.sample(10.125).0;
        assert!(midway.x > 0.0);
    }

    #[test]
    fn retargeting_mid_glide_keeps_position_and_velocity_continuous() {
        let mut motion = Motion::new();
        let a = Point { x: 0.0, y: 0.0 };
        let b = Point { x: 800.0, y: 0.0 };
        let c = Point { x: 400.0, y: 600.0 };
        motion.approach(a, false, Approach::Glide, false, 0.0);
        motion.advance(1.0);
        let travel = motion.approach(b, true, Approach::Glide, false, 1.0);
        assert!(travel > 0.0 && travel <= TRAVEL.as_secs_f64());
        let switch = 1.0 + travel * 0.4;
        let (before, velocity_before) = motion.current(switch);
        motion.approach(c, true, Approach::Glide, false, switch);
        let (after, velocity_after) = motion.current(switch);
        assert!(distance(before, after) < 1e-6);
        assert!(distance(velocity_before, velocity_after) < velocity_before.x.abs() * 0.01);
        // And it still converges exactly on the new target.
        let mut now = switch;
        while motion.glide.is_some() {
            now += 1.0 / 120.0;
            motion.advance(now);
            assert!(now < switch + 1.0, "glide must finish");
        }
        assert_eq!(motion.position, c);
    }

    #[test]
    fn spring_steps_converge_at_display_rates() {
        for rate in [60.0, 120.0] {
            let mut motion = Motion::new();
            let target = Point {
                x: 1200.0,
                y: -40.0,
            };
            motion.approach(ZERO, false, Approach::Glide, false, 0.0);
            motion.advance(0.5);
            let travel = motion.approach(target, true, Approach::Glide, false, 0.5);
            let mut now = 0.5;
            let mut remaining = distance(motion.position, target);
            while motion.glide.is_some() {
                now += 1.0 / rate;
                motion.advance(now);
                let left = distance(motion.position, target);
                assert!(left <= remaining + 1e-9);
                remaining = left;
            }
            assert_eq!(motion.position, target);
            assert!(now - 0.5 <= travel + 1.0 / rate + 1e-9);
        }
    }

    #[test]
    fn travel_time_is_brisk_and_bounded() {
        assert!((travel_seconds(0.0) - 0.16).abs() < 1e-9);
        assert!(travel_seconds(500.0) > travel_seconds(100.0));
        assert_eq!(travel_seconds(1e9), TRAVEL.as_secs_f64());
        assert_eq!(travel_seconds(-5.0), travel_seconds(0.0));
    }

    #[test]
    fn appearing_fades_in_and_idle_fade_out_hides() {
        let mut motion = Motion::new();
        let target = Point { x: 300.0, y: 200.0 };
        let travel = motion.approach(target, false, Approach::Glide, false, 0.0);
        assert_eq!(travel, 0.0, "a first appearance never delays input");
        assert!(motion.shown && motion.alpha == 0.0);
        assert!(!motion.advance(FADE_IN / 2.0));
        assert!(motion.alpha > 0.0 && motion.alpha < 1.0);
        assert!(!motion.advance(FADE_IN));
        assert_eq!(motion.alpha, 1.0);
        assert!(!motion.animating(), "idle means no ticking");

        motion.fade_out(5.0);
        assert!(motion.animating());
        assert!(!motion.advance(5.0 + FADE_OUT / 2.0));
        assert!(motion.alpha > 0.0 && motion.alpha < 1.0);
        assert!(motion.advance(5.0 + FADE_OUT));
        assert!(!motion.shown && motion.alpha == 0.0 && !motion.animating());
    }

    #[test]
    fn an_action_during_fade_out_restores_the_marker() {
        let mut motion = Motion::new();
        let target = Point { x: 10.0, y: 10.0 };
        motion.approach(target, false, Approach::Glide, false, 0.0);
        motion.advance(1.0);
        motion.fade_out(3.0);
        motion.advance(3.0 + FADE_OUT / 2.0);
        let dim = motion.alpha;
        motion.approach(target, true, Approach::Glide, false, 3.0 + FADE_OUT / 2.0);
        let fade = motion.fade.expect("fades back in");
        assert_eq!((fade.from, fade.to), (dim, 1.0));
        motion.advance(10.0);
        assert!(motion.shown && motion.alpha == 1.0);
    }

    #[test]
    fn hidden_or_new_scope_appears_in_place_instead_of_gliding() {
        let mut motion = Motion::new();
        motion.approach(ZERO, false, Approach::Glide, false, 0.0);
        motion.advance(1.0);
        let target = Point { x: 900.0, y: 900.0 };
        assert_eq!(
            motion.approach(target, false, Approach::Glide, false, 1.0),
            0.0
        );
        assert_eq!(motion.position, target);
        assert!(motion.glide.is_none());
    }

    #[test]
    fn reduce_motion_jumps_and_crossfades() {
        let mut motion = Motion::new();
        motion.approach(ZERO, false, Approach::Glide, true, 0.0);
        motion.advance(1.0);
        let target = Point { x: 640.0, y: 480.0 };
        let travel = motion.approach(target, true, Approach::Glide, true, 1.0);
        assert_eq!(travel, 0.0);
        assert_eq!(motion.position, target);
        assert!(motion.glide.is_none());
        assert!(motion.alpha <= 0.25);
        motion.advance(1.0 + CROSSFADE);
        assert_eq!(motion.alpha, 1.0);
    }

    #[test]
    fn drag_samples_trail_smoothly_without_delaying_input() {
        let mut motion = Motion::new();
        motion.approach(ZERO, false, Approach::Follow, false, 0.0);
        motion.advance(0.2);
        for step in 1..=10 {
            let now = 0.2 + f64::from(step) * 0.03;
            let point = Point {
                x: f64::from(step) * 20.0,
                y: 0.0,
            };
            assert_eq!(
                motion.approach(point, true, Approach::Follow, false, now),
                0.0
            );
            let glide = motion.glide.expect("drag glides");
            assert!(glide.duration >= 0.03 && glide.duration <= 0.12);
        }
        motion.advance(5.0);
        assert_eq!(motion.position, Point { x: 200.0, y: 0.0 });
    }

    #[test]
    fn actor_names_are_sanitised_and_capped() {
        assert_eq!(sanitize_name("  Claude  "), "Claude");
        assert_eq!(sanitize_name("Claude\n\tCode"), "Claude Code");
        assert_eq!(sanitize_name(""), DEFAULT_NAME);
        assert_eq!(sanitize_name(" \u{202E}\u{200B} "), DEFAULT_NAME);
        assert_eq!(sanitize_name("evil\u{202E}txt"), "evil txt");
        let long = sanitize_name(&"x".repeat(100));
        assert_eq!(long.chars().count(), NAME_MAX_CHARS);
        assert!(long.ends_with('\u{2026}'));
        let words = sanitize_name("an agent with a very long display name indeed");
        assert!(words.chars().count() <= NAME_MAX_CHARS);
        assert!(!words.contains(" \u{2026}"));
        let wide = sanitize_name(&"界".repeat(40));
        assert_eq!(wide.chars().count(), NAME_MAX_CHARS);
    }

    #[test]
    fn actor_colours_are_clamped_with_a_safe_fallback() {
        assert_eq!(sanitize_color([0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]);
        assert_eq!(sanitize_color([-1.0, 2.0, 0.5]), [0.0, 1.0, 0.5]);
        assert_eq!(sanitize_color([f64::NAN, 0.0, 0.0]), DEFAULT_COLOR);
        assert_eq!(sanitize_color([0.0, f64::INFINITY, 0.0]), DEFAULT_COLOR);
        let actor = sanitize_actor("", [9.0, 9.0, 9.0]);
        assert_eq!(actor.name, DEFAULT_NAME);
        assert_eq!(actor.color, [1.0, 1.0, 1.0]);
    }

    #[test]
    fn set_actor_is_versioned_and_resettable() {
        // The only test touching the shared slot, so no cross-test races.
        reset_actor();
        let (neutral, start) = current_actor();
        assert_eq!(neutral, neutral_actor());
        set_actor("Claude", [0.85, 0.47, 0.34]);
        let (actor, version) = current_actor();
        assert_eq!(actor.name, "Claude");
        assert_ne!(version, start);
        set_actor("Claude", [0.85, 0.47, 0.34]);
        assert_eq!(
            current_actor().1,
            version,
            "unchanged actor keeps its style"
        );
        let worker = std::thread::spawn(|| set_actor("Codex", [0.4, 0.4, 0.9]));
        worker.join().unwrap();
        assert_eq!(current_actor().0.name, "Codex");
        reset_actor();
        assert_eq!(current_actor().0, neutral_actor());
    }

    #[test]
    fn tag_text_is_legible_for_any_agent_colour() {
        for tint in [
            DEFAULT_COLOR,
            [0.851, 0.467, 0.341],
            [1.0, 0.84, 0.04],
            [1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0],
            [0.5, 0.5, 0.5],
            [0.0, 1.0, 0.0],
            [0.45, 0.42, 0.96],
        ] {
            for high_contrast in [false, true] {
                let (fill, ink) = tag_palette(tint, high_contrast);
                let required = if high_contrast { 7.0 } else { 4.5 };
                assert!(
                    contrast(fill, ink) >= required,
                    "{tint:?} {high_contrast} -> {:.2}",
                    contrast(fill, ink)
                );
            }
        }
        // Aven's accent keeps white text on a deepened, same-hue fill.
        let (fill, ink) = tag_palette(DEFAULT_COLOR, false);
        assert_eq!(ink, WHITE);
        assert!(fill[2] > fill[0] && fill[2] > fill[1]);
        // A light yellow keeps its hue and takes dark text.
        assert_eq!(tag_palette([1.0, 0.84, 0.04], false).1, INK);
    }

    #[test]
    fn tag_stays_on_screen_near_edges() {
        let screen = rect(0.0, 0.0, 1440.0, 900.0);
        let tag = NSSize::new(80.0, TAG_HEIGHT);
        assert_eq!(
            tag_side(NSPoint::new(700.0, 450.0), tag, screen),
            (true, true)
        );
        assert_eq!(
            tag_side(NSPoint::new(1400.0, 450.0), tag, screen),
            (false, true)
        );
        assert_eq!(
            tag_side(NSPoint::new(700.0, 10.0), tag, screen),
            (true, false)
        );
        // Frames for every side stay inside the panel, clear of the ring.
        let widest = NSSize::new(TAG_TEXT_MAX + TAG_PADDING * 2.0, TAG_HEIGHT);
        for (right, below) in [(true, true), (true, false), (false, true), (false, false)] {
            let frame = tag_frame(widest, right, below);
            assert!(frame.origin.x >= 0.0 && frame.origin.x + frame.size.width <= WIDTH);
            assert!(frame.origin.y >= 0.0 && frame.origin.y + frame.size.height <= HEIGHT);
            let ring_left = TIP_X - RING / 2.0;
            let ring_right = TIP_X + RING / 2.0;
            assert!(frame.origin.x >= ring_right || frame.origin.x + frame.size.width <= ring_left);
        }
    }

    #[test]
    fn fade_is_bounded_and_eased() {
        let fade = Fade::new(1.0, 0.0, 2.0, 0.4);
        assert_eq!(fade.sample(1.0), 1.0);
        assert_eq!(fade.sample(2.4), 0.0);
        assert!((fade.sample(2.2) - 0.5).abs() < 1e-9);
        let clamped = Fade::new(-3.0, 4.0, 0.0, 0.0);
        assert_eq!((clamped.from, clamped.to), (0.0, 1.0));
        assert!(clamped.finished(0.01));
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
