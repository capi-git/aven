//! Opt-in live checks against a disposable AppKit fixture this test builds,
//! launches in the background, and quits. It never targets another app.
//!
//! Run with: AVEN_AX_LIVE=1 cargo test -p aven --lib live_fixture -- --ignored --nocapture
//! Requires the test process to be trusted for Accessibility.
use super::*;
use crate::desktop_presence::{self as presence_state, Step};
use std::sync::atomic::AtomicUsize;

type TapCallback = unsafe extern "C" fn(*mut c_void, u32, Event, *mut c_void) -> Event;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreate(source: Cf) -> Event;
    fn CGEventGetLocation(event: Event) -> Point;
    fn CGEventGetIntegerValueField(event: Cf, field: u32) -> i64;
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        mask: u64,
        callback: TapCallback,
        user: *mut c_void,
    ) -> Cf;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFMachPortCreateRunLoopSource(allocator: Cf, port: Cf, order: isize) -> Cf;
    fn CFRunLoopGetCurrent() -> Cf;
    fn CFRunLoopAddSource(run_loop: Cf, source: Cf, mode: Cf);
    fn CFRunLoopRunInMode(mode: Cf, seconds: f64, return_after_source: bool) -> i32;
    static kCFRunLoopDefaultMode: Cf;
}

static POINTER_EVENTS: AtomicUsize = AtomicUsize::new(0);
static OWN_POINTER_EVENTS: AtomicUsize = AtomicUsize::new(0);

unsafe extern "C" fn observe(_: *mut c_void, kind: u32, event: Event, _: *mut c_void) -> Event {
    // Tap-disabled notifications (0xFFFFFFFE/F) carry no event data.
    if kind < 0xFFFF_FFFE {
        POINTER_EVENTS.fetch_add(1, Ordering::SeqCst);
        // kCGEventSourceUnixProcessID (41) and kCGEventSourceUserData (42).
        let source = CGEventGetIntegerValueField(event.cast_const(), 41);
        let marker = CGEventGetIntegerValueField(event.cast_const(), 42);
        if source == i64::from(std::process::id()) || marker == presence::EVENT_MARKER {
            OWN_POINTER_EVENTS.fetch_add(1, Ordering::SeqCst);
        }
    }
    event
}

/// A passive, listen-only session tap for pointer events. It never changes or
/// blocks events; it counts any that this test process might have posted.
struct PointerWatch {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<bool>>,
}

impl PointerWatch {
    fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread = std::thread::spawn(move || unsafe {
            // Mouse down/up/moved/dragged (1-7), scroll (22), other buttons (25-27).
            let mask = (1..=7)
                .chain([22, 25, 26, 27])
                .fold(0_u64, |mask, kind| mask | (1 << kind));
            let tap = CGEventTapCreate(1, 0, 1, mask, observe, std::ptr::null_mut());
            let Ok(tap) = OwnedCf::new(tap, "") else {
                let _ = ready_tx.send(false);
                return false;
            };
            let source = OwnedCf::new(
                CFMachPortCreateRunLoopSource(std::ptr::null(), tap.0, 0),
                "",
            )
            .unwrap();
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source.0, kCFRunLoopDefaultMode);
            let _ = ready_tx.send(true);
            while !flag.load(Ordering::SeqCst) {
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
            }
            true
        });
        assert!(
            ready_rx.recv().unwrap_or(false),
            "could not observe pointer events"
        );
        Self {
            stop,
            thread: Some(thread),
        }
    }
    fn finish(mut self) -> (usize, usize) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        (
            POINTER_EVENTS.load(Ordering::SeqCst),
            OWN_POINTER_EVENTS.load(Ordering::SeqCst),
        )
    }
}

fn pointer() -> Point {
    unsafe {
        let event = OwnedCf::new(CGEventCreate(std::ptr::null()), "pointer").unwrap();
        CGEventGetLocation(event.event())
    }
}

/// The frontmost app according to LaunchServices (no main run loop needed).
fn frontmost_pid() -> Option<i32> {
    let front = Command::new("/usr/bin/lsappinfo")
        .arg("front")
        .output()
        .ok()?;
    let asn = String::from_utf8(front.stdout).ok()?.trim().to_owned();
    let info = Command::new("/usr/bin/lsappinfo")
        .args(["info", "-only", "pid", &asn])
        .output()
        .ok()?;
    // The line reads `pid = 1234 ...` (or `"pid"=1234`).
    let text = String::from_utf8(info.stdout).ok()?;
    let after = &text[text.find("pid")? + 3..];
    let digits: String = after
        .trim_start_matches(|c: char| c == '"' || c == '=' || c.is_whitespace())
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

struct Fixture {
    child: std::process::Child,
    receipt: PathBuf,
    directory: PathBuf,
}

impl Fixture {
    fn read(&self) -> Value {
        std::fs::read(&self.receipt)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null)
    }
    /// Waits for the fixture to report a condition (its timer runs at 20 Hz).
    fn wait(&self, what: &str, check: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..60 {
            let value = self.read();
            if check(&value) {
                return value;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("fixture never reported {what}: {}", self.read());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::write(self.receipt.with_extension("json.done"), []);
        std::thread::sleep(Duration::from_millis(300));
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn launch(nonce: &str) -> Fixture {
    let directory = std::env::temp_dir().join(format!("aven-ax-fixture-{nonce}"));
    std::fs::create_dir_all(&directory).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/desktop-accessibility-fixture.swift");
    let binary = directory.join("aven-ax-fixture");
    let built = Command::new("/usr/bin/xcrun")
        .args(["swiftc", "-O"])
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .status()
        .unwrap();
    assert!(built.success(), "fixture build failed");
    let receipt = directory.join("receipt.json");
    let child = Command::new(&binary)
        .arg(&receipt)
        .arg(nonce)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let fixture = Fixture {
        child,
        receipt,
        directory,
    };
    fixture.wait("start", |value| value["nonce"] == nonce);
    fixture
}

fn index_of(outline: &str, role: &str, needle: &str) -> u32 {
    outline
        .lines()
        .find(|line| {
            let line = line.trim_start();
            line.split_once("] ")
                .is_some_and(|(_, rest)| rest.starts_with(role) && rest.contains(needle))
        })
        .and_then(|line| {
            line.trim_start()
                .strip_prefix('[')?
                .split(']')
                .next()?
                .parse()
                .ok()
        })
        .unwrap_or_else(|| panic!("no {role} {needle} in:\n{outline}"))
}

fn done(next: Next) -> Value {
    match next {
        Next::Done(value) => value,
        Next::ClickAt { .. } => panic!("unexpected click-event fallback"),
        Next::ScrollAt { .. } => panic!("unexpected scroll-event fallback"),
        Next::Keys => panic!("unexpected key-event fallback"),
        Next::TypeKeys => panic!("unexpected typing fallback"),
    }
}

#[test]
#[ignore = "launches a disposable AppKit fixture; set AVEN_AX_LIVE=1"]
fn live_fixture_background_element_actions() {
    if std::env::var("AVEN_AX_LIVE").as_deref() != Ok("1") {
        eprintln!("AVEN_AX_LIVE is not set; skipping");
        return;
    }
    assert!(
        permissions().1,
        "the test process needs Accessibility access"
    );
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let secret = format!("fixture-secret-{}", &nonce[..8]);
    let fixture = launch(&nonce);
    let front_before = frontmost_pid();
    let watch = PointerWatch::start();
    let pointer_before = pointer();
    let start = fixture.read();
    let pid = start["pid"].as_i64().unwrap() as i32;
    let window_id = start["windowId"].as_u64().unwrap() as u32;
    let window = windows()
        .unwrap()
        .into_iter()
        .find(|window| window.window_id == window_id && window.pid == pid)
        .expect("fixture window is on screen");
    assert!(window.title.contains(&nonce));
    let bounds = window.bounds();
    let scope = "aven-ax-live-fixture";
    let ticket = presence_state::with(|state| {
        state.forget(None);
        state.begin(
            scope,
            Step::Clicking,
            Some("Fixture".into()),
            Instant::now(),
        )
    });
    let gate = || presence_state::with(|state| state.check(&ticket));
    let mut evidence = serde_json::Map::new();

    // 1. appState: indexed controls, secure value never read.
    let started = Instant::now();
    let state = capture_state(scope, pid, window_id, bounds, 400).unwrap();
    let outline = state["elements"].as_str().unwrap().to_owned();
    eprintln!("appState in {:?}:\n{outline}", started.elapsed());
    evidence.insert("appStateMs".into(), json!(started.elapsed().as_millis()));
    evidence.insert("count".into(), state["count"].clone());
    assert!(!outline.contains(&secret), "secure value leaked");
    assert!(outline.contains("SecureTextField") && outline.contains("value=<redacted>"));
    let state_id = state["stateId"].as_u64();
    let send = index_of(&outline, "Button", "\"Send\"");
    let find_in = |state: &Value, role: &str, needle: &str| {
        let index = index_of(state["elements"].as_str().unwrap(), role, needle);
        locate(
            scope,
            window_id,
            state["stateId"].as_u64(),
            index,
            pid,
            bounds,
        )
        .unwrap()
    };
    // Every action uses up the window's indexes: observe before each one,
    // and mark the end of an action the way the gate does.
    let observe = || capture_state(scope, pid, window_id, bounds, 400).unwrap();
    let acted = || invalidate(scope, window_id);

    // 2. click: AXPress.
    let value = done(
        click(
            &find_in(&state, "Button", "\"Send\""),
            Button::Left,
            1,
            &gate,
        )
        .unwrap(),
    );
    acted();
    assert_eq!(value["method"], "AXPress");
    fixture.wait("button press", |value| value["presses"] == 1);

    // 3. After an action, earlier indexes are refused even for a stateId
    // that is still the latest; the retitled button would also be stale.
    let error = locate(scope, window_id, state_id, send, pid, bounds)
        .err()
        .unwrap();
    assert!(
        error.contains("State changed; call appState again"),
        "{error}"
    );
    evidence.insert("usedIndexError".into(), json!(error));
    let state = observe();
    let error = locate(scope, window_id, state_id, send, pid, bounds)
        .err()
        .unwrap();
    assert!(error.starts_with(rules::STALE), "{error}");
    evidence.insert("supersededIndexError".into(), json!(error));

    // 4. setValue on a text field, then typeText at its caret.
    let value = done(
        set_value(
            &find_in(&state, "TextField", "placeholder=\"Name\""),
            &ElementValue::Text("Ada".into()),
            &gate,
        )
        .unwrap(),
    );
    acted();
    evidence.insert("setValue".into(), value);
    fixture.wait("name set", |value| value["name"] == "Ada");
    let field = find_in(&observe(), "TextField", "placeholder=\"Name\"");
    done(select_text(&field, None, Some((3, 0)), &gate).unwrap());
    acted();
    let field = find_in(&observe(), "TextField", "placeholder=\"Name\"");
    let value = done(type_text(Some(&field), true, " Lovelace", &gate).unwrap());
    acted();
    evidence.insert("typeText".into(), value);
    fixture.wait("typed text", |value| value["name"] == "Ada Lovelace");
    let field = find_in(&observe(), "TextField", "placeholder=\"Name\"");
    let value = done(
        press_key(
            Some(&field),
            true,
            "Backspace",
            false,
            (pid, window_id, bounds),
            &gate,
        )
        .unwrap(),
    );
    acted();
    evidence.insert("backspace".into(), value);
    fixture.wait("backspace", |value| value["name"] == "Ada Lovelac");

    // 5. Text area: Enter inserts a newline at the caret.
    let area = find_in(&observe(), "TextArea", "Notes");
    done(select_text(&area, None, Some((5, 0)), &gate).unwrap());
    acted();
    let area = find_in(&observe(), "TextArea", "Notes");
    let value = done(
        press_key(
            Some(&area),
            true,
            "Enter",
            false,
            (pid, window_id, bounds),
            &gate,
        )
        .unwrap(),
    );
    acted();
    evidence.insert("enterInTextArea".into(), value);
    let area = find_in(&observe(), "TextArea", "Notes");
    done(type_text(Some(&area), true, "World", &gate).unwrap());
    acted();
    fixture.wait("notes", |value| value["notes"] == "Hello\nWorld");

    // 6. Slider: setValue and arrow → AXIncrement.
    let slider = find_in(&observe(), "Slider", "Volume");
    done(set_value(&slider, &ElementValue::Number(75.0), &gate).unwrap());
    acted();
    fixture.wait("slider set", |value| value["slider"] == 75.0);
    let slider = find_in(&observe(), "Slider", "Volume");
    let value = done(
        press_key(
            Some(&slider),
            true,
            "ArrowUp",
            false,
            (pid, window_id, bounds),
            &gate,
        )
        .unwrap(),
    );
    acted();
    assert_eq!(value["method"], "AXIncrement");
    fixture.wait("slider increment", |value| {
        value["slider"].as_f64().unwrap() > 75.0
    });

    // 7. Scroll the table's scroll area by a page.
    let rows = find_in(&observe(), "Table", "Rows");
    let value = done(scroll(&rows, Some(ScrollDirection::Down), 1, None, &gate).unwrap());
    acted();
    evidence.insert("scroll".into(), value);
    let scrolled = fixture.wait("scroll", |value| {
        value["scrollY"].as_f64().unwrap_or(0.0) > 0.0
    });
    evidence.insert("scrollY".into(), scrolled["scrollY"].clone());

    // 7b. Untitled rows are told apart by their content, not position. A row
    // inserted above after appState makes the observed row stale.
    let rows_state = observe();
    let rows_outline = rows_state["elements"].as_str().unwrap().to_owned();
    eprintln!("rows:\n{rows_outline}");
    let first_row = index_of(&rows_outline, "Row:TableRow", "@");
    let rows_id = rows_state["stateId"].as_u64();
    std::fs::write(fixture.receipt.with_extension("json.insert"), []).unwrap();
    fixture.wait("row insert", |value| value["inserted"] == 1);
    let shifted = locate(scope, window_id, rows_id, first_row, pid, bounds)
        .err()
        .expect("a row whose content changed underneath its index must be refused");
    assert!(shifted.starts_with(rules::STALE), "{shifted}");
    evidence.insert("rowInsertedError".into(), json!(shifted));
    assert_eq!(fixture.read()["selectedRow"], -1, "nothing was selected");

    // 7c. Rows have no press action: a click selects the row.
    let rows_state = observe();
    let rows_outline = rows_state["elements"].as_str().unwrap().to_owned();
    let row = index_of(&rows_outline, "Row:TableRow", "@");
    let row = locate(
        scope,
        window_id,
        rows_state["stateId"].as_u64(),
        row,
        pid,
        bounds,
    )
    .unwrap();
    let value = done(click(&row, Button::Left, 1, &gate).unwrap());
    acted();
    assert_eq!(value["method"], "AXSelected");
    let selected = fixture.wait("row selection", |value| {
        value["selectedRow"].as_i64() >= Some(0)
    });
    evidence.insert("selectedRow".into(), selected["selectedRow"].clone());

    // 8. Context menu: AXShowMenu, read the open menu, pick an item.
    let options = find_in(&observe(), "Button", "\"Options\"");
    let value = done(secondary(&options, None, &gate).unwrap());
    acted();
    evidence.insert("showMenu".into(), value);
    fixture.wait("menu open", |value| value["menuOpened"] == 1);
    let menu_state = observe();
    let menu_outline = menu_state["elements"].as_str().unwrap();
    eprintln!("with menu open:\n{menu_outline}");
    assert!(
        menu_state["openMenus"].as_u64().unwrap() >= 1,
        "{menu_state}"
    );
    evidence.insert("openMenus".into(), menu_state["openMenus"].clone());
    let item = find_in(&menu_state, "MenuItem", "\"Beta\"");
    let value = done(click(&item, Button::Left, 1, &gate).unwrap());
    acted();
    evidence.insert("menuItem".into(), value);
    fixture.wait("menu choice", |value| value["menuChoice"] == "Beta");

    // 9. Pause refuses the next mutation before it reaches the app.
    let target = find_in(&observe(), "Button", "\"Sent\"");
    presence_state::with(|state| state.pause(presence_state::Pause::ByUser));
    let paused = click(&target, Button::Left, 1, &gate).err().unwrap();
    assert!(
        paused.starts_with(presence_state::PAUSED_BY_USER),
        "{paused}"
    );
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(fixture.read()["presses"], 1, "paused input reached the app");
    evidence.insert("pausedError".into(), json!(paused));
    presence_state::with(|state| state.forget(None));

    // 10. The pointer never moved; the fixture never became active or key.
    let end = fixture.read();
    let pointer_after = pointer();
    let front_after = frontmost_pid();
    let (pointer_events, own_pointer_events) = watch.finish();
    evidence.insert(
        "pointer".into(),
        json!({
            "before": [pointer_before.x, pointer_before.y],
            "after": [pointer_after.x, pointer_after.y],
            "userPointerEventsDuringTest": pointer_events - own_pointer_events,
            "pointerEventsFromThisProcess": own_pointer_events,
        }),
    );
    evidence.insert(
        "frontmost".into(),
        json!({"before": front_before, "after": front_after, "fixture": pid}),
    );
    evidence.insert("receipt".into(), end.clone());
    eprintln!("EVIDENCE {}", Value::Object(evidence));
    assert_eq!(own_pointer_events, 0, "this process posted pointer events");
    // The user may be using their Mac. A moved pointer is only acceptable when
    // the tap saw their own pointer events, none of which came from this test.
    assert!(
        pointer_before == pointer_after || pointer_events > 0,
        "the system pointer moved without any user pointer event"
    );
    assert_eq!(
        end["activeEver"], false,
        "the fixture became the active app"
    );
    assert_eq!(end["keyEver"], false, "the fixture window became key");
    assert_ne!(front_after, Some(pid));
    assert_ne!(front_before, Some(pid));
    assert_eq!(
        end["passwordLength"].as_u64(),
        Some(secret.chars().count() as u64)
    );
    forget(Some(scope));
    assert!(locate(scope, window_id, None, 0, pid, bounds).is_err());
}
