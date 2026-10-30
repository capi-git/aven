//! Aven's XCUITest agent server (`src-tauri/ios-agent`): accessibility
//! snapshots for agents, and input when the native path is unavailable.
//!
//! The runner is built once per Xcode version into Aven's app data, from
//! sources embedded in the binary, and started per device on demand. It
//! listens on 127.0.0.1 with a random port and token.
//!
//! A device's server starts once at a time: taps and agent requests that
//! arrive meanwhile wait for that start, and after a failed start the next
//! one waits a little longer each time. Every start launches a test runner
//! that installs an app on the device, so starts side by side replaced each
//! other's runner and queued in front of a Run's own install.
#![cfg(target_os = "macos")]

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

const SOURCES: [(&str, &str); 4] = [
    (
        "AvenSimAgent.xcodeproj/project.pbxproj",
        include_str!("../ios-agent/AvenSimAgent.xcodeproj/project.pbxproj"),
    ),
    (
        "AvenSimAgent.xcodeproj/xcshareddata/xcschemes/AvenSimAgent.xcscheme",
        include_str!(
            "../ios-agent/AvenSimAgent.xcodeproj/xcshareddata/xcschemes/AvenSimAgent.xcscheme"
        ),
    ),
    (
        "AvenSimHost/AvenSimHostApp.swift",
        include_str!("../ios-agent/AvenSimHost/AvenSimHostApp.swift"),
    ),
    (
        "AvenSimAgentUITests/AgentServer.swift",
        include_str!("../ios-agent/AvenSimAgentUITests/AgentServer.swift"),
    ),
];

/// A version stamp of the embedded sources, so an Aven update rebuilds.
fn sources_hash() -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for (path, text) in SOURCES {
        for byte in path.bytes().chain(text.bytes()) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
    hash
}

struct Server {
    child: Arc<Mutex<Child>>,
    port: u16,
    token: String,
}

static SERVERS: OnceLock<Mutex<HashMap<String, Server>>> = OnceLock::new();
/// Each device's screen size in points, as its agent server reported it.
static SCREENS: OnceLock<Mutex<HashMap<String, (f64, f64)>>> = OnceLock::new();

fn screens() -> std::sync::MutexGuard<'static, HashMap<String, (f64, f64)>> {
    SCREENS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// The screen's size in points, once a device's agent server has said.
pub(crate) fn screen_points(udid: &str) -> Option<(f64, f64)> {
    screens().get(&udid.to_uppercase()).copied()
}
static BUILD_LOCK: Mutex<()> = Mutex::new(());

fn servers() -> std::sync::MutexGuard<'static, HashMap<String, Server>> {
    SERVERS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

fn agent_root() -> Result<PathBuf, String> {
    let xcode = crate::ios_sim::run(
        crate::ios_sim::tool("/usr/bin/xcodebuild", &["-version"]),
        Duration::from_secs(30),
        None,
    )?;
    let version = String::from_utf8_lossy(&xcode.stdout)
        .lines()
        .find_map(|line| line.strip_prefix("Build version "))
        .unwrap_or("unknown")
        .trim()
        .to_owned();
    Ok(crate::ios_sim::data_root()?
        .join("agent")
        .join(format!("{version}-{:016x}", sources_hash())))
}

fn find_xctestrun(products: &Path) -> Option<PathBuf> {
    std::fs::read_dir(products)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "xctestrun"))
}

/// Builds the runner once; later calls reuse it.
/// Removes runners built for other Xcode versions or older sources.
fn prune_old_builds(root: &Path) {
    let (Some(parent), Some(current)) = (root.parent(), root.file_name()) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() != current && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn ensure_built() -> Result<PathBuf, String> {
    let _guard = BUILD_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let root = agent_root()?;
    prune_old_builds(&root);
    let products = root.join("DerivedData/Build/Products");
    if let Some(found) = find_xctestrun(&products) {
        return Ok(found);
    }
    let source = root.join("src");
    for (path, text) in SOURCES {
        let target = source.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&target, text)
            .map_err(|error| format!("Could not prepare the simulator agent: {error}"))?;
    }
    let project = source.join("AvenSimAgent.xcodeproj");
    let derived = root.join("DerivedData");
    let project = project.to_string_lossy().into_owned();
    let derived = derived.to_string_lossy().into_owned();
    let output = crate::ios_sim::run(
        crate::ios_sim::tool(
            "/usr/bin/xcodebuild",
            &[
                "-project",
                &project,
                "-scheme",
                "AvenSimAgent",
                "-destination",
                "generic/platform=iOS Simulator",
                "-derivedDataPath",
                &derived,
                "build-for-testing",
                "-quiet",
            ],
        ),
        Duration::from_secs(600),
        None,
    )?;
    if !output.success {
        let detail = output
            .stderr
            .lines()
            .rev()
            .find(|l| l.contains("error"))
            .unwrap_or("")
            .trim()
            .to_owned();
        return Err(format!("Could not build the simulator agent. {detail}")
            .trim()
            .to_owned());
    }
    find_xctestrun(&products).ok_or_else(|| "The simulator agent build produced no test run".into())
}

fn alive(server: &Server) -> bool {
    matches!(
        server
            .child
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .try_wait(),
        Ok(None)
    )
}

/// The port in the server's ready line: `AVEN_AGENT_READY port=<n>`.
fn ready_port(line: &str) -> Option<u16> {
    let rest = &line[line.find("AVEN_AGENT_READY port=")? + "AVEN_AGENT_READY port=".len()..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|port| *port > 0)
}

// ---------------------------------------------------------------------------
// Starts: one at a time per device, waiting longer after each failure

/// The wait after a failed start; each further failure in a row doubles it,
/// up to `RETRY_MAX`.
const RETRY_FIRST: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(60);

/// How long to wait after the `failures`-th failed start in a row.
pub(crate) fn retry_after(failures: u32, first: Duration, max: Duration) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    first.saturating_mul(1 << doublings).min(max)
}

/// One device's starts.
#[derive(Debug, Default)]
struct Gate {
    starting: bool,
    failures: u32,
    /// The last failure, and when another start may run.
    blocked: Option<(String, Instant)>,
}

/// What a caller that finds no server running does.
#[derive(Debug, PartialEq, Eq)]
enum Admission {
    Start,
    /// Another caller is starting it: wait for that start.
    Wait,
    /// It failed moments ago: report that rather than start again.
    Refuse(String),
}

impl Gate {
    fn admit(&mut self, now: Instant) -> Admission {
        if self.starting {
            return Admission::Wait;
        }
        if let Some((error, until)) = &self.blocked {
            if now < *until {
                let seconds = until.duration_since(now).as_secs_f64().ceil().max(1.0);
                return Admission::Refuse(format!("{error} (Aven tries again in {seconds} s)"));
            }
        }
        self.starting = true;
        Admission::Start
    }

    fn finish(&mut self, error: Option<&str>, now: Instant, first: Duration, max: Duration) {
        self.starting = false;
        match error {
            None => {
                self.failures = 0;
                self.blocked = None;
            }
            Some(error) => {
                self.failures = self.failures.saturating_add(1);
                let until = now + retry_after(self.failures, first, max);
                self.blocked = Some((error.to_owned(), until));
            }
        }
    }
}

/// Server starts by device: one at a time, and after a failure none again
/// until a growing wait has passed.
pub(crate) struct Starts {
    gates: Mutex<HashMap<String, Gate>>,
    changed: Condvar,
    first: Duration,
    max: Duration,
}

impl Starts {
    pub(crate) fn new(first: Duration, max: Duration) -> Self {
        Self {
            gates: Mutex::new(HashMap::new()),
            changed: Condvar::new(),
            first,
            max,
        }
    }

    fn gates(&self) -> std::sync::MutexGuard<'_, HashMap<String, Gate>> {
        self.gates.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The server `running` finds, if any. Otherwise one caller runs `start`
    /// while others for the same `key` wait for it and then use its server
    /// (or get its error), and a start that failed moments ago is reported
    /// again rather than repeated.
    pub(crate) fn run<T>(
        &self,
        key: &str,
        running: impl Fn() -> Option<T>,
        start: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        loop {
            if let Some(found) = running() {
                return Ok(found);
            }
            let admission = self
                .gates()
                .entry(key.to_owned())
                .or_default()
                .admit(Instant::now());
            match admission {
                Admission::Start => {
                    // A start that ended just before this one was admitted.
                    let result = match running() {
                        Some(found) => Ok(found),
                        None => std::panic::catch_unwind(std::panic::AssertUnwindSafe(start))
                            .unwrap_or_else(|_| {
                                Err("The simulator agent stopped unexpectedly".into())
                            }),
                    };
                    self.gates().entry(key.to_owned()).or_default().finish(
                        result.as_ref().err().map(String::as_str),
                        Instant::now(),
                        self.first,
                        self.max,
                    );
                    self.changed.notify_all();
                    return result;
                }
                Admission::Wait => {
                    let mut gates = self.gates();
                    while gates.get(key).is_some_and(|gate| gate.starting) {
                        gates = self
                            .changed
                            .wait_timeout(gates, Duration::from_secs(1))
                            .unwrap_or_else(|p| p.into_inner())
                            .0;
                    }
                }
                Admission::Refuse(error) => return Err(error),
            }
        }
    }

    /// Forgets a device's failures (its server was stopped on purpose).
    fn forget(&self, key: &str) {
        let mut gates = self.gates();
        if gates.get(key).is_some_and(|gate| !gate.starting) {
            gates.remove(key);
        }
    }
}

fn starts() -> &'static Starts {
    static STARTS: OnceLock<Starts> = OnceLock::new();
    STARTS.get_or_init(|| Starts::new(RETRY_FIRST, RETRY_MAX))
}

/// Runners still starting, by device, so a device shut down meanwhile (or
/// Aven quitting) ends them too.
static STARTING: OnceLock<Mutex<HashMap<String, Arc<Mutex<Child>>>>> = OnceLock::new();

fn starting() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Mutex<Child>>>> {
    STARTING
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// The runner's `xcodebuild` arguments. Its results go to a bundle of this
/// device's own in Aven's agent folder (never the person's DerivedData),
/// and a runner that fails is not followed by a diagnostics collection: that
/// takes minutes, outlives the runner and keeps the simulator busy.
pub(crate) fn runner_args(
    xctestrun: &str,
    udid: &str,
    derived: &str,
    results: &str,
) -> Vec<String> {
    [
        "test-without-building",
        "-xctestrun",
        xctestrun,
        "-destination",
        &format!("id={udid}"),
        "-derivedDataPath",
        derived,
        "-resultBundlePath",
        results,
        "-collect-test-diagnostics",
        "never",
        "-only-testing:AvenSimAgentUITests/AgentServer/testServe",
    ]
    .map(str::to_owned)
    .to_vec()
}

/// Output lines kept to explain a start that failed.
const TAIL_LINES: usize = 40;
/// How long a start may take to listen.
const READY_WAIT: Duration = Duration::from_secs(180);
/// A Run's install or launch on the device goes first, for at most this long.
const RUN_FIRST_WAIT: Duration = Duration::from_secs(60);

fn cut(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// A plain reason for a start that failed: what the runner said when it
/// gave up, else its last error line.
pub(crate) fn start_failure(said: &str, tail: &[String]) -> String {
    let said = said.trim();
    let detail = if said.is_empty() {
        tail.iter()
            .rev()
            .map(|line| line.trim())
            .find(|line| !line.starts_with("**") && line.to_ascii_lowercase().contains("error"))
            .unwrap_or("")
    } else {
        said
    };
    let detail = cut(detail, 300);
    if detail.is_empty() {
        "The simulator agent did not start".into()
    } else {
        format!("The simulator agent did not start: {detail}")
    }
}

/// Starts the agent server on `udid` and waits until it listens. The server
/// picks its own port and reports it, so nothing else can take it between.
fn start(udid: &str, bundle: Option<&str>) -> Result<(u16, String), String> {
    let key = udid.to_uppercase();
    let xctestrun = ensure_built()?;
    // The runner installs and launches an app as well: a Run installing or
    // opening its app on this device goes first.
    let until = Instant::now() + RUN_FIRST_WAIT;
    while crate::ios_sim::installing_on(&key) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(200));
    }
    let root = agent_root()?;
    let results = root.join("results").join(format!("{key}.xcresult"));
    let _ = std::fs::remove_dir_all(&results);
    if let Some(parent) = results.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let args = runner_args(
        &xctestrun.to_string_lossy(),
        udid,
        &root.join("DerivedData").to_string_lossy(),
        &results.to_string_lossy(),
    );
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut command = crate::ios_sim::tool("/usr/bin/xcodebuild", &args);
    command
        .env("TEST_RUNNER_AVEN_AGENT_TOKEN", &token)
        .env("TEST_RUNNER_AVEN_AGENT_BUNDLE_ID", bundle.unwrap_or(""))
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the simulator agent: {error}"))?;
    let stdout = child.stdout.take();
    let (ready, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    let tail: Arc<Mutex<VecDeque<String>>> = Arc::default();
    std::thread::spawn({
        let tail = tail.clone();
        move || {
            let Some(stdout) = stdout else { return };
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sent {
                    continue;
                }
                if let Some(port) = ready_port(&line) {
                    let _ = ready.send(Ok(port));
                    sent = true;
                } else if let Some((_, said)) = line.split_once("AVEN_AGENT_FAILED") {
                    let _ = ready.send(Err(said.to_owned()));
                    sent = true;
                } else {
                    let mut tail = tail.lock().unwrap_or_else(|p| p.into_inner());
                    if tail.len() >= TAIL_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            }
            // The runner ended without saying it listens.
            if !sent {
                let _ = ready.send(Err(String::new()));
            }
        }
    });
    let child = Arc::new(Mutex::new(child));
    starting().insert(key.clone(), child.clone());
    let deadline = Instant::now() + READY_WAIT;
    let outcome = loop {
        match ready_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(outcome) => break outcome,
            Err(RecvTimeoutError::Disconnected) => break Err(String::new()),
            Err(RecvTimeoutError::Timeout) => {
                let exited = !matches!(
                    child.lock().unwrap_or_else(|p| p.into_inner()).try_wait(),
                    Ok(None)
                );
                // Ended without a word (or was stopped): give its output a
                // moment to arrive, for the reason.
                if exited {
                    break ready_rx
                        .recv_timeout(Duration::from_secs(1))
                        .unwrap_or_else(|_| Err(String::new()));
                }
                if Instant::now() >= deadline {
                    break Err("it did not answer within 3 minutes".into());
                }
            }
        }
    };
    {
        let mut starting = starting();
        if starting.get(&key).is_some_and(|c| Arc::ptr_eq(c, &child)) {
            starting.remove(&key);
        }
    }
    let port = match outcome {
        Ok(port) => port,
        Err(said) => {
            stop_child(&child);
            let tail: Vec<String> = tail
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .iter()
                .cloned()
                .collect();
            return Err(start_failure(&said, &tail));
        }
    };
    let previous = servers().insert(
        key,
        Server {
            child,
            port,
            token: token.clone(),
        },
    );
    if let Some(previous) = previous {
        stop_child(&previous.child);
    }
    Ok((port, token))
}

fn stop_child(child: &Arc<Mutex<Child>>) {
    // Signals its process group only while the child is unreaped.
    crate::ios_sim::kill_child(child);
}

/// Stops `udid`'s agent server and any start of one, before Aven shuts the
/// device down: a runner whose device goes away starts it again to retry.
pub(crate) fn stop_device(udid: &str) {
    let key = udid.to_uppercase();
    let server = servers().remove(&key);
    let pending = starting().remove(&key);
    for child in server.map(|s| s.child).into_iter().chain(pending) {
        stop_child(&child);
    }
    starts().forget(&key);
}

/// Stops every agent server (Aven quitting).
pub(crate) fn shutdown() {
    let all: Vec<Server> = servers().drain().map(|(_, server)| server).collect();
    let pending: Vec<Arc<Mutex<Child>>> = starting().drain().map(|(_, child)| child).collect();
    for child in all.into_iter().map(|s| s.child).chain(pending) {
        stop_child(&child);
    }
}

pub(crate) struct Connection {
    stream: TcpStream,
    reader: BufReader<TcpStream>,
    token: String,
    udid: String,
}

impl Connection {
    /// The screen's size in points (also kept for `screen_points`).
    pub fn screen(&mut self) -> Result<(f64, f64), String> {
        let reply = self.request(json!({ "action": "screen" }))?;
        let size = reply
            .get("screen")
            .and_then(Value::as_array)
            .and_then(|s| Some((s.first()?.as_f64()?, s.get(1)?.as_f64()?)))
            .filter(|(w, h)| *w > 0.0 && *h > 0.0)
            .ok_or("The simulator agent did not report the screen")?;
        screens().insert(self.udid.to_uppercase(), size);
        Ok(size)
    }

    pub fn request(&mut self, mut request: Value) -> Result<Value, String> {
        request["token"] = json!(self.token);
        let mut line = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        line.push(b'\n');
        self.stream
            .write_all(&line)
            .map_err(|error| format!("The simulator agent stopped: {error}"))?;
        let mut reply = String::new();
        self.reader
            .read_line(&mut reply)
            .map_err(|error| format!("The simulator agent did not answer: {error}"))?;
        let value: Value = serde_json::from_str(&reply)
            .map_err(|_| "The simulator agent did not answer".to_string())?;
        if value.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(value)
        } else {
            Err(value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("The simulator agent refused")
                .to_owned())
        }
    }
}

/// A connection to `udid`'s agent server, starting it if needed, focused on
/// `bundle` (the home screen when none).
pub(crate) fn connect(udid: &str, bundle: Option<&str>) -> Result<Connection, String> {
    let key = udid.to_uppercase();
    let running = || {
        servers()
            .get(&key)
            .filter(|server| alive(server))
            .map(|server| (server.port, server.token.clone()))
    };
    let (port, token) = starts().run(&key, running, || {
        // A server whose runner stopped.
        if let Some(stale) = servers().remove(&key) {
            stop_child(&stale.child);
        }
        start(udid, bundle)
    })?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let stream = loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(stream) => break stream,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(format!("Could not reach the simulator agent: {error}")),
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut connection = Connection {
        stream,
        reader,
        token,
        udid: udid.to_owned(),
    };
    connection.request(json!({
        "action": "activate",
        "bundleId": bundle.unwrap_or("com.apple.springboard"),
    }))?;
    Ok(connection)
}

pub(crate) fn press_home(udid: &str) -> Result<(), String> {
    connect(udid, None)?
        .request(json!({ "action": "press", "button": "home" }))
        .map(|_| ())
}

/// The accessibility outline agents read: one line per element that says
/// something, indented by depth, with its frame in upright screen points.
pub(crate) fn outline(snapshot: &Value) -> String {
    let mut lines = Vec::new();
    let nodes = snapshot
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for node in &nodes {
        let get = |key: &str| node.get(key).and_then(Value::as_str).unwrap_or("");
        let (id, label, value, placeholder) =
            (get("id"), get("label"), get("value"), get("placeholder"));
        let kind = get("type");
        let named =
            !id.is_empty() || !label.is_empty() || !value.is_empty() || !placeholder.is_empty();
        if !named
            && !matches!(
                kind,
                "Button" | "TextField" | "SecureTextField" | "Switch" | "Cell" | "Alert"
            )
        {
            continue;
        }
        let depth = node
            .get("depth")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(12) as usize;
        let mut line = format!("{}{kind}", "  ".repeat(depth));
        if !label.is_empty() {
            line.push_str(&format!(" \"{label}\""));
        }
        if !id.is_empty() {
            line.push_str(&format!(" id={id}"));
        }
        if !value.is_empty() {
            line.push_str(&format!(" value=\"{value}\""));
        }
        if !placeholder.is_empty() {
            line.push_str(&format!(" placeholder=\"{placeholder}\""));
        }
        for flag in ["disabled", "selected", "focused"] {
            if node.get(flag).and_then(Value::as_bool) == Some(true) {
                line.push(' ');
                line.push_str(flag);
            }
        }
        if let Some(frame) = node.get("frame").and_then(Value::as_array) {
            let f: Vec<i64> = frame.iter().filter_map(Value::as_i64).collect();
            if f.len() == 4 {
                line.push_str(&format!(" @{},{} {}x{}", f[0], f[1], f[2], f[3]));
            }
        }
        lines.push(line);
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outlines_named_elements_with_frames() {
        let snapshot = json!({ "nodes": [
            { "type": "Application", "depth": 0, "label": "Spike", "frame": [0, 0, 402, 874] },
            { "type": "Other", "depth": 1, "frame": [0, 0, 402, 874] },
            { "type": "Button", "depth": 2, "label": "Tap me", "id": "tapButton", "frame": [150, 240, 102, 50] },
            { "type": "TextField", "depth": 2, "placeholder": "Type here", "focused": true, "frame": [32, 300, 338, 34] },
            { "type": "SecureTextField", "depth": 2, "value": "<redacted>", "frame": [32, 340, 338, 34] },
        ]});
        assert_eq!(
            outline(&snapshot),
            "Application \"Spike\" @0,0 402x874\n    Button \"Tap me\" id=tapButton @150,240 102x50\n    TextField placeholder=\"Type here\" focused @32,300 338x34\n    SecureTextField value=\"<redacted>\" @32,340 338x34"
        );
    }

    #[test]
    fn reads_the_port_from_the_ready_line_only() {
        assert_eq!(ready_port("AVEN_AGENT_READY port=53122"), Some(53122));
        assert_eq!(
            ready_port("2026-10-27 10:00:01.123 AvenSimAgentUITests-Runner[12:34] AVEN_AGENT_READY port=8765"),
            Some(8765)
        );
        assert_eq!(ready_port("AVEN_AGENT_READY port=0"), None);
        assert_eq!(ready_port("AVEN_AGENT_READY port="), None);
        assert_eq!(ready_port("Test Case started"), None);
    }

    #[test]
    fn embeds_the_runner_sources() {
        for (path, text) in SOURCES {
            assert!(!text.is_empty(), "{path}");
        }
        let server = SOURCES[3].1;
        assert!(server.contains("AVEN_AGENT_TOKEN"));
        // It listens on a port the system picks and announces it when ready.
        assert!(server.contains("port: .any") && server.contains("case .ready:"));
        assert!(!server.contains("AVEN_AGENT_PORT"));
        assert_ne!(sources_hash(), 0);
    }

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Barrier;

    /// Five callers find no server at once, as five taps did while the
    /// runner was being built: one start, and all five use its server.
    #[test]
    fn starts_a_devices_server_once_for_callers_arriving_together() {
        let starts = Starts::new(Duration::from_secs(5), Duration::from_secs(60));
        let server: Mutex<Option<u16>> = Mutex::new(None);
        let launched = AtomicUsize::new(0);
        let together = Barrier::new(5);
        let results: Vec<Result<u16, String>> = std::thread::scope(|scope| {
            let callers: Vec<_> = (0..5)
                .map(|_| {
                    scope.spawn(|| {
                        together.wait();
                        starts.run(
                            "A",
                            || *server.lock().unwrap(),
                            || {
                                launched.fetch_add(1, Ordering::SeqCst);
                                std::thread::sleep(Duration::from_millis(150));
                                *server.lock().unwrap() = Some(4242);
                                Ok(4242)
                            },
                        )
                    })
                })
                .collect();
            callers.into_iter().map(|c| c.join().unwrap()).collect()
        });
        assert_eq!(launched.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(|r| r == &Ok(4242)), "{results:?}");
    }

    /// A start that fails is reported to everyone waiting for it, and is not
    /// repeated by each of them or by the next tap until the wait passes.
    #[test]
    fn reports_a_failed_start_to_its_waiters_and_waits_before_the_next() {
        let starts = Starts::new(Duration::from_millis(500), Duration::from_secs(60));
        let launched = AtomicUsize::new(0);
        let together = Barrier::new(4);
        let failing = || -> Result<u16, String> {
            launched.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(100));
            Err("The simulator agent did not start".into())
        };
        let results: Vec<Result<u16, String>> = std::thread::scope(|scope| {
            let callers: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        together.wait();
                        starts.run("A", || None, failing)
                    })
                })
                .collect();
            callers.into_iter().map(|c| c.join().unwrap()).collect()
        });
        assert_eq!(launched.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(|r| r
            .as_ref()
            .is_err_and(|e| e.starts_with("The simulator agent did not start"))));
        // The next tap, moments later: told why and when, nothing launched.
        let refused = starts.run("A", || None, failing).unwrap_err();
        assert!(refused.contains("tries again in"), "{refused}");
        assert_eq!(launched.load(Ordering::SeqCst), 1);
        // Another device is not held up.
        assert_eq!(starts.run("B", || None, || Ok(1)), Ok(1));
        // Once the wait passed, it starts again; success clears the failures.
        std::thread::sleep(Duration::from_millis(550));
        assert_eq!(starts.run("A", || None, || Ok(7)), Ok(7));
        assert_eq!(starts.run("A", || None, || Ok(8)), Ok(8));
    }

    #[test]
    fn a_start_that_panics_still_ends() {
        let starts = Starts::new(Duration::from_millis(1), Duration::from_millis(1));
        let result = starts.run("A", || None::<u16>, || panic!("boom"));
        assert_eq!(
            result,
            Err("The simulator agent stopped unexpectedly".into())
        );
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(starts.run("A", || None, || Ok(1)), Ok(1));
    }

    #[test]
    fn waits_longer_after_each_failure_up_to_a_minute() {
        let (first, max) = (Duration::from_secs(5), Duration::from_secs(60));
        let waits: Vec<u64> = (1..=6)
            .map(|n| retry_after(n, first, max).as_secs())
            .collect();
        assert_eq!(waits, [5, 10, 20, 40, 60, 60]);
        assert_eq!(retry_after(u32::MAX, first, max), max);
    }

    #[test]
    fn explains_a_start_that_failed_plainly() {
        assert_eq!(
            start_failure(" Could not listen: address in use ", &[]),
            "The simulator agent did not start: Could not listen: address in use"
        );
        let tail = [
            "Testing failed:".to_owned(),
            "\tAvenSimAgentUITests-Runner (4512) encountered an error (Early unexpected exit, operation never finished bootstrapping)".to_owned(),
            "** TEST EXECUTE FAILED **".to_owned(),
        ];
        assert_eq!(
            start_failure("", &tail),
            "The simulator agent did not start: AvenSimAgentUITests-Runner (4512) encountered an error (Early unexpected exit, operation never finished bootstrapping)"
        );
        assert_eq!(start_failure("", &[]), "The simulator agent did not start");
        let long = format!("error: {}", "é".repeat(400));
        assert!(start_failure("", &[long]).len() < 360);
    }

    #[test]
    fn runs_the_runner_without_diagnostics_into_its_own_results() {
        let args = runner_args(
            "/a/run.xctestrun",
            "E5B2",
            "/a/DerivedData",
            "/a/results/E5B2.xcresult",
        );
        let pair = |flag: &str| {
            let at = args.iter().position(|a| a == flag).unwrap();
            args[at + 1].clone()
        };
        assert_eq!(args[0], "test-without-building");
        assert_eq!(pair("-destination"), "id=E5B2");
        assert_eq!(pair("-collect-test-diagnostics"), "never");
        assert_eq!(pair("-resultBundlePath"), "/a/results/E5B2.xcresult");
        assert_eq!(pair("-derivedDataPath"), "/a/DerivedData");
    }
}
