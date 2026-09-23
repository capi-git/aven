//! A small owned window keeps usage graphics above native browser children.
//! Its renderer receives only a display snapshot and can refresh or dismiss it.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    window::{Color, WindowBuilder},
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Url,
    Webview, WebviewBuilder, WebviewUrl, WindowEvent,
};

const STATE_EVENT: &str = "usage-panel-state";
const ACTION_EVENT: &str = "usage-panel-action";
const CLOSED_EVENT: &str = "usage-panel-closed";

#[derive(Default)]
pub struct UsagePanelState(Mutex<HashMap<String, Panel>>);

struct Panel {
    owner: String,
    owner_window: String,
    snapshot: Value,
    shown: bool,
    focused: bool,
}

#[derive(Clone, Copy, Deserialize)]
pub struct UsagePanelAnchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}

impl UsagePanelAnchor {
    fn validate(self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height, self.dpr]
            .into_iter()
            .all(f64::is_finite)
            || self.width <= 0.0
            || self.height <= 0.0
            || !(0.1..=16.0).contains(&self.dpr)
        {
            return Err("Invalid usage panel position".into());
        }
        Ok(())
    }
}

fn with_panels<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut HashMap<String, Panel>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<UsagePanelState>();
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "Usage panel state is unavailable")?;
    action(&mut entries)
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    if !snapshot.is_object() || snapshot.to_string().len() > 128_000 {
        return Err("Invalid usage display data".into());
    }
    Ok(())
}

fn validate_owner(caller: &Webview) -> Result<(), String> {
    crate::browser::label(caller, "usage-panel")?;
    Ok(())
}

fn owned_label(entries: &HashMap<String, Panel>, owner: &str) -> Option<String> {
    entries
        .iter()
        .find_map(|(label, panel)| (panel.owner == owner).then(|| label.clone()))
}

fn dismiss(app: &AppHandle, label: &str, destroy: bool) {
    let panel = with_panels(app, |entries| Ok(entries.remove(label)))
        .ok()
        .flatten();
    if destroy {
        if let Some(window) = app.get_window(label) {
            let _ = window.destroy();
        }
    }
    if let Some(panel) = panel {
        let _ = app.emit_to(
            EventTarget::webview(panel.owner),
            CLOSED_EVENT,
            json!({ "label": label }),
        );
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
    anchor: UsagePanelAnchor,
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let owner = caller.window();
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    let right = f64::from(origin.x) + (anchor.x + anchor.width) * anchor.dpr;
    let bottom = f64::from(origin.y) + (anchor.y + anchor.height) * anchor.dpr;
    let monitor = owner
        .monitor_from_point(right - 1.0, bottom - 1.0)
        .map_err(|error| error.to_string())?
        .or(owner.current_monitor().map_err(|error| error.to_string())?)
        .ok_or("The usage panel display is unavailable")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let margin = 8.0 * scale;
    let left = f64::from(work.position.x) + margin;
    let top = f64::from(work.position.y) + margin;
    let available_width = (f64::from(work.size.width) - 2.0 * margin).max(scale);
    let available_height = (f64::from(work.size.height) - 2.0 * margin).max(scale);
    let width = (360.0 * scale).min(available_width);
    let height = (560.0 * scale).min(available_height);
    let x = (right - width).clamp(left, left + available_width - width);
    let y = (bottom + 6.0 * scale).clamp(top, top + available_height - height);
    Ok((
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    ))
}

#[tauri::command]
pub async fn usage_panel_open(
    caller: Webview,
    anchor: UsagePanelAnchor,
    snapshot: Value,
) -> Result<String, String> {
    validate_owner(&caller)?;
    anchor.validate()?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let owner = caller.window();
    let (position, size) = placement(&caller, anchor)?;
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join("index.html?usagePanel=1")
        .map_err(|error| error.to_string())?;
    // Reserve atomically so simultaneous clicks cannot make duplicate panels.
    // Unique labels also isolate delayed destroy/readiness events after reopen.
    let label = format!("usage-panel-{}", uuid::Uuid::new_v4());
    let existing = with_panels(app, |entries| {
        if let Some(existing) = owned_label(entries, caller.label()) {
            entries.get_mut(&existing).unwrap().snapshot = snapshot.clone();
            return Ok(Some(existing));
        }
        entries.insert(
            label.clone(),
            Panel {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                snapshot: snapshot.clone(),
                shown: false,
                focused: false,
            },
        );
        Ok(None)
    })?;
    if let Some(existing) = existing {
        let _ = app.emit_to(EventTarget::webview(&existing), STATE_EVENT, snapshot);
        return Ok(existing);
    }
    let build = (|| {
        let window = WindowBuilder::new(app, &label)
            .title("Usage")
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
        let child = WebviewBuilder::new(&label, WebviewUrl::App("index.html?usagePanel=1".into()))
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
        dismiss(app, &label, true);
        return Err(error);
    }
    if app.get_window(owner.label()).is_none()
        || !with_panels(app, |entries| Ok(entries.contains_key(&label)))?
    {
        dismiss(app, &label, true);
        return Err("The owning workspace closed".into());
    }
    Ok(label)
}

#[tauri::command]
pub async fn usage_panel_update(caller: Webview, snapshot: Value) -> Result<(), String> {
    validate_owner(&caller)?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let label = with_panels(app, |entries| {
        let label = owned_label(entries, caller.label());
        if let Some(label) = &label {
            entries.get_mut(label).unwrap().snapshot = snapshot.clone();
        }
        Ok(label)
    })?;
    if let Some(label) = label {
        app.emit_to(EventTarget::webview(label), STATE_EVENT, snapshot)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn usage_panel_get_state(caller: Webview) -> Result<Value, String> {
    with_panels(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(|panel| panel.snapshot.clone())
            .ok_or("This usage panel is closed".into())
    })
}

#[tauri::command]
pub async fn usage_panel_ready(caller: Webview) -> Result<(), String> {
    let app = caller.app_handle();
    with_panels(app, |entries| {
        let panel = entries
            .get_mut(caller.label())
            .ok_or("This usage panel is closed")?;
        if app.get_window(&panel.owner_window).is_none() {
            return Err("The owning workspace closed".into());
        }
        panel.shown = true;
        Ok(())
    })?;
    let window = caller.window();
    // Making the utility window key does not guarantee its unfocused child
    // webview becomes first responder. Escape must work before any click.
    let result = window
        .show()
        .and_then(|()| window.set_focus())
        .and_then(|()| caller.set_focus());
    if result.is_err() {
        dismiss(app, caller.label(), true);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn usage_panel_action(caller: Webview, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "refresh" | "close") {
        return Err("Unknown usage action".into());
    }
    let app = caller.app_handle();
    let (owner, owner_window) = with_panels(app, |entries| {
        entries
            .get(caller.label())
            .map(|panel| (panel.owner.clone(), panel.owner_window.clone()))
            .ok_or("This usage panel is closed".into())
    })?;
    if action == "close" {
        dismiss(app, caller.label(), true);
        // Escape and the explicit Close button return keyboard focus to the
        // originating workspace. Outside-click dismissal intentionally leaves
        // focus wherever the user moved it.
        if let Some(window) = app.get_window(&owner_window) {
            let _ = window.set_focus();
        }
    } else {
        app.emit_to(
            EventTarget::webview(owner),
            ACTION_EVENT,
            json!({ "action": action, "label": caller.label() }),
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn usage_panel_close(caller: Webview) -> Result<(), String> {
    validate_owner(&caller)?;
    let app = caller.app_handle();
    if let Some(label) = with_panels(app, |entries| Ok(owned_label(entries, caller.label())))? {
        dismiss(app, &label, true);
    }
    Ok(())
}

/// Called for every native window event; no changes to browser layout are made.
pub fn window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    let dismiss_self = with_panels(app, |entries| {
        let Some(panel) = entries.get_mut(label) else {
            return Ok(false);
        };
        match event {
            WindowEvent::Focused(true) => {
                panel.focused = true;
                Ok(false)
            }
            WindowEvent::Focused(false) => Ok(panel.shown && panel.focused),
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. } => Ok(true),
            _ => Ok(false),
        }
    })
    .unwrap_or(false);
    if dismiss_self {
        dismiss(app, label, !matches!(event, WindowEvent::Destroyed));
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
            dismiss(app, &child, true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_anchors() {
        let anchor = UsagePanelAnchor {
            x: 10.0,
            y: 5.0,
            width: 24.0,
            height: 24.0,
            dpr: 2.0,
        };
        assert!(anchor.validate().is_ok());
        assert!(UsagePanelAnchor {
            x: f64::NAN,
            ..anchor
        }
        .validate()
        .is_err());
        assert!(UsagePanelAnchor { dpr: 0.0, ..anchor }.validate().is_err());
    }
    #[test]
    fn accepts_only_bounded_display_objects() {
        assert!(validate_snapshot(&json!({"providers": []})).is_ok());
        assert!(validate_snapshot(&json!("text")).is_err());
        assert!(validate_snapshot(&json!({"text": "x".repeat(128_000)})).is_err());
    }
    #[test]
    fn panel_navigation_cannot_escape_its_entrypoint() {
        let url = Url::parse("tauri://localhost/index.html?usagePanel=1").unwrap();
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html?usagePanel=1#state").unwrap(),
            &url
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &url
        ));
        assert!(!allowed_url(
            &Url::parse("https://example.com/index.html?usagePanel=1").unwrap(),
            &url
        ));
    }
}
