//! Aven's XCUITest agent server (`src-tauri/ios-agent`): accessibility
//! snapshots for agents, and input when the native path is unavailable.
//!
//! The runner is built once per Xcode version into Aven's app data, from
//! sources embedded in the binary, and started per device on demand. It
//! listens on 127.0.0.1 with a random port and token.
#![cfg(target_os = "macos")]

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
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

/// Starts the agent server on `udid` and waits until it listens.
/// The port in the server's ready line: `AVEN_AGENT_READY port=<n>`.
fn ready_port(line: &str) -> Option<u16> {
    let rest = &line[line.find("AVEN_AGENT_READY port=")? + "AVEN_AGENT_READY port=".len()..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|port| *port > 0)
}

/// Starts the agent server on `udid` and waits until it listens. The server
/// picks its own port and reports it, so nothing else can take it between.
fn start(udid: &str, bundle: Option<&str>) -> Result<(u16, String), String> {
    let xctestrun = ensure_built()?;
    // Test results and logs stay in Aven's agent folder, not the person's
    // own DerivedData; each run's results replace the last ones.
    let derived = agent_root()?.join("DerivedData");
    let _ = std::fs::remove_dir_all(derived.join("Logs/Test"));
    let derived = derived.to_string_lossy().into_owned();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let destination = format!("id={udid}");
    let run = xctestrun.to_string_lossy().into_owned();
    let mut command = crate::ios_sim::tool(
        "/usr/bin/xcodebuild",
        &[
            "test-without-building",
            "-xctestrun",
            &run,
            "-destination",
            &destination,
            "-derivedDataPath",
            &derived,
            "-only-testing:AvenSimAgentUITests/AgentServer/testServe",
        ],
    );
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
    let (ready, ready_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let Some(stdout) = stdout else { return };
        let mut sent = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sent {
                continue;
            }
            if let Some(port) = ready_port(&line) {
                let _ = ready.send(Ok(port));
                sent = true;
            } else if line.contains("AVEN_AGENT_FAILED") {
                let _ = ready.send(Err(()));
                sent = true;
            }
        }
    });
    let child = Arc::new(Mutex::new(child));
    let port = match ready_rx.recv_timeout(Duration::from_secs(180)) {
        Ok(Ok(port)) => port,
        _ => {
            stop_child(&child);
            return Err("The simulator agent did not start".into());
        }
    };
    servers().insert(
        udid.to_uppercase(),
        Server {
            child,
            port,
            token: token.clone(),
        },
    );
    Ok((port, token))
}

fn stop_child(child: &Arc<Mutex<Child>>) {
    // Signals its process group only while the child is unreaped.
    crate::ios_sim::kill_child(child);
}

/// Stops every agent server (Aven quitting).
pub(crate) fn shutdown() {
    let all: Vec<Server> = servers().drain().map(|(_, server)| server).collect();
    for server in all {
        stop_child(&server.child);
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
    let existing = {
        let servers = servers();
        servers
            .get(&key)
            .filter(|server| alive(server))
            .map(|server| (server.port, server.token.clone()))
    };
    let (port, token) = match existing {
        Some(found) => found,
        None => {
            if let Some(stale) = servers().remove(&key) {
                stop_child(&stale.child);
            }
            start(udid, bundle)?
        }
    };
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
}
