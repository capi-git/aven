//! Small, app-local placement history for controlled workspace windows.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{LogicalPosition, LogicalSize, Manager, Window};

const MAX_KEYS: usize = 64;
const MAX_FILE_BYTES: u64 = 128_000;
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Bounds {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .into_iter()
            .all(f64::is_finite)
            && self.width > 0.0
            && self.height > 0.0
    }
    fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedBounds {
    bounds: Bounds,
    updated_at: u64,
}
#[derive(Default, Serialize, Deserialize)]
struct History {
    version: u8,
    windows: HashMap<String, SavedBounds>,
}
fn storage_path(window: &Window) -> Result<PathBuf, String> {
    Ok(window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspace-window-bounds.json"))
}
fn read_history(path: &Path) -> History {
    if !fs::metadata(path).is_ok_and(|meta| meta.len() <= MAX_FILE_BYTES) {
        return History::default();
    }
    let mut history = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<History>(&bytes).ok())
        .filter(|history| history.version == 1)
        .unwrap_or_default();
    history
        .windows
        .retain(|key, saved| valid_key(key) && saved.bounds.valid());
    trim_history(&mut history);
    history
}
fn valid_key(key: &str) -> bool {
    !key.trim().is_empty() && key.len() <= 512
}
fn trim_history(history: &mut History) {
    while history.windows.len() > MAX_KEYS {
        let oldest = history
            .windows
            .iter()
            .min_by(|(left_key, left), (right_key, right)| {
                left.updated_at
                    .cmp(&right.updated_at)
                    .then(left_key.cmp(right_key))
            })
            .map(|(key, _)| key.clone());
        if let Some(key) = oldest {
            history.windows.remove(&key);
        }
    }
}
fn current_bounds(window: &Window) -> Result<Bounds, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let bounds = Bounds {
        x: f64::from(position.x) / scale,
        y: f64::from(position.y) / scale,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
    };
    if !bounds.valid() {
        return Err("Workspace window has invalid bounds".into());
    }
    Ok(bounds)
}
fn monitor_areas(window: &Window, reference: &Window) -> Result<(Vec<Bounds>, usize), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let reference_monitor = reference.current_monitor().ok().flatten();
    let mut preferred = 0;
    let mut areas = Vec::new();
    for monitor in monitors {
        let work = monitor.work_area();
        let scale = monitor.scale_factor();
        // Work areas are physical; convert each display with its own scale.
        let area = Bounds {
            x: f64::from(work.position.x) / scale,
            y: f64::from(work.position.y) / scale,
            width: f64::from(work.size.width) / scale,
            height: f64::from(work.size.height) / scale,
        };
        if !area.valid() {
            continue;
        }
        if reference_monitor
            .as_ref()
            .is_some_and(|reference| reference.position() == monitor.position())
        {
            preferred = areas.len();
        }
        areas.push(area);
    }
    Ok((areas, preferred))
}

/** Keep the full frame inside the work area, even on a very small display. */
fn clamp_bounds(bounds: Bounds, area: Bounds) -> Bounds {
    let width = bounds.width.max(360.0).min(area.width);
    let height = bounds.height.max(300.0).min(area.height);
    Bounds {
        x: bounds.x.clamp(area.x, area.x + area.width - width),
        y: bounds.y.clamp(area.y, area.y + area.height - height),
        width,
        height,
    }
}
fn desired_bounds(
    saved: Option<Bounds>,
    areas: &[Bounds],
    preferred: usize,
    point: Option<(f64, f64)>,
) -> Option<Bounds> {
    let preferred = areas.get(preferred).or_else(|| areas.first())?;
    let point = point.filter(|(x, y)| x.is_finite() && y.is_finite());
    let saved = saved.filter(|bounds| bounds.valid());
    let anchor = point.or_else(|| {
        saved.map(|bounds| {
            (
                bounds.x + 100.0_f64.min(bounds.width / 2.0),
                bounds.y + 18.0,
            )
        })
    });
    let area = anchor
        .and_then(|(x, y)| areas.iter().find(|area| area.contains(x, y)))
        .unwrap_or(preferred);
    let width = saved.map_or(1000.0, |bounds| bounds.width);
    let height = saved.map_or(720.0, |bounds| bounds.height);
    let (x, y) = point
        .map(|(x, y)| (x - 100.0, y - 18.0))
        .or_else(|| saved.map(|bounds| (bounds.x, bounds.y)))
        .unwrap_or((
            area.x + (area.width - width) / 2.0,
            area.y + (area.height - height) / 2.0,
        ));
    Some(clamp_bounds(
        Bounds {
            x,
            y,
            width,
            height,
        },
        *area,
    ))
}
fn apply(window: &Window, bounds: Bounds) -> Result<(), String> {
    let current = current_bounds(window)?;
    if (current.width - bounds.width).abs() > 1.0 || (current.height - bounds.height).abs() > 1.0 {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let inner = window.inner_size().map_err(|e| e.to_string())?;
        let frame_width = (current.width - f64::from(inner.width) / scale).max(0.0);
        let frame_height = (current.height - f64::from(inner.height) / scale).max(0.0);
        window
            .set_size(LogicalSize::new(
                (bounds.width - frame_width).max(1.0),
                (bounds.height - frame_height).max(1.0),
            ))
            .map_err(|e| e.to_string())?;
    }
    if (current.x - bounds.x).abs() > 1.0 || (current.y - bounds.y).abs() > 1.0 {
        window
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Tao's macOS size/position setters enqueue AppKit mutations and return before
// the new frame exists. A just-created hidden workspace must finish that work
// before its renderer measures the browser viewport for transfer readiness.
async fn apply_settled(window: &Window, bounds: Bounds) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWindow;
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        let window = window.clone();
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        // Run outside Tao's event-handler lock: resizing synchronously delivers
        // AppKit window events and may otherwise reenter that lock.
        dispatch2::DispatchQueue::main().exec_async(move || {
            let result = (|| {
                let current = current_bounds(&window)?;
                let pointer = window.ns_window().map_err(|e| e.to_string())?;
                let native = unsafe { &*pointer.cast::<NSWindow>() };
                let frame = native.frame();
                // Keep Tao's global top-left origin, including negative monitor
                // origins, while setting AppKit's outer bottom-left frame.
                let origin_y =
                    frame.origin.y + current.y - bounds.y + current.height - bounds.height;
                native.setFrame_display(
                    NSRect::new(
                        NSPoint::new(bounds.x, origin_y),
                        NSSize::new(bounds.width, bounds.height),
                    ),
                    false,
                );
                Ok::<(), String>(())
            })();
            let _ = send.send(result);
        });
        tauri::async_runtime::spawn_blocking(move || {
            receive
                .recv()
                .map_err(|_| "Workspace placement was interrupted".to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    apply(window, bounds)
}

/// A drop sets the new position; otherwise restore this key's last saved frame.
pub(crate) async fn place(
    window: &Window,
    reference: &Window,
    point: Option<(f64, f64)>,
    key: &str,
) -> Result<(), String> {
    let saved = if valid_key(key) {
        let _guard = STORAGE_LOCK
            .lock()
            .map_err(|_| "Workspace placement storage is unavailable")?;
        read_history(&storage_path(window)?)
            .windows
            .get(key)
            .map(|entry| entry.bounds)
    } else {
        None
    };
    let (areas, preferred) = monitor_areas(window, reference)?;
    if let Some(bounds) = desired_bounds(saved, &areas, preferred, point) {
        apply_settled(window, bounds).await?;
    }
    Ok(())
}
/// Recover the current frame after a display change without restoring an older size.
pub(crate) fn recover(window: &Window, reference: &Window) -> Result<(), String> {
    let current = current_bounds(window)?;
    let (areas, preferred) = monitor_areas(window, reference)?;
    if let Some(bounds) = desired_bounds(Some(current), &areas, preferred, None) {
        apply(window, bounds)?;
    }
    Ok(())
}
/// Call on close/blur or after debouncing resize/move; no idle worker is started.
pub(crate) fn save(window: &Window, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Invalid workspace placement key".into());
    }
    if window.is_minimized().map_err(|e| e.to_string())?
        || window.is_maximized().map_err(|e| e.to_string())?
        || window.is_fullscreen().map_err(|e| e.to_string())?
    {
        return Ok(());
    }
    let bounds = current_bounds(window)?;
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|_| "Workspace placement storage is unavailable")?;
    let path = storage_path(window)?;
    let mut history = read_history(&path);
    if history
        .windows
        .get(key)
        .is_some_and(|entry| entry.bounds == bounds)
    {
        return Ok(());
    }
    history.version = 1;
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    history
        .windows
        .insert(key.into(), SavedBounds { bounds, updated_at });
    trim_history(&mut history);
    let data = serde_json::to_vec(&history).map_err(|e| e.to_string())?;
    let directory = path
        .parent()
        .ok_or("Workspace placement directory is unavailable")?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let temporary = directory.join(format!(
        "workspace-window-bounds-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let result = fs::write(&temporary, data).and_then(|()| fs::rename(&temporary, &path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn area(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }
    #[test]
    fn negative_origin_display_keeps_drop_on_that_display() {
        let screens = [
            area(0.0, 25.0, 1500.0, 900.0),
            area(-1920.0, -200.0, 1920.0, 1080.0),
        ];
        let placed = desired_bounds(None, &screens, 0, Some((-700.0, -100.0))).unwrap();
        assert_eq!(placed, area(-1000.0, -118.0, 1000.0, 720.0));
    }
    #[test]
    fn disconnected_display_recovers_whole_frame_into_reference_work_area() {
        let placed = desired_bounds(
            Some(area(-1800.0, -100.0, 1200.0, 800.0)),
            &[area(0.0, 25.0, 1000.0, 650.0)],
            0,
            None,
        )
        .unwrap();
        assert_eq!(placed, area(0.0, 25.0, 1000.0, 650.0));
    }
    #[test]
    fn repeated_key_restores_frame_and_drop_keeps_its_saved_size() {
        let saved = area(200.0, 90.0, 700.0, 500.0);
        let screens = [area(0.0, 25.0, 1500.0, 900.0)];
        assert_eq!(desired_bounds(Some(saved), &screens, 0, None), Some(saved));
        assert_eq!(
            desired_bounds(Some(saved), &screens, 0, Some((500.0, 200.0))),
            Some(area(400.0, 182.0, 700.0, 500.0))
        );
    }
    #[test]
    fn tiny_work_area_wins_over_default_minimum() {
        assert_eq!(
            clamp_bounds(
                area(0.0, 0.0, 1000.0, 720.0),
                area(10.0, 40.0, 300.0, 200.0)
            ),
            area(10.0, 40.0, 300.0, 200.0)
        );
    }
    #[test]
    fn no_monitors_is_noop_and_nonfinite_drop_uses_reference() {
        assert_eq!(desired_bounds(None, &[], 0, None), None);
        assert_eq!(
            desired_bounds(
                None,
                &[area(0.0, 25.0, 1500.0, 900.0)],
                0,
                Some((f64::NAN, 0.0))
            ),
            Some(area(250.0, 115.0, 1000.0, 720.0))
        );
    }
    #[test]
    fn separate_display_work_areas_do_not_use_primary_size() {
        let screens = [
            area(0.0, 25.0, 1500.0, 900.0),
            area(1500.0, 0.0, 800.0, 600.0),
        ];
        assert_eq!(
            desired_bounds(None, &screens, 0, Some((2250.0, 300.0))),
            Some(area(1500.0, 0.0, 800.0, 600.0))
        );
    }
    #[test]
    fn history_is_bounded_by_recency() {
        let mut history = History::default();
        for index in 0..70 {
            history.windows.insert(
                format!("key-{index}"),
                SavedBounds {
                    bounds: area(0.0, 0.0, 1000.0, 720.0),
                    updated_at: index,
                },
            );
        }
        trim_history(&mut history);
        assert_eq!(history.windows.len(), 64);
        assert!(!history.windows.contains_key("key-0"));
        assert!(history.windows.contains_key("key-69"));
    }
}
