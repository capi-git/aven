//! Opt-in timing of the iPhone pane's phases on a throwaway simulator, so a
//! change can be measured the same way before and after.
//!
//! Run with:
//!   AVEN_IOS_SIM_PERF=1 AVEN_IOS_SIM_PERF_UDID=<udid> AVEN_IOS_SIM_PERF_APP=<folder> \
//!     cargo test -p aven --lib ios_sim_perf -- --ignored --nocapture --test-threads=1
//!
//! The simulator must be named "Aven Perf …": the test erases, boots and shuts
//! it down. `AVEN_IOS_SIM_PERF_APP` is a folder with a small Xcode app (the
//! sample in `tests/fixtures/ios-sample` works); it is copied first, so its
//! builds write nothing there. Nothing else is touched.
use super::*;

fn perf_device() -> Option<(String, PathBuf)> {
    if std::env::var_os("AVEN_IOS_SIM_PERF").is_none() {
        eprintln!("set AVEN_IOS_SIM_PERF=1 to run");
        return None;
    }
    let udid = std::env::var("AVEN_IOS_SIM_PERF_UDID").expect("AVEN_IOS_SIM_PERF_UDID");
    let app = std::env::var("AVEN_IOS_SIM_PERF_APP").expect("AVEN_IOS_SIM_PERF_APP");
    let devices = list_devices().unwrap();
    let device = devices
        .iter()
        .find(|d| d.udid.eq_ignore_ascii_case(&udid))
        .expect("the perf simulator");
    assert!(
        device.name.starts_with("Aven Perf"),
        "refusing to use {} for timing",
        device.name
    );
    Some((udid.to_uppercase(), PathBuf::from(app)))
}

fn springboard_pid(udid: &str) -> Option<u32> {
    let listed = simctl(
        &["spawn", udid, "launchctl", "list"],
        Duration::from_secs(10),
    )
    .ok()?;
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?;
            (parts.nth(1)? == "com.apple.SpringBoard").then(|| pid.parse().ok())?
        })
}

/// Seconds until an app launch on the device succeeds (the home screen is up).
fn until_launchable(udid: &str) -> f64 {
    let started = Instant::now();
    loop {
        let ok = simctl(
            &["launch", udid, "com.apple.Preferences"],
            Duration::from_secs(60),
        )
        .is_ok_and(|o| o.success);
        if ok || started.elapsed() > Duration::from_secs(90) {
            let _ = simctl(
                &["terminate", udid, "com.apple.Preferences"],
                Duration::from_secs(20),
            );
            return started.elapsed().as_secs_f64();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Forgets what this Aven session knows about devices, as after a restart.
fn forget_session() {
    let mut state = state();
    state.ready.clear();
    // What Aven booted is read back from its data, as after a restart.
    state.aven_boots.clear();
    state.aven_boots_loaded = false;
    state.pane_devices.clear();
    state.known = None;
}

struct Step {
    name: String,
    seconds: f64,
    note: String,
}

fn row(steps: &mut Vec<Step>, name: &str, seconds: f64, note: impl Into<String>) {
    let note = note.into();
    eprintln!("{name:<52} {seconds:>7.2} s  {note}");
    steps.push(Step {
        name: name.into(),
        seconds,
        note,
    });
}

/// Times one action that may restart SpringBoard; notes whether it did.
fn timed_pick(
    steps: &mut Vec<Step>,
    name: &str,
    udid: &str,
    project: &str,
    picked: bool,
    usable: bool,
) -> f64 {
    let before = springboard_pid(udid);
    let started = Instant::now();
    let readiness = ensure_device(project, udid, None, picked).unwrap();
    let seconds = started.elapsed().as_secs_f64();
    let after = springboard_pid(udid);
    let restarted = before.is_some() && before != after;
    let mut note = format!(
        "{readiness:?}{}",
        if restarted {
            ", home screen restarted"
        } else {
            ""
        }
    );
    let mut total = seconds;
    if usable {
        let extra = until_launchable(udid);
        total += extra;
        note.push_str(&format!(", apps open {extra:.1} s later"));
    }
    row(steps, name, seconds, note);
    total
}

/// Runs the Run pipeline once and records when each phase began.
fn timed_run(
    steps: &mut Vec<Step>,
    name: &str,
    project: &str,
    udid: &str,
    container: &str,
) -> (String, f64) {
    let before = springboard_pid(udid);
    let started = Instant::now();
    start_run(RunRequest {
        project: project.into(),
        udid: udid.into(),
        container: container.into(),
        scheme: "SpikeApp".into(),
    })
    .unwrap();
    let mut phases: Vec<(Phase, f64)> = Vec::new();
    loop {
        let status = status_of(project);
        if phases.last().map(|(p, _)| *p) != Some(status.phase) {
            phases.push((status.phase, started.elapsed().as_secs_f64()));
        }
        assert_ne!(status.phase, Phase::Failed, "{}", status.message);
        if status.phase == Phase::Running {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(600));
        std::thread::sleep(Duration::from_millis(5));
    }
    // The app is on screen once its console says so.
    loop {
        if recent_logs(project, 200)
            .iter()
            .any(|l| l.contains("SPIKE launched"))
        {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(660));
        std::thread::sleep(Duration::from_millis(5));
    }
    let total = started.elapsed().as_secs_f64();
    let after = springboard_pid(udid);
    let phases: Vec<String> = phases
        .iter()
        .map(|(phase, at)| format!("{phase:?}@{at:.2}"))
        .collect();
    let status = status_of(project);
    row(
        steps,
        name,
        total,
        format!(
            "{}; {}{}",
            phases.join(" "),
            status.message,
            if before != after {
                "; home screen restarted"
            } else {
                ""
            }
        ),
    );
    (status.bundle_id.unwrap_or_default(), total)
}

/// A fresh copy of the app, and a fresh project folder in Aven's data.
fn fresh_project(app: &Path) -> String {
    let project = std::env::temp_dir().join(format!("aven-ios-perf-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    assert!(Command::new("/bin/cp")
        .arg("-R")
        .arg(app)
        .arg(&project)
        .status()
        .unwrap()
        .success());
    let project = project.to_string_lossy().into_owned();
    let _ = std::fs::remove_dir_all(project_dir(&project).unwrap());
    project
}

fn median(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(|a, b| a.total_cmp(b));
    samples[samples.len() / 2]
}

#[test]
#[ignore]
fn ios_sim_perf_phases() {
    let Some((udid, app)) = perf_device() else {
        return;
    };
    let support = support();
    assert!(support.live, "{:?}", support.reason);
    let mut steps = Vec::new();

    // Tool costs every phase pays.
    let samples: Vec<f64> = (0..5)
        .map(|_| {
            let started = Instant::now();
            list_devices().unwrap();
            started.elapsed().as_secs_f64()
        })
        .collect();
    row(
        &mut steps,
        "simctl list devices (median of 5)",
        median(samples),
        "",
    );
    let samples: Vec<f64> = (0..3)
        .map(|_| {
            let started = Instant::now();
            let _ = simctl(
                &["spawn", &udid, "launchctl", "list"],
                Duration::from_secs(10),
            );
            started.elapsed().as_secs_f64()
        })
        .collect();
    row(
        &mut steps,
        "simctl spawn (median of 3)",
        median(samples),
        "",
    );

    let project = fresh_project(&app);

    // a) Picking a device.
    let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
    checked(
        simctl(&["erase", &udid], Duration::from_secs(120)).unwrap(),
        "erase",
    )
    .unwrap();
    forget_session();
    timed_pick(
        &mut steps,
        "pick: first boot of a new device",
        &udid,
        &project,
        true,
        true,
    );
    timed_pick(
        &mut steps,
        "pick the same device again",
        &udid,
        &project,
        true,
        false,
    );
    forget_session();
    timed_pick(
        &mut steps,
        "remembered device after an Aven restart",
        &udid,
        &project,
        false,
        false,
    );
    forget_session();
    timed_pick(
        &mut steps,
        "pick it after an Aven restart",
        &udid,
        &project,
        true,
        false,
    );
    let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
    forget_session();
    timed_pick(
        &mut steps,
        "pick: warm boot (shut down device)",
        &udid,
        &project,
        true,
        true,
    );

    // b) The screen: framebuffer present right after the pick.
    let started = Instant::now();
    native::reset(&udid);
    let info = native::display_info(&udid).unwrap();
    row(
        &mut steps,
        "framebuffer lookup after reset",
        started.elapsed().as_secs_f64(),
        format!("{}x{} @{}x", info.width, info.height, info.scale),
    );

    // e) Run: first (clean), no change, one edited file, relaunch.
    let listed = project_info(&project, None);
    let container = listed
        .container
        .expect("an Xcode project")
        .path
        .to_string_lossy()
        .into_owned();
    let (bundle, _) = timed_run(&mut steps, "run: clean build", &project, &udid, &container);
    timed_run(
        &mut steps,
        "run: nothing changed",
        &project,
        &udid,
        &container,
    );
    let source = Path::new(&project).join("SpikeApp/SpikeApp.swift");
    let mut text = std::fs::read_to_string(&source).unwrap();
    text.push_str("\n// edited\n");
    std::fs::write(&source, text).unwrap();
    timed_run(
        &mut steps,
        "run: one file edited",
        &project,
        &udid,
        &container,
    );
    let started = Instant::now();
    relaunch(&project, &udid, &bundle).unwrap();
    while status_of(&project).phase != Phase::Running {
        std::thread::sleep(Duration::from_millis(5));
    }
    row(
        &mut steps,
        "relaunch without building",
        started.elapsed().as_secs_f64(),
        "",
    );
    // A Run right after a warm boot: the device is not ready yet.
    let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
    forget_session();
    timed_run(
        &mut steps,
        "run: device shut down, nothing changed",
        &project,
        &udid,
        &container,
    );
    let agent = Command::new("/usr/bin/pgrep")
        .args(["-f", "test-without-building"])
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    row(
        &mut steps,
        "XCUITest agent running after Runs",
        0.0,
        format!("{agent}"),
    );

    // d) Input through the native path.
    std::thread::sleep(Duration::from_secs(2));
    let samples: Vec<f64> = (0..20)
        .map(|_| {
            let started = Instant::now();
            native::display_info(&udid).unwrap();
            started.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    row(
        &mut steps,
        "display_info (ms, median of 20)",
        median(samples),
        "",
    );
    let screen_now = screen(&udid).unwrap();
    let (w, h) = screen_now.size();
    let samples: Vec<f64> = (0..10)
        .map(|_| {
            let (x, y) = screen_now.to_device(w / 2.0, h * 0.9);
            let started = Instant::now();
            tap(&udid, x, y).unwrap();
            started.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    row(
        &mut steps,
        "agent tap call (ms, median of 10)",
        median(samples),
        "includes the 60 ms hold",
    );
    let samples: Vec<f64> = (0..20)
        .map(|i| {
            let (x, y) = screen_now.to_device(w / 2.0, h * 0.5 + i as f64);
            let started = Instant::now();
            native::touch(&udid, native::TouchPhase::Down, x, y).unwrap();
            let down = started.elapsed().as_secs_f64() * 1000.0;
            native::touch(&udid, native::TouchPhase::Up, x, y).unwrap();
            std::thread::sleep(Duration::from_millis(30));
            down
        })
        .collect();
    row(
        &mut steps,
        "one touch message (ms, median of 20)",
        median(samples),
        "",
    );
    let started = Instant::now();
    swipe(
        &udid,
        screen_now.to_device(w / 2.0, h * 0.85),
        screen_now.to_device(w / 2.0, h * 0.55),
        Duration::from_millis(300),
    )
    .unwrap();
    row(
        &mut steps,
        "300 ms swipe call",
        started.elapsed().as_secs_f64(),
        "",
    );
    let started = Instant::now();
    type_text(&udid, "Hello Aven 123").unwrap();
    row(
        &mut steps,
        "type 14 characters",
        started.elapsed().as_secs_f64(),
        "",
    );
    let started = Instant::now();
    let png = screenshot_png(&udid).unwrap();
    row(
        &mut steps,
        "framebuffer screenshot",
        started.elapsed().as_secs_f64(),
        format!("{} KB", png.0.len() / 1024),
    );
    let started = Instant::now();
    let path = std::env::temp_dir().join("aven-ios-sim-perf-shot.png");
    simctl(
        &[
            "io",
            &udid,
            "screenshot",
            "--type=png",
            &path.to_string_lossy(),
        ],
        Duration::from_secs(20),
    )
    .unwrap();
    row(
        &mut steps,
        "simctl screenshot",
        started.elapsed().as_secs_f64(),
        format!(
            "{} KB",
            std::fs::metadata(&path).map_or(0, |m| m.len()) / 1024
        ),
    );
    let _ = std::fs::remove_file(&path);

    // f) The XCUITest agent, on demand.
    let started = Instant::now();
    let mut agent = crate::ios_sim_xcuitest::connect(&udid, Some(&bundle)).unwrap();
    row(
        &mut steps,
        "XCUITest agent start (first snapshot)",
        started.elapsed().as_secs_f64(),
        "",
    );
    let started = Instant::now();
    agent.request(json!({ "action": "snapshot" })).unwrap();
    row(
        &mut steps,
        "snapshot on an open connection",
        started.elapsed().as_secs_f64(),
        "",
    );
    let started = Instant::now();
    crate::ios_sim_xcuitest::connect(&udid, Some(&bundle))
        .unwrap()
        .request(json!({ "action": "snapshot" }))
        .unwrap();
    row(
        &mut steps,
        "agent snapshot (connect + activate + snapshot)",
        started.elapsed().as_secs_f64(),
        "",
    );
    crate::ios_sim_xcuitest::shutdown();

    // h) The pane moves to another simulator: one Aven booted is shut down.
    if std::env::var_os("AVEN_IOS_SIM_PERF_RELEASE").is_some() {
        let started = Instant::now();
        let other = "00000000-0000-0000-0000-000000000000".to_owned();
        state().pane_devices.insert(project_key(&project), other);
        release_later(&project, &udid);
        while list_devices()
            .unwrap()
            .iter()
            .any(|d| d.udid.eq_ignore_ascii_case(&udid) && d.booted)
        {
            assert!(started.elapsed() < Duration::from_secs(60), "still booted");
            std::thread::sleep(Duration::from_millis(250));
        }
        row(
            &mut steps,
            "pane moved away: Aven's simulator shut down after",
            started.elapsed().as_secs_f64(),
            format!("{:?}", status_of(&project).phase),
        );
    }

    stop(&project);
    let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(project_dir(&project).unwrap());
    eprintln!("\n| Step | Seconds | Note |\n| --- | ---: | --- |");
    for step in &steps {
        eprintln!("| {} | {:.2} | {} |", step.name, step.seconds, step.note);
    }
}

/// The slow paths again, several times each (`AVEN_IOS_SIM_PERF_REPEAT`,
/// default 3): picking a shut-down device until apps open, and Run on a
/// shut-down device with a clean build and with nothing changed.
#[test]
#[ignore]
fn ios_sim_perf_repeat() {
    let Some((udid, app)) = perf_device() else {
        return;
    };
    let times: usize = std::env::var("AVEN_IOS_SIM_PERF_REPEAT")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(3);
    let project = fresh_project(&app);
    let container = project_info(&project, None)
        .container
        .expect("an Xcode project")
        .path
        .to_string_lossy()
        .into_owned();
    let mut steps = Vec::new();
    let (mut picks, mut clean, mut unchanged) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..times {
        let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
        forget_session();
        picks.push(timed_pick(
            &mut steps,
            "pick a shut-down device",
            &udid,
            &project,
            true,
            true,
        ));
        let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
        forget_session();
        let _ = std::fs::remove_dir_all(project_dir(&project).unwrap());
        clean.push(
            timed_run(
                &mut steps,
                "run, shut down, clean build",
                &project,
                &udid,
                &container,
            )
            .1,
        );
        let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
        forget_session();
        unchanged.push(
            timed_run(
                &mut steps,
                "run, shut down, nothing changed",
                &project,
                &udid,
                &container,
            )
            .1,
        );
    }
    stop(&project);
    let _ = simctl(&["shutdown", &udid], Duration::from_secs(120));
    let _ = std::fs::remove_dir_all(project_dir(&project).unwrap());
    let _ = std::fs::remove_dir_all(&project);
    let range = |v: &Vec<f64>| {
        let lo = v.iter().copied().fold(f64::MAX, f64::min);
        let hi = v.iter().copied().fold(0.0, f64::max);
        format!(
            "median {:.1} s (range {lo:.1}–{hi:.1}, n={})",
            median(v.clone()),
            v.len()
        )
    };
    eprintln!(
        "\nshut-down device picked, until apps open: {}",
        range(&picks)
    );
    eprintln!(
        "Run on a shut-down device, clean build, until the app runs: {}",
        range(&clean)
    );
    eprintln!(
        "Run on a shut-down device, nothing changed, until the app runs: {}",
        range(&unchanged)
    );
}
