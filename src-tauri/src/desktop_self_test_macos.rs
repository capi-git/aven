//! Opt-in debug-only input receipt against an owned disposable window. Never
//! posts HID input, activates an app, or alters permissions/settings. The real
//! opt-in and TCC gates must already be satisfied. No external scope is used.
use super::*;
use objc2::{define_class, MainThreadOnly};
use objc2_app_kit::{NSBackingStoreType, NSColor, NSEvent, NSPanel, NSView, NSWindowStyleMask};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize};
use std::cell::RefCell;
use std::sync::atomic::AtomicUsize;

static DOWNS: AtomicUsize = AtomicUsize::new(0);
static UPS: AtomicUsize = AtomicUsize::new(0);
static DRAGS: AtomicUsize = AtomicUsize::new(0);
static USER_EVENTS: Mutex<Vec<Value>> = Mutex::new(Vec::new());
pub(super) fn record_event(kind: u32, marked: bool, source_pid: i64, front: Option<i32>) {
    if std::env::var("AVEN_DEV_DESKTOP_SELF_TEST").as_deref() != Ok("1") {
        return;
    }
    if let Ok(mut events) = USER_EVENTS.lock() {
        if events.len() < 64 {
            events.push(
                json!({"kind":kind,"marked":marked,"sourcePid":source_pid,"frontmostPid":front}),
            );
        }
    }
}

static SCROLLS: AtomicUsize = AtomicUsize::new(0);
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: Cf) -> Event;
    fn CGEventGetLocation(event: Event) -> Point;
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind=MainThreadOnly]
    #[name="AvenDesktopInputFixture"]
    struct Fixture;
    unsafe impl NSObjectProtocol for Fixture {}
    impl Fixture {
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self,_:&NSEvent)->bool {true}
        #[unsafe(method(mouseDown:))]
        fn down(&self,_:&NSEvent){DOWNS.fetch_add(1,Ordering::SeqCst);}
        #[unsafe(method(mouseUp:))]
        fn up(&self,_:&NSEvent){UPS.fetch_add(1,Ordering::SeqCst);}
        #[unsafe(method(mouseDragged:))]
        fn dragged(&self,_:&NSEvent){DRAGS.fetch_add(1,Ordering::SeqCst);}
        #[unsafe(method(scrollWheel:))]
        fn scrolled(&self,_:&NSEvent){SCROLLS.fetch_add(1,Ordering::SeqCst);}
    }
);
thread_local! {static FIXTURE:RefCell<Option<Retained<NSPanel>>>=const{RefCell::new(None)};}
fn pointer() -> Result<Point, String> {
    unsafe {
        let event = OwnedCf::new(CGEventCreate(std::ptr::null()), "Could not read pointer")?;
        Ok(CGEventGetLocation(event.event()))
    }
}
fn create(app: &AppHandle) -> Result<u32, String> {
    activation_on_main(app, Instant::now() + Duration::from_secs(2), || {
        let mtm = MainThreadMarker::new().ok_or("Not on main thread")?;
        let frame = NSRect::new(NSPoint::new(420.0, 350.0), NSSize::new(440.0, 260.0));
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
            NSPanel::alloc(mtm),
            frame,
            NSWindowStyleMask::Titled | NSWindowStyleMask::NonactivatingPanel,
            NSBackingStoreType::Buffered,
            false,
        );
        unsafe {
            panel.setReleasedWhenClosed(false);
        }
        panel.setHidesOnDeactivate(false);
        panel.setTitle(&NSString::from_str("Aven Dev · disposable input check"));
        panel.setBackgroundColor(Some(&NSColor::windowBackgroundColor()));
        let view = Fixture::alloc(mtm).set_ivars(());
        let view: Retained<Fixture> = unsafe {
            msg_send![super(view),initWithFrame:NSRect::new(NSPoint::new(0.0,0.0),frame.size)]
        };
        panel.setContentView(Some(&view));
        panel.orderFrontRegardless(); // never make key or activate
        let id = panel.windowNumber() as u32;
        FIXTURE.with(|slot| *slot.borrow_mut() = Some(panel));
        Ok(id)
    })
}
fn receipt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("aven.desktop-input-self-test.json"))
}
pub(super) fn run(app: &AppHandle) {
    std::thread::sleep(Duration::from_secs(6));
    let scope = "aven-dev-owned-input-fixture";
    let result = (|| -> Result<Value, String> {
        let status = super::super::current_status(app)?;
        if status.state != "ready" {
            return Err("Aven Dev needs its existing desktop opt-in and both permissions for this test; no settings were changed.".into());
        }
        let window = create(app)?;
        std::thread::sleep(Duration::from_millis(200));
        let before = pointer()?;
        let front_before = presence_ui::frontmost_pid()?;
        bind_session(scope)?;
        presence::with(|state| {
            state.bind(
                scope,
                Some(presence::resolve_actor(&presence::ActorInput {
                    harness: Some("codex".into()),
                    title: Some("Owned native input fixture".into()),
                })),
            )
        });
        let actions = [
            json!({"action":"click","windowId":window,"x":80,"y":100}),
            json!({"action":"scroll","windowId":window,"x":80,"y":100,"deltaY":80}),
            json!({"action":"drag","windowId":window,"from":{"x":80,"y":100},"to":{"x":160,"y":120},"durationMs":150}),
        ];
        for value in actions {
            let request: Request = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let target = presence_target(app, &request)?;
            if target.pid != Some(std::process::id() as i32) || target.shared_input {
                return Err("Self-test refused a target outside its own app.".into());
            }
            // Seed a grant only for the fixture's synthetic test scope. This
            // never grants an agent access or changes a persisted preference.
            presence::with(|state| {
                if let presence::Admission::Ask(id) =
                    state.admit(scope, true, target.app.as_ref(), true, true, Instant::now())
                {
                    state.answer(id, true);
                    state.take_outcome(id, Instant::now());
                }
            });
            super::super::execute(app, scope, request, &|| true)?;
            std::thread::sleep(Duration::from_millis(120));
        }
        let after = pointer()?;
        let front_after = presence_ui::frontmost_pid()?;
        let counts = [
            DOWNS.load(Ordering::SeqCst),
            UPS.load(Ordering::SeqCst),
            DRAGS.load(Ordering::SeqCst),
            SCROLLS.load(Ordering::SeqCst),
        ];
        Ok(
            json!({"passed":counts[0]==2 && counts[1]==2 && counts[2]>0 && counts[3]>0 && before==after && front_before==front_after,"down":counts[0],"up":counts[1],"dragged":counts[2],"scrolled":counts[3],"pointerUnchanged":before==after,"foregroundUnchanged":front_before==front_after,"target":"owned disposable Aven Dev view","inputMode":"app"}),
        )
    })();
    super::super::remove_session_captures(scope);
    let _ = activation_on_main(app, Instant::now() + Duration::from_secs(2), || {
        FIXTURE.with(|slot| {
            if let Some(panel) = slot.borrow_mut().take() {
                panel.orderOut(None);
            }
        });
        Ok(())
    });
    let mut value = match result {
        Ok(value) => value,
        Err(error) => json!({"passed":false,"error":error}),
    };
    value["receivedEvents"] = json!({"down":DOWNS.load(Ordering::SeqCst),"up":UPS.load(Ordering::SeqCst),"dragged":DRAGS.load(Ordering::SeqCst),"scrolled":SCROLLS.load(Ordering::SeqCst)});
    value["observedEventMetadata"] = USER_EVENTS
        .lock()
        .map_or_else(|_| json!([]), |events| json!(*events));
    if let Ok(path) = receipt_path(app) {
        let _ = super::super::write_private_json(&path, &value);
    }
}
