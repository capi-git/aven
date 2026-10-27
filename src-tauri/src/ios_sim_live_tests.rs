//! Opt-in live check of the iPhone pane's native path on a throwaway
//! simulator this test creates and deletes. It never touches other devices.
//!
//! Run with:
//!   AVEN_IOS_SIM_LIVE=1 cargo test -p aven --lib ios_sim_live -- --ignored --nocapture
//!
//! It boots the device, runs the post-boot input fix, builds and runs the
//! sample app in `tests/fixtures/ios-sample` through the Run pipeline, taps
//! and types through SimulatorKit, reads the results back through Aven's
//! XCUITest agent, rotates, presses Home, and takes framebuffer screenshots.
use super::*;

struct Throwaway(String);

impl Drop for Throwaway {
    fn drop(&mut self) {
        crate::ios_sim_xcuitest::shutdown();
        let _ = simctl(&["shutdown", &self.0], Duration::from_secs(120));
        let _ = simctl(&["delete", &self.0], Duration::from_secs(120));
        eprintln!("deleted throwaway simulator {}", self.0);
    }
}

/// The newest iOS runtime and an iPhone it supports (a Pro when there is one).
fn newest_iphone() -> (String, String) {
    let output = simctl(&["list", "runtimes", "-j"], Duration::from_secs(30)).unwrap();
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut runtimes: Vec<&Value> = value["runtimes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| {
            r["isAvailable"] == true && r["identifier"].as_str().unwrap_or("").contains(".iOS-")
        })
        .collect();
    runtimes.sort_by_key(|r| {
        r["version"]
            .as_str()
            .unwrap_or("0")
            .split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    let runtime = runtimes.last().expect("an iOS simulator runtime");
    let types = runtime["supportedDeviceTypes"].as_array().unwrap();
    let iphone = types
        .iter()
        .filter(|t| t["productFamily"] == "iPhone")
        .find(|t| t["name"].as_str().unwrap_or("").ends_with(" Pro"))
        .or_else(|| types.iter().find(|t| t["productFamily"] == "iPhone"))
        .expect("an iPhone device type");
    (
        iphone["identifier"].as_str().unwrap().to_owned(),
        runtime["identifier"].as_str().unwrap().to_owned(),
    )
}

fn node<'a>(snapshot: &'a Value, id: &str) -> Option<&'a Value> {
    snapshot["nodes"].as_array()?.iter().find(|n| n["id"] == id)
}

fn centre(node: &Value) -> (f64, f64) {
    let f: Vec<f64> = node["frame"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect();
    (f[0] + f[2] / 2.0, f[1] + f[3] / 2.0)
}

fn label(snapshot: &Value, id: &str) -> String {
    node(snapshot, id)
        .and_then(|n| n["label"].as_str())
        .unwrap_or("")
        .to_owned()
}

/// Saves a framebuffer screenshot for a failing step (AVEN_IOS_SIM_SHOTS).
fn debug_shot(udid: &str, name: &str) {
    let Some(dir) = std::env::var_os("AVEN_IOS_SIM_SHOTS") else {
        return;
    };
    let turns = screen(udid).map(|s| s.turns).unwrap_or(0);
    if let Ok(png) = native::screenshot_png(udid, turns) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(Path::new(&dir).join(format!("{name}.png")), png);
    }
}

fn wait_for(what: &str, timeout: Duration, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[test]
#[ignore]
fn ios_sim_live_round_trip() {
    if std::env::var_os("AVEN_IOS_SIM_LIVE").is_none() {
        eprintln!("set AVEN_IOS_SIM_LIVE=1 to run");
        return;
    }
    let support = support();
    assert!(support.xcode, "Xcode is required");
    assert!(
        support.live,
        "native path unavailable: {:?}",
        support.reason
    );

    let (device_type, runtime) = newest_iphone();
    let name = format!("Aven Dev iPhone Test {}", std::process::id());
    let created = simctl(
        &["create", &name, &device_type, &runtime],
        Duration::from_secs(120),
    )
    .unwrap();
    let udid = String::from_utf8_lossy(&checked(created, "create").unwrap())
        .trim()
        .to_owned();
    assert!(ios_sim_devices::valid_udid(&udid), "{udid}");
    let _cleanup = Throwaway(udid.clone());
    eprintln!("created {name} ({device_type}, {runtime}): {udid}");

    // A fresh copy of the sample, so builds write nothing into the checkout.
    let project = std::env::temp_dir().join(format!("aven-ios-sample-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ios-sample");
    let copied = Command::new("/bin/cp")
        .arg("-R")
        .arg(&fixture)
        .arg(&project)
        .status()
        .unwrap();
    assert!(copied.success());
    let project = project.to_string_lossy().into_owned();

    let started = Instant::now();
    ensure_device(&project, &udid, None).unwrap();
    eprintln!("boot + input fix: {:.1} s", started.elapsed().as_secs_f64());
    assert!(scoped_devices(&project).contains(&udid.to_uppercase()));
    assert_eq!(
        notify_flag(&udid),
        Some(0),
        "the HID announcement flag stays cleared"
    );

    let info = native::display_info(&udid).unwrap();
    eprintln!("display: {info:?}");
    assert!(info.width > 300.0 && info.height > info.width && info.scale >= 2.0);
    let png = native::screenshot_png(&udid, 0).unwrap();
    assert_eq!(
        png_size(&png),
        Some((
            (info.width * info.scale) as u32,
            (info.height * info.scale) as u32
        ))
    );

    let listed = project_info(&project, None);
    assert_eq!(listed.schemes, ["SpikeApp"], "{:?}", listed.error);
    let container = listed.container.unwrap();
    let started = Instant::now();
    let generation = start_run(RunRequest {
        project: project.clone(),
        udid: udid.clone(),
        container: container.path.to_string_lossy().into_owned(),
        scheme: "SpikeApp".into(),
    })
    .unwrap();
    wait_for("the app to run", Duration::from_secs(600), || {
        let status = status_of(&project);
        assert_ne!(
            status.phase,
            Phase::Failed,
            "{}: {:?}",
            status.message,
            status.errors
        );
        status.phase == Phase::Running
    });
    let status = status_of(&project);
    eprintln!(
        "run: {} (pipeline {:.1} s, generation {generation})",
        status.message,
        started.elapsed().as_secs_f64()
    );
    let bundle = status.bundle_id.clone().unwrap();
    wait_for("the app's console", Duration::from_secs(30), || {
        recent_logs(&project, 100)
            .iter()
            .any(|l| l.contains("SPIKE launched"))
    });

    // Relaunching without a build is fast.
    let started = Instant::now();
    relaunch(&project, &udid, &bundle).unwrap();
    wait_for("the relaunch", Duration::from_secs(60), || {
        status_of(&project).phase == Phase::Running
    });
    eprintln!("relaunch: {:.2} s", started.elapsed().as_secs_f64());
    std::thread::sleep(Duration::from_secs(2));

    let started = Instant::now();
    let mut agent = crate::ios_sim_xcuitest::connect(&udid, Some(&bundle)).unwrap();
    eprintln!(
        "XCUITest agent ready: {:.1} s",
        started.elapsed().as_secs_f64()
    );
    let snap = || {
        crate::ios_sim_xcuitest::connect(&udid, Some(&bundle))
            .unwrap()
            .request(json!({ "action": "snapshot" }))
            .unwrap()
    };
    let started = Instant::now();
    let first = agent.request(json!({ "action": "snapshot" })).unwrap();
    eprintln!(
        "snapshot: {} ms\n{}",
        started.elapsed().as_millis(),
        crate::ios_sim_xcuitest::outline(&first)
    );
    assert_eq!(label(&first, "tapCount"), "Taps: 0");

    // A native tap on the button.
    let screen_now = screen(&udid).unwrap();
    let (x, y) = centre(node(&first, "tapButton").unwrap());
    let (dx, dy) = screen_now.to_device(x, y);
    let started = Instant::now();
    tap(&udid, dx, dy).unwrap();
    eprintln!("tap sent: {} ms", started.elapsed().as_millis());
    wait_for("the tap", Duration::from_secs(5), || {
        label(&snap(), "tapCount") == "Taps: 1"
    });
    wait_for("the tap's log line", Duration::from_secs(5), || {
        recent_logs(&project, 200)
            .iter()
            .any(|l| l.contains("SPIKE tap 1"))
    });

    // Typing: US keys, then a word with an accent through the pasteboard.
    let (x, y) = centre(node(&first, "textField").unwrap());
    let (dx, dy) = screen_now.to_device(x, y);
    tap(&udid, dx, dy).unwrap();
    std::thread::sleep(Duration::from_millis(600));
    let started = Instant::now();
    // No sentence ends: iOS capitalises after "!" even from a keyboard.
    type_text(&udid, "Hello Aven 123").unwrap();
    eprintln!("typed 14 characters: {} ms", started.elapsed().as_millis());
    wait_for("typed text", Duration::from_secs(5), || {
        label(&snap(), "echo") == "Echo: Hello Aven 123"
    });
    type_text(&udid, " café").unwrap();
    std::thread::sleep(Duration::from_secs(2));
    debug_shot(&udid, "after-paste");
    let pasteboard = simctl(&["pbpaste", &udid], Duration::from_secs(10))
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    eprintln!(
        "pasteboard {pasteboard:?}; echo {:?}",
        label(&snap(), "echo")
    );
    wait_for("pasted text", Duration::from_secs(10), || {
        label(&snap(), "echo") == "Echo: Hello Aven 123 café"
    });
    press_named_key(&udid, "Backspace").unwrap();
    wait_for("a key press", Duration::from_secs(5), || {
        label(&snap(), "echo") == "Echo: Hello Aven 123 caf"
    });
    assert_eq!(notify_flag(&udid), Some(0), "pasting leaves input working");

    // Landscape: the framebuffer stays portrait; taps map through the turn.
    set_orientation(&udid, "landscapeLeft").unwrap();
    wait_for("landscape", Duration::from_secs(10), || {
        matches!(
            native::display_info(&udid).map(|i| i.orientation),
            Ok(3 | 4)
        )
    });
    std::thread::sleep(Duration::from_secs(1));
    let turned = screen(&udid).unwrap();
    eprintln!(
        "landscape: orientation {} → {} quarter turns, flag after devicectl {:?}",
        turned.info.orientation,
        turned.turns,
        notify_flag(&udid)
    );
    let (w, h) = turned.size();
    assert!(w > h);
    let png = native::screenshot_png(&udid, turned.turns).unwrap();
    assert_eq!(
        png_size(&png),
        Some((
            (w * turned.info.scale) as u32,
            (h * turned.info.scale) as u32
        ))
    );
    let _ = std::fs::write(
        std::env::temp_dir().join("aven-ios-sim-landscape.png"),
        &png,
    );
    let landscape = snap();
    let (x, y) = centre(node(&landscape, "tapButton").unwrap());
    let (dx, dy) = turned.to_device(x, y);
    tap(&udid, dx, dy).unwrap();
    wait_for("a landscape tap", Duration::from_secs(5), || {
        label(&snap(), "tapCount") == "Taps: 2"
    });
    set_orientation(&udid, "portrait").unwrap();
    wait_for("portrait", Duration::from_secs(10), || {
        matches!(native::display_info(&udid).map(|i| i.orientation), Ok(1))
    });

    // Home leaves the app.
    press_button(&udid, native::Button::Home).unwrap();
    std::thread::sleep(Duration::from_secs(2));
    let home = crate::ios_sim_xcuitest::connect(&udid, None)
        .unwrap()
        .request(json!({ "action": "snapshot" }))
        .unwrap();
    assert!(
        crate::ios_sim_xcuitest::outline(&home).contains("SpikeApp"),
        "the home screen shows the app's icon"
    );

    stop(&project);
    assert_eq!(status_of(&project).phase, Phase::Stopped);
    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(project_dir(&project).unwrap());
}
