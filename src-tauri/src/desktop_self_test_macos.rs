//! Opt-in debug-only input checks against an owned window and a disposable
//! AppKit receiver launched from this development bundle directory. Never posts
//! HID input or changes permissions/settings; existing opt-in and TCC gates apply.
use super::*;
use objc2::{define_class, MainThreadOnly};
use objc2_app_kit::{NSBackingStoreType, NSColor, NSEvent, NSPanel, NSView, NSWindowStyleMask};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSPoint, NSRect, NSSize};
use std::cell::RefCell;
use std::sync::atomic::AtomicUsize;

static DOWNS: AtomicUsize = AtomicUsize::new(0);
static UPS: AtomicUsize = AtomicUsize::new(0);
static DRAGS: AtomicUsize = AtomicUsize::new(0);
static INTERRUPT: AtomicUsize = AtomicUsize::new(0);
static LAST_UP: Mutex<Option<(f64, f64)>> = Mutex::new(None);
const SCOPE: &str = "aven-dev-owned-input-fixture";
static USER_EVENTS: Mutex<Vec<Value>> = Mutex::new(Vec::new());
pub(super) fn record_event(event: Value) {
    if std::env::var("AVEN_DEV_DESKTOP_SELF_TEST").as_deref() != Ok("1") {
        return;
    }
    if let Ok(mut events) = USER_EVENTS.lock() {
        if events.len() < 256 {
            events.push(event);
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
        fn up(&self,event:&NSEvent){
            UPS.fetch_add(1,Ordering::SeqCst);
            let point=event.locationInWindow();
            *LAST_UP.lock().unwrap()=Some((point.x,point.y));
        }
        #[unsafe(method(mouseDragged:))]
        fn dragged(&self,_:&NSEvent){
            DRAGS.fetch_add(1,Ordering::SeqCst);
            match INTERRUPT.swap(0,Ordering::SeqCst) {
                1 => presence::with(|state| state.pause(presence::Pause::ByUser)),
                2 => presence::with(|state| state.stop(SCOPE,Instant::now())),
                _ => return,
            }
            presence_ui::changed();
        }
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

fn external_receiver(app: &AppHandle, scope: &str) -> Result<Value, String> {
    let nonce = uuid::Uuid::new_v4().to_string();
    let receipt = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!("aven.input-receiver-{nonce}.json"));
    let done = receipt.with_extension("json.done");
    struct Finish(PathBuf);
    impl Drop for Finish {
        fn drop(&mut self) {
            let _ = std::fs::write(&self.0, []);
        }
    }
    let _finish = Finish(done);
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = executable
        .ancestors()
        .nth(4)
        .ok_or("No fixture bundle directory")?
        .join("Aven Input Fixture.app");
    let _launcher = Command::new("/usr/bin/open")
        .args(["-W", "-n", "-g", "-a"])
        .arg(bundle)
        .arg("--args")
        .arg(&receipt)
        .arg(&nonce)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let read = || -> Result<Value, String> {
        serde_json::from_slice(&std::fs::read(&receipt).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    };
    let mut initial = None;
    for _ in 0..100 {
        if let Ok(value) = read() {
            if value["nonce"] == nonce {
                initial = Some(value);
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let initial = initial.ok_or("The separate native input receiver did not start.")?;
    std::thread::sleep(Duration::from_millis(500));
    let pid = initial["pid"].as_i64().ok_or("No receiver PID")? as i32;
    let window = initial["windowId"].as_u64().ok_or("No receiver window")? as u32;
    let observed = windows()?
        .into_iter()
        .find(|w| w.window_id == window && w.pid == pid && w.title.contains(&nonce))
        .ok_or("Receiver identity did not match its observed window")?;
    let actions = [
        json!({"action":"click","windowId":window,"x":80,"y":100}),
        json!({"action":"scroll","windowId":window,"x":80,"y":100,"deltaY":80}),
        json!({"action":"drag","windowId":window,"from":{"x":80,"y":100},"to":{"x":160,"y":120},"durationMs":150}),
        json!({"action":"click","windowId":window,"x":320,"y":observed.height-54.0}),
        json!({"action":"click","windowId":window,"x":80,"y":observed.height-54.0}),
        json!({"action":"type","windowId":window,"text":"Aven QA"}),
        json!({"action":"press","windowId":window,"key":"Backspace"}),
    ];
    for value in actions {
        let request: Request = serde_json::from_value(value).map_err(|e| e.to_string())?;
        let target = presence_target(app, &request)?;
        if target.pid != Some(pid) || target.window_id != Some(window) || target.shared_input {
            return Err("Test refused an unexpected receiver target".into());
        }
        presence::with(|state| {
            if let presence::Admission::Ask(id) =
                state.admit(scope, true, target.app.as_ref(), true, true, Instant::now())
            {
                state.answer(id, true);
                state.take_outcome(id, Instant::now());
            }
        });
        if let Err(error) = super::super::execute(app, scope, request, &|| true) {
            std::thread::sleep(Duration::from_millis(300));
            record_event(json!({"externalReceiverError":error,"receipt":read().ok()}));
            return Err(error);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let result = read()?;
    if result["down"] != 2
        || result["up"] != 2
        || result["scrolled"] != 1
        || result["dragged"].as_u64().unwrap_or(0) == 0
        || result["x"] != 160.0
        || result["y"] != observed.height - 120.0
        || result["buttonPresses"] != 1
        || result["typedAndBackspace"] != true
    {
        record_event(json!({"externalReceiverFailed":result}));
        return Err("The separate AppKit receiver did not confirm every input.".into());
    }
    Ok(result)
}
pub(super) fn run(app: &AppHandle) {
    std::thread::sleep(Duration::from_secs(6));
    let scope = SCOPE;
    let result = (|| -> Result<Value, String> {
        let status = super::super::current_status(app)?;
        if status.state != "ready" {
            return Err("Aven Dev needs its existing desktop opt-in and both permissions for this test; no settings were changed.".into());
        }
        let window = create(app)?;
        std::thread::sleep(Duration::from_millis(200));
        record_event(
            json!({"fixtureWindow":window,"bounds":windows()?.into_iter().find(|w| w.window_id == window)}),
        );
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
        let perform = |value: Value| -> Result<Value, String> {
            let request: Request = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let target = presence_target(app, &request)?;
            if target.pid != Some(std::process::id() as i32) || target.shared_input {
                return Err("Self-test refused a target outside its own app.".into());
            }
            super::super::execute(app, scope, request, &|| true)
        };
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
        let counts = [
            DOWNS.load(Ordering::SeqCst),
            UPS.load(Ordering::SeqCst),
            DRAGS.load(Ordering::SeqCst),
            SCROLLS.load(Ordering::SeqCst),
        ];
        let expected_y = window_bounds(window)?.height - 120.0;
        let drag_endpoint = LAST_UP
            .lock()
            .unwrap()
            .is_some_and(|(x, y)| (x - 160.0).abs() < 0.01 && (y - expected_y).abs() < 0.01);
        let external = external_receiver(app, scope)?;
        let button_pressed = external["buttonPresses"] == 1;
        let typed = external["typedAndBackspace"] == true;
        let mut interruptions = Vec::new();
        for mode in [1, 2] {
            let up_before = UPS.load(Ordering::SeqCst);
            INTERRUPT.store(mode, Ordering::SeqCst);
            let result = perform(
                json!({"action":"drag","windowId":window,"from":{"x":80,"y":100},"to":{"x":260,"y":120},"durationMs":600}),
            );
            std::thread::sleep(Duration::from_millis(150));
            let fired = INTERRUPT.load(Ordering::SeqCst) == 0;
            let released = UPS.load(Ordering::SeqCst) == up_before + 1;
            interruptions.push(json!({"mode":mode,"interrupted":result.is_err(),"fired":fired,"released":released}));
            if !fired || result.is_ok() || !released {
                return Err("Controlled interruption did not release the test drag.".into());
            }
            if mode == 1 {
                // Resume only the pause deliberately raised by this fixture.
                presence::with(|state| state.resume());
            }
        }
        let after = pointer()?;
        let front_after = presence_ui::frontmost_pid()?;
        Ok(
            json!({"passed":counts[0]==2 && counts[1]==2 && counts[2]>0 && counts[3]>0 && drag_endpoint && button_pressed && typed && before==after && front_before==front_after,"down":counts[0],"up":counts[1],"dragged":counts[2],"scrolled":counts[3],"dragEndpoint":drag_endpoint,"externalReceiver":external,"buttonPressed":button_pressed,"typedAndBackspace":typed,"interruptions":interruptions,"pointerUnchanged":before==after,"foregroundUnchanged":front_before==front_after,"target":"owned disposable Aven Dev view","inputMode":"app"}),
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
