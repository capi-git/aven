//! The Aven bubble: a small owned window floating over the visible browser
//! page, so the page stays live around it. The workspace decides where it sits
//! and what it shows; the bubble can only ask its owner to send, stop or open
//! the chat it displays.
use crate::display_rate::FullRefreshRate;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    window::{Color, WindowBuilder},
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, PhysicalPosition, Url,
    Webview, WebviewBuilder, WebviewUrl, Window, WindowEvent,
};

const STATE_EVENT: &str = "browser-orb-state";
const ACTION_EVENT: &str = "browser-orb-action";
const LABEL_PREFIX: &str = "browser-orb-";
const ENTRY: &str = "index.html?browserOrb=1";
/// Room for the closed bubble and its shadow.
const CLOSED_SIZE: (f64, f64) = (60.0, 60.0);
const MAX_SIZE: (f64, f64) = (720.0, 640.0);
/// Space between the bubble and the bottom of the page.
const BOTTOM_GAP: f64 = 12.0;
const SIDE_MARGIN: f64 = 8.0;
const MAX_TEXT: usize = 20_000;

#[derive(Default)]
pub struct BrowserOrbState(Mutex<HashMap<String, Orb>>);

struct Orb {
    owner: String,
    owner_window: String,
    anchor: Anchor,
    snapshot: Value,
    size: (f64, f64),
    revision: u64,
    /// The owner wants it on screen; false while no page is visible.
    wanted: bool,
    /// The renderer has painted the current state at least once.
    ready: bool,
    /// The pill is open and holds keyboard focus.
    focused: bool,
}

/// The visible page's rectangle in the owner's CSS pixels.
#[derive(Clone, Copy, Deserialize, PartialEq)]
pub struct Anchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}

impl Anchor {
    fn validate(self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height, self.dpr]
            .into_iter()
            .all(f64::is_finite)
            || self.width < 80.0
            || self.height < 80.0
            || !(0.1..=16.0).contains(&self.dpr)
        {
            return Err("Invalid bubble position".into());
        }
        Ok(())
    }
}

fn with_orbs<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut HashMap<String, Orb>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<BrowserOrbState>();
    let mut entries = state.0.lock().map_err(|_| "Bubble state is unavailable")?;
    action(&mut entries)
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    if !snapshot.is_object() || snapshot.to_string().len() > 64_000 {
        return Err("Invalid bubble display data".into());
    }
    Ok(())
}

fn owned_label(entries: &HashMap<String, Orb>, owner: &str) -> Option<String> {
    entries
        .iter()
        .find_map(|(label, orb)| (orb.owner == owner).then(|| label.clone()))
}

fn bubble_label(caller: &Webview) -> Result<String, String> {
    let label = caller.label();
    if !label.starts_with(LABEL_PREFIX) {
        return Err("Only the bubble can do this".into());
    }
    Ok(label.to_string())
}

fn display_state(orb: &Orb) -> Value {
    json!({ "snapshot": orb.snapshot, "revision": orb.revision })
}

fn clamp_size(width: f64, height: f64) -> Result<(f64, f64), String> {
    if !width.is_finite() || !height.is_finite() {
        return Err("Invalid bubble size".into());
    }
    Ok((
        width.clamp(CLOSED_SIZE.0, MAX_SIZE.0),
        height.clamp(CLOSED_SIZE.1, MAX_SIZE.1),
    ))
}

/// Centre the bubble at the bottom of the page and keep it inside the page.
/// Physical position from the owner's inner origin; size in logical points.
fn place(
    origin: PhysicalPosition<i32>,
    scale: f64,
    anchor: Anchor,
    size: (f64, f64),
) -> (PhysicalPosition<i32>, LogicalSize<f64>) {
    let page_left = f64::from(origin.x) + anchor.x * anchor.dpr;
    let page_top = f64::from(origin.y) + anchor.y * anchor.dpr;
    let page_width = anchor.width * anchor.dpr;
    let page_height = anchor.height * anchor.dpr;
    let margin = SIDE_MARGIN * scale;
    // Never wider or taller than the page it floats over.
    let width = (size.0 * scale).min((page_width - 2.0 * margin).max(CLOSED_SIZE.0 * scale));
    let height = (size.1 * scale).min((page_height - margin).max(CLOSED_SIZE.1 * scale));
    let centred = page_left + (page_width - width) / 2.0;
    let x = centred.clamp(
        page_left + margin,
        (page_left + page_width - width - margin).max(page_left + margin),
    );
    let y = (page_top + page_height - BOTTOM_GAP * scale - height).max(page_top);
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    )
}

fn placement(
    owner: &Window,
    anchor: Anchor,
    size: (f64, f64),
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    let scale = owner.scale_factor().map_err(|error| error.to_string())?;
    Ok(place(origin, scale, anchor, size))
}

fn apply_placement(app: &AppHandle, label: &str) -> Result<(), String> {
    let target = with_orbs(app, |entries| {
        Ok(entries
            .get(label)
            .map(|orb| (orb.owner_window.clone(), orb.anchor, orb.size)))
    })?;
    let Some((owner_window, anchor, size)) = target else {
        return Ok(());
    };
    let (Some(owner), Some(window)) = (app.get_window(&owner_window), app.get_window(label)) else {
        return Ok(());
    };
    let (position, size) = placement(&owner, anchor, size)?;
    window
        .set_size(size)
        .and_then(|()| window.set_position(position))
        .map_err(|error| error.to_string())?;
    // The page always fills the window exactly. Tauri's proportional
    // auto-resize would scale it again on top of this, leaving the page ten
    // times too wide after the pill opens.
    if let Some(webview) = app.get_webview(label) {
        let _ = webview.set_position(LogicalPosition::new(0.0, 0.0));
        let _ = webview.set_size(size);
    }
    Ok(())
}

/// Show the bubble without taking keyboard focus from the page or chat.
fn show_quietly(window: &Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWindow;
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: Tauri returns this window's live NSWindow, and this runs on
        // the main thread (every caller goes through `on_main`).
        let ns_window = unsafe { &*(pointer as *const NSWindow) };
        ns_window.orderFront(None);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show().map_err(|error| error.to_string())
    }
}

fn hide(app: &AppHandle, label: &str) {
    let refocus = with_orbs(app, |entries| {
        Ok(entries.get_mut(label).map(|orb| {
            let refocus = orb.focused.then(|| orb.owner_window.clone());
            orb.wanted = false;
            orb.focused = false;
            refocus
        }))
    })
    .ok()
    .flatten()
    .flatten();
    if let Some(window) = app.get_window(label) {
        let _ = window.hide();
    }
    if let Some(owner) = refocus.and_then(|owner| app.get_window(&owner)) {
        let _ = owner.set_focus();
    }
}

fn destroy(app: &AppHandle, label: &str) {
    let _ = with_orbs(app, |entries| Ok(entries.remove(label)));
    if let Some(window) = app.get_window(label) {
        let _ = window.destroy();
    }
}

fn allowed_url(url: &Url, expected: &Url) -> bool {
    let mut url = url.clone();
    url.set_fragment(None);
    url == *expected
}

/// Place, update or hide the owner's bubble. `None` hides it.
#[tauri::command]
pub async fn browser_orb_set(
    caller: Webview,
    anchor: Option<Anchor>,
    snapshot: Value,
) -> Result<(), String> {
    crate::browser::label(&caller, "browser-orb")?;
    if let Some(anchor) = anchor {
        anchor.validate()?;
    }
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle().clone();
    crate::usage_panel::on_main(&app, move || set_orb(caller, anchor, snapshot)).await
}

fn set_orb(caller: Webview, anchor: Option<Anchor>, snapshot: Value) -> Result<(), String> {
    let app = caller.app_handle();
    let owner = caller.window();
    if app.get_window(owner.label()).is_none() {
        return Err("The owning workspace closed".into());
    }
    let existing = with_orbs(app, |entries| Ok(owned_label(entries, caller.label())))?;
    let Some(anchor) = anchor else {
        if let Some(label) = existing {
            hide(app, &label);
        }
        return Ok(());
    };
    if let Some(label) = existing
        .clone()
        .filter(|label| app.get_window(label).is_some())
    {
        let (state, show, moved) = with_orbs(app, |entries| {
            let orb = entries.get_mut(&label).ok_or("Bubble closed")?;
            let changed = orb.snapshot != snapshot;
            if changed {
                orb.snapshot = snapshot;
                orb.revision += 1;
            }
            let moved = orb.anchor != anchor || !orb.wanted;
            orb.anchor = anchor;
            let show = !orb.wanted && orb.ready;
            orb.wanted = true;
            Ok((changed.then(|| display_state(orb)), show, moved))
        })?;
        // Content updates arrive with every streamed word; only move the
        // window when the page itself moved, or it jitters.
        if moved {
            apply_placement(app, &label)?;
        }
        if let Some(state) = state {
            app.emit_to(EventTarget::webview(&label), STATE_EVENT, state)
                .map_err(|error| error.to_string())?;
        }
        if show {
            if let Some(window) = app.get_window(&label) {
                show_quietly(&window)?;
            }
        }
        return Ok(());
    }
    if let Some(label) = existing {
        destroy(app, &label);
    }
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join(ENTRY)
        .map_err(|error| error.to_string())?;
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4());
    let (position, size) = placement(&owner, anchor, CLOSED_SIZE)?;
    with_orbs(app, |entries| {
        entries.insert(
            label.clone(),
            Orb {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                anchor,
                snapshot,
                size: CLOSED_SIZE,
                revision: 1,
                wanted: true,
                ready: false,
                focused: false,
            },
        );
        Ok(())
    })?;
    let build = (|| {
        let window = WindowBuilder::new(app, &label)
            .title("Aven")
            .inner_size(size.width, size.height)
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            // The bubble draws its own soft shadow; a window shadow would box it.
            .shadow(false)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .parent(&owner)
            .map_err(|error| error.to_string())?
            .build()
            .map_err(|error| error.to_string())?;
        window
            .set_position(position)
            .map_err(|error| error.to_string())?;
        let child = WebviewBuilder::new(&label, WebviewUrl::App(ENTRY.into()))
            .full_refresh_rate(app)
            .focused(false)
            .accept_first_mouse(true)
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
        destroy(app, &label);
        return Err(error);
    }
    Ok(())
}

/// The owner is going away or turned the bubble off.
#[tauri::command]
pub async fn browser_orb_close(caller: Webview) -> Result<(), String> {
    crate::browser::label(&caller, "browser-orb")?;
    let app = caller.app_handle().clone();
    crate::usage_panel::on_main(&app, move || {
        let app = caller.app_handle();
        if let Some(label) = with_orbs(app, |entries| Ok(owned_label(entries, caller.label())))? {
            destroy(app, &label);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn browser_orb_get_state(caller: Webview) -> Result<Value, String> {
    let label = bubble_label(&caller)?;
    with_orbs(caller.app_handle(), |entries| {
        entries
            .get(&label)
            .map(display_state)
            .ok_or("This bubble is closed".into())
    })
}

/// The renderer painted; show it if the owner still wants it.
#[tauri::command]
pub async fn browser_orb_ready(caller: Webview) -> Result<(), String> {
    let label = bubble_label(&caller)?;
    let app = caller.app_handle().clone();
    crate::usage_panel::on_main(&app, move || {
        let app = caller.app_handle();
        let show = with_orbs(app, |entries| {
            Ok(entries.get_mut(&label).is_some_and(|orb| {
                orb.ready = true;
                orb.wanted
            }))
        })?;
        if show {
            apply_placement(app, &label)?;
            show_quietly(&caller.window())?;
        }
        Ok(())
    })
    .await
}

/// Resize to fit the bubble's content, growing upwards from the page bottom.
/// `focus` gives the open pill the keyboard; dropping it hands focus back.
#[tauri::command]
pub async fn browser_orb_layout(
    caller: Webview,
    width: f64,
    height: f64,
    focus: bool,
) -> Result<(), String> {
    let label = bubble_label(&caller)?;
    let size = clamp_size(width, height)?;
    let app = caller.app_handle().clone();
    crate::usage_panel::on_main(&app, move || {
        let app = caller.app_handle();
        let change = with_orbs(app, |entries| {
            Ok(entries.get_mut(&label).map(|orb| {
                let resized = orb.size != size;
                orb.size = size;
                let was = orb.focused;
                orb.focused = focus && orb.wanted;
                (was, orb.focused, orb.owner_window.clone(), resized)
            }))
        })?;
        let Some((was_focused, focused, owner_window, resized)) = change else {
            return Ok(());
        };
        if resized {
            apply_placement(app, &label)?;
        }
        if focused && !was_focused {
            let window = caller.window();
            window.set_focus().map_err(|error| error.to_string())?;
            let _ = caller.set_focus();
        } else if was_focused && !focused {
            if let Some(owner) = app.get_window(&owner_window) {
                let _ = owner.set_focus();
            }
        }
        Ok(())
    })
    .await
}

/// Ask the owner to act on the chat the bubble shows.
#[tauri::command]
pub async fn browser_orb_action(
    caller: Webview,
    action: String,
    text: Option<String>,
) -> Result<(), String> {
    let label = bubble_label(&caller)?;
    match action.as_str() {
        "submit" => {
            let text = text.as_deref().unwrap_or_default();
            if text.trim().is_empty() || text.len() > MAX_TEXT {
                return Err("Invalid message".into());
            }
        }
        "stop" | "openChat" | "dismiss" => {
            if text.is_some() {
                return Err("Invalid bubble action".into());
            }
        }
        _ => return Err("Unknown bubble action".into()),
    }
    let owner = with_orbs(caller.app_handle(), |entries| {
        Ok(entries
            .get(&label)
            .filter(|orb| orb.wanted)
            .map(|orb| (orb.owner.clone(), orb.revision)))
    })?;
    let Some((owner, revision)) = owner else {
        return Err("This bubble is closed".into());
    };
    caller
        .app_handle()
        .emit_to(
            EventTarget::webview(owner),
            ACTION_EVENT,
            json!({ "action": action, "text": text, "revision": revision }),
        )
        .map_err(|error| error.to_string())
}

/// Follow the owner when it moves or resizes, and go with it when it closes.
pub fn window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    if label.starts_with(LABEL_PREFIX) {
        if matches!(event, WindowEvent::Destroyed) {
            let _ = with_orbs(app, |entries| Ok(entries.remove(label)));
        }
        return;
    }
    let children = with_orbs(app, |entries| {
        Ok(entries
            .iter()
            .filter(|(_, orb)| orb.owner_window == label)
            .map(|(child, _)| child.clone())
            .collect::<Vec<_>>())
    })
    .unwrap_or_default();
    for child in children {
        match event {
            WindowEvent::Destroyed | WindowEvent::CloseRequested { .. } => destroy(app, &child),
            WindowEvent::Moved(_)
            | WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. } => {
                let _ = apply_placement(app, &child);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: Anchor = Anchor {
        x: 300.0,
        y: 100.0,
        width: 800.0,
        height: 600.0,
        dpr: 2.0,
    };

    #[test]
    fn rejects_bad_anchors_and_tiny_pages() {
        assert!(PAGE.validate().is_ok());
        assert!(Anchor {
            x: f64::NAN,
            ..PAGE
        }
        .validate()
        .is_err());
        assert!(Anchor { dpr: 0.0, ..PAGE }.validate().is_err());
        assert!(Anchor {
            width: 40.0,
            ..PAGE
        }
        .validate()
        .is_err());
    }

    #[test]
    fn sits_centred_at_the_bottom_of_the_page() {
        let (position, size) = place(PhysicalPosition::new(0, 0), 2.0, PAGE, (60.0, 60.0));
        assert_eq!((size.width, size.height), (60.0, 60.0));
        // Page spans x 600..2200 and y 200..1400 in physical pixels.
        assert_eq!(position.x, 600 + (1600 - 120) / 2);
        assert_eq!(position.y, 1400 - 24 - 120);
    }

    #[test]
    fn grows_upwards_and_never_leaves_the_page() {
        let narrow = Anchor {
            width: 500.0,
            ..PAGE
        };
        let (position, size) = place(PhysicalPosition::new(10, 20), 2.0, narrow, (720.0, 640.0));
        // Limited to the page, less its margins.
        assert_eq!(size.width, (1000.0 - 32.0) / 2.0);
        assert_eq!(size.height, (1200.0 - 16.0) / 2.0);
        assert!(position.x >= 10 + 600);
        assert!(position.y >= 20 + 200);
    }

    #[test]
    fn sizes_are_clamped() {
        assert_eq!(clamp_size(1.0, 1.0).unwrap(), CLOSED_SIZE);
        assert_eq!(clamp_size(9_000.0, 9_000.0).unwrap(), MAX_SIZE);
        assert!(clamp_size(f64::NAN, 10.0).is_err());
    }

    #[test]
    fn bubble_navigation_cannot_leave_its_entrypoint() {
        let expected = Url::parse("tauri://localhost/index.html?browserOrb=1").unwrap();
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html?browserOrb=1#x").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &expected
        ));
    }
}
