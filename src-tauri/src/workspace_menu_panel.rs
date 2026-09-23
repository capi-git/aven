//! App-rendered workspace actions in an owned window above native browser children.
//! The panel only reports a validated selection to its originating workspace;
//! it never changes browser visibility or executes actions itself.
use serde::Deserialize;
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
    anchor: WorkspaceMenuPanelAnchor,
    shown: bool,
    focused: bool,
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
            || self.width <= 0.0
            || self.height <= 0.0
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
                && (item["disabled"].is_null() || item["disabled"].is_boolean())
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

fn take_selection(
    entries: &mut HashMap<String, Panel>,
    label: &str,
    action: &str,
) -> Result<Panel, String> {
    let panel = entries
        .get(label)
        .ok_or("This workspace menu panel is closed")?;
    if !is_allowed_action(&panel.snapshot, action) {
        return Err("Unknown or disabled workspace menu action".into());
    }
    // Each panel accepts exactly one terminal selection, including Close.
    entries
        .remove(label)
        .ok_or_else(|| "This workspace menu panel is closed".into())
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
    anchor: WorkspaceMenuPanelAnchor,
    height: f64,
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let owner = caller.window();
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    let right = f64::from(origin.x) + (anchor.x + anchor.width) * anchor.dpr;
    let bottom = f64::from(origin.y) + (anchor.y + anchor.height) * anchor.dpr;
    let monitor = owner
        .monitor_from_point(right - 1.0, bottom - 1.0)
        .map_err(|error| error.to_string())?
        .or(owner.current_monitor().map_err(|error| error.to_string())?)
        .ok_or("The workspace menu panel display is unavailable")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    Ok(clamped_placement(
        right,
        bottom,
        scale,
        [
            f64::from(work.position.x),
            f64::from(work.position.y),
            f64::from(work.size.width),
            f64::from(work.size.height),
        ],
        height,
    ))
}

fn clamped_placement(
    right: f64,
    bottom: f64,
    scale: f64,
    work: [f64; 4],
    requested_height: f64,
) -> (PhysicalPosition<i32>, LogicalSize<f64>) {
    let [work_left, work_top, work_width, work_height] = work;
    let margin = 8.0 * scale;
    let left = work_left + margin;
    let top = work_top + margin;
    let available_width = (work_width - 2.0 * margin).max(scale);
    let available_height = (work_height - 2.0 * margin).max(scale);
    let width = (360.0 * scale).min(available_width);
    let height = (requested_height * scale).min(available_height);
    let x = (right - width).clamp(left, left + available_width - width);
    let y = (bottom + 6.0 * scale).clamp(top, top + available_height - height);
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    )
}

#[tauri::command]
pub async fn workspace_menu_panel_open(
    caller: Webview,
    anchor: WorkspaceMenuPanelAnchor,
    snapshot: Value,
) -> Result<String, String> {
    validate_owner(&caller)?;
    anchor.validate()?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let owner = caller.window();
    let (position, size) = placement(&caller, anchor, panel_height(&snapshot))?;
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join("index.html?workspaceMenuPanel=1")
        .map_err(|error| error.to_string())?;
    // Reserve atomically so simultaneous clicks cannot make duplicate panels.
    // Unique labels also isolate delayed destroy/readiness events after reopen.
    let label = format!("workspace-menu-panel-{}", uuid::Uuid::new_v4());
    let existing = with_panels(app, |entries| {
        if let Some(existing) = owned_label(entries, caller.label()) {
            let panel = entries.get_mut(&existing).unwrap();
            panel.snapshot = snapshot.clone();
            panel.anchor = anchor;
            return Ok(Some(existing));
        }
        entries.insert(
            label.clone(),
            Panel {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                snapshot: snapshot.clone(),
                anchor,
                shown: false,
                focused: false,
            },
        );
        Ok(None)
    })?;
    if let Some(existing) = existing {
        if let Some(window) = app.get_window(&existing) {
            window
                .set_position(position)
                .map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
        }
        let _ = app.emit_to(EventTarget::webview(&existing), STATE_EVENT, snapshot);
        return Ok(existing);
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
pub async fn workspace_menu_panel_update(caller: Webview, snapshot: Value) -> Result<(), String> {
    validate_owner(&caller)?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let existing = with_panels(app, |entries| {
        let label = owned_label(entries, caller.label());
        Ok(label.map(|label| {
            let panel = entries.get_mut(&label).unwrap();
            panel.snapshot = snapshot.clone();
            (label, panel.anchor)
        }))
    })?;
    if let Some((label, anchor)) = existing {
        let (position, size) = placement(&caller, anchor, panel_height(&snapshot))?;
        if let Some(window) = app.get_window(&label) {
            window
                .set_position(position)
                .map_err(|error| error.to_string())?;
            window.set_size(size).map_err(|error| error.to_string())?;
        }
        app.emit_to(EventTarget::webview(label), STATE_EVENT, snapshot)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn workspace_menu_panel_get_state(caller: Webview) -> Result<Value, String> {
    with_panels(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(|panel| panel.snapshot.clone())
            .ok_or("This workspace menu panel is closed".into())
    })
}

#[tauri::command]
pub async fn workspace_menu_panel_ready(caller: Webview) -> Result<(), String> {
    let app = caller.app_handle();
    with_panels(app, |entries| {
        let panel = entries
            .get_mut(caller.label())
            .ok_or("This workspace menu panel is closed")?;
        if app.get_window(&panel.owner_window).is_none() {
            return Err("The owning workspace closed".into());
        }
        panel.shown = true;
        Ok(())
    })?;
    let window = caller.window();
    // Focus the renderer too so Escape and menu keys work before any click.
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
pub async fn workspace_menu_panel_action(caller: Webview, action: String) -> Result<(), String> {
    let app = caller.app_handle();
    let panel = with_panels(app, |entries| {
        take_selection(entries, caller.label(), &action)
    })?;
    let result = if action != "close" {
        app.emit_to(
            EventTarget::webview(&panel.owner),
            ACTION_EVENT,
            json!({ "action": action, "label": caller.label() }),
        )
        .map_err(|error| error.to_string())
    } else {
        Ok(())
    };
    if let Some(window) = app.get_window(caller.label()) {
        let _ = window.destroy();
    }
    let _ = app.emit_to(
        EventTarget::webview(&panel.owner),
        CLOSED_EVENT,
        json!({ "label": caller.label() }),
    );
    // Selection/Escape returns to the originating workspace. Blur-driven close
    // leaves focus where the user moved it, just like other app popups.
    if let Some(window) = app.get_window(&panel.owner_window) {
        let _ = window.set_focus();
    }
    result
}

#[tauri::command]
pub async fn workspace_menu_panel_close(caller: Webview) -> Result<(), String> {
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
                width: 0.0,
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
        assert!(take_selection(&mut entries, "window-2", "browser").is_err());
        assert!(take_selection(&mut entries, "workspace-menu-panel-a", "editor").is_err());
        assert_eq!(entries.len(), 1);
        assert_eq!(
            take_selection(&mut entries, "workspace-menu-panel-a", "browser")
                .unwrap()
                .owner,
            "main"
        );
        assert!(take_selection(&mut entries, "workspace-menu-panel-a", "browser").is_err());
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
        let (position, size) =
            clamped_placement(2_000.0, 80.0, 2.0, [0.0, 0.0, 2_880.0, 1_800.0], 200.0);
        assert_eq!(position, PhysicalPosition::new(1_280, 92));
        assert_eq!(size, LogicalSize::new(360.0, 200.0));
        let (position, size) = clamped_placement(
            -1_900.0,
            1_075.0,
            1.0,
            [-1_920.0, 0.0, 1_920.0, 1_080.0],
            200.0,
        );
        assert_eq!(position, PhysicalPosition::new(-1_912, 872));
        assert_eq!(size, LogicalSize::new(360.0, 200.0));
        let (position, size) =
            clamped_placement(600.0, 500.0, 2.0, [0.0, 0.0, 400.0, 300.0], 200.0);
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
}
