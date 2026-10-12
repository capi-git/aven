//! Non-activating native controls. Policy stays in desktop_presence; this
//! adapter only renders models and reports genuine user input.
use super::{agent_cursor, CGDisplayBounds, CGMainDisplayID};
use crate::desktop_presence::{self as presence, BarModel, ButtonAction, ButtonStyle};
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, sel, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSButton, NSColor, NSFont, NSPanel, NSScreen, NSStatusWindowLevel,
    NSTextField, NSView, NSVisualEffectView, NSWindowCollectionBehavior, NSWindowSharingType,
    NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

const HEIGHT: f64 = 64.0;
const WIDTH: f64 = 580.0;
static WINDOW_ID: AtomicU32 = AtomicU32::new(0);
static REVISION: AtomicU64 = AtomicU64::new(0);

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
            let action = BAR.with(|slot| slot.borrow().as_ref().and_then(|bar| bound_action(&bar.actions, bar.button_base, sender.tag()).cloned()));
            if let Some(action) = action {
                presence::with(|state| match action {
                    ButtonAction::Pause => state.pause(presence::Pause::ByUser),
                    ButtonAction::Resume => state.resume(),
                    ButtonAction::Stop(scope) => state.stop(&scope, Instant::now()),
                    ButtonAction::Allow(id) => { state.answer(id, true); },
                    ButtonAction::Deny(id) => { state.answer(id, false); },
                });
                agent_cursor::clear_scope(None);
                changed();
            }
        }
    }
);

struct Bar {
    panel: Retained<PresencePanel>,
    model: Option<BarModel>,
    actions: Vec<ButtonAction>,
    button_base: isize,
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

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
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
                agent_cursor::clear_scope(None);
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
impl Bar {
    fn new(mtm: MainThreadMarker) -> Self {
        let panel: Retained<PresencePanel> = unsafe {
            msg_send![PresencePanel::alloc(mtm), initWithContentRect: rect(0.0,0.0,WIDTH,HEIGHT), styleMask: NSWindowStyleMask::NonactivatingPanel, backing: NSBackingStoreType::Buffered, defer: false]
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
            actions: vec![],
            button_base: 0,
            anchor: None,
            suppressed: false,
            monitor: None,
        }
    }
    fn render(&mut self, mtm: MainThreadMarker, model: Option<BarModel>) {
        let Some(model) = model else {
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
                            if let Some(bar) =
                                slot.borrow().as_ref().filter(|bar| bar.model.is_none())
                            {
                                bar.panel.orderOut(None);
                            }
                        });
                    },
                );
            } else {
                self.panel.orderOut(None);
            }
            self.model = None;
            self.monitor = None;
            return;
        };
        let main_top = unsafe {
            let r = CGDisplayBounds(CGMainDisplayID());
            r.origin.y + r.size.height
        };
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
            return;
        };
        let visible = screen.visibleFrame();
        let area = presence::Frame {
            x: visible.origin.x,
            y: main_top - visible.origin.y - visible.size.height,
            width: visible.size.width,
            height: visible.size.height,
        };
        let avoid = self.anchor.into_iter().collect::<Vec<_>>();
        let Some((frame, _)) = presence::place_bar(area, WIDTH, HEIGHT, false, &avoid) else {
            self.panel.orderOut(None);
            return;
        };
        self.panel.setFrame_display(
            rect(
                frame.x,
                main_top - frame.y - frame.height,
                frame.width,
                frame.height,
            ),
            true,
        );
        if self.model.as_ref() != Some(&model) {
            self.actions = model.buttons.iter().map(|b| b.action.clone()).collect();
            self.button_base = self.button_base.checked_add(8).unwrap_or(8);
            let view = NSVisualEffectView::initWithFrame(
                NSVisualEffectView::alloc(mtm),
                rect(0.0, 0.0, frame.width, HEIGHT),
            );
            unsafe {
                let _: () = msg_send![&*view, setMaterial: 13_isize]; // HUDWindow
                let _: () = msg_send![&*view, setBlendingMode: 0_isize]; // behind window
                let _: () = msg_send![&*view, setState: 1_isize]; // active
            }
            view.setWantsLayer(true);
            if let Some(layer) = view.layer() {
                layer.setCornerRadius(14.0);
                layer.setMasksToBounds(true);
                let workspace = NSWorkspace::sharedWorkspace();
                if workspace.accessibilityDisplayShouldReduceTransparency() {
                    layer.setBackgroundColor(Some(&NSColor::windowBackgroundColor().CGColor()));
                }
            }
            let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                model.color[0],
                model.color[1],
                model.color[2],
                1.0,
            );
            let dot = NSView::initWithFrame(NSView::alloc(mtm), rect(17.0, 27.0, 10.0, 10.0));
            dot.setWantsLayer(true);
            if let Some(layer) = dot.layer() {
                layer.setCornerRadius(5.0);
                layer.setBackgroundColor(Some(&color.CGColor()));
            }
            view.addSubview(&dot);
            let buttons_width: f64 = model
                .buttons
                .iter()
                .map(|b| {
                    if b.label.chars().count() > 11 {
                        112.0
                    } else if b.label.chars().count() > 7 {
                        96.0
                    } else {
                        68.0
                    }
                })
                .sum();
            let text_width = (frame.width - 64.0 - buttons_width).max(50.0);
            for (text, y, size, secondary) in [
                (&model.title, 34.0, 13.0, false),
                (&model.detail, 14.0, 11.0, true),
            ] {
                let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
                label.setFrame(rect(39.0, y, text_width, 18.0));
                label.setFont(Some(&NSFont::systemFontOfSize(size)));
                let text_color = if secondary {
                    NSColor::secondaryLabelColor()
                } else {
                    NSColor::labelColor()
                };
                label.setTextColor(Some(&text_color));
                unsafe {
                    let _: () = msg_send![&*label, setLineBreakMode: 4_usize];
                }
                view.addSubview(&label);
            }
            let mut x = frame.width - buttons_width - 12.0;
            for (index, b) in model.buttons.iter().enumerate() {
                let width = if b.label.chars().count() > 11 {
                    112.0
                } else if b.label.chars().count() > 7 {
                    96.0
                } else {
                    68.0
                };
                let button =
                    NSButton::initWithFrame(NSButton::alloc(mtm), rect(x, 18.0, width - 4.0, 28.0));
                button.setTitle(&NSString::from_str(b.label));
                button.setTag(self.button_base + index as isize);
                button.setFont(Some(&NSFont::systemFontOfSize(12.0)));
                unsafe {
                    let _: () = msg_send![&*button, setBezelStyle: 1_usize];
                    button.setTarget(Some(&self.panel));
                    button.setAction(Some(sel!(avenPresenceAction:)));
                }
                if b.style == ButtonStyle::Destructive {
                    button.setContentTintColor(Some(&NSColor::systemRedColor()));
                }
                if b.style == ButtonStyle::Prominent {
                    button.setContentTintColor(Some(&NSColor::controlAccentColor()));
                }
                view.addSubview(&button);
                x += width;
            }
            self.panel.setContentView(Some(&view));
            self.model = Some(model);
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
}

fn refresh(mtm: MainThreadMarker) {
    let now = Instant::now();
    let (model, next) = presence::with(|state| (state.model(now), state.next_refresh(now)));
    BAR.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_none() && model.is_none() {
            return;
        }
        slot.get_or_insert_with(|| Bar::new(mtm)).render(mtm, model);
    });
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
            let mut slot = slot.borrow_mut();
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
    let _ = main(|_| {
        BAR.with(|slot| {
            if let Some(bar) = slot.borrow_mut().take() {
                bar.panel.orderOut(None);
            }
            WINDOW_ID.store(0, Ordering::Release);
        })
    });
}
pub(super) fn suppress(hidden: bool) -> Result<(), String> {
    main(move |mtm| {
        BAR.with(|slot| {
            if let Some(bar) = slot.borrow_mut().as_mut() {
                bar.suppressed = hidden;
                if hidden {
                    bar.panel.orderOut(None);
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
#[cfg(debug_assertions)]
fn preview_enabled() -> bool {
    std::env::var("AVEN_DEV_PRESENCE_PREVIEW").as_deref() == Ok("1")
}
#[cfg(debug_assertions)]
pub(super) fn preview() {
    std::thread::sleep(Duration::from_secs(4));
    let scope = "aven-dev-presence-preview";
    presence::with(|state| {
        state.bind(
            scope,
            Some(presence::resolve_actor(&presence::ActorInput {
                harness: Some("claude".into()),
                title: Some("Desktop control preview · no input".into()),
            })),
        )
    });
    let app = presence::AppIdentity::new("aven-dev-preview", "Aven Dev");
    let id =
        presence::with(|state| state.admit(scope, true, Some(&app), true, true, Instant::now()));
    let _ = show(None, false);
    std::thread::sleep(Duration::from_secs(12));
    if let presence::Admission::Ask(id) = id {
        presence::with(|state| {
            state.answer(id, true);
            state.take_outcome(id, Instant::now());
        });
    }
    let ticket = presence::with(|state| {
        state.begin(
            scope,
            presence::Step::Clicking,
            Some("Aven Dev".into()),
            Instant::now(),
        )
    });
    // Exercise the actual native interruption monitor without posting input.
    let _ = show(None, true);
    std::thread::sleep(Duration::from_secs(60));
    presence::with(|state| {
        if state.check(&ticket).is_ok() {
            state.pause(presence::Pause::UserActive);
        }
    });
    changed();
    std::thread::sleep(Duration::from_secs(12));
    presence::with(|state| {
        state.end(&ticket, Instant::now());
        state.forget(None);
    });
    changed();
}

pub(super) fn covers(point: super::Point) -> Result<bool, String> {
    main(move |_| {
        BAR.with(|slot| {
            slot.borrow().as_ref().is_some_and(|bar| {
                if !bar.panel.isVisible() {
                    return false;
                }
                let f = bar.panel.frame();
                let top = unsafe {
                    let r = CGDisplayBounds(CGMainDisplayID());
                    r.origin.y + r.size.height
                };
                point.x >= f.origin.x
                    && point.x < f.origin.x + f.size.width
                    && top - point.y >= f.origin.y
                    && top - point.y < f.origin.y + f.size.height
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
