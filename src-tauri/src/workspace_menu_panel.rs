//! App-rendered workspace actions in an owned window above native browser children.
//! The panel only reports a validated selection to its originating workspace;
//! it never changes browser visibility or executes actions itself.
use crate::display_rate::FullRefreshRate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};
use tauri::{
    window::{Color, WindowBuilder},
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Url,
    Webview, WebviewBuilder, WebviewUrl, WindowEvent,
};

const STATE_EVENT: &str = "workspace-menu-panel-state";
const ACTION_EVENT: &str = "workspace-menu-panel-action";
const CLOSED_EVENT: &str = "workspace-menu-panel-closed";

#[derive(Default)]
pub struct WorkspaceMenuPanelState(Mutex<HashMap<String, Panel>>);

struct Panel {
    owner: String,
    owner_window: String,
    snapshot: Value,
    presentation: Option<String>,
    anchor: WorkspaceMenuPanelAnchor,
    shown: bool,
    focused: bool,
}

#[derive(Clone, Serialize)]
pub struct PanelHandle {
    label: String,
    presentation: String,
}

struct Selection {
    owner: String,
    owner_window: String,
    presentation: String,
}

#[derive(Clone, Copy, Deserialize)]
pub struct WorkspaceMenuPanelAnchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}

impl WorkspaceMenuPanelAnchor {
    fn validate(self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height, self.dpr]
            .into_iter()
            .all(f64::is_finite)
            || self.width < 0.0
            || self.height < 0.0
            || self.x.abs() > 1_000_000.0
            || self.y.abs() > 1_000_000.0
            || self.width > 1_000_000.0
            || self.height > 1_000_000.0
            || !(0.1..=16.0).contains(&self.dpr)
        {
            return Err("Invalid workspace menu panel position".into());
        }
        Ok(())
    }
}

fn with_panels<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut HashMap<String, Panel>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<WorkspaceMenuPanelState>();
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "Workspace menu panel state is unavailable")?;
    action(&mut entries)
}

fn valid_text(value: &Value, max: usize) -> bool {
    value
        .as_str()
        .is_some_and(|text| !text.trim().is_empty() && text.len() <= max && !text.contains('\0'))
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    let valid = || {
        if !snapshot.is_object()
            || snapshot.to_string().len() > 32_768
            || !valid_text(&snapshot["title"], 120)
            || !matches!(snapshot["theme"]["mode"].as_str(), Some("dark" | "light"))
            || !valid_text(&snapshot["theme"]["accent"], 1024)
            || (!snapshot["compact"].is_null() && !snapshot["compact"].is_boolean())
            || (!snapshot["align"].is_null()
                && !matches!(snapshot["align"].as_str(), Some("start" | "end")))
            || (!snapshot["width"].is_null()
                && !snapshot["width"]
                    .as_f64()
                    .is_some_and(|width| (1.0..=1_000_000.0).contains(&width)))
            || (!snapshot["gap"].is_null()
                && !snapshot["gap"]
                    .as_f64()
                    .is_some_and(|gap| (0.0..=24.0).contains(&gap)))
        {
            return false;
        }
        for key in ["background", "text"] {
            if !snapshot["theme"][key].is_null() && !valid_text(&snapshot["theme"][key], 1024) {
                return false;
            }
        }
        let Some(items) = snapshot["items"].as_array() else {
            return false;
        };
        if items.is_empty() || items.len() > 24 {
            return false;
        }
        let mut ids = HashSet::new();
        items.iter().all(|item| {
            let Some(id) = item["id"].as_str() else {
                return false;
            };
            !id.is_empty()
                && id.len() <= 80
                && id != "close"
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':'))
                && ids.insert(id)
                && valid_text(&item["label"], 240)
                && (item["description"].is_null() || valid_text(&item["description"], 512))
                && ["disabled", "checked", "danger", "separatorBefore"]
                    .iter()
                    .all(|key| item[key].is_null() || item[key].is_boolean())
                && (item["shortcut"].is_null() || valid_text(&item["shortcut"], 80))
        })
    };
    if valid() {
        Ok(())
    } else {
        Err("Invalid workspace menu display data".into())
    }
}

fn is_allowed_action(snapshot: &Value, action: &str) -> bool {
    action == "close"
        || snapshot["items"].as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| item["id"].as_str() == Some(action) && item["disabled"] != true)
        })
}

fn panel_height(snapshot: &Value) -> f64 {
    // Shared panel header/padding plus compact action rows. Descriptions receive
    // a second line; large menus scroll within the available display height.
    let Some(items) = snapshot["items"].as_array() else {
        return 108.0;
    };
    if snapshot["compact"] == true {
        let separators = items
            .iter()
            .skip(1)
            .filter(|item| item["separatorBefore"] == true)
            .count();
        let children = items.len() + separators;
        let height = 14.0
            + 30.0 * items.len() as f64
            + 9.0 * separators as f64
            + 2.0 * children.saturating_sub(1) as f64;
        return height.clamp(44.0, 560.0);
    }
    let rows: f64 = items
        .iter()
        .map(|item| {
            let label_lines = item["label"]
                .as_str()
                .map_or(1, |text| text.chars().count().div_ceil(40).max(1));
            let description = item["description"].as_str().filter(|text| !text.is_empty());
            let description_height = description.map_or(0.0, |text| {
                3.0 + 18.0 * text.chars().count().div_ceil(44).max(1) as f64
            });
            (20.0 + 19.0 * label_lines as f64 + description_height).max(48.0)
        })
        .sum();
    (58.0 + rows + 2.0 * items.len().saturating_sub(1) as f64).clamp(108.0, 560.0)
}

fn accept_ready(panel: &mut Panel, presentation: &str) -> bool {
    if panel.presentation.as_deref() != Some(presentation) || panel.shown {
        return false;
    }
    panel.shown = true;
    true
}

fn take_selection(
    entries: &mut HashMap<String, Panel>,
    label: &str,
    presentation: &str,
    action: &str,
) -> Result<Selection, String> {
    let panel = entries
        .get_mut(label)
        .ok_or("This workspace menu panel is closed")?;
    if panel.presentation.as_deref() != Some(presentation) || !panel.shown {
        return Err("This workspace menu presentation is closed".into());
    }
    if !is_allowed_action(&panel.snapshot, action) {
        return Err("Unknown or disabled workspace menu action".into());
    }
    // The presentation accepts one terminal selection. Keep its renderer warm.
    panel.presentation = None;
    panel.shown = false;
    panel.focused = false;
    Ok(Selection {
        owner: panel.owner.clone(),
        owner_window: panel.owner_window.clone(),
        presentation: presentation.into(),
    })
}

fn validate_owner(caller: &Webview) -> Result<(), String> {
    crate::browser::label(caller, "workspace-menu-panel")?;
    Ok(())
}

fn owned_label(entries: &HashMap<String, Panel>, owner: &str) -> Option<String> {
    entries
        .iter()
        .find_map(|(label, panel)| (panel.owner == owner).then(|| label.clone()))
}

fn state_payload(panel: &Panel) -> Value {
    panel.presentation.as_ref().map_or(
        Value::Null,
        |presentation| json!({ "presentation": presentation, "snapshot": panel.snapshot }),
    )
}

fn notify_closed(app: &AppHandle, label: &str, owner: &str, presentation: &str) {
    let _ = app.emit_to(
        EventTarget::webview(owner),
        CLOSED_EVENT,
        json!({ "label": label, "presentation": presentation }),
    );
}

fn dismiss(app: &AppHandle, label: &str, destroy: bool, expected: Option<&str>) {
    let dismissed = with_panels(app, |entries| {
        let Some(panel) = entries.get_mut(label) else {
            return Ok(None);
        };
        if expected.is_some() && panel.presentation.as_deref() != expected {
            return Ok(None);
        }
        panel.shown = false;
        panel.focused = false;
        let notify = panel
            .presentation
            .take()
            .map(|id| (panel.owner.clone(), id));
        if destroy {
            entries.remove(label);
        }
        Ok(Some(notify))
    })
    .ok()
    .flatten();
    // A stale owner's cleanup must not hide a later caller's presentation.
    let Some(notify) = dismissed else { return };
    if let Some(window) = app.get_window(label) {
        if destroy {
            let _ = window.destroy();
        } else {
            let _ = window.hide();
        }
    }
    if let Some((owner, presentation)) = notify {
        notify_closed(app, label, &owner, &presentation);
    }
}

fn allowed_url(url: &Url, expected: &Url) -> bool {
    let mut url = url.clone();
    url.set_fragment(None);
    let mut expected = expected.clone();
    expected.set_fragment(None);
    url == expected
}

/// Return physical placement and logical size, clamped to the anchor's display.
fn placement(
    caller: &Webview,
    anchor: WorkspaceMenuPanelAnchor,
    snapshot: &Value,
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let owner = caller.window();
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    // Only the main/window-* app webviews may call this command; they are
    // WebviewWindows filling the owner. Webview::position() is already a
    // screen position for those views, so adding it would double the origin.
    let (left, right, bottom) = anchor_edges(origin, anchor);
    let monitor = owner
        .monitor_from_point(left, bottom - 1.0)
        .map_err(|error| error.to_string())?
        .or(owner.current_monitor().map_err(|error| error.to_string())?)
        .ok_or("The workspace menu panel display is unavailable")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let start = snapshot["align"] == "start"
        || (snapshot["align"].is_null() && snapshot["compact"] == true);
    let width = panel_width(snapshot);
    Ok(clamped_placement(
        if start { left } else { right },
        bottom,
        scale,
        [
            f64::from(work.position.x),
            f64::from(work.position.y),
            f64::from(work.size.width),
            f64::from(work.size.height),
        ],
        LogicalSize::new(width, panel_height(snapshot)),
        start,
        snapshot["gap"].as_f64().unwrap_or(6.0),
    ))
}

fn anchor_edges(
    origin: PhysicalPosition<i32>,
    anchor: WorkspaceMenuPanelAnchor,
) -> (f64, f64, f64) {
    let left = f64::from(origin.x) + anchor.x * anchor.dpr;
    let right = left + anchor.width * anchor.dpr;
    let bottom = f64::from(origin.y) + (anchor.y + anchor.height) * anchor.dpr;
    (left, right, bottom)
}

fn panel_width(snapshot: &Value) -> f64 {
    snapshot["width"]
        .as_f64()
        .unwrap_or(if snapshot["compact"] == true {
            280.0
        } else {
            360.0
        })
        .clamp(180.0, 480.0)
}

fn clamped_placement(
    anchor_x: f64,
    bottom: f64,
    scale: f64,
    work: [f64; 4],
    requested: LogicalSize<f64>,
    align_start: bool,
    gap: f64,
) -> (PhysicalPosition<i32>, LogicalSize<f64>) {
    let [work_left, work_top, work_width, work_height] = work;
    let margin = 8.0 * scale;
    let left = work_left + margin;
    let top = work_top + margin;
    let available_width = (work_width - 2.0 * margin).max(scale);
    let available_height = (work_height - 2.0 * margin).max(scale);
    let width = (requested.width * scale).min(available_width);
    let height = (requested.height * scale).min(available_height);
    let x = if align_start {
        anchor_x
    } else {
        anchor_x - width
    }
    .clamp(left, left + available_width - width);
    let y = (bottom + gap * scale).clamp(top, top + available_height - height);
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    )
}

// Serialize native visibility and state on the event thread: a late ready,
// update or cleanup from the preceding opening cannot affect its replacement.
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let run = move || {
        let _ = send.send(operation());
    };
    // AppKit may synchronously reenter Tao while showing or creating a window.
    // The main queue runs outside Tao's event-handler lock (as in pip_group).
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        dispatch2::DispatchQueue::main().exec_async(run);
    }
    #[cfg(not(target_os = "macos"))]
    app.run_on_main_thread(run)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv()
            .map_err(|_| "Panel operation was interrupted".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn workspace_menu_panel_open(
    caller: Webview,
    anchor: WorkspaceMenuPanelAnchor,
    snapshot: Value,
) -> Result<PanelHandle, String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || open_on_main(caller, anchor, snapshot)).await
}

fn open_on_main(
    caller: Webview,
    anchor: WorkspaceMenuPanelAnchor,
    snapshot: Value,
) -> Result<PanelHandle, String> {
    validate_owner(&caller)?;
    anchor.validate()?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let owner = caller.window();
    if app.get_window(owner.label()).is_none() || app.get_webview(caller.label()).is_none() {
        return Err("The owning workspace closed".into());
    }
    if let Some(existing) = with_panels(app, |entries| Ok(owned_label(entries, caller.label())))? {
        if app.get_window(&existing).is_none() || app.get_webview(&existing).is_none() {
            dismiss(app, &existing, true, None);
        }
    }
    let (position, size) = placement(&caller, anchor, &snapshot)?;
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join("index.html?workspaceMenuPanel=1")
        .map_err(|error| error.to_string())?;
    // One retained renderer per owner. A new nonce isolates each opening from
    // queued readiness, selection, and cleanup messages from previous menus.
    let label = format!("workspace-menu-panel-{}", uuid::Uuid::new_v4());
    let presentation = uuid::Uuid::new_v4().to_string();
    let existing = with_panels(app, |entries| {
        if let Some(existing) = owned_label(entries, caller.label()) {
            let panel = entries.get_mut(&existing).unwrap();
            let previous = panel.presentation.replace(presentation.clone());
            panel.snapshot = snapshot.clone();
            panel.anchor = anchor;
            panel.shown = false;
            panel.focused = false;
            return Ok(Some((existing, previous)));
        }
        entries.insert(
            label.clone(),
            Panel {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                snapshot: snapshot.clone(),
                presentation: Some(presentation.clone()),
                anchor,
                shown: false,
                focused: false,
            },
        );
        Ok(None)
    })?;
    if let Some((existing, previous)) = existing {
        if let Some(previous) = previous {
            notify_closed(app, &existing, caller.label(), &previous);
        }
        let reuse = (|| {
            let window = app.get_window(&existing).ok_or("The menu window closed")?;
            window.hide().map_err(|error| error.to_string())?;
            window
                .set_position(position)
                .map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
            window
                .set_title(snapshot["title"].as_str().unwrap_or("Open"))
                .map_err(|error| error.to_string())?;
            app.emit_to(
                EventTarget::webview(&existing),
                STATE_EVENT,
                json!({ "presentation": presentation, "snapshot": snapshot }),
            )
            .map_err(|error| error.to_string())
        })();
        if let Err(error) = reuse {
            dismiss(app, &existing, true, Some(&presentation));
            return Err(error);
        }
        return Ok(PanelHandle {
            label: existing,
            presentation,
        });
    }
    let build = (|| {
        let window = WindowBuilder::new(app, &label)
            .title(snapshot["title"].as_str().unwrap_or("Open"))
            .inner_size(size.width, size.height)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .shadow(true)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .parent(&owner)
            .map_err(|error| error.to_string())?
            .build()
            .map_err(|error| error.to_string())?;
        window
            .set_position(position)
            .map_err(|error| error.to_string())?;
        window.set_size(size).map_err(|error| error.to_string())?;
        let child = WebviewBuilder::new(
            &label,
            WebviewUrl::App("index.html?workspaceMenuPanel=1".into()),
        )
        .full_refresh_rate(app)
        .focused(false)
        .auto_resize()
        .disable_drag_drop_handler()
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .on_navigation(move |url| allowed_url(url, &expected))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
        window
            .add_child(child, LogicalPosition::new(0.0, 0.0), size)
            .map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = build {
        dismiss(app, &label, true, None);
        return Err(error);
    }
    if app.get_window(owner.label()).is_none()
        || !with_panels(app, |entries| Ok(entries.contains_key(&label)))?
    {
        dismiss(app, &label, true, None);
        return Err("The owning workspace closed".into());
    }
    Ok(PanelHandle {
        label,
        presentation,
    })
}

#[tauri::command]
pub async fn workspace_menu_panel_update(
    caller: Webview,
    presentation: String,
    snapshot: Value,
) -> Result<Option<PanelHandle>, String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || update_on_main(caller, presentation, snapshot)).await
}

fn update_on_main(
    caller: Webview,
    presentation: String,
    snapshot: Value,
) -> Result<Option<PanelHandle>, String> {
    validate_owner(&caller)?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let existing = with_panels(app, |entries| {
        let Some(label) = owned_label(entries, caller.label()) else {
            return Ok(None);
        };
        let panel = entries.get_mut(&label).unwrap();
        if panel.presentation.as_deref() != Some(&presentation) {
            return Ok(None);
        }
        let changed = panel.snapshot != snapshot;
        if changed {
            panel.snapshot = snapshot.clone();
            panel.presentation = Some(uuid::Uuid::new_v4().to_string());
        }
        Ok(Some((
            PanelHandle {
                label,
                presentation: panel.presentation.clone().unwrap(),
            },
            panel.anchor,
            changed,
        )))
    })?;
    let Some((handle, anchor, changed)) = existing else {
        return Ok(None);
    };
    if changed {
        let refresh = (|| {
            let (position, size) = placement(&caller, anchor, &snapshot)?;
            let window = app
                .get_window(&handle.label)
                .ok_or("The menu window closed")?;
            window
                .set_position(position)
                .map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
            // A palette/data refresh never hides or refocuses an already visible menu.
            app.emit_to(
                EventTarget::webview(&handle.label),
                STATE_EVENT,
                json!({ "presentation": handle.presentation, "snapshot": snapshot }),
            )
            .map_err(|error| error.to_string())
        })();
        if let Err(error) = refresh {
            dismiss(app, &handle.label, true, Some(&handle.presentation));
            return Err(error);
        }
    }
    Ok(Some(handle))
}

#[tauri::command]
pub async fn workspace_menu_panel_get_state(caller: Webview) -> Result<Value, String> {
    with_panels(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(state_payload)
            .ok_or("This workspace menu panel is closed".into())
    })
}

#[tauri::command]
pub async fn workspace_menu_panel_ready(
    caller: Webview,
    presentation: String,
) -> Result<bool, String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || ready_on_main(caller, presentation)).await
}

fn ready_on_main(caller: Webview, presentation: String) -> Result<bool, String> {
    let app = caller.app_handle();
    let show = with_panels(app, |entries| {
        let Some(panel) = entries.get_mut(caller.label()) else {
            return Ok(false);
        };
        if app.get_window(&panel.owner_window).is_none() {
            return Ok(false);
        }
        Ok(accept_ready(panel, &presentation))
    })?;
    if !show {
        return Ok(false);
    }
    let window = caller.window();
    // The renderer acknowledges the current presentation after painting it.
    // Focus both views so Escape works immediately, including on warm reopen.
    let result = window
        .show()
        .and_then(|()| window.set_focus())
        .and_then(|()| caller.set_focus());
    if result.is_err() {
        dismiss(app, caller.label(), true, Some(&presentation));
    }
    result.map(|()| true).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workspace_menu_panel_action(
    caller: Webview,
    presentation: String,
    action: String,
) -> Result<(), String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || action_on_main(caller, presentation, action)).await
}

fn action_on_main(caller: Webview, presentation: String, action: String) -> Result<(), String> {
    let app = caller.app_handle();
    let selection = with_panels(app, |entries| {
        take_selection(entries, caller.label(), &presentation, &action)
    })?;
    if let Some(window) = app.get_window(caller.label()) {
        let _ = window.hide();
    }
    let result = if action != "close" {
        app.emit_to(EventTarget::webview(&selection.owner), ACTION_EVENT,
            json!({ "action": action, "label": caller.label(), "presentation": selection.presentation }))
            .map_err(|error| error.to_string())
    } else {
        Ok(())
    };
    notify_closed(
        app,
        caller.label(),
        &selection.owner,
        &selection.presentation,
    );
    if let Some(window) = app.get_window(&selection.owner_window) {
        let _ = window.set_focus();
    }
    result
}

#[tauri::command]
pub async fn workspace_menu_panel_close(
    caller: Webview,
    presentation: String,
) -> Result<(), String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || close_on_main(caller, presentation)).await
}

fn close_on_main(caller: Webview, presentation: String) -> Result<(), String> {
    validate_owner(&caller)?;
    let app = caller.app_handle();
    if let Some(label) = with_panels(app, |entries| Ok(owned_label(entries, caller.label())))? {
        dismiss(app, &label, false, Some(&presentation));
    }
    Ok(())
}

/// Retain hidden menus across owner movement and blur. Destroy only with the
/// owning window or an actual native popup destruction, avoiding cold WK loads.
pub fn window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    let dismiss_self = with_panels(app, |entries| {
        let Some(panel) = entries.get_mut(label) else {
            return Ok(false);
        };
        match event {
            WindowEvent::Focused(true) => {
                panel.focused = panel.shown;
                Ok(false)
            }
            WindowEvent::Focused(false) => Ok(panel.shown && panel.focused),
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. } => Ok(true),
            _ => Ok(false),
        }
    })
    .unwrap_or(false);
    if dismiss_self {
        dismiss(
            app,
            label,
            matches!(
                event,
                WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }
            ),
            None,
        );
    }
    if matches!(
        event,
        WindowEvent::Moved(_)
            | WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. }
            | WindowEvent::Destroyed
            | WindowEvent::CloseRequested { .. }
    ) {
        let children = with_panels(app, |entries| {
            Ok(entries
                .iter()
                .filter(|(_, panel)| panel.owner_window == label)
                .map(|(child, _)| child.clone())
                .collect::<Vec<_>>())
        })
        .unwrap_or_default();
        for child in children {
            dismiss(
                app,
                &child,
                matches!(
                    event,
                    WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }
                ),
                None,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Value {
        json!({
            "title": "Open workspace",
            "items": [
                {"id": "browser", "label": "Open browser", "description": "Preview this project"},
                {"id": "finder", "label": "Reveal in Finder"},
                {"id": "editor", "label": "Open editor", "disabled": true}
            ],
            "theme": {"mode": "dark", "accent": "#6CABDD", "background": "#0B121A", "text": "#FFFFFF"}
        })
    }

    fn anchor() -> WorkspaceMenuPanelAnchor {
        WorkspaceMenuPanelAnchor {
            x: 10.0,
            y: 5.0,
            width: 24.0,
            height: 24.0,
            dpr: 2.0,
        }
    }

    #[test]
    fn anchors_reject_unbounded_or_nonfinite_geometry() {
        assert!(anchor().validate().is_ok());
        for invalid in [
            WorkspaceMenuPanelAnchor {
                x: f64::NAN,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                y: f64::INFINITY,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                width: -1.0,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                height: -1.0,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                x: 1_000_001.0,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                dpr: 0.0,
                ..anchor()
            },
            WorkspaceMenuPanelAnchor {
                dpr: 16.1,
                ..anchor()
            },
        ] {
            assert!(invalid.validate().is_err());
        }
    }

    #[test]
    fn snapshots_require_bounded_unique_item_ids_and_display_text() {
        assert!(validate_snapshot(&snapshot()).is_ok());
        for (key, value) in [
            ("title", json!("")),
            ("title", json!("x".repeat(121))),
            ("items", json!([])),
            ("items", json!([{"id":"close", "label":"Close"}])),
            (
                "items",
                json!([{"id":"a", "label":"One"}, {"id":"a", "label":"Two"}]),
            ),
            ("items", json!([{"id":"bad id", "label":"One"}])),
            ("items", json!([{"id":"a", "label":""}])),
            (
                "items",
                json!([{"id":"a", "label":"One", "disabled":"false"}]),
            ),
            (
                "items",
                json!([{"id":"a", "label":"One", "description":"x".repeat(513)}]),
            ),
            ("theme", json!({"mode":"unknown", "accent":"#fff"})),
        ] {
            let mut invalid = snapshot();
            invalid[key] = value;
            assert!(validate_snapshot(&invalid).is_err(), "{invalid}");
        }
        let mut too_many = snapshot();
        too_many["items"] = Value::Array(
            (0..25)
                .map(|id| json!({"id":id.to_string(), "label":"Item"}))
                .collect(),
        );
        assert!(validate_snapshot(&too_many).is_err());
    }

    #[test]
    fn actions_are_limited_to_current_enabled_items_or_close() {
        let mut value = snapshot();
        assert!(is_allowed_action(&value, "browser"));
        assert!(is_allowed_action(&value, "close"));
        for invalid in ["", "editor", "supervised", "arbitrary", "Browser"] {
            assert!(!is_allowed_action(&value, invalid));
        }
        value["items"][0]["disabled"] = json!(true);
        assert!(!is_allowed_action(&value, "browser"));
    }

    #[test]
    fn selection_consumes_only_the_registered_panel_once() {
        let mut entries = HashMap::new();
        entries.insert(
            "workspace-menu-panel-a".into(),
            Panel {
                owner: "main".into(),
                owner_window: "main".into(),
                snapshot: snapshot(),
                presentation: Some("presentation-a".into()),
                anchor: anchor(),
                shown: true,
                focused: true,
            },
        );
        assert_eq!(
            owned_label(&entries, "main"),
            Some("workspace-menu-panel-a".into())
        );
        assert_eq!(owned_label(&entries, "window-2"), None);
        assert!(take_selection(
            &mut entries,
            "workspace-menu-panel-a",
            "old-presentation",
            "browser"
        )
        .is_err());
        entries.get_mut("workspace-menu-panel-a").unwrap().shown = false;
        assert!(take_selection(
            &mut entries,
            "workspace-menu-panel-a",
            "presentation-a",
            "browser"
        )
        .is_err());
        entries.get_mut("workspace-menu-panel-a").unwrap().shown = true;
        assert!(take_selection(&mut entries, "window-2", "presentation-a", "browser").is_err());
        assert!(take_selection(
            &mut entries,
            "workspace-menu-panel-a",
            "presentation-a",
            "editor"
        )
        .is_err());
        assert_eq!(entries.len(), 1);
        assert_eq!(
            take_selection(
                &mut entries,
                "workspace-menu-panel-a",
                "presentation-a",
                "browser"
            )
            .unwrap()
            .owner,
            "main"
        );
        assert!(take_selection(
            &mut entries,
            "workspace-menu-panel-a",
            "presentation-a",
            "browser"
        )
        .is_err());
    }

    #[test]
    fn content_height_accounts_for_descriptions_and_limits_long_menus() {
        let mut value = snapshot();
        let with_description = panel_height(&value);
        value["items"][0]
            .as_object_mut()
            .unwrap()
            .remove("description");
        assert!(panel_height(&value) < with_description);
        value["items"][0]["description"] = json!("x".repeat(512));
        assert!(panel_height(&value) > with_description);
        value["items"] = Value::Array(
            (0..24)
                .map(|id| json!({"id":id.to_string(), "label":"Item"}))
                .collect(),
        );
        assert_eq!(panel_height(&value), 560.0);
    }

    #[test]
    fn position_clamps_to_retina_negative_origin_and_small_displays() {
        let (position, size) = clamped_placement(
            2_000.0,
            80.0,
            2.0,
            [0.0, 0.0, 2_880.0, 1_800.0],
            LogicalSize::new(360.0, 200.0),
            false,
            6.0,
        );
        assert_eq!(position, PhysicalPosition::new(1_280, 92));
        assert_eq!(size, LogicalSize::new(360.0, 200.0));
        let (position, size) = clamped_placement(
            -1_900.0,
            1_075.0,
            1.0,
            [-1_920.0, 0.0, 1_920.0, 1_080.0],
            LogicalSize::new(360.0, 200.0),
            false,
            6.0,
        );
        assert_eq!(position, PhysicalPosition::new(-1_912, 872));
        assert_eq!(size, LogicalSize::new(360.0, 200.0));
        let (position, size) = clamped_placement(
            600.0,
            500.0,
            2.0,
            [0.0, 0.0, 400.0, 300.0],
            LogicalSize::new(360.0, 200.0),
            false,
            6.0,
        );
        assert_eq!(position, PhysicalPosition::new(16, 16));
        assert_eq!(size, LogicalSize::new(184.0, 134.0));
    }

    #[test]
    fn navigation_stays_in_the_registered_display_only_document() {
        let expected = Url::parse("tauri://localhost/index.html?workspaceMenuPanel=1").unwrap();
        assert!(allowed_url(&expected.join("#state").unwrap(), &expected));
        for invalid in [
            "tauri://localhost/index.html",
            "https://example.com/",
            "tauri://localhost/index.html?accessPanel=1",
        ] {
            assert!(!allowed_url(&Url::parse(invalid).unwrap(), &expected));
        }
    }
    #[test]
    fn point_and_element_anchors_apply_screen_origin_and_dpr_once() {
        let point = WorkspaceMenuPanelAnchor {
            x: 25.0,
            y: 40.0,
            width: 0.0,
            height: 0.0,
            dpr: 2.0,
        };
        assert!(point.validate().is_ok());
        assert_eq!(
            anchor_edges(PhysicalPosition::new(400, 120), point),
            (450.0, 450.0, 200.0)
        );
        let zoomed = WorkspaceMenuPanelAnchor {
            width: 30.0,
            height: 20.0,
            dpr: 2.5,
            ..point
        };
        assert_eq!(
            anchor_edges(PhysicalPosition::new(-1920, 100), zoomed),
            (-1857.5, -1782.5, 250.0)
        );
    }

    #[test]
    fn compact_height_covers_frame_flex_gaps_and_separators() {
        let mut value = snapshot();
        value["compact"] = json!(true);
        assert_eq!(panel_height(&value), 108.0);
        value["items"][1]["separatorBefore"] = json!(true);
        assert_eq!(panel_height(&value), 119.0);
        value["items"] = json!([{ "id": "only", "label": "Only" }]);
        assert_eq!(panel_height(&value), 44.0);
    }

    #[test]
    fn requested_menu_width_is_bounded_without_rejecting_narrow_callers() {
        let mut value = snapshot();
        value["width"] = json!(160.0);
        assert!(validate_snapshot(&value).is_ok());
        assert_eq!(panel_width(&value), 180.0);
        value["width"] = json!(900.0);
        assert!(validate_snapshot(&value).is_ok());
        assert_eq!(panel_width(&value), 480.0);
        for invalid in [json!(0), json!(-2), json!("large"), json!(1_000_001)] {
            value["width"] = invalid;
            assert!(validate_snapshot(&value).is_err());
        }
    }

    #[test]
    fn current_readiness_shows_once_and_ignores_closed_or_replaced_presentations() {
        let mut panel = Panel {
            owner: "main".into(),
            owner_window: "main".into(),
            snapshot: snapshot(),
            anchor: anchor(),
            presentation: Some("new".into()),
            shown: false,
            focused: false,
        };
        assert!(!accept_ready(&mut panel, "old"));
        assert!(accept_ready(&mut panel, "new"));
        assert!(!accept_ready(&mut panel, "new"));
        panel.presentation = Some("updated".into());
        assert!(!accept_ready(&mut panel, "updated"));
        panel.presentation = None;
        panel.shown = false;
        assert!(!accept_ready(&mut panel, "updated"));
        panel.presentation = Some("reopened".into());
        assert!(!accept_ready(&mut panel, "updated"));
        assert!(accept_ready(&mut panel, "reopened"));
    }
}
