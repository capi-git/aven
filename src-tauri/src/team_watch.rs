//! A team's panel popped out of its workspace into a small window of its
//! own, which the user can move anywhere, even to another display.
//!
//! Unlike a detached workspace it owns nothing: no chats, no harnesses and
//! no project. Its page only draws the snapshots its owning workspace sends
//! (`team_watch_open` / `team_watch_update`) and sends each button press
//! back (`team_watch_action`). This module passes those actions only from a
//! pop-out to the page that opened it, after checking their shape; the
//! owner checks each one against the team before performing it, and
//! answers through `team_watch_reply`.
//!
//! - Closing the pop-out tells its owner, which shows the team as a pill
//!   again. A close the owner asked for is quiet.
//! - When the owning window is closed while its chats still run (macOS
//!   hides it), the pop-out says so and can bring it back. Actions that
//!   show something there bring it back too, so nothing lands unseen.
//! - When the owning window goes, the pop-out is told so and can only close.
//! - Its page may only show its own entry point and may not open windows.
//!
//! It is an ordinary top-level window rather than a child of the workspace
//! (see `native_popup`): a child window moves with its parent and cannot be
//! put on another display on its own.
use crate::display_rate::FullRefreshRate;
use crate::native_popup::on_main;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalSize, Manager, PhysicalPosition, Webview, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

const STATE_EVENT: &str = "team-watch-state";
const ACTION_EVENT: &str = "team-watch-action";
const CLOSED_EVENT: &str = "team-watch-closed";
const REPLY_EVENT: &str = "team-watch-reply";
/// Tells an owner when one of its pop-outs gains or loses focus.
const FOCUS_EVENT: &str = "team-watch-focus";
/// Tells an owner its pop-out drew and is on screen, so it need not take
/// the team back.
const SHOWN_EVENT: &str = "team-watch-shown";
const ENTRY: &str = "index.html?teamWatch=1";
const LABEL_PREFIX: &str = "team-watch-";

/// A long discussion's thread travels with its snapshot; this is far more
/// than one needs and far less than would strain the event bridge.
const MAX_SNAPSHOT_BYTES: usize = 1_500_000;
const MAX_ACTION_BYTES: usize = 8_000;
const MAX_REPLY_CHARS: usize = 2_000;
const MAX_TITLE_CHARS: usize = 160;

/// The window's size limits, in logical pixels.
const MIN_WIDTH: f64 = 320.0;
const MIN_HEIGHT: f64 = 360.0;
const MAX_WIDTH: f64 = 900.0;
const MAX_HEIGHT: f64 = 1_100.0;

/// What a pop-out may ask its owner to do. The owner checks each against
/// the team as well (`parseTeamWatchAction`). It must match the page's
/// `TEAM_WATCH_ACTION_KINDS`, which a test checks.
const ACTIONS: &[&str] = &[
    "stop",
    "resume",
    "finish",
    "compare",
    "suggest",
    "review",
    "open-agents",
    "open-chat",
    "jump-in",
    "build",
    "summarise",
    "watch",
];

/// Actions that show something in the owning window, which then comes
/// forward.
const SHOWS_OWNER: &[&str] = &["watch", "open-chat", "open-agents", "compare", "build"];

#[derive(Default)]
pub struct TeamWatchState(Mutex<HashMap<String, PopOut>>);

#[derive(Debug, Clone, PartialEq)]
struct PopOut {
    /// The webview that opened it and performs its actions.
    owner: String,
    owner_window: String,
    team: String,
    snapshot: Value,
    revision: u64,
    /// The owning window closed; nothing here can act any more.
    owner_closed: bool,
    /// The owning window was closed while its chats run, so it is hidden.
    owner_hidden: bool,
    /// Shown once its page drew; later snapshots never take focus.
    shown: bool,
    /// Its owner closed it: no need to tell the owner.
    quiet: bool,
}

impl PopOut {
    fn display_state(&self) -> Value {
        json!({
            "team": self.team,
            "snapshot": self.snapshot,
            "revision": self.revision,
            "ownerClosed": self.owner_closed,
            "ownerHidden": self.owner_hidden && !self.owner_closed,
        })
    }

    /// The first frame of the current page shows the window; later ones
    /// (and stale ones) do not.
    fn accept_ready(&mut self, revision: u64) -> bool {
        if self.shown || revision > self.revision {
            return false;
        }
        self.shown = true;
        true
    }
}

/// Where the panel sat in its workspace, in that page's CSS pixels.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct TeamWatchPlace {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dpr: f64,
}

impl TeamWatchPlace {
    fn validate(self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height, self.dpr]
            .into_iter()
            .all(f64::is_finite)
            || self.width <= 0.0
            || self.height <= 0.0
            || !(0.1..=16.0).contains(&self.dpr)
        {
            return Err("Invalid team panel position".into());
        }
        Ok(())
    }
}

fn with_state<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut HashMap<String, PopOut>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<TeamWatchState>();
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "Team panel state is unavailable")?;
    action(&mut entries)
}

/// Whether `label` is a popped-out team panel.
pub fn is_team_watch_label(label: &str) -> bool {
    label
        .strip_prefix(LABEL_PREFIX)
        .is_some_and(|rest| !rest.is_empty())
}

/// `discuss:<id>`, `race:<id>` or `orchestrate:<lead>`.
fn valid_team_id(team: &str) -> bool {
    let Some((kind, key)) = team.split_once(':') else {
        return false;
    };
    matches!(kind, "discuss" | "race" | "orchestrate")
        && !key.is_empty()
        && key.len() <= 200
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    let view = &snapshot["view"];
    if !snapshot.is_object()
        || !(view.is_object() || view.is_null())
        || !snapshot["theme"].is_object()
        || snapshot.to_string().len() > MAX_SNAPSHOT_BYTES
    {
        return Err("Invalid team panel data".into());
    }
    Ok(())
}

/// An action's kind, when it is one a pop-out may send.
fn validate_action(action: &Value) -> Result<&str, String> {
    let kind = action["kind"].as_str().unwrap_or_default();
    if !action.is_object()
        || !ACTIONS.contains(&kind)
        || action.to_string().len() > MAX_ACTION_BYTES
    {
        return Err("Unknown team panel action".into());
    }
    Ok(kind)
}

/// The window's title: one line, without control characters.
fn clean_title(title: &str) -> String {
    let line: String = title
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TITLE_CHARS)
        .collect();
    let line = line.trim();
    if line.is_empty() {
        "Team".into()
    } else {
        line.into()
    }
}

/// Only a workspace page opens pop-outs and acts for them.
fn validate_owner(caller: &Webview) -> Result<(), String> {
    if !crate::window::is_workspace_label(caller.label()) {
        return Err("Only a workspace can show a team in its own window".into());
    }
    Ok(())
}

fn owned_label(entries: &HashMap<String, PopOut>, owner: &str, team: &str) -> Option<String> {
    entries
        .iter()
        .find_map(|(label, pop)| (pop.owner == owner && pop.team == team).then(|| label.clone()))
}

/// Where the window opens: over the panel it came from, in physical pixels,
/// its size in logical ones, kept on that display's work area.
fn placement(
    origin: (f64, f64),
    place: TeamWatchPlace,
    work: ((f64, f64), (f64, f64)),
    scale: f64,
) -> (PhysicalPosition<i32>, LogicalSize<f64>) {
    let ((left, top), (work_width, work_height)) = work;
    let margin = 8.0 * scale;
    let available_width = (work_width - 2.0 * margin).max(scale);
    let available_height = (work_height - 2.0 * margin).max(scale);
    let width = (place.width.clamp(MIN_WIDTH, MAX_WIDTH) * scale).min(available_width);
    let height = (place.height.clamp(MIN_HEIGHT, MAX_HEIGHT) * scale).min(available_height);
    let x = (origin.0 + place.x * place.dpr)
        .clamp(left + margin, left + margin + available_width - width);
    let y = (origin.1 + place.y * place.dpr)
        .clamp(top + margin, top + margin + available_height - height);
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        LogicalSize::new(width / scale, height / scale),
    )
}

fn place_window(
    caller: &Webview,
    place: TeamWatchPlace,
) -> Result<(PhysicalPosition<i32>, LogicalSize<f64>), String> {
    let owner = caller.window();
    let origin = owner.inner_position().map_err(|error| error.to_string())?;
    let x = f64::from(origin.x) + place.x * place.dpr;
    let y = f64::from(origin.y) + place.y * place.dpr;
    let monitor = owner
        .monitor_from_point(x, y)
        .map_err(|error| error.to_string())?
        .or(owner.current_monitor().map_err(|error| error.to_string())?)
        .ok_or("The display for the team panel is unavailable")?;
    let work = monitor.work_area();
    Ok(placement(
        (f64::from(origin.x), f64::from(origin.y)),
        place,
        (
            (f64::from(work.position.x), f64::from(work.position.y)),
            (f64::from(work.size.width), f64::from(work.size.height)),
        ),
        monitor.scale_factor(),
    ))
}

/// Close a pop-out its owner no longer shows, without telling that owner.
fn close_quietly(app: &AppHandle, label: &str) {
    let _ = with_state(app, |entries| {
        if let Some(pop) = entries.get_mut(label) {
            pop.quiet = true;
        }
        Ok(())
    });
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    } else {
        let _ = with_state(app, |entries| Ok(entries.remove(label)));
    }
}

#[tauri::command]
pub async fn team_watch_open(
    caller: Webview,
    team: String,
    title: String,
    snapshot: Value,
    at: TeamWatchPlace,
) -> Result<(), String> {
    validate_owner(&caller)?;
    if !valid_team_id(&team) {
        return Err("Invalid team".into());
    }
    at.validate()?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        open_window(caller, team, clean_title(&title), snapshot, at)
    })
    .await
}

fn open_window(
    caller: Webview,
    team: String,
    title: String,
    snapshot: Value,
    at: TeamWatchPlace,
) -> Result<(), String> {
    let app = caller.app_handle();
    let owner = caller.window();
    if app.get_window(owner.label()).is_none() || app.get_webview(caller.label()).is_none() {
        return Err("The owning workspace closed".into());
    }
    // Already out: show what is current and bring it forward.
    if let Some(label) = with_state(app, |entries| {
        Ok(owned_label(entries, caller.label(), &team))
    })? {
        if let Some(window) = app.get_webview_window(&label) {
            let state = with_state(app, |entries| {
                let pop = entries.get_mut(&label).ok_or("The team panel closed")?;
                if pop.snapshot != snapshot {
                    pop.snapshot = snapshot;
                    pop.revision += 1;
                }
                Ok(pop.display_state())
            })?;
            let _ = app.emit_to(EventTarget::webview(&label), STATE_EVENT, state);
            let _ = window.unminimize();
            window.show().map_err(|error| error.to_string())?;
            return window.set_focus().map_err(|error| error.to_string());
        }
        with_state(app, |entries| Ok(entries.remove(&label)))?;
    }
    let (position, size) = place_window(&caller, at)?;
    let expected = caller
        .url()
        .map_err(|error| error.to_string())?
        .join(ENTRY)
        .map_err(|error| error.to_string())?;
    let label = format!("{LABEL_PREFIX}{}", uuid::Uuid::new_v4());
    with_state(app, |entries| {
        entries.insert(
            label.clone(),
            PopOut {
                owner: caller.label().into(),
                owner_window: owner.label().into(),
                team,
                snapshot,
                revision: 1,
                owner_closed: false,
                owner_hidden: !owner.is_visible().unwrap_or(true),
                shown: false,
                quiet: false,
            },
        );
        Ok(())
    })?;
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(ENTRY.into()))
        .title(&title)
        .inner_size(size.width, size.height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .visible(false)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url| crate::native_popup::allowed_url(url, &expected))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    // Its header is its title bar, beside the traffic lights.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let built = builder
        .full_refresh_rate(app)
        .build()
        .map_err(|error| error.to_string())
        .and_then(|window| {
            window
                .set_position(position)
                .map_err(|error| error.to_string())
        });
    if let Err(error) = built {
        close_quietly(app, &label);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn team_watch_update(
    caller: Webview,
    team: String,
    snapshot: Value,
) -> Result<(), String> {
    validate_owner(&caller)?;
    validate_snapshot(&snapshot)?;
    let app = caller.app_handle();
    let update = with_state(app, |entries| {
        let Some(label) = owned_label(entries, caller.label(), &team) else {
            return Ok(None);
        };
        let pop = entries.get_mut(&label).ok_or("The team panel closed")?;
        if pop.snapshot == snapshot {
            return Ok(None);
        }
        pop.snapshot = snapshot;
        pop.revision += 1;
        Ok(Some((label, pop.display_state())))
    })?;
    if let Some((label, state)) = update {
        app.emit_to(EventTarget::webview(label), STATE_EVENT, state)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The owner closes a pop-out (the team came back, or went).
#[tauri::command]
pub async fn team_watch_close(caller: Webview, team: String) -> Result<(), String> {
    validate_owner(&caller)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        if let Some(label) = with_state(app, |entries| {
            Ok(owned_label(entries, caller.label(), &team))
        })? {
            close_quietly(app, &label);
        }
        Ok(())
    })
    .await
}

/// A reloaded owner closes the pop-outs its earlier page left open.
#[tauri::command]
pub async fn team_watch_reset(caller: Webview) -> Result<(), String> {
    validate_owner(&caller)?;
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let labels = with_state(app, |entries| {
            Ok(entries
                .iter()
                .filter(|(_, pop)| pop.owner == caller.label())
                .map(|(label, _)| label.clone())
                .collect::<Vec<_>>())
        })?;
        for label in labels {
            close_quietly(app, &label);
        }
        Ok(())
    })
    .await
}

/// The owner answers one of its pop-out's actions: an error, or nothing.
#[tauri::command]
pub async fn team_watch_reply(
    caller: Webview,
    team: String,
    request_id: String,
    error: Option<String>,
) -> Result<(), String> {
    validate_owner(&caller)?;
    if !valid_request_id(&request_id) {
        return Err("Invalid request".into());
    }
    let app = caller.app_handle();
    let Some(label) = with_state(app, |entries| {
        Ok(owned_label(entries, caller.label(), &team))
    })?
    else {
        return Ok(());
    };
    let error: Option<String> = error.map(|text| text.chars().take(MAX_REPLY_CHARS).collect());
    app.emit_to(
        EventTarget::webview(label),
        REPLY_EVENT,
        json!({ "requestId": request_id, "error": error }),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn team_watch_get_state(caller: Webview) -> Result<Value, String> {
    with_state(caller.app_handle(), |entries| {
        entries
            .get(caller.label())
            .map(PopOut::display_state)
            .ok_or("This team panel is closed".into())
    })
}

/// The pop-out drew its first frame: show it, in front.
#[tauri::command]
pub async fn team_watch_ready(caller: Webview, revision: u64) -> Result<(), String> {
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let Some((owner, payload)) = with_state(app, |entries| {
            Ok(shown_notice(entries, caller.label(), revision))
        })?
        else {
            return Ok(());
        };
        let window = caller.window();
        window.show().map_err(|error| error.to_string())?;
        let _ = app.emit_to(EventTarget::webview(&owner), SHOWN_EVENT, payload);
        window.set_focus().map_err(|error| error.to_string())
    })
    .await
}

/// A press in the pop-out, passed to the page that owns its team.
#[tauri::command]
pub async fn team_watch_action(
    caller: Webview,
    request_id: String,
    action: Value,
) -> Result<(), String> {
    if !valid_request_id(&request_id) {
        return Err("Invalid request".into());
    }
    let kind = validate_action(&action)?.to_string();
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let target = with_state(app, |entries| {
            Ok(entries.get(caller.label()).map(|pop| {
                (
                    pop.owner.clone(),
                    pop.owner_window.clone(),
                    pop.team.clone(),
                    pop.owner_closed,
                )
            }))
        })?;
        let Some((owner, owner_window, team, owner_closed)) = target else {
            return Err("This team panel is closed".into());
        };
        if owner_closed || app.get_webview(&owner).is_none() {
            return Err("This team's window was closed.".into());
        }
        app.emit_to(
            EventTarget::webview(owner),
            ACTION_EVENT,
            json!({ "team": team, "requestId": request_id, "action": action }),
        )
        .map_err(|error| error.to_string())?;
        if SHOWS_OWNER.contains(&kind.as_str()) {
            show_owner_window(app, &owner_window);
        }
        Ok(())
    })
    .await
}

/// Bring the owning window back and forward, even when it was closed
/// while its chats run (hidden), so what an action shows there is seen.
fn show_owner_window(app: &AppHandle, owner_window: &str) {
    let Some(window) = app.get_window(owner_window) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    owner_visibility(app, owner_window, false);
}

/// "Show it" in a pop-out whose owning window was closed while its team
/// still runs there.
#[tauri::command]
pub async fn team_watch_show_owner(caller: Webview) -> Result<(), String> {
    if !is_team_watch_label(caller.label()) {
        return Err("Only a team panel can show its window".into());
    }
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        let app = caller.app_handle();
        let owner = with_state(app, |entries| {
            Ok(entries
                .get(caller.label())
                .map(|pop| (pop.owner_window.clone(), pop.owner_closed)))
        })?;
        match owner {
            None => Err("This team panel is closed".into()),
            Some((_, true)) => Err("This team's window was closed.".into()),
            Some((window, false)) => {
                show_owner_window(app, &window);
                Ok(())
            }
        }
    })
    .await
}

/// The owning window was hidden by a close while its chats run, or shown
/// again: its pop-outs say so, or stop saying so.
pub fn owner_visibility(app: &AppHandle, owner_window: &str, hidden: bool) {
    let changed = with_state(app, |entries| {
        Ok(set_owner_hidden(entries, owner_window, hidden))
    })
    .unwrap_or_default();
    for (label, state) in changed {
        let _ = app.emit_to(EventTarget::webview(label), STATE_EVENT, state);
    }
}

/// Marks `owner_window`'s pop-outs hidden or shown, returning each one that
/// changed with the state its page should now show.
fn set_owner_hidden(
    entries: &mut HashMap<String, PopOut>,
    owner_window: &str,
    hidden: bool,
) -> Vec<(String, Value)> {
    entries
        .iter_mut()
        .filter(|(_, pop)| {
            pop.owner_window == owner_window && !pop.owner_closed && pop.owner_hidden != hidden
        })
        .map(|(label, pop)| {
            pop.owner_hidden = hidden;
            pop.revision += 1;
            (label.clone(), pop.display_state())
        })
        .collect()
}

/// The pop-out closes itself; its owner shows the team as a pill again.
#[tauri::command]
pub async fn team_watch_dismiss(caller: Webview) -> Result<(), String> {
    if !is_team_watch_label(caller.label()) {
        return Err("Only a team panel can close itself".into());
    }
    let app = caller.app_handle().clone();
    on_main(&app, move || {
        caller.window().destroy().map_err(|error| error.to_string())
    })
    .await
}

/// ⌘W in a focused pop-out closes it rather than a pane in the workspace.
pub fn close_focused(app: &AppHandle) -> bool {
    let Some(window) = app
        .webview_windows()
        .into_values()
        .find(|window| is_team_watch_label(window.label()) && window.is_focused().unwrap_or(false))
    else {
        return false;
    };
    let _ = window.destroy();
    true
}

/// What follows a window going: a pop-out that closed tells its owner, and
/// an owner that closed tells its pop-outs.
pub fn window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    // However a hidden owner comes back (the Dock, a menu, an action), it
    // is focused once it is on screen again.
    if matches!(event, WindowEvent::Focused(true)) && !is_team_watch_label(label) {
        owner_visibility(app, label, false);
        return;
    }
    // A focused pop-out shows its team's chats, so its owner counts them as
    // on screen rather than its own window's focus.
    if let WindowEvent::Focused(focused) = event {
        let notice = with_state(app, |entries| Ok(focus_notice(entries, label, *focused)))
            .ok()
            .flatten();
        if let Some((owner, payload)) = notice {
            let _ = app.emit_to(EventTarget::webview(owner), FOCUS_EVENT, payload);
        }
        return;
    }
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    if is_team_watch_label(label) {
        let closed = with_state(app, |entries| Ok(entries.remove(label)))
            .ok()
            .flatten();
        if let Some(pop) = closed {
            if !pop.quiet && !pop.owner_closed && app.get_webview(&pop.owner).is_some() {
                let _ = app.emit_to(
                    EventTarget::webview(pop.owner),
                    CLOSED_EVENT,
                    json!({ "team": pop.team }),
                );
            }
        }
        return;
    }
    let orphans = with_state(app, |entries| Ok(owner_closed(entries, label))).unwrap_or_default();
    for (child, state) in orphans {
        let _ = app.emit_to(EventTarget::webview(child), STATE_EVENT, state);
    }
}

/// The owner to tell, and what, when the pop-out `label` gains or loses
/// focus; nothing for an orphaned pop-out or any other window.
/// A pop-out's first drawn frame: marks it shown and returns its owner and
/// what to tell it, or nothing for a later or stale frame.
fn shown_notice(
    entries: &mut HashMap<String, PopOut>,
    label: &str,
    revision: u64,
) -> Option<(String, Value)> {
    let pop = entries.get_mut(label)?;
    if !pop.accept_ready(revision) {
        return None;
    }
    Some((pop.owner.clone(), json!({ "team": pop.team })))
}

fn focus_notice(
    entries: &HashMap<String, PopOut>,
    label: &str,
    focused: bool,
) -> Option<(String, Value)> {
    let pop = entries.get(label).filter(|pop| !pop.owner_closed)?;
    Some((
        pop.owner.clone(),
        json!({ "team": pop.team, "focused": focused }),
    ))
}

/// Marks every pop-out of `owner_window` as orphaned, returning each with
/// the state its page should now show.
fn owner_closed(entries: &mut HashMap<String, PopOut>, owner_window: &str) -> Vec<(String, Value)> {
    entries
        .iter_mut()
        .filter(|(_, pop)| pop.owner_window == owner_window && !pop.owner_closed)
        .map(|(label, pop)| {
            pop.owner_closed = true;
            pop.revision += 1;
            (label.clone(), pop.display_state())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_popup::allowed_url;
    use tauri::Url;

    fn pop(owner: &str, team: &str) -> PopOut {
        PopOut {
            owner: owner.into(),
            owner_window: owner.into(),
            team: team.into(),
            snapshot: json!({ "view": null, "theme": {} }),
            revision: 1,
            owner_closed: false,
            owner_hidden: false,
            shown: false,
            quiet: false,
        }
    }

    #[test]
    fn tells_the_owner_once_its_pop_out_is_shown() {
        let mut entries = HashMap::from([("team-watch-1".into(), pop("main", "race:r1"))]);
        // A page that failed to load reports the oldest revision; it still shows.
        assert_eq!(
            shown_notice(&mut entries, "team-watch-1", 0),
            Some(("main".into(), json!({ "team": "race:r1" })))
        );
        assert_eq!(shown_notice(&mut entries, "team-watch-1", 1), None);
        assert_eq!(shown_notice(&mut entries, "team-watch-2", 1), None);
        let mut newer = HashMap::from([("team-watch-3".into(), pop("main", "race:r2"))]);
        assert_eq!(shown_notice(&mut newer, "team-watch-3", 2), None);
    }

    #[test]
    fn names_only_its_own_windows() {
        assert!(is_team_watch_label("team-watch-1234"));
        assert!(!is_team_watch_label("team-watch-"));
        assert!(!is_team_watch_label("main"));
        assert!(!is_team_watch_label("usage-panel-1"));
        // Never mistaken for a workspace, so it is never asked to save,
        // restored, or counted as a window holding chats.
        assert!(!crate::window::is_workspace_label("team-watch-1234"));
    }

    #[test]
    fn accepts_only_team_ids_of_the_three_kinds() {
        assert!(valid_team_id("discuss:0f3a-91"));
        assert!(valid_team_id("race:r_1.2"));
        assert!(valid_team_id("orchestrate:lead-7"));
        assert!(!valid_team_id("discuss:"));
        assert!(!valid_team_id("chat:abc"));
        assert!(!valid_team_id("race:a/b"));
        assert!(!valid_team_id("race:<script>"));
        assert!(!valid_team_id(&format!("race:{}", "a".repeat(201))));
    }

    #[test]
    fn accepts_only_bounded_snapshots() {
        assert!(validate_snapshot(&json!({ "view": null, "theme": {} })).is_ok());
        assert!(
            validate_snapshot(&json!({ "view": { "team": {} }, "theme": { "mode": "dark" } }))
                .is_ok()
        );
        assert!(validate_snapshot(&json!("text")).is_err());
        assert!(validate_snapshot(&json!({ "view": 3, "theme": {} })).is_err());
        assert!(validate_snapshot(&json!({ "view": null })).is_err());
        assert!(validate_snapshot(&json!({
            "view": { "text": "x".repeat(MAX_SNAPSHOT_BYTES) },
            "theme": {}
        }))
        .is_err());
    }

    #[test]
    fn passes_on_only_known_actions_of_a_sane_size() {
        assert_eq!(validate_action(&json!({ "kind": "stop" })), Ok("stop"));
        assert_eq!(
            validate_action(&json!({ "kind": "jump-in", "text": "Also check the cache." })),
            Ok("jump-in")
        );
        assert!(validate_action(&json!({ "kind": "delete-project" })).is_err());
        assert!(validate_action(&json!({ "kind": 4 })).is_err());
        assert!(validate_action(&json!("stop")).is_err());
        assert!(validate_action(
            &json!({ "kind": "jump-in", "text": "x".repeat(MAX_ACTION_BYTES) })
        )
        .is_err());
        assert!(valid_request_id("lq2-14"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("a b"));
        assert!(!valid_request_id(&"a".repeat(81)));
        // Showing something in the owner brings the owner forward.
        assert!(SHOWS_OWNER.iter().all(|kind| ACTIONS.contains(kind)));
    }

    #[test]
    fn titles_are_one_clean_line() {
        assert_eq!(
            clean_title("Race · “Fix\nthe loop”"),
            "Race · “Fixthe loop”"
        );
        assert_eq!(clean_title("  "), "Team");
        assert_eq!(
            clean_title(&"a".repeat(400)).chars().count(),
            MAX_TITLE_CHARS
        );
    }

    #[test]
    fn rejects_invalid_places() {
        let place = TeamWatchPlace {
            x: 900.0,
            y: 200.0,
            width: 430.0,
            height: 590.0,
            dpr: 2.0,
        };
        assert!(place.validate().is_ok());
        assert!(TeamWatchPlace {
            x: f64::NAN,
            ..place
        }
        .validate()
        .is_err());
        assert!(TeamWatchPlace {
            width: 0.0,
            ..place
        }
        .validate()
        .is_err());
        assert!(TeamWatchPlace { dpr: 40.0, ..place }.validate().is_err());
    }

    #[test]
    fn opens_where_the_panel_sat_and_stays_on_its_display() {
        let place = TeamWatchPlace {
            x: 900.0,
            y: 200.0,
            width: 430.0,
            height: 590.0,
            dpr: 2.0,
        };
        let work = ((0.0, 50.0), (2880.0, 1700.0));
        let (position, size) = placement((100.0, 80.0), place, work, 2.0);
        assert_eq!(position, PhysicalPosition::new(1900, 480));
        assert_eq!(size, LogicalSize::new(430.0, 590.0));
        // Far off the right edge: pulled back onto the display.
        let (position, _) = placement((2500.0, 80.0), place, work, 2.0);
        assert_eq!(position.x, 2880 - 16 - 860);
        // Never smaller than its least size, nor taller than the display.
        let tiny = TeamWatchPlace {
            width: 10.0,
            height: 4000.0,
            ..place
        };
        let (_, size) = placement((0.0, 0.0), tiny, work, 2.0);
        assert_eq!(size.width, MIN_WIDTH);
        assert!(size.height * 2.0 <= 1700.0 - 32.0 + 0.001);
    }

    #[test]
    fn page_cannot_leave_its_entry_point() {
        let expected = Url::parse("tauri://localhost/index.html?teamWatch=1").unwrap();
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html?teamWatch=1#x").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://localhost/index.html?workspaceWindow=1").unwrap(),
            &expected
        ));
        assert!(!allowed_url(
            &Url::parse("https://example.com/index.html?teamWatch=1").unwrap(),
            &expected
        ));
    }

    #[test]
    fn shows_once_per_page_and_never_for_a_stale_frame() {
        let mut entry = pop("main", "race:r1");
        assert!(!entry.accept_ready(2));
        assert!(entry.accept_ready(1));
        assert!(!entry.accept_ready(1));
        entry.revision = 3;
        assert!(!entry.accept_ready(3));
    }

    #[test]
    fn finds_each_owners_pop_out_by_team() {
        let mut entries = HashMap::new();
        entries.insert("team-watch-a".to_string(), pop("main", "race:r1"));
        entries.insert("team-watch-b".to_string(), pop("window-2", "race:r1"));
        entries.insert("team-watch-c".to_string(), pop("main", "discuss:d1"));
        assert_eq!(
            owned_label(&entries, "main", "race:r1").as_deref(),
            Some("team-watch-a")
        );
        assert_eq!(
            owned_label(&entries, "window-2", "race:r1").as_deref(),
            Some("team-watch-b")
        );
        assert_eq!(owned_label(&entries, "window-2", "discuss:d1"), None);
    }

    #[test]
    fn an_owner_closing_orphans_only_its_own_pop_outs_once() {
        let mut entries = HashMap::new();
        entries.insert("team-watch-a".to_string(), pop("main", "race:r1"));
        entries.insert("team-watch-b".to_string(), pop("window-2", "race:r1"));
        let told = owner_closed(&mut entries, "main");
        assert_eq!(told.len(), 1);
        assert_eq!(told[0].0, "team-watch-a");
        assert_eq!(told[0].1["ownerClosed"], json!(true));
        assert_eq!(told[0].1["revision"], json!(2));
        assert!(!entries["team-watch-b"].owner_closed);
        assert!(owner_closed(&mut entries, "main").is_empty());
    }

    #[test]
    fn says_when_its_owner_is_hidden_and_back_once_each() {
        let mut entries = HashMap::new();
        entries.insert("team-watch-a".to_string(), pop("main", "race:r1"));
        entries.insert("team-watch-b".to_string(), pop("window-2", "race:r1"));
        let told = set_owner_hidden(&mut entries, "main", true);
        assert_eq!(told.len(), 1);
        assert_eq!(told[0].0, "team-watch-a");
        assert_eq!(told[0].1["ownerHidden"], json!(true));
        assert_eq!(told[0].1["ownerClosed"], json!(false));
        assert_eq!(told[0].1["revision"], json!(2));
        assert!(!entries["team-watch-b"].owner_hidden);
        assert!(set_owner_hidden(&mut entries, "main", true).is_empty());
        let back = set_owner_hidden(&mut entries, "main", false);
        assert_eq!(back[0].1["ownerHidden"], json!(false));
        // Once the owner is gone for good, only that is said.
        set_owner_hidden(&mut entries, "main", true);
        owner_closed(&mut entries, "main");
        assert_eq!(
            entries["team-watch-a"].display_state()["ownerHidden"],
            json!(false)
        );
        assert!(set_owner_hidden(&mut entries, "main", false).is_empty());
    }

    #[test]
    fn tells_only_its_own_owner_when_a_pop_out_takes_focus() {
        let mut entries = HashMap::new();
        entries.insert("team-watch-a".to_string(), pop("main", "discuss:d1"));
        assert_eq!(
            focus_notice(&entries, "team-watch-a", true),
            Some((
                "main".to_string(),
                json!({ "team": "discuss:d1", "focused": true })
            ))
        );
        assert_eq!(
            focus_notice(&entries, "team-watch-a", false).map(|(_, payload)| payload),
            Some(json!({ "team": "discuss:d1", "focused": false }))
        );
        assert_eq!(focus_notice(&entries, "main", true), None);
        assert_eq!(focus_notice(&entries, "team-watch-b", true), None);
        owner_closed(&mut entries, "main");
        assert_eq!(focus_notice(&entries, "team-watch-a", true), None);
    }

    /// The page's list of actions a pop-out sends, read from its source, is
    /// exactly the list passed on here: an action added on one side only
    /// would fail in the pop-out alone.
    #[test]
    fn passes_on_exactly_the_actions_the_page_sends() {
        let source = include_str!("../../src/lib/teamWatch.ts");
        let start = source
            .find("export const TEAM_WATCH_ACTION_KINDS")
            .expect("TEAM_WATCH_ACTION_KINDS is in teamWatch.ts");
        let list = &source[start..];
        let list = &list[list.find("= [").unwrap() + 3..list.find("];").unwrap()];
        let page: Vec<&str> = list
            .split('"')
            .enumerate()
            .filter_map(|(index, part)| (index % 2 == 1).then_some(part))
            .collect();
        assert_eq!(page, ACTIONS);
        for kind in ACTIONS {
            assert_eq!(validate_action(&json!({ "kind": kind })), Ok(*kind));
        }
        assert_eq!(
            validate_action(&json!({ "kind": "review", "sessionId": "c" })),
            Ok("review")
        );
    }

    /// The pop-out's capability: it listens for its own events and drags its
    /// own window, nothing else. It is not in the workspace's capability.
    #[test]
    fn capability_grants_only_events_and_dragging() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let own: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("team-watch.json")).unwrap())
                .unwrap();
        assert_eq!(own["identifier"], json!("team-watch"));
        assert_eq!(own["webviews"], json!(["team-watch-*"]));
        assert!(own.get("windows").is_none());
        assert!(own.get("remote").is_none());
        assert_eq!(
            own["permissions"],
            json!([
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:window:allow-start-dragging"
            ])
        );
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path
                .file_name()
                .is_some_and(|name| name == "team-watch.json")
            {
                continue;
            }
            let other: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            for key in ["webviews", "windows"] {
                for pattern in other[key].as_array().into_iter().flatten() {
                    let pattern = pattern.as_str().unwrap_or_default();
                    assert!(
                        !pattern.starts_with("team-watch") && pattern != "*",
                        "{} grants {pattern} to team panels",
                        path.display()
                    );
                }
            }
        }
    }
}
