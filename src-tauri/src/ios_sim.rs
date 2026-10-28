//! The iPhone pane: Xcode and simulator discovery, Run (build, install,
//! launch with console output), device input, and the live view's placement.
//!
//! macOS only. The live screen and input use Xcode's private simulator
//! frameworks through `ios_sim_native`; when those are unavailable the pane
//! runs in basic mode (polled `simctl` screenshots, XCUITest input).
#![cfg(target_os = "macos")]

use crate::ios_sim_boot::{self, BootFacts, BootId, InputStep};
use crate::ios_sim_devices::{self, SimDeviceInfo};
use crate::ios_sim_native as native;
use crate::ios_sim_xcode::{self, AppProduct, BuildIssue, XcodeContainer};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Webview};

const XCRUN: &str = "/usr/bin/xcrun";
const XCODEBUILD: &str = "/usr/bin/xcodebuild";
/// Console lines kept per project for the pane and agents.
const LOG_LINES: usize = 4000;
const DTUHIDD_FLAG: &str = "com.apple.coredevice.dtuhidd.active";
const DTUHIDD_JOB: &str = "com.apple.coredevice.dtuhidd";

// ---------------------------------------------------------------------------
// Shared state

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    #[default]
    Idle,
    Booting,
    Preparing,
    Building,
    Installing,
    Launching,
    Running,
    Failed,
    Stopped,
}

impl Phase {
    fn busy(self) -> bool {
        matches!(
            self,
            Phase::Booting
                | Phase::Preparing
                | Phase::Building
                | Phase::Installing
                | Phase::Launching
        )
    }
}

/// What the pane's bottom strip shows for a project.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunStatus {
    pub phase: Phase,
    pub message: String,
    pub udid: Option<String>,
    pub bundle_id: Option<String>,
    pub built_ms: Option<u64>,
    pub errors: Vec<BuildIssue>,
    pub log_path: Option<String>,
}

#[derive(Default)]
struct ProjectRun {
    status: RunStatus,
    logs: VecDeque<String>,
    /// Bumped by every Run and Stop; stale workers stop reporting.
    generation: u64,
    /// The build or the launched app's console process.
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Default)]
struct State {
    projects: HashMap<String, ProjectRun>,
    /// Devices Aven booted or the person picked in each project's pane: the
    /// only ones that project's agents may drive.
    scope: HashMap<String, BTreeSet<String>>,
    /// The boot of each device whose input Aven made (or found) ready.
    ready: HashMap<String, BootId>,
    /// Boots Aven started, and when if it was in this session (for the wait
    /// for CoreDevice's announcement). Kept in `boots.json` across restarts.
    aven_boots: HashMap<String, (BootId, Option<Instant>)>,
    aven_boots_loaded: bool,
    /// The device each open iPhone pane shows (a project can have several).
    panes: PaneDevices,
    /// Boots watched for a late CoreDevice announcement.
    watching: BTreeSet<(String, BootId)>,
    /// Build settings per (container, scheme).
    products: HashMap<(PathBuf, String), AppProduct>,
    /// The webview each live view sits above, as a pointer.
    views: HashMap<String, usize>,
    /// The device each live view shows.
    view_devices: HashMap<String, String>,
    /// What each project's pane has chosen, for agents' launches.
    choices: HashMap<String, PaneChoice>,
    /// Simulators `simctl list` named recently, to refuse anything else
    /// (a real device's identifier is a UUID too) without listing each time.
    known: Option<(Instant, BTreeSet<String>)>,
}

/// The device each open iPhone pane shows, by the pane's id. Panes of the
/// same project (one per chat, hidden tabs included) count separately, so a
/// device stays up while any of them shows it.
#[derive(Default)]
struct PaneDevices(HashMap<String, (String, String)>);

impl PaneDevices {
    /// Pane `pane` of `project` now shows `udid` (`None`: it closed). Returns
    /// the project and device it stopped showing, when that changed.
    fn show(&mut self, pane: &str, project: &str, udid: Option<&str>) -> Option<(String, String)> {
        let previous = match udid {
            Some(udid) => self
                .0
                .insert(pane.to_owned(), (project_key(project), udid.to_uppercase())),
            None => self.0.remove(pane),
        };
        previous.filter(|(_, before)| udid.is_none_or(|now| !before.eq_ignore_ascii_case(now)))
    }

    /// Whether any open pane shows `udid`.
    fn shows(&self, udid: &str) -> bool {
        self.0
            .values()
            .any(|(_, device)| device.eq_ignore_ascii_case(udid))
    }

    /// The projects with a pane showing `udid`.
    fn projects_showing(&self, udid: &str) -> BTreeSet<String> {
        self.0
            .values()
            .filter(|(_, device)| device.eq_ignore_ascii_case(udid))
            .map(|(project, _)| project.clone())
            .collect()
    }
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Serialises boots and input preparation per device.
static DEVICE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

fn device_lock(udid: &str) -> Arc<Mutex<()>> {
    DEVICE_LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .entry(udid.to_uppercase())
        .or_default()
        .clone()
}

/// Project paths are compared without a trailing slash.
pub(crate) fn project_key(project: &str) -> String {
    let trimmed = project.trim();
    let trimmed = trimmed
        .strip_suffix('/')
        .filter(|t| !t.is_empty())
        .unwrap_or(trimmed);
    trimmed.to_owned()
}

pub(crate) fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    native::set_event_handler(on_native_event);
}

fn emit_status(project: &str, status: &RunStatus) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ios-sim-status",
            json!({ "project": project, "status": status }),
        );
    }
}

fn set_status(project: &str, generation: Option<u64>, update: impl FnOnce(&mut RunStatus)) -> bool {
    let status = {
        let mut state = state();
        let run = state.projects.entry(project_key(project)).or_default();
        if generation.is_some_and(|g| g != run.generation) {
            return false;
        }
        update(&mut run.status);
        run.status.clone()
    };
    emit_status(&project_key(project), &status);
    true
}

fn push_logs(project: &str, generation: u64, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }
    {
        let mut state = state();
        let run = state.projects.entry(project_key(project)).or_default();
        if run.generation != generation {
            return;
        }
        for line in &lines {
            if run.logs.len() >= LOG_LINES {
                run.logs.pop_front();
            }
            run.logs.push_back(line.clone());
        }
    }
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "ios-sim-log",
            json!({ "project": project_key(project), "lines": lines }),
        );
    }
}

/// Recent console lines for a project (oldest first).
pub(crate) fn recent_logs(project: &str, limit: usize) -> Vec<String> {
    let state = state();
    state
        .projects
        .get(&project_key(project))
        .map(|run| {
            let skip = run.logs.len().saturating_sub(limit);
            run.logs.iter().skip(skip).cloned().collect()
        })
        .unwrap_or_default()
}

pub(crate) fn status_of(project: &str) -> RunStatus {
    state()
        .projects
        .get(&project_key(project))
        .map(|run| run.status.clone())
        .unwrap_or_default()
}

/// Devices this project's pane uses, for the agent scope.
pub(crate) fn scoped_devices(project: &str) -> BTreeSet<String> {
    state()
        .scope
        .get(&project_key(project))
        .cloned()
        .unwrap_or_default()
}

fn add_to_scope(project: &str, udid: &str) {
    state()
        .scope
        .entry(project_key(project))
        .or_default()
        .insert(udid.to_uppercase());
}

// ---------------------------------------------------------------------------
// Tools

pub(crate) struct Output {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

pub(crate) fn tool(program: &str, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command
        .args(args)
        .env("PATH", crate::harness::gui_search_path())
        .stdin(Stdio::null());
    command
}

/// Runs a tool to completion, killing it after `timeout`.
pub(crate) fn run(
    mut command: Command,
    timeout: Duration,
    input: Option<&[u8]>,
) -> Result<Output, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Xcode's tools: {error}"))?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        let _ = stdin.write_all(input);
    }
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });
    let err = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        String::from_utf8_lossy(&buffer).into_owned()
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Xcode's tools did not answer in time".into());
            }
            Err(error) => return Err(error.to_string()),
        }
    };
    Ok(Output {
        success: status.success(),
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

fn simctl(args: &[&str], timeout: Duration) -> Result<Output, String> {
    let mut all = vec!["simctl"];
    all.extend_from_slice(args);
    run(tool(XCRUN, &all), timeout, None)
}

fn checked(output: Output, what: &str) -> Result<Vec<u8>, String> {
    if output.success {
        return Ok(output.stdout);
    }
    let detail = output
        .stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    Err(if detail.is_empty() {
        format!("{what} failed")
    } else {
        format!("{what} failed: {detail}")
    })
}

// ---------------------------------------------------------------------------
// Xcode support

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Support {
    /// Xcode with the iOS simulator is installed and selected.
    pub xcode: bool,
    /// The live screen and native input work (otherwise basic mode).
    pub live: bool,
    pub developer_dir: Option<String>,
    pub reason: Option<String>,
}

/// (CoreSimulator, SimulatorKit) bundle versions the live path was tested
/// with. Other versions use basic mode unless `AVEN_IOS_SIM_ALLOW_UNTESTED=1`.
const TESTED_FRAMEWORKS: &[(&str, &str)] = &[("1174.9.2", "1005.3")];

/// Whether live mode may load these framework versions.
pub(crate) fn live_allowed(core: &str, kit: &str, allow_untested: bool) -> Result<(), String> {
    if allow_untested
        || TESTED_FRAMEWORKS
            .iter()
            .any(|(c, k)| *c == core && *k == kit)
    {
        Ok(())
    } else {
        Err(format!(
            "Aven has not been tested with this Xcode's simulator (CoreSimulator {core}, SimulatorKit {kit}), so it shows screenshots"
        ))
    }
}

/// What `xcode-select` points at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DeveloperDir {
    /// Xcode with the iOS simulator.
    Xcode(String),
    /// Only the command line tools are selected; `Some` names an installed
    /// Xcode that could be selected instead.
    CommandLineTools(Option<String>),
    Missing,
}

fn selected_developer_dir() -> DeveloperDir {
    let dir = std::env::var("DEVELOPER_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .or_else(|| {
            run(
                tool("/usr/bin/xcode-select", &["-p"]),
                Duration::from_secs(5),
                None,
            )
            .ok()
            .filter(|o| o.success)
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        });
    let Some(dir) = dir else {
        return DeveloperDir::Missing;
    };
    if Path::new(&dir)
        .join("Platforms/iPhoneSimulator.platform")
        .is_dir()
    {
        return DeveloperDir::Xcode(dir);
    }
    if dir.contains("CommandLineTools") {
        let xcode = ["/Applications/Xcode.app", "/Applications/Xcode-beta.app"]
            .into_iter()
            .find(|app| {
                Path::new(app)
                    .join("Contents/Developer/Platforms/iPhoneSimulator.platform")
                    .is_dir()
            })
            .map(str::to_owned);
        return DeveloperDir::CommandLineTools(xcode);
    }
    DeveloperDir::Missing
}

/// What the pane and its menu say when there is no usable Xcode.
pub(crate) fn no_xcode_reason(dir: &DeveloperDir) -> String {
    match dir {
        DeveloperDir::CommandLineTools(Some(xcode)) => format!(
            "The command line tools are selected instead of Xcode. To run iPhone apps, run this in Terminal: sudo xcode-select -s {xcode}"
        ),
        DeveloperDir::CommandLineTools(None) => {
            "Install Xcode to run iPhone apps (only its command line tools are installed)".into()
        }
        _ => "Install Xcode to run iPhone apps".into(),
    }
}

/// Rechecked this often, so a newly installed or selected Xcode is noticed.
const SUPPORT_REFRESH: Duration = Duration::from_secs(10);
static SUPPORT: Mutex<Option<(Instant, Support)>> = Mutex::new(None);

pub(crate) fn support() -> Support {
    let mut cached = SUPPORT.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((at, support)) = cached.as_ref() {
        if at.elapsed() < SUPPORT_REFRESH {
            return support.clone();
        }
    }
    let selected = selected_developer_dir();
    let support = match &selected {
        DeveloperDir::Xcode(dir) => {
            let allow_untested = std::env::var_os("AVEN_IOS_SIM_ALLOW_UNTESTED").is_some();
            let live = native::framework_versions(dir)
                .ok_or_else(|| "Xcode's simulator frameworks are missing".to_string())
                .and_then(|(core, kit)| live_allowed(&core, &kit, allow_untested))
                .and_then(|()| native::probe(dir));
            Support {
                xcode: true,
                live: live.is_ok(),
                developer_dir: Some(dir.clone()),
                reason: live.err(),
            }
        }
        other => Support {
            xcode: false,
            live: false,
            developer_dir: None,
            reason: Some(no_xcode_reason(other)),
        },
    };
    *cached = Some((Instant::now(), support.clone()));
    support
}

#[tauri::command]
pub async fn ios_sim_support() -> Support {
    tauri::async_runtime::spawn_blocking(support)
        .await
        .unwrap_or(Support {
            xcode: false,
            live: false,
            developer_dir: None,
            reason: Some("Could not check for Xcode".into()),
        })
}

// ---------------------------------------------------------------------------
// Projects

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectInfo {
    pub containers: Vec<XcodeContainer>,
    pub container: Option<XcodeContainer>,
    pub schemes: Vec<String>,
    pub error: Option<String>,
}

/// Whether a project folder holds an Xcode project or workspace (cheap:
/// two levels of folder listing, no tools).
#[tauri::command]
pub async fn ios_sim_has_project(project: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        !ios_sim_xcode::find_containers(Path::new(&project)).is_empty()
    })
    .await
    .unwrap_or(false)
}

pub(crate) fn project_info(project: &str, container: Option<&str>) -> ProjectInfo {
    let containers = ios_sim_xcode::find_containers(Path::new(project));
    let chosen = container
        .and_then(|path| containers.iter().find(|c| c.path == Path::new(path)))
        .or_else(|| containers.first())
        .cloned();
    let Some(chosen) = chosen else {
        return ProjectInfo {
            containers,
            container: None,
            schemes: Vec::new(),
            error: Some("This project has no Xcode project or workspace".into()),
        };
    };
    let mut args: Vec<String> = chosen.args().to_vec();
    args.extend(["-list".into(), "-json".into()]);
    // `-list` takes no DerivedData path; this keeps its logs out of the
    // person's own DerivedData folder too.
    if let Ok(dir) = project_dir(project) {
        args.push(format!(
            "-IDECustomDerivedDataLocation={}",
            dir.join("DerivedData").display()
        ));
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    // The first read of a project with Swift packages resolves them, which
    // can take minutes.
    let listed = run(tool(XCODEBUILD, &args), Duration::from_secs(900), None)
        .and_then(|output| checked(output, "Reading the schemes"))
        .and_then(|stdout| ios_sim_xcode::parse_list_json(&String::from_utf8_lossy(&stdout)));
    match listed {
        Ok(list) => ProjectInfo {
            containers,
            container: Some(chosen),
            schemes: list.schemes,
            error: None,
        },
        Err(error) => ProjectInfo {
            containers,
            container: Some(chosen),
            schemes: Vec::new(),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn ios_sim_project(project: String, container: Option<String>) -> ProjectInfo {
    tauri::async_runtime::spawn_blocking(move || project_info(&project, container.as_deref()))
        .await
        .unwrap_or_else(|error| ProjectInfo {
            containers: Vec::new(),
            container: None,
            schemes: Vec::new(),
            error: Some(error.to_string()),
        })
}

/// `<app data>/ios-sim`: per-project builds and Aven's simulator agent.
pub(crate) fn data_root() -> Result<PathBuf, String> {
    match APP.get() {
        Some(app) => Ok(app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("ios-sim")),
        // Live tests run without the app.
        None if cfg!(test) => Ok(std::env::temp_dir().join("aven-ios-sim-test")),
        None => Err("Aven is still starting".into()),
    }
}

/// `<app data>/ios-sim/<project stem>`: DerivedData and the last build log.
fn project_dir(project: &str) -> Result<PathBuf, String> {
    Ok(data_root()?.join(crate::project_logo::project_stem(&project_key(project))))
}

/// Removes a project's DerivedData and logs when the project is removed.
#[tauri::command]
pub async fn ios_sim_forget_project(project: String) -> Result<(), String> {
    let dir = project_dir(&project)?;
    // End its build or app console first: nothing may keep writing into the
    // folder this removes, or outlive the project.
    {
        let project = project.clone();
        tauri::async_runtime::spawn_blocking(move || stop(&project))
            .await
            .map_err(|error| error.to_string())?;
    }
    {
        let mut state = state();
        let key = project_key(&project);
        state.projects.remove(&key);
        state.scope.remove(&key);
        state
            .products
            .retain(|(container, _), _| !container.starts_with(&key));
    }
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove the iPhone build files: {error}")),
    })
    .await
    .map_err(|error| error.to_string())?
}

// ---------------------------------------------------------------------------
// Devices

pub(crate) fn list_devices() -> Result<Vec<SimDeviceInfo>, String> {
    let output = simctl(
        &["list", "devices", "available", "-j"],
        Duration::from_secs(30),
    )?;
    let stdout = checked(output, "Listing simulators")?;
    ios_sim_devices::parse_device_list(&String::from_utf8_lossy(&stdout))
}

fn device(udid: &str) -> Result<SimDeviceInfo, String> {
    let devices = list_devices()?;
    remember_known(&devices);
    devices
        .into_iter()
        .find(|d| d.udid.eq_ignore_ascii_case(udid))
        .ok_or_else(|| "That simulator is no longer available".to_string())
}

fn remember_known(devices: &[SimDeviceInfo]) {
    state().known = Some((
        Instant::now(),
        devices.iter().map(|d| d.udid.to_uppercase()).collect(),
    ));
}

/// Refuses anything `simctl list` does not name as a simulator, such as a
/// real device's UUID, before it reaches devicectl or the agent scope.
pub(crate) fn require_simulator(udid: &str) -> Result<String, String> {
    if !ios_sim_devices::valid_udid(udid) {
        return Err("Not a simulator".into());
    }
    let key = udid.to_uppercase();
    let fresh = state()
        .known
        .as_ref()
        .is_some_and(|(at, known)| at.elapsed() < Duration::from_secs(30) && known.contains(&key));
    if fresh {
        return Ok(key);
    }
    let devices = list_devices()?;
    remember_known(&devices);
    ios_sim_devices::known_simulator(udid, &devices).ok_or_else(|| "Not a simulator".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceList {
    devices: Vec<SimDeviceInfo>,
    /// The pane's choice when it has none remembered.
    suggested: Option<String>,
}

#[tauri::command]
pub async fn ios_sim_devices() -> Result<DeviceList, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let devices = list_devices()?;
        remember_known(&devices);
        // Simulators Aven started, in this session or before a restart, come
        // first, so a pane never boots another one while Aven's still runs.
        let ours: BTreeSet<String> = devices
            .iter()
            .filter(|d| d.booted && boot_facts(&d.udid, d.data_path.as_deref()).aven_booted())
            .map(|d| d.udid.to_uppercase())
            .collect();
        let suggested = ios_sim_devices::default_device(&devices, &ours).map(|d| d.udid.clone());
        Ok(DeviceList { devices, suggested })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// CoreDevice's HID daemon in this simulator (iOS 27 and later; older
/// runtimes have none, and their input needs no fix).
fn hid_daemon(udid: &str) -> ios_sim_boot::Daemon {
    simctl(
        &["spawn", udid, "launchctl", "list"],
        Duration::from_secs(10),
    )
    .map(|o| ios_sim_boot::parse_daemon(&String::from_utf8_lossy(&o.stdout), DTUHIDD_JOB))
    .unwrap_or(ios_sim_boot::Daemon::Absent)
}

fn notify_flag(udid: &str) -> Option<u64> {
    let output = simctl(
        &["spawn", udid, "notifyutil", "-g", DTUHIDD_FLAG],
        Duration::from_secs(10),
    )
    .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace().last()?.parse().ok()
}

/// What preparing a device's input did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Prepared {
    /// The home screen restarted; touches work.
    Restarted,
    /// CoreDevice did not announce its HID daemon: touches work as they are.
    /// `watch`: it may still do so later (the daemon exists).
    Clear { watch: bool },
}

/// Xcode 27.1's CoreDevice HID daemon makes the simulator ignore SimulatorKit
/// input once it announces itself after a boot (it does when a CoreDevice
/// client such as DeviceHub is open). Then mark it inactive and restart
/// backboardd so the input services start fresh (the home screen restarts
/// once). `booted_at` is when Aven booted the device in this session.
fn prepare_input(udid: &str, booted_at: Option<Instant>) -> Result<Prepared, String> {
    loop {
        let daemon = hid_daemon(udid);
        let flag = notify_flag(udid);
        match ios_sim_boot::announcement(flag, daemon, booted_at.map(|at| at.elapsed())) {
            ios_sim_boot::Announcement::Fix => break,
            ios_sim_boot::Announcement::Wait => std::thread::sleep(Duration::from_millis(150)),
            ios_sim_boot::Announcement::Clear => {
                return Ok(Prepared::Clear {
                    watch: daemon != ios_sim_boot::Daemon::Absent,
                })
            }
        }
    }
    // Clear the flag and tell its listeners in one call.
    checked(
        simctl(
            &[
                "spawn",
                udid,
                "notifyutil",
                "-s",
                DTUHIDD_FLAG,
                "0",
                "-p",
                DTUHIDD_FLAG,
            ],
            Duration::from_secs(10),
        )?,
        "Preparing the simulator's input",
    )?;
    let _ = simctl(
        &[
            "spawn",
            udid,
            "launchctl",
            "kickstart",
            "-k",
            "system/com.apple.backboardd",
        ],
        Duration::from_secs(20),
    );
    native::reset(udid);
    // SpringBoard is back once its job has a process again. Waiting longer,
    // until it takes app launches, measured slower overall: an install
    // started while it comes back finishes sooner than one started after.
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        let listed = simctl(
            &["spawn", udid, "launchctl", "list"],
            Duration::from_secs(10),
        )
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
        let running = listed.lines().any(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next().unwrap_or("");
            let label = parts.nth(1).unwrap_or("");
            label == "com.apple.SpringBoard" && pid.parse::<u32>().is_ok()
        });
        if running {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    std::thread::sleep(Duration::from_secs(2));
    native::reset(udid);
    Ok(Prepared::Restarted)
}

/// Child processes waiting for a late announcement, ended when Aven quits.
static WATCHERS: Mutex<Vec<Arc<Mutex<Child>>>> = Mutex::new(Vec::new());

/// Waits (without polling) for CoreDevice to announce its HID daemon on a
/// boot whose input works without the fix, as when DeviceHub is opened
/// later. Touches then stop reaching the device until the fix runs: the
/// pane says so, and the next Run or pick fixes it.
fn watch_announcement(udid: &str, data_path: Option<PathBuf>, boot: BootId) {
    let key = udid.to_uppercase();
    if !state().watching.insert((key.clone(), boot)) {
        return;
    }
    let mut command = tool(
        XCRUN,
        &["simctl", "spawn", &key, "notifyutil", "-1", DTUHIDD_FLAG],
    );
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let Ok(child) = command.spawn() else {
        state().watching.remove(&(key, boot));
        return;
    };
    let child = Arc::new(Mutex::new(child));
    WATCHERS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(child.clone());
    let _ = std::thread::Builder::new()
        .name("ios-sim-announce".into())
        .spawn(move || {
            // Ends when the notification comes or the device shuts down.
            loop {
                let done = child.lock().unwrap_or_else(|p| p.into_inner()).try_wait();
                match done {
                    Ok(None) => std::thread::sleep(Duration::from_millis(500)),
                    _ => break,
                }
            }
            WATCHERS
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .retain(|other| !Arc::ptr_eq(other, &child));
            state().watching.remove(&(key.clone(), boot));
            let same_boot = data_path.as_deref().and_then(ios_sim_boot::boot_id) == Some(boot);
            if !same_boot || notify_flag(&key) != Some(1) {
                return;
            }
            let projects = {
                let mut state = state();
                if state.ready.get(&key) == Some(&boot) {
                    state.ready.remove(&key);
                }
                state.panes.projects_showing(&key)
            };
            for project in projects {
                set_status(&project, None, |s| {
                    if s.phase == Phase::Running {
                        s.message = format!("{} · {NEEDS_PICK}", s.message);
                    } else if !s.phase.busy() {
                        s.message = NEEDS_PICK.into();
                    }
                });
            }
        });
}

/// Whether a device's touches and keys reach it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Readiness {
    Ready,
    /// A simulator that was already running needs its input fixed, which
    /// restarts its home screen: done only when the person picks it.
    NeedsPick,
}

const NEEDS_PICK: &str =
    "Pick this iPhone again in the device menu to make touches work (its home screen restarts once)";

/// Stands in for a boot that cannot be named (no data folder): the record
/// then holds until a boot can be read.
const UNKNOWN_BOOT: BootId = 0;

fn boots_file() -> Option<PathBuf> {
    data_root().ok().map(|root| root.join("boots.json"))
}

/// Boots Aven started, read once from `boots.json` (an earlier session's
/// boots that are still running stay Aven's).
fn load_aven_boots(state: &mut State) {
    if state.aven_boots_loaded {
        return;
    }
    state.aven_boots_loaded = true;
    let saved: HashMap<String, BootId> = boots_file()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    for (udid, boot) in saved {
        state.aven_boots.entry(udid).or_insert((boot, None));
    }
}

fn save_aven_boots(state: &State) {
    let Some(path) = boots_file() else { return };
    let boots: HashMap<&String, BootId> = state
        .aven_boots
        .iter()
        .filter(|(_, (boot, _))| *boot != UNKNOWN_BOOT)
        .map(|(udid, (boot, _))| (udid, *boot))
        .collect();
    if let Ok(json) = serde_json::to_vec(&boots) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, json);
    }
}

/// What Aven knows about a device's current boot.
fn boot_facts(udid: &str, data_path: Option<&Path>) -> BootFacts {
    let key = udid.to_uppercase();
    let current = data_path.and_then(ios_sim_boot::boot_id);
    let mut state = state();
    load_aven_boots(&mut state);
    BootFacts {
        current,
        ready: state.ready.get(&key).copied(),
        started_by_aven: state
            .aven_boots
            .get(&key)
            .map(|(boot, at)| (*boot, at.map(|at| at.elapsed()))),
    }
}

fn mark_ready(udid: &str, facts: &BootFacts) {
    state()
        .ready
        .insert(udid.to_uppercase(), facts.current.unwrap_or(UNKNOWN_BOOT));
}

/// Boots `udid` if needed and makes its input ready, once per boot. The input
/// fix (which restarts the home screen) runs only on a boot Aven started, or
/// on a device the person picked in the pane (`picked`). Progress goes to
/// `report` (phase and message).
pub(crate) fn prepare_device(
    project: &str,
    udid: &str,
    picked: bool,
    report: &dyn Fn(Phase, String),
) -> Result<Readiness, String> {
    if !ios_sim_devices::valid_udid(udid) {
        return Err("Not a simulator".into());
    }
    let lock = device_lock(udid);
    let _guard = lock.lock().unwrap_or_else(|p| p.into_inner());
    let info = device(udid)?;
    add_to_scope(project, udid);
    let key = udid.to_uppercase();
    if !info.booted {
        report(Phase::Booting, format!("Starting {}…", info.name));
        let output = simctl(&["bootstatus", udid, "-b"], Duration::from_secs(300))?;
        checked(output, "Starting the simulator")?;
    }
    // Only a boot Aven started from shut down is Aven's; one already
    // starting belongs to whoever started it.
    if info.state == "Shutdown" {
        let boot = info
            .data_path
            .as_deref()
            .and_then(ios_sim_boot::boot_id)
            .unwrap_or(UNKNOWN_BOOT);
        let mut state = state();
        load_aven_boots(&mut state);
        state.ready.remove(&key);
        state
            .aven_boots
            .insert(key.clone(), (boot, Some(Instant::now())));
        save_aven_boots(&state);
        drop(state);
        native::reset(udid);
    }
    let facts = boot_facts(&key, info.data_path.as_deref());
    let prepared = match ios_sim_boot::input_step(&facts, picked, support().live) {
        InputStep::Ready => Prepared::Clear { watch: false },
        // Someone else's running simulator: never restart its home screen
        // unless the person picks it here.
        InputStep::Check => {
            let daemon = hid_daemon(udid);
            match ios_sim_boot::announcement(notify_flag(udid), daemon, None) {
                ios_sim_boot::Announcement::Fix => return Ok(Readiness::NeedsPick),
                _ => Prepared::Clear {
                    watch: daemon != ios_sim_boot::Daemon::Absent,
                },
            }
        }
        // A boot Aven just started may still be announced; any other is
        // fixed only if the announcement happened.
        InputStep::Fix { since_boot } => {
            report(Phase::Preparing, "Getting the iPhone ready…".into());
            prepare_input(udid, since_boot.map(|since| Instant::now() - since))?
        }
    };
    mark_ready(&key, &facts);
    if let (Prepared::Clear { watch: true }, Some(boot)) = (prepared, facts.current) {
        watch_announcement(udid, info.data_path.clone(), boot);
    }
    Ok(Readiness::Ready)
}

/// `prepare_device` with progress in the project's status strip.
pub(crate) fn ensure_device(
    project: &str,
    udid: &str,
    generation: Option<u64>,
    picked: bool,
) -> Result<Readiness, String> {
    let key = udid.to_uppercase();
    prepare_device(project, udid, picked, &|phase, message| {
        set_status(project, generation, |s| {
            s.phase = phase;
            s.message = message;
            s.udid = Some(key.clone());
        });
    })
}

/// How long a simulator Aven started keeps running after its pane moves to
/// another one, in case the person moves back.
const RELEASE_GRACE: Duration = Duration::from_secs(8);

/// A pane moved from `udid` to another device: shut `udid` down shortly if
/// Aven started it and nothing else uses it. Simulators someone else started
/// keep running.
fn release_later(project: &str, udid: &str) {
    let (project, udid) = (project_key(project), udid.to_uppercase());
    let _ = std::thread::Builder::new()
        .name("ios-sim-release".into())
        .spawn(move || {
            std::thread::sleep(RELEASE_GRACE);
            let lock = device_lock(&udid);
            let _guard = lock.lock().unwrap_or_else(|p| p.into_inner());
            let Ok(info) = device(&udid) else { return };
            if !info.booted {
                return;
            }
            let facts = boot_facts(&udid, info.data_path.as_deref());
            let (shown, used, ours_running) = {
                let state = state();
                // Any open pane, of this project or another.
                let shown = state.panes.shows(&udid);
                let on_device = |run: &ProjectRun| {
                    run.status.udid.as_deref() == Some(udid.as_str())
                        && (run.status.phase.busy() || run.status.phase == Phase::Running)
                };
                // Another project's run, or this project's build for it.
                let used = state.projects.iter().any(|(owner, run)| {
                    on_device(run) && (*owner != project || run.status.phase.busy())
                });
                let ours_running = state.projects.get(&project).is_some_and(on_device);
                (shown, used, ours_running)
            };
            if !ios_sim_boot::may_release(&facts, shown, used) {
                return;
            }
            // This project's app on it ends with it.
            if ours_running {
                stop(&project);
            }
            if simctl(&["shutdown", &udid], Duration::from_secs(120)).is_ok_and(|o| o.success) {
                let mut state = state();
                state.ready.remove(&udid);
                state.aven_boots.remove(&udid);
                save_aven_boots(&state);
                drop(state);
                native::reset(&udid);
            }
        });
}

/// Pane `pane` shows `udid`: boot it if needed. `picked` is true when the
/// person chose it in the device menu just now (not a remembered or
/// suggested one). The device it showed before is released shortly unless
/// another pane shows it.
#[tauri::command]
pub async fn ios_sim_use_device(
    project: String,
    udid: String,
    picked: Option<bool>,
    pane: String,
) -> Result<(), String> {
    if !valid_view_id(&pane) {
        return Err("Invalid iPhone pane".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if ios_sim_devices::valid_udid(&udid) {
            let previous = state().panes.show(&pane, &project, Some(&udid));
            if let Some((owner, previous)) = previous {
                release_later(&owner, &previous);
            }
        }
        let generation = state()
            .projects
            .entry(project_key(&project))
            .or_default()
            .generation;
        let busy = status_of(&project).phase.busy();
        let result = ensure_device(&project, &udid, Some(generation), picked.unwrap_or(false));
        if !busy {
            set_status(&project, Some(generation), |s| {
                if matches!(s.phase, Phase::Booting | Phase::Preparing | Phase::Idle) {
                    s.phase = Phase::Idle;
                    s.message = match &result {
                        Ok(Readiness::Ready) => String::new(),
                        Ok(Readiness::NeedsPick) => NEEDS_PICK.into(),
                        Err(error) => error.clone(),
                    };
                }
            });
        }
        result.map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The pane's current device, container and scheme.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaneChoice {
    pub udid: Option<String>,
    pub container: Option<String>,
    pub scheme: Option<String>,
}

/// Records the pane's choice. A device counts only when `simctl list` names
/// it as a simulator; it then joins the project's agent scope.
pub(crate) fn record_choice(project: &str, mut choice: PaneChoice, devices: &[SimDeviceInfo]) {
    let key = project_key(project);
    choice.udid = choice
        .udid
        .and_then(|udid| ios_sim_devices::known_simulator(&udid, devices));
    let mut state = state();
    if let Some(udid) = &choice.udid {
        state
            .scope
            .entry(key.clone())
            .or_default()
            .insert(udid.clone());
    }
    state.choices.insert(key, choice);
}

#[tauri::command]
pub async fn ios_sim_pane_choice(project: String, choice: PaneChoice) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let devices = if choice.udid.is_some() {
            list_devices()?
        } else {
            Vec::new()
        };
        remember_known(&devices);
        record_choice(&project, choice, &devices);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn pane_scheme(project: &str) -> Option<String> {
    state()
        .choices
        .get(&project_key(project))
        .and_then(|c| c.scheme.clone())
}

pub(crate) fn pane_container(project: &str) -> Option<String> {
    state()
        .choices
        .get(&project_key(project))
        .and_then(|c| c.container.clone())
}

pub(crate) fn pane_device(project: &str) -> Option<String> {
    state()
        .choices
        .get(&project_key(project))
        .and_then(|c| c.udid.clone())
        .map(|u| u.to_uppercase())
}

pub(crate) fn generation_of(project: &str) -> u64 {
    state()
        .projects
        .get(&project_key(project))
        .map_or(0, |run| run.generation)
}

// ---------------------------------------------------------------------------
// Run

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunRequest {
    pub project: String,
    pub udid: String,
    pub container: String,
    pub scheme: String,
}

pub(crate) fn kill_child(child: &Arc<Mutex<Child>>) {
    let mut child = child.lock().unwrap_or_else(|p| p.into_inner());
    // Builds run in their own process group; end the whole group, but only
    // while the child is unreaped: after `wait`, its PID (and group) may
    // belong to another process.
    if matches!(child.try_wait(), Ok(None)) {
        let pid = child.id() as i32;
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Starts a Run; returns at once. Status and console lines arrive as events.
pub(crate) fn start_run(request: RunRequest) -> Result<u64, String> {
    if !ios_sim_devices::valid_udid(&request.udid) {
        return Err("Not a simulator".into());
    }
    let containers = ios_sim_xcode::find_containers(Path::new(&request.project));
    let container = containers
        .into_iter()
        .find(|c| c.path == Path::new(&request.container))
        .ok_or("That Xcode project is not in this project")?;
    if request.scheme.trim().is_empty() || request.scheme.starts_with('-') {
        return Err("Choose a scheme".into());
    }
    let (generation, previous) = {
        let mut state = state();
        let run = state
            .projects
            .entry(project_key(&request.project))
            .or_default();
        run.generation += 1;
        run.logs.clear();
        (run.generation, run.child.take())
    };
    if let Some(child) = previous {
        kill_child(&child);
    }
    set_status(&request.project, Some(generation), |s| {
        *s = RunStatus {
            phase: Phase::Building,
            message: "Building…".into(),
            udid: Some(request.udid.to_uppercase()),
            ..Default::default()
        };
    });
    std::thread::Builder::new()
        .name("ios-sim-run".into())
        .spawn(move || {
            let project = request.project.clone();
            if let Err(error) = run_pipeline(&request, &container, generation) {
                set_status(&project, Some(generation), |s| {
                    if s.phase != Phase::Failed {
                        s.phase = Phase::Failed;
                        s.message = error;
                    }
                });
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(generation)
}

fn current(project: &str, generation: u64) -> bool {
    state()
        .projects
        .get(&project_key(project))
        .is_some_and(|run| run.generation == generation)
}

fn product_for(
    container: &XcodeContainer,
    scheme: &str,
    derived: &Path,
) -> Result<AppProduct, String> {
    let key = (container.path.clone(), scheme.to_owned());
    if let Some(product) = state().products.get(&key) {
        return Ok(product.clone());
    }
    let mut args: Vec<String> = container.args().to_vec();
    args.extend([
        "-scheme".into(),
        scheme.into(),
        "-configuration".into(),
        "Debug".into(),
        "-destination".into(),
        "generic/platform=iOS Simulator".into(),
        "-derivedDataPath".into(),
        derived.to_string_lossy().into_owned(),
        "-showBuildSettings".into(),
        "-json".into(),
    ]);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run(tool(XCODEBUILD, &args), Duration::from_secs(120), None)?;
    let stdout = checked(output, "Reading the build settings")?;
    let product = ios_sim_xcode::parse_build_settings(&String::from_utf8_lossy(&stdout))?;
    state().products.insert(key, product.clone());
    Ok(product)
}

fn register_child(project: &str, generation: u64, child: Child) -> Option<Arc<Mutex<Child>>> {
    let child = Arc::new(Mutex::new(child));
    let mut state = state();
    let run = state.projects.entry(project_key(project)).or_default();
    if run.generation != generation {
        drop(state);
        kill_child(&child);
        return None;
    }
    run.child = Some(child.clone());
    Some(child)
}

/// A Run's build: the scheme for this simulator's architecture only, into
/// the project's own DerivedData in Aven's data, so every later Run builds
/// incrementally. No index store: nothing reads one there, and writing it
/// slows every compile.
pub(crate) fn build_args(
    container: &XcodeContainer,
    scheme: &str,
    udid: &str,
    derived: &Path,
) -> Vec<String> {
    let mut args: Vec<String> = container.args().to_vec();
    args.extend([
        "-scheme".into(),
        scheme.into(),
        "-configuration".into(),
        "Debug".into(),
        "-destination".into(),
        format!("id={udid}"),
        "-derivedDataPath".into(),
        derived.to_string_lossy().into_owned(),
        "ONLY_ACTIVE_ARCH=YES".into(),
        "COMPILER_INDEX_STORE_ENABLE=NO".into(),
        "build".into(),
    ]);
    args
}

/// The device's progress while a Run builds: kept quiet until the build is
/// done, then shown while the Run waits for the device.
#[derive(Default)]
struct DeviceProgress {
    latest: Option<(Phase, String)>,
    shown: bool,
}

/// Boots the device and makes its input ready beside the build.
fn prepare_beside_build(
    project: &str,
    udid: &str,
    generation: u64,
    progress: Arc<Mutex<DeviceProgress>>,
) -> Result<std::thread::JoinHandle<Result<Readiness, String>>, String> {
    let (project, udid) = (project.to_owned(), udid.to_owned());
    std::thread::Builder::new()
        .name("ios-sim-device".into())
        .spawn(move || {
            let key = udid.to_uppercase();
            prepare_device(&project, &udid, false, &|phase, message| {
                let mut progress = progress.lock().unwrap_or_else(|p| p.into_inner());
                progress.latest = Some((phase, message.clone()));
                if progress.shown {
                    set_status(&project, Some(generation), |s| {
                        s.phase = phase;
                        s.message = message;
                        s.udid = Some(key.clone());
                    });
                }
            })
        })
        .map_err(|error| error.to_string())
}

fn run_pipeline(
    request: &RunRequest,
    container: &XcodeContainer,
    generation: u64,
) -> Result<(), String> {
    let project = request.project.as_str();
    let udid = request.udid.as_str();
    let dir = project_dir(project)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not prepare the build folder: {error}"))?;
    let derived = dir.join("DerivedData");
    // Building needs no running device: the device starts (and its input is
    // fixed) while the app builds, and its build settings are read beside it.
    let progress = Arc::new(Mutex::new(DeviceProgress::default()));
    let device = prepare_beside_build(project, udid, generation, progress.clone())?;
    let product = {
        let (container, scheme, derived) =
            (container.clone(), request.scheme.clone(), derived.clone());
        std::thread::spawn(move || product_for(&container, &scheme, &derived))
    };
    set_status(project, Some(generation), |s| {
        s.phase = Phase::Building;
        s.message = "Building…".into();
    });
    let started = Instant::now();
    let args = build_args(container, &request.scheme, udid, &derived);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut build = tool(XCODEBUILD, &args);
    if let Some(parent) = container.path.parent() {
        build.current_dir(parent);
    }
    {
        use std::os::unix::process::CommandExt;
        build.process_group(0);
    }
    build.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = build
        .spawn()
        .map_err(|error| format!("Could not start xcodebuild: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let Some(child) = register_child(project, generation, child) else {
        return Ok(());
    };
    let log = Arc::new(Mutex::new(String::new()));
    let collect = |pipe: Option<Box<dyn Read + Send>>, log: Arc<Mutex<String>>| {
        std::thread::spawn(move || {
            let Some(pipe) = pipe else { return };
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let mut log = log.lock().unwrap_or_else(|p| p.into_inner());
                log.push_str(&line);
                log.push('\n');
            }
        })
    };
    let out = collect(
        stdout.map(|p| Box::new(p) as Box<dyn Read + Send>),
        log.clone(),
    );
    let err = collect(
        stderr.map(|p| Box::new(p) as Box<dyn Read + Send>),
        log.clone(),
    );
    let status = loop {
        let done = child.lock().unwrap_or_else(|p| p.into_inner()).try_wait();
        match done {
            Ok(Some(status)) => break Some(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break None,
        }
    };
    let _ = out.join();
    let _ = err.join();
    if !current(project, generation) {
        return Ok(());
    }
    let text = log.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let summary = ios_sim_xcode::parse_build_output(&text);
    let built_ms = started.elapsed().as_millis() as u64;
    let log_path = dir.join("build.log");
    let _ = std::fs::write(&log_path, build_log(&request.scheme, &summary, &text));
    if !status.is_some_and(|s| s.success()) || !summary.succeeded && !summary.errors.is_empty() {
        let errors = summary.errors.iter().take(50).cloned().collect();
        set_status(project, Some(generation), |s| {
            s.phase = Phase::Failed;
            s.message = ios_sim_xcode::failure_label(&summary);
            s.errors = errors;
            s.log_path = Some(log_path.to_string_lossy().into_owned());
            s.built_ms = Some(built_ms);
        });
        return Ok(());
    }
    let product = product
        .join()
        .map_err(|_| "Could not read the build settings".to_string())??;
    let readiness = wait_for_device(project, generation, device, &progress)?;
    if !current(project, generation) {
        return Ok(());
    }
    if !product.app_path.is_dir() {
        state()
            .products
            .remove(&(container.path.clone(), request.scheme.clone()));
        return Err("The build did not produce the app; press Run again".into());
    }
    // The settings were cached; the identifier may have changed since. Read
    // it from the app just built.
    let bundle_id = built_bundle_id(&product.app_path).unwrap_or_else(|| product.bundle_id.clone());
    set_status(project, Some(generation), |s| {
        s.phase = Phase::Installing;
        s.message = "Installing…".into();
        s.log_path = Some(log_path.to_string_lossy().into_owned());
        s.built_ms = Some(built_ms);
        s.bundle_id = Some(bundle_id.clone());
    });
    let app = product.app_path.to_string_lossy().into_owned();
    checked(
        simctl(&["install", udid, &app], Duration::from_secs(300))?,
        "Installing the app",
    )?;
    if !current(project, generation) {
        return Ok(());
    }
    launch(project, udid, &bundle_id, generation, Some(built_ms))?;
    if readiness == Readiness::NeedsPick {
        set_status(project, Some(generation), |s| {
            if s.phase == Phase::Running {
                s.message = format!("{} · {NEEDS_PICK}", s.message);
            }
        });
    }
    Ok(())
}

/// Waits for the device a Run prepared beside its build, showing its
/// progress from now on.
fn wait_for_device(
    project: &str,
    generation: u64,
    device: std::thread::JoinHandle<Result<Readiness, String>>,
    progress: &Mutex<DeviceProgress>,
) -> Result<Readiness, String> {
    if !device.is_finished() {
        let latest = {
            let mut progress = progress.lock().unwrap_or_else(|p| p.into_inner());
            progress.shown = true;
            progress.latest.clone()
        };
        // Still waiting for another preparation of the same device (the
        // pane's) when there is no progress of its own.
        let (phase, message) =
            latest.unwrap_or((Phase::Preparing, "Getting the iPhone ready…".into()));
        set_status(project, Some(generation), |s| {
            s.phase = phase;
            s.message = message;
        });
    }
    device
        .join()
        .map_err(|_| "The simulator did not start".to_string())?
}

/// CFBundleIdentifier from a built app's Info.plist.
fn built_bundle_id(app: &Path) -> Option<String> {
    let plist = app.join("Info.plist");
    let plist = plist.to_string_lossy().into_owned();
    let output = run(
        tool(
            "/usr/bin/plutil",
            &["-extract", "CFBundleIdentifier", "raw", "-o", "-", &plist],
        ),
        Duration::from_secs(10),
        None,
    )
    .ok()
    .filter(|o| o.success)?;
    let id = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!id.is_empty() && !id.contains(char::is_whitespace)).then_some(id)
}

/// The saved log: errors first, so "Show errors" opens on them.
fn build_log(scheme: &str, summary: &ios_sim_xcode::BuildSummary, text: &str) -> String {
    let mut out = String::new();
    if summary.errors.is_empty() {
        out.push_str(&format!("Build log for {scheme}\n\n"));
    } else {
        out.push_str(&format!(
            "{} in {scheme}\n\n",
            ios_sim_xcode::failure_label(summary)
        ));
        for issue in &summary.errors {
            match (&issue.file, issue.line) {
                (Some(file), Some(line)) => {
                    out.push_str(&format!("{file}:{line}: {}\n", issue.message))
                }
                (Some(file), None) => out.push_str(&format!("{file}: {}\n", issue.message)),
                _ => out.push_str(&format!("{}\n", issue.message)),
            }
        }
        out.push_str("\n── Full build log ──\n\n");
    }
    out.push_str(text);
    out
}

/// Launches (or relaunches) the app with its console attached.
pub(crate) fn launch(
    project: &str,
    udid: &str,
    bundle_id: &str,
    generation: u64,
    built_ms: Option<u64>,
) -> Result<(), String> {
    set_status(project, Some(generation), |s| {
        s.phase = Phase::Launching;
        s.message = "Opening the app…".into();
        s.bundle_id = Some(bundle_id.to_owned());
    });
    let mut launch = tool(
        XCRUN,
        &[
            "simctl",
            "launch",
            "--console-pty",
            "--terminate-running-process",
            udid,
            bundle_id,
        ],
    );
    {
        use std::os::unix::process::CommandExt;
        launch.process_group(0);
    }
    launch.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = launch
        .spawn()
        .map_err(|error| format!("Could not open the app: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let Some(child) = register_child(project, generation, child) else {
        return Ok(());
    };
    let message = match built_ms {
        Some(ms) => format!("Running · {}", ios_sim_xcode::built_in_label(ms)),
        None => "Running".into(),
    };
    set_status(project, Some(generation), |s| {
        s.phase = Phase::Running;
        s.message = message;
    });
    let owner = project.to_owned();
    let pump = |pipe: Option<Box<dyn Read + Send>>, owner: String| {
        std::thread::spawn(move || {
            let Some(pipe) = pipe else { return };
            let mut reader = BufReader::new(pipe);
            let mut batch = Vec::new();
            let mut last = Instant::now();
            let mut line = Vec::new();
            loop {
                line.clear();
                match reader.read_until(b'\n', &mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&line)
                            .trim_end_matches(['\r', '\n'])
                            .to_owned();
                        batch.push(text);
                        if batch.len() >= 50 || last.elapsed() > Duration::from_millis(100) {
                            push_logs(&owner, generation, std::mem::take(&mut batch));
                            last = Instant::now();
                        }
                    }
                }
            }
            push_logs(&owner, generation, batch);
        })
    };
    let out = pump(
        stdout.map(|p| Box::new(p) as Box<dyn Read + Send>),
        owner.clone(),
    );
    let err = pump(stderr.map(|p| Box::new(p) as Box<dyn Read + Send>), owner);
    std::thread::spawn({
        let project = project.to_owned();
        move || {
            loop {
                let done = child.lock().unwrap_or_else(|p| p.into_inner()).try_wait();
                match done {
                    Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                    _ => break,
                }
            }
            let _ = out.join();
            let _ = err.join();
            set_status(&project, Some(generation), |s| {
                if s.phase == Phase::Running {
                    s.phase = Phase::Stopped;
                    s.message = "The app quit".into();
                }
            });
        }
    });
    Ok(())
}

/// Reopens the last built app without building.
pub(crate) fn relaunch(project: &str, udid: &str, bundle_id: &str) -> Result<u64, String> {
    let (generation, previous) = {
        let mut state = state();
        let run = state.projects.entry(project_key(project)).or_default();
        run.generation += 1;
        (run.generation, run.child.take())
    };
    if let Some(child) = previous {
        kill_child(&child);
    }
    ensure_device(project, udid, Some(generation), false)?;
    launch(project, udid, bundle_id, generation, None)?;
    Ok(generation)
}

#[tauri::command]
pub async fn ios_sim_run(request: RunRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start_run(request).map(|_| ()))
        .await
        .map_err(|error| error.to_string())?
}

/// Stops a build or the running app.
pub(crate) fn stop(project: &str) {
    let (child, status, generation) = {
        let mut state = state();
        let run = state.projects.entry(project_key(project)).or_default();
        run.generation += 1;
        (run.child.take(), run.status.clone(), run.generation)
    };
    if let Some(child) = child {
        kill_child(&child);
    }
    if let (Some(udid), Some(bundle)) = (&status.udid, &status.bundle_id) {
        if status.phase == Phase::Running || status.phase == Phase::Launching {
            let _ = simctl(&["terminate", udid, bundle], Duration::from_secs(20));
        }
    }
    set_status(project, Some(generation), |s| {
        s.phase = Phase::Stopped;
        s.message = if status.phase == Phase::Building {
            "Build stopped".into()
        } else {
            "Stopped".into()
        };
    });
}

/// Aven is quitting: end builds and app consoles it started (the apps keep
/// running in their simulators) and the XCUITest agents.
pub(crate) fn shutdown() {
    let children: Vec<Arc<Mutex<Child>>> = state()
        .projects
        .values_mut()
        .filter_map(|run| {
            run.generation += 1;
            run.child.take()
        })
        .collect();
    let watchers = std::mem::take(&mut *WATCHERS.lock().unwrap_or_else(|p| p.into_inner()));
    for child in children.iter().chain(&watchers) {
        kill_child(child);
    }
    crate::ios_sim_xcuitest::shutdown();
}

#[tauri::command]
pub async fn ios_sim_stop(project: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stop(&project))
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaneState {
    status: RunStatus,
    logs: Vec<String>,
}

#[tauri::command]
pub fn ios_sim_state(project: String) -> PaneState {
    PaneState {
        status: status_of(&project),
        logs: recent_logs(&project, 1000),
    }
}

// ---------------------------------------------------------------------------
// Input and device actions shared by the pane and agents

/// The device's screen as an agent or a person sees it: upright points.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Screen {
    pub info: native::DisplayInfo,
    pub turns: u32,
}

impl Screen {
    /// Upright size in points.
    pub fn size(self) -> (f64, f64) {
        if self.turns % 2 == 1 {
            (self.info.height, self.info.width)
        } else {
            (self.info.width, self.info.height)
        }
    }
    /// An upright point as a portrait framebuffer point.
    pub fn to_device(self, x: f64, y: f64) -> (f64, f64) {
        let (w, h) = self.size();
        let p = crate::ios_sim_geometry::view_to_device(
            w,
            h,
            self.info.width,
            self.info.height,
            self.turns,
            x,
            y,
        );
        (p.x, p.y)
    }
}

pub(crate) fn screen(udid: &str) -> Result<Screen, String> {
    let info = native::display_info(udid)?;
    Ok(Screen {
        info,
        turns: crate::ios_sim_geometry::quarter_turns_for_orientation(info.orientation),
    })
}

pub(crate) fn tap(udid: &str, x: f64, y: f64) -> Result<(), String> {
    let down = native::touch(udid, native::TouchPhase::Down, x, y);
    std::thread::sleep(Duration::from_millis(60));
    // Lift the finger even when the press failed, so none stays down.
    let up = native::touch(udid, native::TouchPhase::Up, x, y);
    down.and(up)
}

pub(crate) fn swipe(
    udid: &str,
    from: (f64, f64),
    to: (f64, f64),
    duration: Duration,
) -> Result<(), String> {
    let steps = (duration.as_millis() as u64 / 17).max(2);
    let mut result = native::touch(udid, native::TouchPhase::Down, from.0, from.1);
    let mut last = from;
    if result.is_ok() {
        for step in 1..=steps {
            std::thread::sleep(Duration::from_millis(17));
            let t = step as f64 / steps as f64;
            last = (from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t);
            if let Err(error) = native::touch(udid, native::TouchPhase::Moved, last.0, last.1) {
                result = Err(error);
                break;
            }
        }
    }
    let up = native::touch(udid, native::TouchPhase::Up, last.0, last.1);
    result.and(up)
}

pub(crate) fn press_button(udid: &str, button: native::Button) -> Result<(), String> {
    let down = native::button(udid, button, true);
    std::thread::sleep(Duration::from_millis(80));
    let up = native::button(udid, button, false);
    down.and(up)
}

fn press_key(udid: &str, usage: u32, shift: bool, command_key: bool) -> Result<(), String> {
    use crate::ios_sim_keys::{COMMAND, SHIFT};
    // Modifiers and the key are always released, even after a failure.
    let mut pressed = Ok(());
    if command_key {
        pressed = pressed.and(native::key(udid, COMMAND, true));
    }
    if shift {
        pressed = pressed.and(native::key(udid, SHIFT, true));
    }
    let down = native::key(udid, usage, true);
    let up = native::key(udid, usage, false);
    let pressed = pressed.and(down).and(up);
    if shift {
        let _ = native::key(udid, SHIFT, false);
    }
    if command_key {
        let _ = native::key(udid, COMMAND, false);
    }
    pressed
}

pub(crate) fn press_named_key(udid: &str, name: &str) -> Result<(), String> {
    let usage =
        crate::ios_sim_keys::key_for_name(name).ok_or_else(|| format!("Unknown key {name}"))?;
    press_key(udid, usage, false, false)
}

/// Copies `text` into the device's pasteboard and presses Command-V.
/// (`simctl pbcopy` no longer reaches the device on Xcode 27; CoreDevice's
/// pasteboard command does, and leaves SimulatorKit input working.)
pub(crate) fn paste_text(udid: &str, text: &str) -> Result<(), String> {
    // devicectl reaches real devices too: only a listed simulator gets here.
    let udid = &require_simulator(udid)?;
    let output = run(
        tool(
            XCRUN,
            &[
                "devicectl",
                "device",
                "pasteboard",
                "copy",
                "--device",
                udid,
                "-q",
            ],
        ),
        Duration::from_secs(30),
        Some(text.as_bytes()),
    )?;
    checked(output, "Copying to the simulator")?;
    std::thread::sleep(Duration::from_millis(80));
    press_key(udid, crate::ios_sim_keys::KEY_V, false, true)
}

/// Types `text` key by key; words with characters a US keyboard cannot type
/// go in whole through the pasteboard.
pub(crate) fn type_text(udid: &str, text: &str) -> Result<(), String> {
    for (typeable, part) in crate::ios_sim_keys::typing_plan(text) {
        if !typeable {
            paste_text(udid, &part)?;
            continue;
        }
        for c in part.chars() {
            if let Some((usage, shift)) = crate::ios_sim_keys::key_for_char(c) {
                press_key(udid, usage, shift, false)?;
            }
        }
    }
    Ok(())
}

/// The next orientation for the pane's Rotate button.
fn next_orientation(orientation: u32) -> &'static str {
    match orientation {
        1 => "landscapeLeft",
        3 | 4 => "portrait",
        _ => "portrait",
    }
}

pub(crate) fn set_orientation(udid: &str, orientation: &str) -> Result<(), String> {
    let value = match orientation {
        "portrait" | "portraitUpsideDown" | "landscapeLeft" | "landscapeRight" => orientation,
        _ => {
            return Err("Use portrait, portraitUpsideDown, landscapeLeft or landscapeRight".into())
        }
    };
    // devicectl reaches real devices too: only a listed simulator gets here.
    let udid = &require_simulator(udid)?;
    let output = run(
        tool(
            XCRUN,
            &[
                "devicectl",
                "device",
                "orientation",
                "set",
                "--device",
                udid,
                value,
                "-q",
            ],
        ),
        Duration::from_secs(30),
        None,
    )?;
    checked(output, "Rotating the simulator")?;
    Ok(())
}

/// An upright PNG of the screen: from the framebuffer when live, else simctl.
pub(crate) fn screenshot_png(udid: &str) -> Result<(Vec<u8>, f64), String> {
    if support().live {
        if let Ok(screen) = screen(udid) {
            let png = native::screenshot_png(udid, screen.turns)?;
            return Ok((png, screen.info.scale));
        }
    }
    let png = simctl_screenshot(udid)?;
    let (width, _) = png_size(&png).ok_or("The simulator returned no picture")?;
    // simctl reports pixels; the agent server knows the screen in points.
    let scale = crate::ios_sim_xcuitest::screen_points(udid)
        .filter(|(w, _)| *w > 0.0)
        .map(|(w, _)| (width as f64 / w).round().clamp(1.0, 4.0))
        .unwrap_or_else(|| {
            // Until the agent has answered: iPads are @2x, iPhones @3x.
            match device(udid).map(|d| d.family) {
                Ok(ios_sim_devices::DeviceFamily::Ipad) => 2.0,
                _ => 3.0,
            }
        });
    Ok((png, scale))
}

fn checked_udid(udid: &str) -> Result<(), String> {
    if ios_sim_devices::valid_udid(udid) {
        Ok(())
    } else {
        Err("Not a simulator".into())
    }
}

#[tauri::command]
pub async fn ios_sim_button(udid: String, button: String) -> Result<(), String> {
    checked_udid(&udid)?;
    let button = match button.as_str() {
        "home" => native::Button::Home,
        "lock" => native::Button::Lock,
        _ => return Err("Unknown button".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        if support().live {
            press_button(&udid, button)
        } else {
            crate::ios_sim_xcuitest::press_home(&udid)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ios_sim_rotate(udid: String) -> Result<(), String> {
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let orientation = native::display_info(&udid)
            .map(|i| i.orientation)
            .unwrap_or(1);
        set_orientation(&udid, next_orientation(orientation))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The pane's Screenshot button: the screen on the Mac clipboard.
#[tauri::command]
pub async fn ios_sim_screenshot(udid: String) -> Result<(), String> {
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (png, _) = screenshot_png(&udid)?;
        native::copy_png(&png)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// One frame as base64 PNG: a basic-mode frame, or the still the live view
/// leaves under a dialog. Live, it comes straight from the framebuffer
/// (about a third of a `simctl` screenshot's time).
#[tauri::command]
pub async fn ios_sim_basic_frame(udid: String) -> Result<Value, String> {
    use base64::Engine;
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let live = support()
            .live
            .then(|| {
                screen(&udid)
                    .and_then(|s| native::screenshot_png(&udid, s.turns))
                    .ok()
            })
            .flatten();
        let png = match live {
            Some(png) => png,
            None => simctl_screenshot(&udid)?,
        };
        let (width, height) = png_size(&png).ok_or("The simulator returned no picture")?;
        Ok(json!({
            "png": base64::engine::general_purpose::STANDARD.encode(&png),
            "width": width,
            "height": height,
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A PNG of the screen from `simctl`. It writes to a file: on Xcode 27, "-"
/// names a file in the current folder rather than standard output.
fn simctl_screenshot(udid: &str) -> Result<Vec<u8>, String> {
    let path = std::env::temp_dir().join(format!(
        "aven-ios-sim-{}.png",
        uuid::Uuid::new_v4().simple()
    ));
    let target = path.to_string_lossy().into_owned();
    let output = simctl(
        &["io", udid, "screenshot", "--type=png", &target],
        Duration::from_secs(20),
    );
    let png = output
        .and_then(|output| checked(output, "Taking a screenshot"))
        .and_then(|_| std::fs::read(&path).map_err(|error| error.to_string()));
    let _ = std::fs::remove_file(&path);
    png
}

fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || !png.starts_with(b"\x89PNG") {
        return None;
    }
    let width = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(png[20..24].try_into().ok()?);
    Some((width, height))
}

/// Basic-mode input from the pane, as fractions (0 to 1) of the upright
/// screenshot, so the pane needs no screen scale. Aven turns them into the
/// screen's points with the size the XCUITest agent reports.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum BasicInput {
    Tap {
        fx: f64,
        fy: f64,
    },
    Swipe {
        fx1: f64,
        fy1: f64,
        fx2: f64,
        fy2: f64,
    },
    Type {
        text: String,
    },
}

fn fraction(value: f64) -> Result<f64, String> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err("Invalid point".into())
    }
}

/// A basic-mode action as an agent-server request in screen points.
pub(crate) fn basic_request(input: &BasicInput, screen: (f64, f64)) -> Result<Value, String> {
    let (w, h) = screen;
    Ok(match input {
        BasicInput::Tap { fx, fy } => {
            json!({ "action": "tap", "x": fraction(*fx)? * w, "y": fraction(*fy)? * h })
        }
        BasicInput::Swipe { fx1, fy1, fx2, fy2 } => json!({
            "action": "swipe",
            "x1": fraction(*fx1)? * w, "y1": fraction(*fy1)? * h,
            "x2": fraction(*fx2)? * w, "y2": fraction(*fy2)? * h,
        }),
        BasicInput::Type { text } => {
            if text.is_empty() || text.len() > 4000 {
                return Err("Nothing to type".into());
            }
            json!({ "action": "type", "text": text })
        }
    })
}

#[tauri::command]
pub async fn ios_sim_basic_input(
    project: String,
    udid: String,
    input: BasicInput,
) -> Result<(), String> {
    checked_udid(&udid)?;
    tauri::async_runtime::spawn_blocking(move || {
        let udid = require_simulator(&udid)?;
        let bundle = status_of(&project).bundle_id;
        let mut agent = crate::ios_sim_xcuitest::connect(&udid, bundle.as_deref())?;
        let screen = agent.screen()?;
        agent.request(basic_request(&input, screen)?).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

// ---------------------------------------------------------------------------
// The live view

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
    #[serde(default)]
    clip_left: f64,
    #[serde(default)]
    clip_right: f64,
    #[serde(default)]
    viewport_height: Option<f64>,
    #[serde(default)]
    holes: Vec<ViewHole>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewHole {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    radius: f64,
}

const MAX_HOLES: usize = 8;

impl ViewBounds {
    /// Validated placement in native points.
    fn layout(&self, native_scale: f64, visible: bool) -> Result<native::ViewLayout, String> {
        let finite = [
            self.x,
            self.y,
            self.width,
            self.height,
            self.scale,
            self.clip_left,
            self.clip_right,
        ]
        .iter()
        .all(|v| v.is_finite());
        if !finite
            || self.width < 0.0
            || self.height < 0.0
            || self.scale <= 0.0
            || self.scale > 8.0
            || [self.x, self.y, self.width, self.height]
                .iter()
                .any(|v| v.abs() > 32768.0)
            || self.clip_left < 0.0
            || self.clip_right < 0.0
            || self.holes.len() > MAX_HOLES
            || !native_scale.is_finite()
            || native_scale <= 0.0
        {
            return Err("Invalid iPhone pane bounds".into());
        }
        let ratio = self.scale / native_scale;
        let mut holes = Vec::with_capacity(self.holes.len() * 5);
        for hole in &self.holes {
            let values = [hole.x, hole.y, hole.width, hole.height, hole.radius];
            if values.iter().any(|v| !v.is_finite() || v.abs() > 32768.0)
                || hole.width <= 0.0
                || hole.height <= 0.0
            {
                continue;
            }
            holes.extend(values.map(|v| v * ratio));
        }
        let viewport = self
            .viewport_height
            .filter(|h| h.is_finite() && *h > 0.0 && *h <= 32768.0)
            .unwrap_or(0.0);
        Ok(native::ViewLayout {
            x: self.x * ratio,
            y: self.y * ratio,
            width: self.width * ratio,
            height: self.height * ratio,
            visible,
            viewport_height: viewport * ratio,
            clip_left: self.clip_left * ratio,
            clip_right: self.clip_right * ratio,
            holes,
        })
    }
}

fn valid_view_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn webview_pointer(view: &Webview) -> Result<usize, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        let _ = send.send(platform.inner() as usize);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "The workspace closed".to_string())
}

pub(crate) async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(operation());
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "The iPhone pane did not respond".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Places a pane's live view and shows `udid` in it (null for none).
#[tauri::command]
pub async fn ios_sim_view_layout(
    caller: Webview,
    id: String,
    udid: Option<String>,
    bounds: ViewBounds,
    visible: bool,
) -> Result<(), String> {
    if !valid_view_id(&id) {
        return Err("Invalid iPhone pane".into());
    }
    if let Some(udid) = &udid {
        checked_udid(udid)?;
    }
    let window = caller.window();
    let native_scale = window.scale_factor().map_err(|error| error.to_string())?;
    let layout = bounds.layout(native_scale, visible)?;
    {
        let mut state = state();
        match &udid {
            Some(udid) => state.view_devices.insert(id.clone(), udid.to_uppercase()),
            None => state.view_devices.remove(&id),
        };
    }
    let known = state().views.get(&id).copied();
    let webview = match known {
        Some(pointer) => pointer,
        None => {
            let pointer = webview_pointer(&caller)?;
            state().views.insert(id.clone(), pointer);
            pointer
        }
    };
    let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    // Checked here, off the main thread (the first check runs Xcode's tools).
    let live = tauri::async_runtime::spawn_blocking(|| support().live)
        .await
        .unwrap_or(false);
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let content: *mut objc2::runtime::AnyObject =
            unsafe { objc2::msg_send![ns_window as *mut objc2::runtime::AnyObject, contentView] };
        if content.is_null() {
            return Err("The window has no content".into());
        }
        unsafe { native::view_attach(&id, content.cast(), webview as *mut std::ffi::c_void)? };
        if live {
            native::view_set_device(&id, udid.as_deref())?;
        }
        native::view_layout(&id, &layout)
    })
    .await
}

#[tauri::command]
pub async fn ios_sim_view_close(caller: Webview, id: String) -> Result<(), String> {
    if !valid_view_id(&id) {
        return Err("Invalid iPhone pane".into());
    }
    let released = {
        let mut state = state();
        state.views.remove(&id);
        state.view_devices.remove(&id);
        state.panes.show(&id, "", None)
    };
    // The pane closed: its device goes shortly unless another pane shows it.
    if let Some((owner, udid)) = released {
        release_later(&owner, &udid);
    }
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        native::view_detach(&id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn ios_sim_view_focus(caller: Webview, id: String) -> Result<bool, String> {
    if !valid_view_id(&id) {
        return Err("Invalid iPhone pane".into());
    }
    let app = caller.app_handle().clone();
    on_main(&app, move || Ok(native::view_focus(&id))).await
}

/// The device a pane's live view shows.
#[cfg_attr(not(debug_assertions), allow(dead_code))]
pub(crate) fn view_device(id: &str) -> Option<String> {
    state().view_devices.get(id).cloned()
}

/// Shows the agent's ring in every live view of `udid`.
pub(crate) fn show_marker(udid: &str, x: f64, y: f64, name: &str, color: [f64; 3], action: i32) {
    let Some(app) = APP.get() else { return };
    let key = udid.to_uppercase();
    let views: Vec<String> = state()
        .view_devices
        .iter()
        .filter(|(_, device)| **device == key)
        .map(|(view, _)| view.clone())
        .collect();
    let name = name.to_owned();
    let _ = app.run_on_main_thread(move || {
        for view in views {
            native::view_marker(&view, x, y, &name, color, action);
        }
    });
}

fn on_native_event(json: String) {
    let Ok(event) = serde_json::from_str::<Value>(&json) else {
        return;
    };
    let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
    let udid = event
        .get("udid")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    match kind {
        "text" => {
            let text = event
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if ios_sim_devices::valid_udid(&udid) && !text.is_empty() {
                std::thread::spawn(move || {
                    let _ = paste_text(&udid, &text);
                });
            }
        }
        "paste" => {
            if ios_sim_devices::valid_udid(&udid) {
                std::thread::spawn(move || {
                    let clipboard =
                        run(tool("/usr/bin/pbpaste", &[]), Duration::from_secs(5), None)
                            .ok()
                            .filter(|o| o.success)
                            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                            .unwrap_or_default();
                    if !clipboard.is_empty() {
                        let _ = paste_text(&udid, &clipboard);
                    }
                });
            }
        }
        _ => {
            if let Some(app) = APP.get() {
                let _ = app.emit("ios-sim-view", event);
            }
        }
    }
}

#[cfg(test)]
#[path = "ios_sim_live_tests.rs"]
mod live_tests;

#[cfg(test)]
#[path = "ios_sim_perf_tests.rs"]
mod perf_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_projects_without_a_trailing_slash() {
        assert_eq!(project_key("/a/b/"), "/a/b");
        assert_eq!(project_key(" /a/b "), "/a/b");
        assert_eq!(project_key("/"), "/");
    }

    #[test]
    fn rotates_between_portrait_and_landscape() {
        assert_eq!(next_orientation(1), "landscapeLeft");
        assert_eq!(next_orientation(3), "portrait");
        assert_eq!(next_orientation(4), "portrait");
        assert_eq!(next_orientation(2), "portrait");
    }

    #[test]
    fn validates_view_bounds_and_converts_to_points() {
        let bounds = ViewBounds {
            x: 10.0,
            y: 20.0,
            width: 300.0,
            height: 600.0,
            scale: 2.0,
            clip_left: 0.0,
            clip_right: 0.0,
            viewport_height: Some(800.0),
            holes: vec![ViewHole {
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0,
                radius: 0.0,
            }],
        };
        let layout = bounds.layout(2.0, true).unwrap();
        assert_eq!(
            (layout.x, layout.y, layout.width, layout.height),
            (10.0, 20.0, 300.0, 600.0)
        );
        assert_eq!(layout.holes, vec![1.0, 2.0, 3.0, 4.0, 0.0]);
        assert_eq!(layout.viewport_height, 800.0);
        let zoomed = bounds.layout(1.0, true).unwrap();
        assert_eq!(zoomed.width, 600.0);
        let mut bad = bounds.clone();
        bad.scale = f64::NAN;
        assert!(bad.layout(2.0, true).is_err());
        let mut many = bounds.clone();
        many.holes = vec![bounds.holes[0].clone(); MAX_HOLES + 1];
        assert!(many.layout(2.0, true).is_err());
    }

    #[test]
    fn scopes_devices_to_the_project_whose_pane_picked_or_booted_them() {
        let project = "/scope-test/pom/";
        let picked = "11111111-2222-3333-4444-555555555555";
        let listed = ios_sim_devices::parse_device_list(&format!(
            r#"{{"devices":{{"com.apple.CoreSimulator.SimRuntime.iOS-27-0":[
              {{"udid":"{picked}","isAvailable":true,"state":"Shutdown","name":"iPhone 18",
                "deviceTypeIdentifier":"com.apple.CoreSimulator.SimDeviceType.iPhone-18"}}]}}}}"#
        ))
        .unwrap();
        let choice = |udid: &str| PaneChoice {
            udid: Some(udid.into()),
            container: None,
            scheme: None,
        };
        record_choice(project, choice(&picked.to_lowercase()), &listed);
        // Booting for a project (ensure_device) records the same way.
        add_to_scope("/scope-test/pom", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
        assert_eq!(pane_device(project).as_deref(), Some(picked));
        // A UUID simctl does not list (a real device's CoreDevice identifier)
        // and anything that is not a UUID never join the scope.
        record_choice(
            project,
            choice("6D1B1E5A-2F44-4C1B-9E5A-0E4D1C2B3A49"),
            &listed,
        );
        record_choice(project, choice("booted"), &listed);
        let scope = scoped_devices("/scope-test/pom");
        assert_eq!(
            scope.into_iter().collect::<Vec<_>>(),
            [
                "11111111-2222-3333-4444-555555555555",
                "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
            ]
        );
        assert!(scoped_devices("/scope-test/other").is_empty());
        // Not a simulator: no pick, and no device for agents to default to.
        assert_eq!(pane_device(project), None);
    }

    #[test]
    fn keeps_a_device_while_any_pane_of_any_chat_shows_it() {
        const A: &str = "AAAAAAAA-0000-0000-0000-000000000001";
        const B: &str = "BBBBBBBB-0000-0000-0000-000000000002";
        let mut panes = PaneDevices::default();
        // Chats 1 and 2 of one project both show A.
        assert_eq!(panes.show("chat-1", "/p/", Some(&A.to_lowercase())), None);
        assert_eq!(panes.show("chat-2", "/p", Some(A)), None);
        assert!(panes.shows(A));
        // Showing the same device again releases nothing.
        assert_eq!(panes.show("chat-2", "/p", Some(A)), None);
        // Chat 2 picks B: A is released, but chat 1 still shows it.
        assert_eq!(
            panes.show("chat-2", "/p", Some(B)),
            Some(("/p".into(), A.into()))
        );
        assert!(panes.shows(A) && panes.shows(B));
        assert_eq!(panes.projects_showing(A), BTreeSet::from(["/p".to_owned()]));
        // Chat 1's pane closes: now nothing shows A.
        assert_eq!(
            panes.show("chat-1", "", None),
            Some(("/p".into(), A.into()))
        );
        assert!(!panes.shows(A));
        assert!(panes.projects_showing(A).is_empty());
        // A pane of another project showing B keeps it after chat 2 closes.
        panes.show("other", "/q", Some(B));
        assert_eq!(
            panes.show("chat-2", "", None),
            Some(("/p".into(), B.into()))
        );
        assert!(panes.shows(B));
        assert_eq!(panes.projects_showing(B), BTreeSet::from(["/q".to_owned()]));
        // Closing a pane that showed nothing releases nothing.
        assert_eq!(panes.show("never-shown", "", None), None);
    }

    #[test]
    fn allows_live_mode_only_on_tested_frameworks() {
        assert!(live_allowed("1174.9.2", "1005.3", false).is_ok());
        let newer = live_allowed("1175.1", "1006", false).unwrap_err();
        assert!(newer.contains("CoreSimulator 1175.1") && newer.contains("SimulatorKit 1006"));
        assert!(live_allowed("1175.1", "1006", true).is_ok());
    }

    #[test]
    fn explains_a_missing_or_unselected_xcode() {
        let tools = no_xcode_reason(&DeveloperDir::CommandLineTools(Some(
            "/Applications/Xcode.app".into(),
        )));
        assert!(tools.contains("sudo xcode-select -s /Applications/Xcode.app"));
        assert!(
            no_xcode_reason(&DeveloperDir::CommandLineTools(None)).contains("command line tools")
        );
        assert_eq!(
            no_xcode_reason(&DeveloperDir::Missing),
            "Install Xcode to run iPhone apps"
        );
    }

    #[test]
    fn maps_basic_mode_fractions_to_screen_points() {
        let tap = basic_request(&BasicInput::Tap { fx: 0.5, fy: 0.25 }, (402.0, 874.0)).unwrap();
        assert_eq!(tap, json!({ "action": "tap", "x": 201.0, "y": 218.5 }));
        let swipe = basic_request(
            &BasicInput::Swipe {
                fx1: 0.0,
                fy1: 1.0,
                fx2: 1.0,
                fy2: 0.0,
            },
            (1024.0, 1366.0),
        )
        .unwrap();
        assert_eq!(swipe["x2"], 1024.0);
        assert_eq!(swipe["y1"], 1366.0);
        assert!(basic_request(&BasicInput::Tap { fx: 1.5, fy: 0.0 }, (402.0, 874.0)).is_err());
        assert!(basic_request(
            &BasicInput::Type {
                text: String::new()
            },
            (1.0, 1.0)
        )
        .is_err());
    }

    #[test]
    fn checks_view_ids() {
        assert!(valid_view_id("iphone-1a2b"));
        assert!(!valid_view_id(""));
        assert!(!valid_view_id("a/b"));
    }

    #[test]
    fn reads_png_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(1206u32.to_be_bytes());
        png.extend(2622u32.to_be_bytes());
        assert_eq!(png_size(&png), Some((1206, 2622)));
        assert_eq!(png_size(b"nope"), None);
    }

    #[test]
    fn builds_incrementally_into_the_projects_own_derived_data() {
        let container = XcodeContainer {
            kind: ios_sim_xcode::ContainerKind::Project,
            path: PathBuf::from("/work/pom/Pom.xcodeproj"),
        };
        // The same folder in Aven's data for every Run of a project.
        let derived = project_dir("/work/pom/").unwrap().join("DerivedData");
        assert_eq!(
            derived,
            project_dir("/work/pom").unwrap().join("DerivedData")
        );
        assert!(derived.starts_with(data_root().unwrap()));
        assert_ne!(
            derived,
            project_dir("/work/other").unwrap().join("DerivedData")
        );
        let udid = "84E140A9-1897-4F93-B3F6-ACC0ECF7974F";
        let args = build_args(&container, "Pom", udid, &derived);
        let after = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .and_then(|i| args.get(i + 1))
                .cloned()
        };
        assert_eq!(
            after("-project").as_deref(),
            Some("/work/pom/Pom.xcodeproj")
        );
        assert_eq!(after("-scheme").as_deref(), Some("Pom"));
        assert_eq!(
            after("-derivedDataPath"),
            Some(derived.to_string_lossy().into_owned())
        );
        // Only this simulator's architecture, never a clean build.
        assert_eq!(after("-destination"), Some(format!("id={udid}")));
        assert!(args.contains(&"ONLY_ACTIVE_ARCH=YES".to_owned()));
        assert!(args.contains(&"COMPILER_INDEX_STORE_ENABLE=NO".to_owned()));
        assert_eq!(args.last().map(String::as_str), Some("build"));
        assert!(!args.iter().any(|a| a == "clean"));
    }

    #[test]
    fn writes_errors_before_the_full_log() {
        let summary =
            ios_sim_xcode::parse_build_output("/p/A.swift:3:1: error: oops\n** BUILD FAILED **\n");
        let log = build_log("App", &summary, "full text");
        assert!(log.starts_with("Build failed · 1 error in App\n\n/p/A.swift:3: oops\n"));
        assert!(log.ends_with("full text"));
    }
}
