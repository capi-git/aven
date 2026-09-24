//! Trusted, temporary session windows. The owner keeps the harness and durable
//! session; a floating window can only act on its own session through this bridge.

use crate::display_rate::FullRefreshRate;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Condvar, Mutex},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder,
};

const STATE_EVENT: &str = "session-pip-state";
const ACTION_EVENT: &str = "session-pip-action";
const CLOSED_EVENT: &str = "session-pip-closed";
const RETURN_EVENT: &str = "session-pip-return-requested";
const QUIT_EVENT: &str = "session-pip-quit-requested";
const CALLBACKS: &[&str] = &[
    "onCwdChange",
    "onBranchChange",
    "onModelChange",
    "onModelSettingsChange",
    "onRuntimeModeChange",
    "onSubmit",
    "onStop",
    "onCompactContext",
    "onDeleteQueuedMessage",
    "onEditQueuedMessage",
    "onQueuedMessageEditingChange",
    "onSteerQueuedMessage",
    "onResumeQueue",
    "onInboxCardDismiss",
    "onNoteCardDismiss",
    "onHandoffCardDismiss",
    "onApproval",
    "onQuestionReply",
    "onOpenFile",
    "onOpenUrl",
    "onOpenDiff",
    "onOpenPlan",
    "onBuildPlan",
    "onSecondOpinion",
    "onHandoff",
    "onNewTerminal",
];

#[derive(Clone)]
struct SessionPip {
    owner: String,
    id: String,
    state: Value,
    pinned: bool,
    draft: Option<Value>,
    returning: bool,
    quitting: bool,
}

#[derive(Default)]
pub struct SessionPipState {
    registry: Mutex<Registry>,
    draft_ack: Condvar,
}

#[derive(Default)]
struct Registry {
    entries: HashMap<String, SessionPip>,
    flushes: HashMap<String, FlushRequest>,
}

struct FlushRequest {
    owner: String,
    labels: HashSet<String>,
    pending: HashSet<String>,
}

impl Registry {
    fn acknowledge_flush(&mut self, request_id: &str, label: &str) -> bool {
        self.flushes
            .get_mut(request_id)
            .is_some_and(|request| request.pending.remove(label))
    }

    fn finish_flush(&mut self, request_id: &str) -> Vec<SessionPipDraft> {
        let Some(request) = self.flushes.remove(request_id) else {
            return Vec::new();
        };
        request
            .labels
            .iter()
            .filter_map(|label| self.entries.get(label))
            .filter(|entry| entry.owner == request.owner)
            .map(|entry| SessionPipDraft {
                id: entry.id.clone(),
                draft: entry.draft.clone(),
            })
            .collect()
    }

    fn remove_window(&mut self, label: &str) -> (Option<SessionPip>, Vec<String>) {
        let closed = self.entries.remove(label);
        let children: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.owner == label)
            .map(|(child, _)| child.clone())
            .collect();
        for child in &children {
            self.entries.remove(child);
        }
        (closed, children)
    }
}

#[derive(Clone, Serialize)]
pub struct SessionPipDraft {
    id: String,
    draft: Option<Value>,
}

#[derive(Clone, Serialize)]
pub struct SessionPipSnapshot {
    id: String,
    state: Value,
    pinned: bool,
}

impl SessionPip {
    fn snapshot(&self) -> SessionPipSnapshot {
        SessionPipSnapshot {
            id: self.id.clone(),
            state: self.state.clone(),
            pinned: self.pinned,
        }
    }

    fn cache_draft(&mut self, draft: Option<Value>) {
        if let Some(draft) = draft {
            let updated = draft["updatedAt"].as_f64().unwrap_or(0.0);
            let previous = self
                .draft
                .as_ref()
                .and_then(|value| value["updatedAt"].as_f64())
                .unwrap_or(0.0);
            if self.draft.is_none() || updated >= previous {
                self.draft = Some(draft);
            }
        }
        self.state["draft"] = self.draft.clone().unwrap_or(Value::Null);
    }

    fn update(&mut self, state: Value) -> Result<(), String> {
        validate_snapshot(&self.id, &state)?;
        let draft = sanitize_draft(state.get("draft"))?;
        self.state = state;
        self.cache_draft(draft);
        Ok(())
    }
}

fn with_registry<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut HashMap<String, SessionPip>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<SessionPipState>();
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| "Session window registry is unavailable")?;
    operation(&mut registry.entries)
}

fn trusted_owner(caller: &Webview) -> Result<String, String> {
    if !crate::window::is_workspace_label(caller.label())
        || caller.label() != caller.window().label()
    {
        return Err("Only the owning workspace can control session windows".into());
    }
    Ok(caller.label().to_string())
}

fn child_label(caller: &Webview) -> Result<String, String> {
    if caller.label() != caller.window().label() || !caller.label().starts_with("pip-session-") {
        return Err("Only a registered session window can use this bridge".into());
    }
    with_registry(caller.app_handle(), |entries| {
        entries
            .contains_key(caller.label())
            .then(|| caller.label().to_string())
            .ok_or_else(|| "This session window has already closed".into())
    })
}

fn owned_label(entries: &HashMap<String, SessionPip>, owner: &str, id: &str) -> Option<String> {
    entries
        .iter()
        .find(|(_, entry)| entry.owner == owner && entry.id == id)
        .map(|(label, _)| label.clone())
}

fn validate_snapshot(id: &str, state: &Value) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 256
        || state
            .get("session")
            .and_then(|session| session.get("id"))
            .and_then(Value::as_str)
            != Some(id)
    {
        return Err("Session window state does not match its session".into());
    }
    if let Some(actions) = state.get("actions") {
        if !actions.as_array().is_some_and(|actions| {
            actions.iter().all(|action| {
                action
                    .as_str()
                    .is_some_and(|name| CALLBACKS.contains(&name))
            })
        }) {
            return Err("Session window state contains an unsupported action".into());
        }
    }
    Ok(())
}

fn sanitize_draft(raw: Option<&Value>) -> Result<Option<Value>, String> {
    let Some(raw) = raw.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let text = raw
        .get("text")
        .and_then(Value::as_str)
        .ok_or("Invalid session draft")?;
    let updated = raw
        .get("updatedAt")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(0.0);
    let attachments: Vec<Value> = raw
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(20)
        .filter_map(|file| {
            let id = file.get("id")?.as_str().filter(|id| !id.is_empty())?;
            let name = file.get("name")?.as_str()?;
            let mime_type = file.get("mimeType")?.as_str()?;
            let kind = file
                .get("kind")?
                .as_str()
                .filter(|kind| ["image", "audio", "file"].contains(kind))?;
            let size = file
                .get("size")?
                .as_f64()
                .filter(|size| size.is_finite() && *size >= 0.0)?;
            let path = file
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty());
            let data = file
                .get("data")
                .and_then(Value::as_str)
                .filter(|data| !data.is_empty());
            if path.is_none() && data.is_none() {
                return None;
            }
            let mut next =
                json!({"id": id, "name": name, "mimeType": mime_type, "kind": kind, "size": size});
            if let Some(path) = path {
                next["path"] = json!(path);
            }
            if let Some(data) = data {
                next["data"] = json!(data);
            }
            Some(next)
        })
        .collect();
    Ok(Some(
        json!({"text": text, "attachments": attachments, "updatedAt": updated}),
    ))
}

fn validate_action(entry: &SessionPip, action: &str, args: &[Value]) -> Result<(), String> {
    if action == "draft" || action == "quit" {
        if args.len() > 1 {
            return Err("Invalid session draft action".into());
        }
        sanitize_draft(args.first())?;
        return Ok(());
    }
    if !CALLBACKS.contains(&action)
        || entry
            .state
            .get("actions")
            .and_then(Value::as_array)
            .is_some_and(|actions| !actions.iter().any(|value| value.as_str() == Some(action)))
    {
        return Err("This session action is unavailable".into());
    }
    if action == "onOpenUrl"
        && !args.first().and_then(Value::as_str).is_some_and(|url| {
            Url::parse(url).is_ok_and(|url| {
                ["http", "https"].contains(&url.scheme()) && url.host_str().is_some()
            })
        })
    {
        return Err("Invalid browser link".into());
    }
    if !["onOpenFile", "onOpenDiff", "onOpenUrl"].contains(&action)
        && args.first().and_then(Value::as_str) != Some(entry.id.as_str())
    {
        return Err("A session window cannot act on a different session".into());
    }
    if action == "onOpenDiff"
        && args
            .get(1)
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str)
            .is_some_and(|id| id != entry.id)
    {
        return Err("A session window cannot open another session's diff".into());
    }
    Ok(())
}

fn emit_action(
    app: &AppHandle,
    owner: &str,
    id: &str,
    action: &str,
    args: Vec<Value>,
) -> Result<(), String> {
    app.emit_to(
        EventTarget::webview(owner),
        ACTION_EVENT,
        json!({"id": id, "action": action, "args": args}),
    )
    .map_err(|error| error.to_string())
}

fn notify_closed(app: &AppHandle, entry: SessionPip) {
    let _ = app.emit_to(
        EventTarget::webview(&entry.owner),
        CLOSED_EVENT,
        json!({"id": entry.id, "draft": entry.draft}),
    );
}

fn finish_return(app: &AppHandle, label: &str, draft: Option<Value>) -> Result<(), String> {
    let entry = with_registry(app, |entries| {
        Ok(entries.remove(label).map(|mut entry| {
            entry.cache_draft(draft);
            entry
        }))
    })?;
    let Some(entry) = entry else { return Ok(()) };
    app.state::<SessionPipState>().draft_ack.notify_all();
    let owner = entry.owner.clone();
    notify_closed(app, entry);
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
    if let Some(window) = app.get_window(&owner) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

pub(crate) fn finish_ready_return(app: &AppHandle, label: &str) -> Result<(), String> {
    finish_return(app, label, None)
}

pub fn request_return(app: &AppHandle, label: &str) -> Result<(), String> {
    if crate::pip_group::request_return(app, label) {
        return Ok(());
    }
    let newly_requested = with_registry(app, |entries| {
        let Some(entry) = entries.get_mut(label) else {
            return Ok(false);
        };
        if entry.returning {
            return Ok(false);
        }
        entry.returning = true;
        Ok(true)
    })?;
    if !newly_requested {
        return Ok(());
    }
    if app
        .emit_to(EventTarget::webview(label), RETURN_EVENT, ())
        .is_err()
    {
        return finish_return(app, label, None);
    }
    // Only close requests create a bounded fallback. No timer runs while idle.
    let (app, label) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(1));
        let _ = finish_return(&app, &label, None);
    });
    Ok(())
}

pub fn request_quit(app: &AppHandle, label: &str) -> Result<(), String> {
    let newly_requested = with_registry(app, |entries| {
        let Some(entry) = entries.get_mut(label) else {
            return Ok(false);
        };
        if entry.quitting {
            return Ok(false);
        }
        entry.quitting = true;
        Ok(true)
    })?;
    if !newly_requested {
        return Ok(());
    }
    let _ = app.emit_to(EventTarget::webview(label), QUIT_EVENT, ());
    let (app, label) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(1));
        let entry = with_registry(&app, |entries| {
            Ok(entries
                .get_mut(&label)
                .filter(|entry| entry.quitting)
                .map(|entry| {
                    entry.quitting = false;
                    entry.clone()
                }))
        })
        .ok()
        .flatten();
        if let Some(entry) = entry {
            let _ = emit_action(
                &app,
                &entry.owner,
                &entry.id,
                "quit",
                vec![entry.draft.clone().unwrap_or(Value::Null)],
            );
        }
    });
    Ok(())
}

pub fn focused_label(app: &AppHandle) -> Option<String> {
    let labels = with_registry(app, |entries| {
        Ok(entries.keys().cloned().collect::<Vec<_>>())
    })
    .ok()?;
    labels.into_iter().find(|label| {
        app.get_webview_window(label)
            .is_some_and(|window| window.is_focused().unwrap_or(false))
    })
}

pub fn dispatch_floating_menu(app: &AppHandle, id: &str) -> bool {
    let Some(label) = focused_label(app) else {
        return false;
    };
    match id {
        "new_window" => return false,
        "close_tab" => {
            let _ = request_return(app, &label);
        }
        "quit" => {
            let _ = request_quit(app, &label);
        }
        "open_model_picker" => {
            let _ = app.emit_to(EventTarget::webview(&label), id, ());
        }
        _ => {
            // Workspace menu commands target this session's owner, never every
            // open workspace. The child has no full-app menu subscriptions.
            if let Ok(Some(owner)) = with_registry(app, |entries| {
                Ok(entries.get(&label).map(|entry| entry.owner.clone()))
            }) {
                let _ = app.emit_to(EventTarget::webview(owner), id, ());
            }
        }
    }
    true
}

#[tauri::command]
pub async fn session_pip_open(
    caller: Webview,
    id: String,
    title: String,
    state: Value,
) -> Result<String, String> {
    let _work = crate::window::begin_runtime_work(caller.app_handle())?;
    let owner = trusted_owner(&caller)?;
    validate_snapshot(&id, &state)?;
    let draft = sanitize_draft(state.get("draft"))?;
    let app = caller.app_handle();
    let allowed_url = caller
        .url()
        .map_err(|error| error.to_string())?
        .join("index.html?pipSession=1")
        .map_err(|error| error.to_string())?;
    let label = format!("pip-session-{}", uuid::Uuid::new_v4());
    let existing = with_registry(app, |entries| {
        if let Some(label) = owned_label(entries, &owner, &id) {
            let entry = entries.get_mut(&label).unwrap();
            entry.update(state)?;
            return Ok(Some((label, entry.snapshot())));
        }
        let mut entry = SessionPip {
            owner,
            id,
            state,
            pinned: true,
            draft: None,
            returning: false,
            quitting: false,
        };
        entry.cache_draft(draft);
        entries.insert(label.clone(), entry);
        Ok(None)
    })?;
    if let Some((label, snapshot)) = existing {
        let _ = app.emit_to(EventTarget::webview(&label), STATE_EVENT, snapshot);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        // A simultaneous open may still be building this same reserved window.
        return Ok(label);
    }
    let built = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App("index.html?pipSession=1".into()),
    )
    .full_refresh_rate(app)
    .title(title.chars().take(160).collect::<String>())
    .inner_size(500.0, 620.0)
    .min_inner_size(360.0, 360.0)
    // Let WK deliver image/File payloads directly to the composer's DOM drop
    // target, using its actual position after app zoom.
    .disable_drag_drop_handler()
    .decorations(true)
    .resizable(true)
    .always_on_top(true)
    .visible(false)
    .on_navigation(move |url| session_url_allowed(url, &allowed_url))
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            with_registry(app, |entries| {
                entries.remove(&label);
                Ok(())
            })?;
            return Err(error.to_string());
        }
    };
    // Owners can contain native browser children; that makes them a Window,
    // rather than Tauri's single-webview WebviewWindow convenience type.
    if app.get_window(caller.window().label()).is_none()
        || !with_registry(app, |entries| Ok(entries.contains_key(&label)))?
    {
        with_registry(app, |entries| {
            entries.remove(&label);
            Ok(())
        })?;
        let _ = window.destroy();
        return Err("The owning workspace closed while opening its session window".into());
    }
    let (close_app, close_label) = (app.clone(), label.clone());
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = request_return(&close_app, &close_label);
        }
    });
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(label)
}

fn session_url_allowed(url: &Url, expected: &Url) -> bool {
    let mut url = url.clone();
    url.set_fragment(None);
    &url == expected
}

#[tauri::command]
pub fn session_pip_update(caller: Webview, id: String, state: Value) -> Result<(), String> {
    let owner = trusted_owner(&caller)?;
    let (label, snapshot) = with_registry(caller.app_handle(), |entries| {
        let label =
            owned_label(entries, &owner, &id).ok_or("This workspace has no such session window")?;
        let entry = entries.get_mut(&label).unwrap();
        entry.update(state)?;
        Ok((label, entry.snapshot()))
    })?;
    caller
        .emit_to(EventTarget::webview(label), STATE_EVENT, snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn session_pip_get_state(caller: Webview) -> Result<SessionPipSnapshot, String> {
    let label = child_label(&caller)?;
    with_registry(caller.app_handle(), |entries| {
        entries
            .get(&label)
            .map(SessionPip::snapshot)
            .ok_or_else(|| "Session window closed".into())
    })
}

#[tauri::command]
pub fn session_pip_action(caller: Webview, action: String, args: Vec<Value>) -> Result<(), String> {
    let label = child_label(&caller)?;
    let (owner, id, draft) = with_registry(caller.app_handle(), |entries| {
        let entry = entries.get_mut(&label).ok_or("Session window closed")?;
        validate_action(entry, &action, &args)?;
        if action == "draft" || action == "quit" {
            entry.cache_draft(sanitize_draft(args.first())?);
            if action == "quit" {
                entry.quitting = false;
            }
        }
        Ok((entry.owner.clone(), entry.id.clone(), entry.draft.clone()))
    })?;
    let args = if action == "draft" || action == "quit" {
        vec![draft.unwrap_or(Value::Null)]
    } else {
        args
    };
    emit_action(caller.app_handle(), &owner, &id, &action, args)
}

#[tauri::command]
pub fn session_pip_draft(
    caller: Webview,
    draft: Option<Value>,
    flush_request_id: Option<String>,
) -> Result<(), String> {
    session_pip_action(
        caller.clone(),
        "draft".into(),
        vec![draft.unwrap_or(Value::Null)],
    )?;
    if let Some(request_id) = flush_request_id {
        let state = caller.app_handle().state::<SessionPipState>();
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| "Session window registry is unavailable")?;
        if registry.acknowledge_flush(&request_id, caller.label()) {
            state.draft_ack.notify_all();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn session_pip_flush_all(caller: Webview) -> Result<Vec<SessionPipDraft>, String> {
    let owner = trusted_owner(&caller)?;
    let app = caller.app_handle().clone();
    let request_id = uuid::Uuid::new_v4().to_string();
    let labels = {
        let state = app.state::<SessionPipState>();
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| "Session window registry is unavailable")?;
        let labels: HashSet<String> = registry
            .entries
            .iter()
            .filter(|(_, entry)| entry.owner == owner)
            .map(|(label, _)| label.clone())
            .collect();
        if labels.is_empty() {
            return Ok(Vec::new());
        }
        registry.flushes.insert(
            request_id.clone(),
            FlushRequest {
                owner,
                labels: labels.clone(),
                pending: labels.clone(),
            },
        );
        labels
    };
    for label in labels {
        let _ = app.emit_to(
            EventTarget::webview(label),
            "session-pip-flush-requested",
            json!({"requestId": request_id}),
        );
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SessionPipDraft>, String> {
        let state = app.state::<SessionPipState>();
        let registry = state
            .registry
            .lock()
            .map_err(|_| "Session window registry is unavailable")?;
        let (mut registry, _) = state
            .draft_ack
            .wait_timeout_while(registry, Duration::from_secs(1), |registry| {
                registry.flushes.get(&request_id).is_some_and(|request| {
                    request
                        .pending
                        .iter()
                        .any(|label| registry.entries.contains_key(label))
                })
            })
            .map_err(|_| "Session window draft flush failed")?;
        Ok(registry.finish_flush(&request_id))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn session_pip_return(caller: Webview, draft: Option<Value>) -> Result<(), String> {
    let label = child_label(&caller)?;
    let draft = sanitize_draft(draft.as_ref())?;
    with_registry(caller.app_handle(), |entries| {
        if let Some(entry) = entries.get_mut(&label) {
            entry.cache_draft(draft.clone());
        }
        Ok(())
    })?;
    if crate::pip_group::return_with_ready_draft(caller.app_handle(), &label) {
        // This child already flushed. Finish it once native detachment completes;
        // only its siblings need a new return/draft handshake.
        return Ok(());
    }
    finish_return(caller.app_handle(), &label, draft)
}

#[tauri::command]
pub fn session_pip_set_pinned(caller: Webview, pinned: bool) -> Result<(), String> {
    let label = child_label(&caller)?;
    crate::pip_group::set_pinned(caller.app_handle(), &label, pinned)
}

pub(crate) fn owner_for_label(app: &AppHandle, label: &str) -> Option<String> {
    with_registry(app, |entries| {
        Ok(entries.get(label).map(|entry| entry.owner.clone()))
    })
    .ok()
    .flatten()
}

pub(crate) fn publish_pinned(app: &AppHandle, label: &str, pinned: bool) -> Result<(), String> {
    let snapshot = with_registry(app, |entries| {
        Ok(entries.get_mut(label).map(|entry| {
            entry.pinned = pinned;
            entry.snapshot()
        }))
    })?;
    if let Some(snapshot) = snapshot {
        app.emit_to(EventTarget::webview(label), STATE_EVENT, snapshot)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn session_pip_show(caller: Webview, id: String) -> Result<(), String> {
    let owner = trusted_owner(&caller)?;
    let label = with_registry(caller.app_handle(), |entries| {
        owned_label(entries, &owner, &id)
            .ok_or_else(|| "This workspace has no such session window".into())
    })?;
    let window = caller
        .app_handle()
        .get_webview_window(&label)
        .ok_or("Session window closed")?;
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn session_pip_close(caller: Webview, id: String) -> Result<(), String> {
    let owner = trusted_owner(&caller)?;
    let label = with_registry(caller.app_handle(), |entries| {
        Ok(owned_label(entries, &owner, &id))
    })?;
    if let Some(label) = label {
        request_return(caller.app_handle(), &label)?;
    }
    Ok(())
}

pub fn window_destroyed(app: &AppHandle, label: &str) {
    let state = app.state::<SessionPipState>();
    let (closed, children) = {
        let Ok(mut registry) = state.registry.lock() else {
            return;
        };
        registry.remove_window(label)
    };
    state.draft_ack.notify_all();
    if let Some(entry) = closed {
        notify_closed(app, entry);
    }
    if !children.is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = crate::pip_group::detach_windows(&app, &children).await {
                eprintln!(
                    "Session Picture in Picture cleanup could not detach its windows: {error}"
                );
                return;
            }
            for label in children {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(owner: &str, id: &str) -> SessionPip {
        SessionPip {
            owner: owner.into(),
            id: id.into(),
            state: json!({"session": {"id": id}}),
            pinned: true,
            draft: None,
            returning: false,
            quitting: false,
        }
    }

    #[test]
    fn validates_snapshot_identity_and_advertised_callbacks() {
        assert!(validate_snapshot(
            "a",
            &json!({"session": {"id": "a"}, "actions": ["onSubmit", "onStop"]})
        )
        .is_ok());
        for state in [
            json!({"session": {"id": "b"}}),
            json!({"session": {"id": "a"}, "actions": ["onClose"]}),
            json!({"session": {"id": "a"}, "actions": "onSubmit"}),
        ] {
            assert!(validate_snapshot("a", &state).is_err());
        }
        assert!(validate_snapshot("", &json!({"session": {"id": ""}})).is_err());
    }

    #[test]
    fn every_callback_is_scoped_to_the_registered_session_and_excluded_actions_stay_unavailable() {
        let current = entry("main", "a");
        for action in CALLBACKS {
            if ["onOpenFile", "onOpenDiff", "onOpenUrl"].contains(action) {
                continue;
            }
            assert!(
                validate_action(&current, action, &[json!("a")]).is_ok(),
                "{action}"
            );
            assert!(
                validate_action(&current, action, &[json!("b")]).is_err(),
                "{action}"
            );
            assert!(validate_action(&current, action, &[]).is_err(), "{action}");
        }
        for action in [
            "onFocus",
            "onClose",
            "onPaneDragStart",
            "eval",
            "harness_send",
        ] {
            assert!(validate_action(&current, action, &[json!("a")]).is_err());
        }
    }

    #[test]
    fn allows_path_callbacks_and_draft_quit_without_a_session_prefix_but_never_foreign_diff_context(
    ) {
        let mut current = entry("main", "a");
        assert!(validate_action(&current, "onOpenFile", &[json!("/project/file.ts")]).is_ok());
        assert!(validate_action(
            &current,
            "onOpenDiff",
            &[Value::Null, json!({"sessionId": "a"})]
        )
        .is_ok());
        assert!(validate_action(
            &current,
            "onOpenDiff",
            &[Value::Null, json!({"sessionId": "b"})]
        )
        .is_err());
        assert!(validate_action(
            &current,
            "quit",
            &[json!({"text": "latest", "attachments": [], "updatedAt": 2})]
        )
        .is_ok());
        assert!(validate_action(&current, "draft", &[json!("not a draft")]).is_err());
        current.state["actions"] = json!(["onStop"]);
        assert!(validate_action(&current, "onSubmit", &[json!("a")]).is_err());
        assert!(validate_action(&current, "quit", &[]).is_ok());
    }

    #[test]
    fn owner_lookup_and_destruction_cannot_cross_workspace_boundaries() {
        let mut registry = Registry::default();
        registry
            .entries
            .insert("pip-a".into(), entry("main", "shared-id"));
        registry
            .entries
            .insert("pip-b".into(), entry("window-1", "shared-id"));
        assert_eq!(
            owned_label(&registry.entries, "main", "shared-id"),
            Some("pip-a".into())
        );
        assert_eq!(
            owned_label(&registry.entries, "preview-main-site", "shared-id"),
            None
        );
        let (closed, children) = registry.remove_window("main");
        assert!(closed.is_none());
        assert_eq!(children, ["pip-a"]);
        assert!(registry.entries.contains_key("pip-b"));
        let (closed, children) = registry.remove_window("pip-b");
        assert_eq!(closed.unwrap().owner, "window-1");
        assert!(children.is_empty());
        assert!(registry.entries.is_empty());
        assert!(registry.remove_window("pip-b").0.is_none());
    }

    #[test]
    fn newer_drafts_and_explicit_clears_survive_stale_owner_snapshots() {
        let mut current = entry("main", "a");
        current.cache_draft(
            sanitize_draft(Some(
                &json!({"text": "latest", "attachments": [], "updatedAt": 20}),
            ))
            .unwrap(),
        );
        current
            .update(json!({"session": {"id": "a"}, "draft": {"text": "old", "updatedAt": 10}}))
            .unwrap();
        assert_eq!(current.state["draft"]["text"], "latest");
        current.cache_draft(
            sanitize_draft(Some(
                &json!({"text": "", "attachments": [], "updatedAt": 21}),
            ))
            .unwrap(),
        );
        current
            .update(json!({"session": {"id": "a"}, "draft": null}))
            .unwrap();
        assert_eq!(current.state["draft"]["text"], "");
        let before = current.snapshot().state;
        assert!(current.update(json!({"session": {"id": "b"}})).is_err());
        assert_eq!(current.state, before);
    }

    #[test]
    fn draft_attachments_keep_sendable_data_but_drop_ephemeral_urls_and_unusable_entries() {
        let raw = json!({"text": "draft", "attachments": [
            {"id":"1", "name":"a.png", "mimeType":"image/png", "kind":"image", "size":5, "data":"abc", "previewUrl":"blob:temporary"},
            {"id":"2", "name":"b.txt", "mimeType":"text/plain", "kind":"file", "size":5, "path":"/project/b.txt"},
            {"id":"3", "name":"c.txt", "mimeType":"text/plain", "kind":"file", "size":5, "previewUrl":"blob:temporary"}
        ], "updatedAt": 10});
        let draft = sanitize_draft(Some(&raw)).unwrap().unwrap();
        assert_eq!(draft["attachments"].as_array().unwrap().len(), 2);
        assert_eq!(draft["attachments"][0]["data"], "abc");
        assert!(draft["attachments"][0].get("previewUrl").is_none());
        assert_eq!(draft["attachments"][1]["path"], "/project/b.txt");
        assert!(sanitize_draft(None).unwrap().is_none());
    }

    #[test]
    fn flush_acknowledgments_cannot_complete_another_child_and_results_are_owner_scoped() {
        let mut registry = Registry::default();
        registry.entries.insert("pip-a".into(), entry("main", "a"));
        registry
            .entries
            .insert("pip-b".into(), entry("window-1", "b"));
        registry.flushes.insert(
            "request".into(),
            FlushRequest {
                owner: "main".into(),
                labels: HashSet::from(["pip-a".into(), "pip-b".into()]),
                pending: HashSet::from(["pip-a".into()]),
            },
        );
        assert!(!registry.acknowledge_flush("request", "pip-b"));
        assert!(!registry.acknowledge_flush("other-request", "pip-a"));
        registry.entries.get_mut("pip-a").unwrap().cache_draft(
            sanitize_draft(Some(&json!({"text":"last keystroke", "updatedAt":1}))).unwrap(),
        );
        assert!(registry.acknowledge_flush("request", "pip-a"));
        assert!(!registry.acknowledge_flush("request", "pip-a"));
        let drafts = registry.finish_flush("request");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].id, "a");
        assert_eq!(drafts[0].draft.as_ref().unwrap()["text"], "last keystroke");
        assert!(registry.flushes.is_empty());
        assert_eq!(registry.entries.len(), 2); // Flushing never closes windows.
    }

    #[test]
    fn trusted_route_accepts_its_fragment_but_denies_remote_or_full_app_navigation() {
        let expected = Url::parse("tauri://localhost/index.html?pipSession=1").unwrap();
        assert!(session_url_allowed(&expected, &expected));
        assert!(session_url_allowed(
            &Url::parse("tauri://localhost/index.html?pipSession=1#message").unwrap(),
            &expected
        ));
        for candidate in [
            "tauri://localhost/index.html",
            "tauri://localhost/index.html?pipSession=2",
            "https://example.com/index.html?pipSession=1",
            "http://localhost:1420/index.html?pipSession=1",
        ] {
            assert!(!session_url_allowed(
                &Url::parse(candidate).unwrap(),
                &expected
            ));
        }
    }
}
