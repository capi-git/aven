//! Aven Dev's real-app check. `scripts/dev-aven.py --smoke` creates a
//! throwaway folder (a marker file, a home folder whose `.local/bin` holds a
//! stand-in `claude`, and a project),
//! launches the debug app with `AVEN_DEV_SMOKE_DIR` pointing at it, and waits.
//! The workspace then sends one real turn, drives the floating sidebar,
//! reports here and quits.
//!
//! Release builds never enable it: both commands answer as if no check were
//! running unless this is a debug build and the marked folder exists.
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{State, Webview};

const MARKER: &str = ".aven-smoke";
/// Beside `MARKER`: run the speed test (`dev-aven.py --perf`) instead, with
/// its settings in `perf.json`.
const PERF_MARKER: &str = ".aven-perf";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeConfig {
    /// An existing, empty project folder for the check's task.
    project_path: String,
    /// Where the stand-in provider lives; a resolved provider outside it
    /// means the check must not send anything.
    bin_dir: String,
    /// The speed test's settings, when this run is the speed test.
    #[serde(skip_serializing_if = "Option::is_none")]
    perf: Option<Value>,
}

fn smoke_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = PathBuf::from(std::env::var_os("AVEN_DEV_SMOKE_DIR")?);
    dir.join(MARKER).is_file().then_some(dir)
}

/// Whether this run is the check, and where its folders are.
#[tauri::command]
pub fn dev_smoke_config() -> Option<SmokeConfig> {
    let dir = smoke_dir()?;
    let perf = dir.join(PERF_MARKER).is_file().then(|| {
        std::fs::read_to_string(dir.join("perf.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| Value::Object(Default::default()))
    });
    Some(SmokeConfig {
        project_path: dir.join("project").to_string_lossy().into_owned(),
        bin_dir: dir.join("home/.local/bin").to_string_lossy().into_owned(),
        perf,
    })
}

/// One of Aven's processes, or a process it started, for the speed test.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSample {
    pid: i32,
    ppid: i32,
    name: String,
    /// User plus system CPU time so far.
    cpu_ns: u64,
    /// Wakeups from idle so far (what keeps a quiet app costly).
    idle_wakeups: u64,
    interrupt_wakeups: u64,
    /// Memory footprint, as Activity Monitor reports it.
    footprint: u64,
}

/// CPU time, wakeups and memory for this app and everything it started.
/// Only while the speed test runs; cheap enough to call between steps.
#[tauri::command]
pub fn dev_perf_sample() -> Result<Vec<ProcessSample>, String> {
    let dir = smoke_dir().ok_or("The speed test is not running")?;
    if !dir.join(PERF_MARKER).is_file() {
        return Err("The speed test is not running".into());
    }
    Ok(sample_processes())
}

#[cfg(target_os = "macos")]
// libc points to the mach2 crate for the clock conversion; not worth a new
// dependency for a debug-only tool.
#[allow(deprecated)]
fn sample_processes() -> Vec<ProcessSample> {
    use std::ffi::c_void;
    let mut timebase = libc::mach_timebase_info { numer: 0, denom: 0 };
    // SAFETY: mach_timebase_info only writes the struct it is given.
    unsafe { libc::mach_timebase_info(&mut timebase) };
    let (numer, denom) = if timebase.denom == 0 {
        (1, 1)
    } else {
        (u64::from(timebase.numer), u64::from(timebase.denom))
    };
    let mut samples = Vec::new();
    let root = std::process::id() as i32;
    // The interface's WebKit processes are XPC services launched for this
    // app rather than its children; macOS records the app as responsible.
    let webkit: std::collections::HashSet<i32> = webkit_processes_of(root).into_iter().collect();
    let mut queue: Vec<(i32, i32)> = webkit.iter().map(|pid| (*pid, root)).collect();
    queue.push((root, 0));
    let mut seen = std::collections::HashSet::new();
    while let Some((pid, ppid)) = queue.pop() {
        if !seen.insert(pid) {
            continue;
        }
        let mut usage: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
        // SAFETY: the buffer is a correctly sized rusage_info_v4.
        let ok = unsafe {
            libc::proc_pid_rusage(
                pid,
                libc::RUSAGE_INFO_V4,
                &mut usage as *mut _ as *mut libc::rusage_info_t,
            )
        } == 0;
        if ok {
            let ticks = usage.ri_user_time + usage.ri_system_time;
            samples.push(ProcessSample {
                pid,
                ppid,
                name: process_name(pid),
                cpu_ns: ticks.saturating_mul(numer) / denom,
                idle_wakeups: usage.ri_pkg_idle_wkups,
                interrupt_wakeups: usage.ri_interrupt_wkups,
                footprint: usage.ri_phys_footprint,
            });
        }
        if webkit.contains(&pid) {
            // XPC services start nothing of ours.
            continue;
        }
        let mut children = [0i32; 512];
        // SAFETY: the buffer size is given in bytes.
        let count = unsafe {
            libc::proc_listchildpids(
                pid,
                children.as_mut_ptr() as *mut c_void,
                (children.len() * std::mem::size_of::<i32>()) as i32,
            )
        };
        let count = (count.max(0) as usize).min(children.len());
        queue.extend(children[..count].iter().map(|child| (*child, pid)));
    }
    samples
}

/// WebKit content, GPU and networking processes running for `root`.
#[cfg(target_os = "macos")]
fn webkit_processes_of(root: i32) -> Vec<i32> {
    use std::ffi::c_void;
    type Responsible = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;
    // A long-standing system call without a public header; Activity Monitor
    // groups processes the same way.
    // SAFETY: RTLD_DEFAULT (-2) searches every loaded image; the symbol is
    // only called if found, with the signature the system declares.
    let symbol = unsafe {
        libc::dlsym(
            -2isize as *mut c_void,
            c"responsibility_get_pid_responsible_for_pid".as_ptr(),
        )
    };
    if symbol.is_null() {
        return Vec::new();
    }
    let responsible: Responsible = unsafe { std::mem::transmute(symbol) };
    // Launched directly (not through Launch Services), the app's own
    // responsible process is whatever started it, and its WebKit services
    // inherit that. Match on it, and only services started after the app.
    // SAFETY: takes and returns a pid.
    let owner = unsafe { responsible(root) };
    let started = start_seconds(root);
    let mut pids = vec![0i32; 8192];
    // SAFETY: the buffer size is given in bytes.
    let count = unsafe {
        libc::proc_listallpids(
            pids.as_mut_ptr() as *mut c_void,
            (pids.len() * std::mem::size_of::<i32>()) as i32,
        )
    };
    pids.truncate(count.max(0) as usize);
    pids.into_iter()
        .filter(|pid| *pid != root && *pid > 0)
        .filter(|pid| process_name(*pid).starts_with("com.apple.WebKit"))
        // SAFETY: takes and returns a pid.
        .filter(|pid| unsafe { responsible(*pid) } == owner)
        .filter(|pid| start_seconds(*pid) >= started)
        .collect()
}

/// The executable's file name; the kernel's short name stops at 16
/// characters, which makes WebKit's three services look alike.
#[cfg(target_os = "macos")]
fn process_name(pid: i32) -> String {
    use std::ffi::c_void;
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: proc_pidpath writes at most the buffer length.
    let len =
        unsafe { libc::proc_pidpath(pid, path.as_mut_ptr() as *mut c_void, path.len() as u32) };
    if len > 0 {
        let path = String::from_utf8_lossy(&path[..len as usize]).into_owned();
        if let Some(name) = path.rsplit('/').next() {
            return name.to_string();
        }
    }
    let mut name = [0u8; 256];
    // SAFETY: proc_name writes at most the buffer length.
    let len = unsafe { libc::proc_name(pid, name.as_mut_ptr() as *mut c_void, 256) };
    String::from_utf8_lossy(&name[..len.max(0) as usize]).into_owned()
}

#[cfg(target_os = "macos")]
fn start_seconds(pid: i32) -> u64 {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    // SAFETY: the buffer is a correctly sized proc_bsdinfo.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut std::ffi::c_void,
            size,
        )
    };
    if written == size {
        info.pbi_start_tvsec
    } else {
        0
    }
}

/// Note a speed test scenario starting or ending, for the runner's profiler.
#[tauri::command]
pub fn dev_perf_mark(label: String) -> Result<(), String> {
    use std::io::Write;
    let dir = smoke_dir().ok_or("The speed test is not running")?;
    if !dir.join(PERF_MARKER).is_file() {
        return Err("The speed test is not running".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("marks.log"))
        .map_err(|error| error.to_string())?;
    writeln!(file, "{label}").map_err(|error| error.to_string())
}

/// Keep the speed test's window above others, without taking the keyboard,
/// so macOS keeps drawing it while it is measured.
#[tauri::command]
pub fn dev_perf_keep_visible(webview: Webview) -> Result<(), String> {
    let dir = smoke_dir().ok_or("The speed test is not running")?;
    if !dir.join(PERF_MARKER).is_file() || webview.label() != "main" {
        return Err("The speed test is not running".into());
    }
    let window = webview.window();
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn sample_processes() -> Vec<ProcessSample> {
    Vec::new()
}

/// When this workspace window was concealed and how it became visible, so the
/// check can confirm it stayed concealed until its interface had drawn.
#[tauri::command]
pub fn dev_smoke_window_reveal(
    webview: Webview,
) -> Result<Option<crate::window_reveal::RevealRecord>, String> {
    smoke_dir().ok_or("The real-app check is not running")?;
    Ok(crate::window_reveal::record(webview.window().label()))
}

/// Record the result for the runner and quit. Only the workspace reports.
#[tauri::command]
pub fn dev_smoke_finish(
    webview: Webview,
    harness: State<'_, crate::harness::HarnessHost>,
    result: Value,
) -> Result<(), String> {
    let dir = smoke_dir().ok_or("The real-app check is not running")?;
    if webview.label() != "main" {
        return Err("Only the workspace reports the real-app check".into());
    }
    let text = serde_json::to_string_pretty(&result).map_err(|error| error.to_string())?;
    std::fs::write(dir.join("result.json"), text).map_err(|error| error.to_string())?;
    // The stand-in provider must not outlive the run.
    harness.kill_all();
    let passed = result.get("passed").and_then(Value::as_bool) == Some(true);
    // The throwaway profile holds nothing to save, and a quit request could be
    // held by the app's own confirmation, so leave at once.
    std::process::exit(if passed { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_marked_folder_in_a_debug_build_enables_the_check() {
        let dir = std::env::temp_dir().join(format!("aven-smoke-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("AVEN_DEV_SMOKE_DIR", &dir);
        assert!(smoke_dir().is_none());
        std::fs::write(dir.join(MARKER), "").unwrap();
        if cfg!(debug_assertions) {
            assert_eq!(smoke_dir(), Some(dir.clone()));
            let config = dev_smoke_config().unwrap();
            assert!(config.project_path.ends_with("project"));
            assert!(config.bin_dir.ends_with("home/.local/bin"));
        } else {
            // Release builds (the Windows release runs its tests as one) never
            // enable the check, even with the marked folder in place.
            assert!(smoke_dir().is_none());
            assert!(dev_smoke_config().is_none());
        }
        std::env::remove_var("AVEN_DEV_SMOKE_DIR");
        assert!(smoke_dir().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
