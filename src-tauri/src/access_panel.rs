//! App-rendered access controls in an owned window above native browser children.
//! The panel only reports a validated selection to its originating workspace;
//! it never changes browser visibility or applies permission settings itself.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    window::{Color, WindowBuilder},
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Url,
    Webview, WebviewBuilder, WebviewUrl, WindowEvent,
};

const STATE_EVENT: &str = "access-panel-state";
const ACTION_EVENT: &str = "access-panel-action";
const CLOSED_EVENT: &str = "access-panel-closed";

#[derive(Default)]
pub struct AccessPanelState(Mutex<HashMap<String, Panel>>);

struct Panel {
    owner: String,
    owner_window: String,
    snapshot: Value,
    open_id: String,
    revision: u64,
    requested: bool,
    shown: bool,
    focused: bool,
}

#[derive(Clone, Copy, Deserialize)]
pub struct AccessPanelAnchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}

impl AccessPanelAnchor {
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
            return Err("Invalid access panel position".into());
        }
        Ok(())
    }
}

fn with_panels<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut HashMap<String, Panel>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<AccessPanelState>();
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "Access panel state is unavailable")?;
    action(&mut entries)
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    if !snapshot.is_object()
        || snapshot.to_string().len() > 8_192
        || !snapshot["value"].as_str().is_some_and(is_access_mode)
        || !snapshot["busy"].is_boolean()
        || !matches!(snapshot["theme"]["mode"].as_str(), Some("dark" | "light"))
        || !["accent", "background", "text"].into_iter().all(|key| {
            snapshot["theme"][key]
                .as_str()
                .is_some_and(|color| !color.is_empty() && color.len() <= 1024)
        })
    {
        return Err("Invalid access display data".into());
    }
    Ok(())
}

fn is_access_mode(value: &str) -> bool {
    matches!(
        value,
        "supervised" | "auto-accept-edits" | "auto" | "full-access"
    )
}

fn is_allowed_action(value: &str) -> bool {
    value == "close" || is_access_mode(value)
}

fn validate_owner(caller: &Webview) -> Result<(), String> {
    crate::browser::label(caller, "access-panel")?;
    Ok(())
}

fn owned_label(entries: &HashMap<String, Panel>, owner: &str) -> Option<String> {
    entries
        .iter()
        .find_map(|(label, panel)| (panel.owner == owner).then(|| label.clone()))
}

impl Panel {
    fn active(&self, open_id: &str) -> bool {
        self.requested && self.open_id == open_id
    }

    fn display_state(&self) -> Value {
        json!({ "snapshot": self.snapshot, "openId": self.open_id, "revision": self.revision })
    }

    fn accept_ready(&mut self, open_id: &str, revision: u64) -> bool {
        if !self.active(open_id) || self.revision != revision || self.shown {
            return false;
        }
        self.shown = true;
        true
    }
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

fn dismiss(app: &AppHandle, label: &str, destroy: bool, open_id: Option<&str>) {
    let dismissed = with_panels(app, |entries| {
        let Some(panel) = entries.get_mut(label) else {
            return Ok(None);
        };
        if open_id.is_some_and(|id| !panel.active(id)) {
            return Ok(None);
        }
        let notice = panel
            .requested
            .then(|| (panel.owner.clone(), panel.open_id.clone()));
        panel.requested = false;
        panel.shown = false;
        panel.focused = false;
        if destroy {
            entries.remove(label);
        }
        Ok(Some(notice))
    })
    .ok()
    .flatten();
    let Some(notice) = dismissed else { return };
    if let Some(window) = app.get_window(label) {
        if destroy {
            let _ = window.destroy();
        } else {
            let _ = window.hide();
        }
    }
    if let Some((owner, open_id)) = notice {
        let _ = app.emit_to(
            EventTarget::webview(owner),
            CLOSED_EVENT,
            json!({ "label": open_id }),
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
    anchor: AccessPanelAnchor,
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let owner = caller.window();
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    let right = f64::from(origin.x) + (anchor.x + anchor.width) * anchor.dpr;
    let bottom = f64::from(origin.y) + (anchor.y + anchor.height) * anchor.dpr;
    let monitor = owner
        .monitor_from_point(right - 1.0, bottom - 1.0)
        .map_err(|error| error.to_string())?
        .or(owner.current_monitor().map_err(|error| error.to_string())?)
        .ok_or("The access panel display is unavailable")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    Ok(clamped_placement(
        right,
        bottom,
        scale,
        f64::from(work.position.x),
        f64::from(work.position.y),
        f64::from(work.size.width),
        f64::from(work.size.height),
    ))
}

fn clamped_placement(
    right: f64,
    bottom: f64,
    scale: f64,
    work_left: f64,
    work_top: f64,
    work_width: f64,
    work_height: f64,
) -> (PhysicalPosition<i32>, LogicalSize<f64>) {
    let margin = 8.0 * scale;
    let left = work_left + margin;
    let top = work_top + margin;
    let available_width = (work_width - 2.0 * margin).max(scale);
    let available_height = (work_height - 2.0 * margin).max(scale);
    let width = (360.0 * scale).min(available_width);
    let height = (350.0 * scale).min(available_height);
    let x = (right - width).clamp(left, left + available_width - width);
    let y = (bottom + 6.0 * scale).clamp(top, top + available_height - height);
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    )
}

#[tauri::command]
pub async fn access_panel_open(
    caller: Webview,
    anchor: AccessPanelAnchor,
    snapshot: Value,
) -> Result<String, String> {
    validate_owner(&caller)?;
    anchor.validate()?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || open_panel(caller, anchor, snapshot)).await
}

fn open_panel(
    caller: Webview,
    anchor: AccessPanelAnchor,
    snapshot: Value,
) -> Result<String, String> {
    let app = caller.app_handle();
    let owner = caller.window();
    if app.get_window(owner.label()).is_none() || app.get_webview(caller.label()).is_none() {
        return Err("The owning workspace closed".into());
    }
    let (position, size) = placement(&caller, anchor)?;
    let open_id = uuid::Uuid::new_v4().to_string();
    let existing = with_panels(app, |entries| Ok(owned_label(entries, caller.label())))?;
    if let Some(label) = existing {
        if app.get_window(&label).is_some() && app.get_webview(&label).is_some() {
            dismiss(app, &label, false, None);
            let state = with_panels(app, |entries| {
                let panel = entries.get_mut(&label).ok_or("Panel closed")?;
                panel.snapshot = snapshot;
                panel.open_id = open_id.clone();
                panel.revision += 1;
                panel.requested = true;
                Ok(panel.display_state())
            })?;
            let window = app.get_window(&label).ok_or("Panel window closed")?;
            let result = window
                .set_position(position)
                .and_then(|()| window.set_size(size))
                .map_err(|error| error.to_string())
                .and_then(|()| {
                    app.emit_to(EventTarget::webview(&label), STATE_EVENT, state)
                        .map_err(|error| error.to_string())
                });
            if let Err(error) = result {
                dismiss(app, &label, true, None);
                return Err(error);
            }
            return Ok(open_id);
        }
        dismiss(app, &label, true, None);
    }
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join("index.html?accessPanel=1")
        .map_err(|error| error.to_string())?;
    let label = format!("access-panel-{}", uuid::Uuid::new_v4());
    with_panels(app, |entries| {
        entries.insert(
            label.clone(),
            Panel {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                snapshot,
                open_id: open_id.clone(),
                revision: 1,
                requested: true,
                shown: false,
                focused: false,
            },
        );
        Ok(())
    })?;
    let build = (|| {
        let window = WindowBuilder::new(app, &label)
            .title("Access")
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
        let child = WebviewBuilder::new(&label, WebviewUrl::App("index.html?accessPanel=1".into()))
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
    Ok(open_id)
}

#[tauri::command]
pub async fn access_panel_update(
    caller: Webview,
    snapshot: Value,
    open_id: String,
) -> Result<(), String> {
    validate_owner(&caller)?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let update = with_panels(app, |entries| {
            let Some(label) = owned_label(entries, caller.label()) else {
                return Ok(None);
            };
            let panel = entries.get_mut(&label).unwrap();
            if !panel.active(&open_id) || panel.snapshot == snapshot {
                return Ok(None);
            }
            panel.snapshot = snapshot;
            panel.revision += 1;
            Ok(Some((label, panel.display_state())))
        })?;
        if let Some((label, state)) = update {
            app.emit_to(EventTarget::webview(label), STATE_EVENT, state)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn access_panel_get_state(caller: Webview) -> Result<Value, String> {
    with_panels(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(Panel::display_state)
            .ok_or("This access panel is closed".into())
    })
}

#[tauri::command]
pub async fn access_panel_ready(
    caller: Webview,
    open_id: String,
    revision: u64,
) -> Result<(), String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let show = with_panels(app, |entries| {
            let Some(panel) = entries.get_mut(caller.label()) else {
                return Ok(false);
            };
            if app.get_window(&panel.owner_window).is_none() {
                return Ok(false);
            }
            Ok(panel.accept_ready(&open_id, revision))
        })?;
        if !show {
            return Ok(());
        }
        let window = caller.window();
        let result = window
            .show()
            .and_then(|()| window.set_focus())
            .and_then(|()| caller.set_focus());
        if result.is_err() {
            dismiss(app, caller.label(), true, None);
        }
        result.map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn access_panel_action(
    caller: Webview,
    action: String,
    open_id: String,
) -> Result<(), String> {
    if !is_allowed_action(&action) {
        return Err("Unknown access action".into());
    }
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let target = with_panels(app, |entries| {
            Ok(entries
                .get(caller.label())
                .filter(|panel| panel.active(&open_id) && panel.shown)
                .map(|panel| (panel.owner.clone(), panel.owner_window.clone())))
        })?;
        let Some((owner, owner_window)) = target else {
            return Ok(());
        };
        if action != "close" {
            app.emit_to(
                EventTarget::webview(owner),
                ACTION_EVENT,
                json!({ "action": action, "label": open_id }),
            )
            .map_err(|error| error.to_string())?;
        }
        dismiss(app, caller.label(), false, Some(&open_id));
        if let Some(window) = app.get_window(&owner_window) {
            let _ = window.set_focus();
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn access_panel_close(caller: Webview, open_id: String) -> Result<(), String> {
    validate_owner(&caller)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        if let Some(label) = with_panels(app, |entries| Ok(owned_label(entries, caller.label())))? {
            dismiss(app, &label, false, Some(&open_id));
        }
        Ok(())
    })
    .await
}

/// Hide on outside focus or owner movement; release retained renderers when
/// their owner closes. No browser layout or visibility changes are made.
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
        let destroyed = matches!(
            event,
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }
        );
        dismiss(app, label, destroyed, None);
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
        let destroy = matches!(
            event,
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }
        );
        for child in children {
            dismiss(app, &child, destroy, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_anchors() {
        let anchor = AccessPanelAnchor {
            x: 10.0,
            y: 5.0,
            width: 24.0,
            height: 24.0,
            dpr: 2.0,
        };
        assert!(anchor.validate().is_ok());
        assert!(AccessPanelAnchor {
            x: f64::NAN,
            ..anchor
        }
        .validate()
        .is_err());
        assert!(AccessPanelAnchor { dpr: 0.0, ..anchor }.validate().is_err());
        for invalid in [
            AccessPanelAnchor {
                dpr: 16.1,
                ..anchor
            },
            AccessPanelAnchor {
                width: 0.0,
                ..anchor
            },
            AccessPanelAnchor {
                height: -1.0,
                ..anchor
            },
            AccessPanelAnchor {
                x: f64::INFINITY,
                ..anchor
            },
            AccessPanelAnchor {
                y: -1_000_001.0,
                ..anchor
            },
            AccessPanelAnchor {
                width: 1_000_001.0,
                ..anchor
            },
        ] {
            assert!(invalid.validate().is_err());
        }
    }
    #[test]
    fn accepts_only_bounded_access_snapshots() {
        let snapshot = json!({
            "value": "full-access",
            "busy": false,
            "theme": {"mode": "dark", "accent": "#6CABDD", "background": "#0B121A", "text": "#FFFFFF"}
        });
        assert!(validate_snapshot(&snapshot).is_ok());
        assert!(validate_snapshot(&json!("text")).is_err());
        for invalid in [
            json!({}),
            json!({"value": "full-access", "busy": false}),
            json!({"value": "full-access", "busy": "false", "theme": snapshot["theme"]}),
            json!({"value": "unknown", "busy": false, "theme": snapshot["theme"]}),
            json!({"value": "auto", "busy": false, "theme": {"mode": "dark", "accent": "x".repeat(1025), "background": "#000", "text": "#fff"}}),
            json!({"value": "auto", "busy": false, "theme": snapshot["theme"], "extra": "x".repeat(8_192)}),
        ] {
            assert!(validate_snapshot(&invalid).is_err());
        }
        let mut nested_colors = snapshot.clone();
        nested_colors["theme"]["background"] = json!(format!(
            "color-mix(in srgb, {} 92%, transparent)",
            "color-mix(in srgb, #0b121a 90%, #6cabdd)".repeat(4)
        ));
        assert!(validate_snapshot(&nested_colors).is_ok());
    }
    #[test]
    fn only_known_permission_choices_or_close_are_actions() {
        for mode in ["supervised", "auto-accept-edits", "auto", "full-access"] {
            assert!(is_access_mode(mode));
            assert!(is_allowed_action(mode));
        }
        assert!(is_allowed_action("close"));
        assert!(!is_access_mode("close"));
        for invalid in ["", "refresh", "full_access", "Full access", "full-access "] {
            assert!(!is_allowed_action(invalid));
        }
    }
    #[test]
    fn keeps_popup_inside_retina_and_negative_origin_displays() {
        let (position, size) = clamped_placement(2_000.0, 80.0, 2.0, 0.0, 0.0, 2_880.0, 1_800.0);
        assert_eq!(position, PhysicalPosition::new(1_280, 92));
        assert_eq!(size, LogicalSize::new(360.0, 350.0));
        let (position, size) =
            clamped_placement(-1_900.0, 1_075.0, 1.0, -1_920.0, 0.0, 1_920.0, 1_080.0);
        assert_eq!(position, PhysicalPosition::new(-1_912, 722));
        assert_eq!(size, LogicalSize::new(360.0, 350.0));
    }
    #[test]
    fn shrinks_popup_to_a_small_work_area() {
        let (position, size) = clamped_placement(600.0, 500.0, 2.0, 0.0, 0.0, 400.0, 300.0);
        assert_eq!(position, PhysicalPosition::new(16, 16));
        assert_eq!(size, LogicalSize::new(184.0, 134.0));
    }
    #[test]
    fn reopening_finds_only_its_own_workspace_panel() {
        let mut entries = HashMap::new();
        entries.insert(
            "access-panel-a".into(),
            Panel {
                owner: "main".into(),
                owner_window: "main".into(),
                snapshot: json!({}),
                open_id: "test".into(),
                revision: 1,
                requested: true,
                shown: false,
                focused: false,
            },
        );
        assert_eq!(owned_label(&entries, "main"), Some("access-panel-a".into()));
        assert_eq!(owned_label(&entries, "window-2"), None);
    }
    #[test]
    fn panel_navigation_cannot_escape_its_entrypoint() {
        let url = Url::parse("tauri://localhost/index.html?accessPanel=1").unwrap();
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html?accessPanel=1#state").unwrap(),
            &url
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &url
        ));
        assert!(!allowed_url(
            &Url::parse("https://example.com/index.html?accessPanel=1").unwrap(),
            &url
        ));
    }
    #[test]
    fn readiness_only_shows_the_current_opening_and_never_refocuses_updates() {
        let mut panel = Panel {
            owner: "main".into(),
            owner_window: "main".into(),
            snapshot: json!({}),
            open_id: "new".into(),
            revision: 2,
            requested: true,
            shown: false,
            focused: false,
        };
        assert!(!panel.active("old"));
        assert!(!panel.accept_ready("old", 2));
        assert!(!panel.accept_ready("new", 1));
        assert!(panel.accept_ready("new", 2));
        panel.revision = 3;
        assert!(!panel.accept_ready("new", 3));
        panel.requested = false;
        panel.shown = false;
        assert!(!panel.active("new"));
        assert!(!panel.accept_ready("new", 3));
        panel.open_id = "replacement".into();
        panel.requested = true;
        assert!(!panel.accept_ready("new", 3));
        assert!(panel.accept_ready("replacement", 3));
    }
}
