//! The bottom bar's This Mac card and Open in menu.
//!
//! `machine_stats` reads whole-machine CPU and memory, and splits Aven's own
//! processes from the Run scripts it started. The card asks only while it is
//! open, every couple of seconds; nothing here polls by itself.
//!
//! `open_in_apps` lists the editors, terminals and Finder that are installed,
//! each with its icon, and `open_in_app` opens a folder in one of them.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Instant;
use tauri::State;

use crate::pty::PtyHost;

// --- This Mac ---------------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupStats {
    /// Share of the whole machine's CPU, 0 to 100; None on the first reading.
    cpu_percent: Option<f64>,
    /// Memory footprint in bytes, as Activity Monitor reports it.
    memory: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MachineStats {
    /// Whole-machine CPU busy, 0 to 100, since the last reading.
    cpu_percent: Option<f64>,
    memory_used: u64,
    memory_total: u64,
    /// Aven itself, its web views and every agent it started.
    aven: Option<GroupStats>,
    /// The Run and Setup scripts named by the caller, and what they started.
    scripts: Option<GroupStats>,
}

/// The previous reading, so CPU can be measured over the time between two.
struct Previous {
    at: Instant,
    ticks: [u64; 4],
    cpu_ns: HashMap<i32, u64>,
}

static PREVIOUS: Mutex<Option<Previous>> = Mutex::new(None);

/// A reading older than this is too stale to measure against.
const STALE_SECS: u64 = 10;

/// Percent of CPU ticks that were not idle between two host readings.
/// Ticks are user, system, idle and nice, as the kernel counts them.
pub(crate) fn busy_percent(before: [u64; 4], after: [u64; 4]) -> Option<f64> {
    let delta: Vec<u64> = after
        .iter()
        .zip(before.iter())
        .map(|(a, b)| a.saturating_sub(*b))
        .collect();
    let total: u64 = delta.iter().sum();
    if total == 0 {
        return None;
    }
    let idle = delta[2];
    Some(((total - idle) as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

/// Memory in use as Activity Monitor counts it: app memory (anonymous pages
/// less purgeable ones), wired memory and the compressor's pages.
pub(crate) fn used_memory(
    internal: u64,
    purgeable: u64,
    wired: u64,
    compressed: u64,
    page_size: u64,
) -> u64 {
    (internal.saturating_sub(purgeable) + wired + compressed).saturating_mul(page_size)
}

/// Every process in `processes` (pid, parent pid) that descends from one of
/// `roots`, the roots included.
pub(crate) fn descendants(processes: &[(i32, i32)], roots: &[i32]) -> HashSet<i32> {
    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();
    for (pid, ppid) in processes {
        children.entry(*ppid).or_default().push(*pid);
    }
    let known: HashSet<i32> = processes.iter().map(|(pid, _)| *pid).collect();
    let mut found = HashSet::new();
    let mut queue: Vec<i32> = roots
        .iter()
        .copied()
        .filter(|pid| known.contains(pid))
        .collect();
    while let Some(pid) = queue.pop() {
        if !found.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            queue.extend(kids.iter().copied());
        }
    }
    found
}

/// CPU share of a group of processes since the previous reading. A process
/// that appeared since then is left out: its whole life would count as now.
pub(crate) fn group_cpu_percent(
    now: &[(i32, u64)],
    before: &HashMap<i32, u64>,
    elapsed_ns: u64,
    cores: u64,
) -> Option<f64> {
    if elapsed_ns == 0 || cores == 0 {
        return None;
    }
    let used: u64 = now
        .iter()
        .filter_map(|(pid, cpu)| before.get(pid).map(|prev| cpu.saturating_sub(*prev)))
        .sum();
    Some((used as f64 / (elapsed_ns as f64 * cores as f64) * 100.0).clamp(0.0, 100.0))
}

#[cfg(target_os = "macos")]
extern "C" {
    /// Gives back the send right `mach_host_self` hands out on each call.
    fn mach_port_deallocate(
        task: libc::mach_port_t,
        name: libc::mach_port_t,
    ) -> libc::kern_return_t;
}

#[cfg(target_os = "macos")]
#[allow(deprecated)] // mach_host_self: libc points at the mach2 crate.
fn host_ticks() -> Option<[u64; 4]> {
    let mut info = libc::host_cpu_load_info { cpu_ticks: [0; 4] };
    let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
    // SAFETY: the buffer is a host_cpu_load_info and the count says so.
    let result = unsafe {
        let host = libc::mach_host_self();
        let result = libc::host_statistics(
            host,
            libc::HOST_CPU_LOAD_INFO,
            &mut info as *mut _ as libc::host_info_t,
            &mut count,
        );
        mach_port_deallocate(libc::mach_task_self(), host);
        result
    };
    if result != libc::KERN_SUCCESS {
        return None;
    }
    Some(info.cpu_ticks.map(u64::from))
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn memory() -> (u64, u64) {
    let mut total: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    // SAFETY: hw.memsize is a u64 and the size says so.
    unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            &mut total as *mut _ as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        );
    }
    let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    // SAFETY: the buffer is a vm_statistics64 and the count says so.
    let result = unsafe {
        let host = libc::mach_host_self();
        let result = libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut _ as libc::host_info64_t,
            &mut count,
        );
        mach_port_deallocate(libc::mach_task_self(), host);
        result
    };
    if result != libc::KERN_SUCCESS {
        return (0, total);
    }
    // SAFETY: vm_page_size is set once by the system at start.
    let page = unsafe { libc::vm_page_size } as u64;
    let used = used_memory(
        u64::from(stats.internal_page_count),
        u64::from(stats.purgeable_count),
        u64::from(stats.wire_count),
        u64::from(stats.compressor_page_count),
        page,
    );
    (used.min(total), total)
}

#[cfg(not(target_os = "macos"))]
fn host_ticks() -> Option<[u64; 4]> {
    None
}

#[cfg(not(target_os = "macos"))]
fn memory() -> (u64, u64) {
    (0, 0)
}

fn read_stats(script_pids: &[i32]) -> MachineStats {
    let ticks = host_ticks();
    let (memory_used, memory_total) = memory();
    let samples = crate::dev_smoke::sample_processes();
    let tree: Vec<(i32, i32)> = samples.iter().map(|s| (s.pid, s.ppid)).collect();
    let scripts = descendants(&tree, script_pids);
    let now = Instant::now();
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u64)
        .unwrap_or(1);

    let mut previous = PREVIOUS.lock().unwrap_or_else(|e| e.into_inner());
    let prev = previous
        .as_ref()
        .filter(|prev| now.duration_since(prev.at).as_secs() < STALE_SECS);
    let elapsed_ns = prev
        .map(|prev| now.duration_since(prev.at).as_nanos() as u64)
        .unwrap_or(0);
    let group = |inside: bool| -> Option<GroupStats> {
        let members: Vec<&crate::dev_smoke::ProcessSample> = samples
            .iter()
            .filter(|s| scripts.contains(&s.pid) == inside)
            .collect();
        if members.is_empty() {
            return None;
        }
        let cpu: Vec<(i32, u64)> = members.iter().map(|s| (s.pid, s.cpu_ns)).collect();
        Some(GroupStats {
            cpu_percent: prev
                .and_then(|prev| group_cpu_percent(&cpu, &prev.cpu_ns, elapsed_ns, cores)),
            memory: members.iter().map(|s| s.footprint).sum(),
        })
    };
    let aven = group(false);
    let script_group = if script_pids.is_empty() {
        None
    } else {
        group(true)
    };
    let cpu_percent = match (prev, ticks) {
        (Some(prev), Some(ticks)) => busy_percent(prev.ticks, ticks),
        _ => None,
    };
    if let Some(ticks) = ticks {
        *previous = Some(Previous {
            at: now,
            ticks,
            cpu_ns: samples.iter().map(|s| (s.pid, s.cpu_ns)).collect(),
        });
    }
    MachineStats {
        cpu_percent,
        memory_used,
        memory_total,
        aven,
        scripts: script_group,
    }
}

/// Whole-machine CPU and memory, with Aven's share and its scripts' share.
/// `script_ptys` are the terminal ids of running Run and Setup scripts.
/// The first reading in a while waits a moment so CPU has a span to measure.
#[tauri::command]
pub async fn machine_stats(
    host: State<'_, PtyHost>,
    script_ptys: Vec<String>,
) -> Result<MachineStats, String> {
    let script_pids: Vec<i32> = script_ptys
        .iter()
        .filter_map(|id| host.pid_of(id))
        .map(|pid| pid as i32)
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let fresh = PREVIOUS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|prev| prev.at.elapsed().as_secs() < STALE_SECS);
        if !fresh {
            read_stats(&script_pids);
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        read_stats(&script_pids)
    })
    .await
    .map_err(|error| error.to_string())
}

// --- Open in ----------------------------------------------------------------

/// Apps a folder can open in: id, name, bundle identifier. Finder first.
const OPEN_IN_APPS: &[(&str, &str, &str)] = &[
    ("finder", "Finder", "com.apple.finder"),
    ("terminal", "Terminal", "com.apple.Terminal"),
    ("iterm", "iTerm", "com.googlecode.iterm2"),
    ("ghostty", "Ghostty", "com.mitchellh.ghostty"),
    ("warp", "Warp", "dev.warp.Warp-Stable"),
    ("vscode", "Visual Studio Code", "com.microsoft.VSCode"),
    ("cursor", "Cursor", "com.todesktop.230313mzl4w4u92"),
    ("zed", "Zed", "dev.zed.Zed"),
    ("windsurf", "Windsurf", "com.exafunction.windsurf"),
    ("xcode", "Xcode", "com.apple.dt.Xcode"),
];

pub(crate) fn bundle_id_of(app: &str) -> Option<&'static str> {
    OPEN_IN_APPS
        .iter()
        .find(|(id, _, _)| *id == app)
        .map(|(_, _, bundle)| *bundle)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenInApp {
    id: &'static str,
    name: &'static str,
    /// A small PNG as a data URL, when macOS gave one.
    icon: Option<String>,
}

/// Icons by bundle identifier: drawing them is the slow part.
static ICONS: Mutex<Option<HashMap<&'static str, Option<String>>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn installed_app_path(bundle: &str) -> Option<String> {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let class = AnyClass::get(c"NSWorkspace")?;
        let workspace: Retained<AnyObject> = msg_send![class, sharedWorkspace];
        let id = NSString::from_str(bundle);
        let url: Option<Retained<AnyObject>> =
            msg_send![&*workspace, URLForApplicationWithBundleIdentifier: &*id];
        let path: Option<Retained<NSString>> = msg_send![&*url?, path];
        path.map(|path| path.to_string())
    })
}

/// The app's icon drawn at 64 pixels (32 points at 2x) as a PNG data URL.
#[cfg(target_os = "macos")]
fn app_icon(path: &str) -> Option<String> {
    use base64::Engine;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
    const SIDE: isize = 64;
    let bytes = objc2::rc::autoreleasepool(|_| unsafe {
        let workspace_class = AnyClass::get(c"NSWorkspace")?;
        let workspace: Retained<AnyObject> = msg_send![workspace_class, sharedWorkspace];
        let file = NSString::from_str(path);
        let image: Option<Retained<AnyObject>> = msg_send![&*workspace, iconForFile: &*file];
        let image = image?;
        let rep_class = AnyClass::get(c"NSBitmapImageRep")?;
        let blank: objc2::rc::Allocated<AnyObject> = msg_send![rep_class, alloc];
        let space = NSString::from_str("NSDeviceRGBColorSpace");
        let rep: Option<Retained<AnyObject>> = msg_send![
            blank,
            initWithBitmapDataPlanes: std::ptr::null_mut::<*mut u8>(),
            pixelsWide: SIDE,
            pixelsHigh: SIDE,
            bitsPerSample: 8isize,
            samplesPerPixel: 4isize,
            hasAlpha: Bool::YES,
            isPlanar: Bool::NO,
            colorSpaceName: &*space,
            bytesPerRow: 0isize,
            bitsPerPixel: 0isize
        ];
        let rep = rep?;
        let context_class = AnyClass::get(c"NSGraphicsContext")?;
        let context: Option<Retained<AnyObject>> =
            msg_send![context_class, graphicsContextWithBitmapImageRep: &*rep];
        let context = context?;
        let _: () = msg_send![context_class, saveGraphicsState];
        let _: () = msg_send![context_class, setCurrentContext: &*context];
        let rect = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(SIDE as f64, SIDE as f64),
        );
        // NSCompositingOperationSourceOver
        let _: () = msg_send![
            &*image,
            drawInRect: rect,
            fromRect: NSRect::ZERO,
            operation: 2usize,
            fraction: 1.0f64
        ];
        let _: () = msg_send![context_class, restoreGraphicsState];
        let properties = NSDictionary::<NSString, AnyObject>::new();
        // NSBitmapImageFileTypePNG
        let data: Option<Retained<AnyObject>> =
            msg_send![&*rep, representationUsingType: 4usize, properties: &*properties];
        let data = data?;
        let length: usize = msg_send![&*data, length];
        let start: *const u8 = msg_send![&*data, bytes];
        if start.is_null() || length == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(start, length).to_vec())
    })?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(target_os = "macos")]
fn list_apps() -> Vec<OpenInApp> {
    let mut icons = ICONS.lock().unwrap_or_else(|e| e.into_inner());
    let icons = icons.get_or_insert_with(HashMap::new);
    OPEN_IN_APPS
        .iter()
        .filter_map(|(id, name, bundle)| {
            let path = installed_app_path(bundle)?;
            let icon = icons
                .entry(*bundle)
                .or_insert_with(|| app_icon(&path))
                .clone();
            Some(OpenInApp { id, name, icon })
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn list_apps() -> Vec<OpenInApp> {
    let _ = &ICONS;
    Vec::new()
}

/// The apps among Finder, terminals and editors that are installed here.
#[tauri::command]
pub async fn open_in_apps() -> Result<Vec<OpenInApp>, String> {
    tauri::async_runtime::spawn_blocking(list_apps)
        .await
        .map_err(|error| error.to_string())
}

/// Opens a folder in one of `open_in_apps`.
#[tauri::command]
pub fn open_in_app(app: String, path: String) -> Result<(), String> {
    let bundle = bundle_id_of(&app).ok_or("That app can't open folders here.")?;
    let path = std::path::PathBuf::from(&path);
    if !path.is_dir() {
        return Err(format!("{}: No such folder", path.display()));
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-b")
            .arg(bundle)
            .arg(&path)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("macOS could not open that app.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle;
        Err("Open in is only on macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_percent_counts_everything_but_idle() {
        assert_eq!(busy_percent([10, 10, 80, 0], [30, 20, 150, 0]), Some(30.0));
        assert_eq!(busy_percent([1, 1, 1, 1], [1, 1, 1, 1]), None);
        // A counter that went backwards counts as nothing, never negative.
        assert_eq!(busy_percent([50, 0, 50, 0], [40, 0, 60, 0]), Some(0.0));
    }

    #[test]
    fn used_memory_leaves_out_purgeable_and_file_cache() {
        assert_eq!(used_memory(100, 10, 20, 5, 16_384), 115 * 16_384);
        assert_eq!(used_memory(5, 10, 0, 0, 4096), 0);
    }

    #[test]
    fn descendants_follow_the_tree_from_each_root() {
        let tree = [(1, 0), (2, 1), (3, 2), (4, 1), (5, 4), (9, 8)];
        let found = descendants(&tree, &[2, 9, 77]);
        assert_eq!(found, HashSet::from([2, 3, 9]));
        assert!(descendants(&tree, &[]).is_empty());
    }

    #[test]
    fn group_cpu_leaves_out_new_processes() {
        let before = HashMap::from([(1, 1_000_000_000u64), (2, 0)]);
        // One second on 2 cores; process 1 used half a second, 3 is new.
        let now = [(1, 1_500_000_000u64), (2, 0), (3, 9_000_000_000)];
        assert_eq!(
            group_cpu_percent(&now, &before, 1_000_000_000, 2),
            Some(25.0)
        );
        assert_eq!(group_cpu_percent(&now, &before, 0, 2), None);
    }

    #[test]
    fn only_listed_apps_can_open_a_folder() {
        assert_eq!(bundle_id_of("finder"), Some("com.apple.finder"));
        assert_eq!(bundle_id_of("rm"), None);
        assert_eq!(OPEN_IN_APPS[0].0, "finder");
    }
}
