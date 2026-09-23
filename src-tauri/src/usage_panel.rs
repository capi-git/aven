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
    open_id: String,
    revision: u64,
    requested: bool,
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
    let app = caller.app_handle().clone();
    on_main(&app, move || open_panel(caller, anchor, snapshot)).await
}

fn open_panel(
    caller: Webview,
    anchor: UsagePanelAnchor,
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
        .join("index.html?usagePanel=1")
        .map_err(|error| error.to_string())?;
    let label = format!("usage-panel-{}", uuid::Uuid::new_v4());
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
        dismiss(app, &label, true, None);
        return Err(error);
    }
    Ok(open_id)
}

#[tauri::command]
pub async fn usage_panel_update(
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
pub async fn usage_panel_get_state(caller: Webview) -> Result<Value, String> {
    with_panels(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(Panel::display_state)
            .ok_or("This usage panel is closed".into())
    })
}

#[tauri::command]
pub async fn usage_panel_ready(
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
pub async fn usage_panel_action(
    caller: Webview,
    action: String,
    open_id: String,
) -> Result<(), String> {
    if !matches!(action.as_str(), "refresh" | "close") {
        return Err("Unknown usage action".into());
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
        if action == "refresh" {
            app.emit_to(
                EventTarget::webview(owner),
                ACTION_EVENT,
                json!({ "action": action, "label": open_id }),
            )
            .map_err(|error| error.to_string())?;
            return Ok(());
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
pub async fn usage_panel_close(caller: Webview, open_id: String) -> Result<(), String> {
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
