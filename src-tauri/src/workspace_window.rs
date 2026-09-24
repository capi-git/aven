//! Controlled workspace views. Only their original workspace owns agent runners.
//! Browser NSViews are moved as a transaction; no page/session is recreated.
#[path = "workspace_placement.rs"]
mod placement;
use crate::display_rate::FullRefreshRate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone)]
struct Entry {
    owner: String,
    state: Value,
    pinned: bool,
    returning: bool,
    transitioning: bool,
}
type WorkspaceAcknowledgement = (String, mpsc::Sender<Result<Value, String>>);

#[derive(Default)]
pub struct WorkspaceWindowState {
    entries: Mutex<HashMap<String, Entry>>,
    ready: Mutex<HashMap<String, (String, mpsc::Sender<()>)>>,
    acknowledgements: Mutex<HashMap<String, WorkspaceAcknowledgement>>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropPoint {
    pub screen_x: f64,
    pub screen_y: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceFileRequest {
    path: String,
    line: Option<u32>,
    column: Option<u32>,
}

fn validate_file_request(file: &WorkspaceFileRequest) -> Result<(), String> {
    if !std::path::Path::new(&file.path).is_absolute() || file.path.chars().any(char::is_control) {
        return Err("File path must be an absolute local path".into());
    }
    if file.line == Some(0)
        || file.column == Some(0)
        || (file.column.is_some() && file.line.is_none())
    {
        return Err("File navigation requires a positive line and column".into());
    }
    Ok(())
}

#[cfg(test)]
mod file_request_tests {
    use super::*;

    #[test]
    fn detached_file_requests_require_local_absolute_paths_and_valid_navigation() {
        let path = std::env::temp_dir()
            .join("Aven test.md")
            .to_string_lossy()
            .into_owned();
        for line in [None, Some(12)] {
            assert!(validate_file_request(&WorkspaceFileRequest {
                path: path.clone(),
                line,
                column: line.map(|_| 2),
            })
            .is_ok());
        }
        for invalid in [
            "notes.md",
            "https://example.com/readme.md",
            "file:///tmp/readme.md",
            "/tmp/a\0.md",
        ] {
            assert!(validate_file_request(&WorkspaceFileRequest {
                path: invalid.into(),
                line: None,
                column: None,
            })
            .is_err());
        }
        for (line, column) in [(Some(0), None), (Some(1), Some(0)), (None, Some(2))] {
            assert!(validate_file_request(&WorkspaceFileRequest {
                path: path.clone(),
                line,
                column,
            })
            .is_err());
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowSnapshot {
    pub id: String,
    pub state: Value,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<Value>,
}

fn entries<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut HashMap<String, Entry>) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<WorkspaceWindowState>();
    let mut all = state
        .entries
        .lock()
        .map_err(|_| "Workspace windows are unavailable")?;
    f(&mut all)
}
fn owner(caller: &Webview) -> Result<String, String> {
    if caller.label() != caller.window().label()
        || !crate::window::is_workspace_label(caller.label())
    {
        return Err("Only an owning workspace can move its tabs".into());
    }
    Ok(caller.label().into())
}
/// Browser commands use this registry, never a label prefix, to trust a child.
pub(crate) fn owner_for_child(app: &AppHandle, label: &str) -> Option<String> {
    entries(app, |all| Ok(all.get(label).map(|e| e.owner.clone())))
        .ok()
        .flatten()
}
fn child(caller: &Webview) -> Result<String, String> {
    if caller.label() != caller.window().label()
        || owner_for_child(caller.app_handle(), caller.label()).is_none()
    {
        return Err("This detached workspace is not registered".into());
    }
    Ok(caller.label().into())
}
fn authorized(caller: &Webview, id: Option<&str>) -> Result<(String, Entry), String> {
    let label = id.unwrap_or(caller.label()).to_string();
    entries(caller.app_handle(), |all| {
        let entry = all.get(&label).ok_or("Workspace window closed")?;
        if caller.label() != label && owner(caller)? != entry.owner {
            return Err("Workspace belongs to another owner".into());
        }
        if caller.label() == label && caller.label() != caller.window().label() {
            return Err("Invalid workspace webview".into());
        }
        Ok((label, entry.clone()))
    })
}
fn validate(state: &Value) -> Result<(), String> {
    let tabs = state["tabs"].as_array().ok_or("Missing workspace tabs")?;
    let browsers = state["browsers"]
        .as_array()
        .ok_or("Missing workspace browsers")?;
    let sessions = state["sessions"]
        .as_array()
        .ok_or("Missing workspace sessions")?;
    if tabs.len() + browsers.len() > 128 || sessions.len() > 128 {
        return Err("Too many detached surfaces".into());
    }
    let mut ids = HashSet::new();
    for tab in tabs.iter().chain(browsers.iter()) {
        let id = tab["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() < 1024)
            .ok_or("Invalid surface identifier")?;
        if !ids.insert(id) {
            return Err("Duplicate detached surface".into());
        }
    }
    for browser in browsers {
        if let Some(id) = browser["nativeId"].as_str() {
            if id.is_empty()
                || id.len() > 80
                || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return Err("Invalid browser identifier".into());
            }
        }
    }
    if !state["view"].is_object() {
        return Err("Missing workspace layout".into());
    }
    Ok(())
}
fn browser_ids(state: &Value) -> Vec<String> {
    state["browsers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| b["nativeId"].as_str().map(str::to_owned))
        .collect()
}
fn snapshot(id: &str, e: &Entry) -> WorkspaceWindowSnapshot {
    WorkspaceWindowSnapshot {
        id: id.into(),
        state: e.state.clone(),
        pinned: e.pinned,
        return_token: None,
        remaining: None,
    }
}
fn emit(
    app: &AppHandle,
    id: &str,
    event: &str,
    payload: impl Serialize + Clone,
) -> Result<(), String> {
    app.emit_to(EventTarget::webview(id), event, payload)
        .map_err(|e| e.to_string())
}

fn geometry_key(state: &Value) -> String {
    let mut ids: Vec<_> = state["originalSurfaceIds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    ids.sort_unstable();
    format!(
        "{}:{}",
        state["cwd"].as_str().unwrap_or(""),
        serde_json::to_string(&ids).unwrap_or_default()
    )
}

async fn move_browsers(
    caller: Webview,
    ids: Vec<String>,
    target: Option<String>,
) -> Result<(), String> {
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        crate::browser::transfer_workspace_pages(caller, ids, target).await
    }
    #[cfg(not(all(feature = "chromium", target_os = "macos")))]
    {
        let _ = (caller, target);
        if ids.is_empty() {
            Ok(())
        } else {
            Err("Moving live browser pages requires the Chromium build".into())
        }
    }
}

#[tauri::command]
pub async fn workspace_window_open(
    caller: Webview,
    state: Value,
    target: Option<String>,
    point: Option<DropPoint>,
) -> Result<WorkspaceWindowSnapshot, String> {
    let _work = crate::window::begin_runtime_work(caller.app_handle())?;
    let owner = owner(&caller)?;
    validate(&state)?;
    let app = caller.app_handle().clone();
    let label = target
        .clone()
        .unwrap_or_else(|| format!("workspace-detached-{}", uuid::Uuid::new_v4()));
    let previous = entries(&app, |all| {
        let previous = all.get(&label).cloned();
        if target.is_some() && previous.as_ref().is_none_or(|e| e.owner != owner) {
            return Err("Destination is not owned by this workspace".into());
        }
        if previous
            .as_ref()
            .is_some_and(|e| e.returning || e.transitioning)
        {
            return Err("This window is already moving. Try again when it finishes.".into());
        }
        all.insert(
            label.clone(),
            Entry {
                owner: owner.clone(),
                state: state.clone(),
                pinned: previous.as_ref().is_some_and(|e| e.pinned),
                returning: false,
                transitioning: true,
            },
        );
        Ok(previous)
    })?;
    let operation = async {
        if previous.is_none() {
            let expected = caller
                .url()
                .map_err(|e| e.to_string())?
                .join("index.html?workspaceWindow=1")
                .map_err(|e| e.to_string())?;
            let window = WebviewWindowBuilder::new(
                &app,
                &label,
                WebviewUrl::App("index.html?workspaceWindow=1".into()),
            )
            .full_refresh_rate(&app)
            .title(state["title"].as_str().unwrap_or("Aven workspace"))
            .inner_size(1000.0, 720.0)
            .min_inner_size(360.0, 300.0)
            // Deliver DOM File drops to the composer; native path-only drops
            // swallow image payloads and use coordinates before UI zoom.
            .disable_drag_drop_handler()
            .decorations(true)
            .resizable(true)
            .always_on_top(false)
            .visible(false)
            .on_navigation(move |url| {
                let mut url = url.clone();
                url.set_fragment(None);
                url == expected
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()
            .map_err(|e| e.to_string())?;
            placement::place(
                &app.get_window(&label).ok_or("Workspace closed")?,
                &caller.window(),
                point.as_ref().map(|p| (p.screen_x, p.screen_y)),
                &geometry_key(&state),
            )
            .await?;
            let (handle, name) = (app.clone(), label.clone());
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = request_return(&handle, &name);
                }
                tauri::WindowEvent::Focused(true)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(w) = handle.get_window(&name) {
                        let _ = placement::recover(&w, &w);
                    }
                }
                tauri::WindowEvent::Focused(false) => {
                    if let Some(w) = handle.get_window(&name) {
                        if let Ok(key) = entries(&handle, |all| {
                            Ok(geometry_key(
                                &all.get(&name).ok_or("Workspace closed")?.state,
                            ))
                        }) {
                            let _ = placement::save(&w, &key);
                        }
                    }
                }
                _ => {}
            });
        }
        let previous_ids: HashSet<_> = previous
            .as_ref()
            .map(|e| browser_ids(&e.state))
            .unwrap_or_default()
            .into_iter()
            .collect();
        let moving: Vec<_> = browser_ids(&state)
            .into_iter()
            .filter(|id| !previous_ids.contains(id))
            .collect();
        move_browsers(caller.clone(), moving, Some(label.clone())).await?;
        let token = uuid::Uuid::new_v4().to_string();
        let (send, receive) = mpsc::channel();
        app.state::<WorkspaceWindowState>()
            .ready
            .lock()
            .map_err(|_| "Workspace acknowledgement unavailable")?
            .insert(label.clone(), (token.clone(), send));
        entries(&app, |all| {
            all.get_mut(&label).ok_or("Workspace closed")?.state["transferToken"] = json!(token);
            Ok(())
        })?;
        let current = workspace_window_get_state(caller.clone(), Some(label.clone()))?;
        emit(&app, &label, "workspace-window-state", current.clone())?;
        tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(20)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "The detached workspace did not acknowledge its layout")?;
        entries(&app, |all| {
            all.get_mut(&label).ok_or("Workspace closed")?.transitioning = false;
            Ok(())
        })?;
        let window = app.get_window(&label).ok_or("Workspace window closed")?;
        placement::recover(&window, &caller.window())?;
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        // Republish browser bounds after the native window is actually shown;
        // WKWebView need not emit visibilitychange for a hidden native window.
        let _ = emit(&app, &label, "workspace-window-resume", ());
        Ok(current)
    }
    .await;
    if let Err(reason) = operation {
        let old_ids: HashSet<_> = previous
            .as_ref()
            .map(|e| browser_ids(&e.state))
            .unwrap_or_default()
            .into_iter()
            .collect();
        let moving = browser_ids(&state)
            .into_iter()
            .filter(|id| !old_ids.contains(id))
            .collect();
        let rollback = move_browsers(caller, moving, None).await;
        let _ = app
            .state::<WorkspaceWindowState>()
            .ready
            .lock()
            .map(|mut ready| ready.remove(&label));
        if let Some(old) = previous {
            let _ = emit(&app, &label, "workspace-window-resume", ());
            let _ = entries(&app, |all| {
                all.insert(label.clone(), old.clone());
                Ok(())
            });
            let _ = emit(
                &app,
                &label,
                "workspace-window-state",
                snapshot(&label, &old),
            );
        } else if rollback.is_ok() {
            let _ = entries(&app, |all| {
                all.remove(&label);
                Ok(())
            });
            if let Some(w) = app.get_window(&label) {
                let _ = w.destroy();
            }
        } else if let Some(w) = app.get_window(&label) {
            let _ = w.show();
        }
        return Err(format!(
            "{reason}{}",
            rollback
                .err()
                .map(|e| format!("; browser recovery needs retry: {e}"))
                .unwrap_or_default()
        ));
    }
    operation
}

#[tauri::command]
pub fn workspace_window_get_state(
    caller: Webview,
    id: Option<String>,
) -> Result<WorkspaceWindowSnapshot, String> {
    let (label, e) = authorized(&caller, id.as_deref())?;
    Ok(snapshot(&label, &e))
}
#[tauri::command]
pub async fn workspace_window_ready(caller: Webview, token: String) -> Result<(), String> {
    let label = child(&caller)?;
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    {
        let (_, entry) = authorized(&caller, None)?;
        crate::browser::workspace_pages_ready(caller.clone(), browser_ids(&entry.state)).await?;
    }
    let state = caller.state::<WorkspaceWindowState>();
    let mut ready = state
        .ready
        .lock()
        .map_err(|_| "Workspace acknowledgement unavailable")?;
    if ready
        .get(&label)
        .is_some_and(|(expected, _)| expected == &token)
    {
        if let Some((_, send)) = ready.remove(&label) {
            let _ = send.send(());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn workspace_window_update(
    caller: Webview,
    id: String,
    sessions: Value,
    theme: Value,
) -> Result<(), String> {
    let owner = owner(&caller)?;
    let current = entries(caller.app_handle(), |all| {
        let e = all.get_mut(&id).ok_or("Workspace closed")?;
        if e.owner != owner {
            return Err("Wrong workspace owner".into());
        }
        e.state["sessions"] = sessions;
        e.state["theme"] = theme;
        Ok(snapshot(&id, e))
    })?;
    emit(caller.app_handle(), &id, "workspace-window-state", current)
}
#[tauri::command]
pub fn workspace_window_checkpoint(caller: Webview, state: Value) -> Result<(), String> {
    let label = child(&caller)?;
    validate(&state)?;
    let (owner, current) = entries(caller.app_handle(), |all| {
        let e = all.get_mut(&label).ok_or("Workspace closed")?;
        if e.transitioning {
            return Ok((e.owner.clone(), snapshot(&label, e)));
        }
        // The child controls layout/drafts, never the authoritative agent state.
        for key in [
            "tabs",
            "browsers",
            "view",
            "editorDrafts",
            "drafts",
            "terminalScreens",
            "dirtyFileIds",
            "closedSurfaceIds",
            "title",
        ] {
            if let Some(v) = state.get(key) {
                e.state[key] = v.clone();
            }
        }
        Ok((e.owner.clone(), snapshot(&label, e)))
    })?;
    emit(
        caller.app_handle(),
        &owner,
        "workspace-window-checkpoint",
        current,
    )
}
#[tauri::command]
pub fn workspace_window_action(
    caller: Webview,
    session_id: String,
    action: String,
    args: Vec<Value>,
) -> Result<(), String> {
    let label = child(&caller)?;
    let (_, e) = authorized(&caller, None)?;
    let session = e.state["sessions"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|s| s["session"]["id"].as_str() == Some(&session_id))
        })
        .ok_or("Session does not belong to this workspace")?;
    if !(action == "onUpdatePlan"
        || session["actions"]
            .as_array()
            .is_some_and(|list| list.iter().any(|v| v.as_str() == Some(&action))))
        || args.first().and_then(Value::as_str) != Some(&session_id)
    {
        return Err("Unsupported detached session action".into());
    }
    emit(
        caller.app_handle(),
        &e.owner,
        "workspace-window-action",
        json!({"windowId":label,"id":session_id,"action":action,"args":args}),
    )
}
pub(crate) fn request_return(app: &AppHandle, label: &str) -> Result<(), String> {
    emit(app, label, "workspace-window-return-requested", ())
}
#[tauri::command]
pub async fn workspace_window_return(caller: Webview) -> Result<(), String> {
    let label = child(&caller)?;
    return_window(caller.app_handle().clone(), label).await
}
async fn return_window(app: AppHandle, label: String) -> Result<(), String> {
    let e = entries(&app, |all| {
        let e = all.get_mut(&label).ok_or("Workspace closed")?;
        if e.returning || e.transitioning {
            return Err("Workspace is already moving".into());
        }
        e.returning = true;
        Ok(e.clone())
    })?;
    let caller = match app.get_webview(&e.owner) {
        Some(caller) => caller,
        None => return Err("Original workspace closed".into()),
    };
    if let Some(window) = app.get_window(&label) {
        let _ = placement::save(&window, &geometry_key(&e.state));
    }
    let result = async {
        move_browsers(caller.clone(), browser_ids(&e.state), None).await?;
        let token = uuid::Uuid::new_v4().to_string();
        let receive = reserve_ack(&app, &token, &e.owner)?;
        let mut returned = snapshot(&label, &e);
        returned.return_token = Some(token.clone());
        emit(&app, &e.owner, "workspace-window-returned", returned)?;
        await_ack(&app, &token, receive).await?;
        entries(&app, |all| {
            all.remove(&label);
            Ok(())
        })?;
        if let Some(w) = app.get_window(&label) {
            w.destroy().map_err(|e| e.to_string())?;
        }
        if let Some(w) = app.get_window(&e.owner) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        Ok(())
    }
    .await;
    if result.is_err() {
        let rollback = move_browsers(caller, browser_ids(&e.state), Some(label.clone())).await;
        let _ = entries(&app, |all| {
            if let Some(e) = all.get_mut(&label) {
                e.returning = false;
            }
            Ok(())
        });
        let _ = emit(&app, &label, "workspace-window-resume", ());
        if let Err(reason) = rollback {
            return Err(format!(
                "Workspace could not return; browser recovery needs retry: {reason}"
            ));
        }
    }
    result
}
fn reserve_ack(
    app: &AppHandle,
    token: &str,
    expected: &str,
) -> Result<mpsc::Receiver<Result<Value, String>>, String> {
    let (send, receive) = mpsc::channel();
    app.state::<WorkspaceWindowState>()
        .acknowledgements
        .lock()
        .map_err(|_| "Workspace acknowledgement unavailable")?
        .insert(token.into(), (expected.into(), send));
    Ok(receive)
}
async fn await_ack(
    app: &AppHandle,
    token: &str,
    receive: mpsc::Receiver<Result<Value, String>>,
) -> Result<Value, String> {
    await_ack_with_timeout(
        app,
        token,
        receive,
        Duration::from_secs(20),
        "Workspace did not acknowledge the transfer; your window was kept open",
    )
    .await
}
async fn await_ack_with_timeout(
    app: &AppHandle,
    token: &str,
    receive: mpsc::Receiver<Result<Value, String>>,
    timeout: Duration,
    timeout_message: &'static str,
) -> Result<Value, String> {
    let result = tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(timeout))
        .await
        .map_err(|e| e.to_string());
    let _ = app
        .state::<WorkspaceWindowState>()
        .acknowledgements
        .lock()
        .map(|mut a| a.remove(token));
    result?.map_err(|_| timeout_message.to_string())?
}
#[tauri::command]
pub async fn workspace_window_ack(
    caller: Webview,
    token: String,
    state: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if caller.label() != caller.window().label() {
        return Err("Invalid acknowledgement sender".into());
    }
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    if error.is_none() {
        if let Some(state) = &state {
            if owner(&caller).is_ok() {
                crate::browser::workspace_pages_ready(caller.clone(), browser_ids(state)).await?;
            } else {
                crate::browser::workspace_pages_hidden(caller.clone(), browser_ids(state)).await?;
            }
        }
    }
    let shared = caller.state::<WorkspaceWindowState>();
    let mut pending = shared
        .acknowledgements
        .lock()
        .map_err(|_| "Workspace acknowledgement unavailable")?;
    if !pending
        .get(&token)
        .is_some_and(|(expected, _)| expected == caller.label())
    {
        return Err("This transfer acknowledgement has expired".into());
    }
    if let Some((_, send)) = pending.remove(&token) {
        let _ = send.send(if let Some(error) = error {
            Err(error)
        } else {
            Ok(state.unwrap_or(Value::Null))
        });
    }
    Ok(())
}
#[tauri::command]
pub async fn workspace_window_freeze(
    caller: Webview,
    id: String,
) -> Result<WorkspaceWindowSnapshot, String> {
    let (_, e) = authorized(&caller, Some(&id))?;
    if e.returning || e.transitioning {
        return Err("Workspace is already moving".into());
    }
    let app = caller.app_handle();
    let token = uuid::Uuid::new_v4().to_string();
    let receive = reserve_ack(app, &token, &id)?;
    emit(app, &id, "workspace-window-freeze", json!({"token":token}))?;
    match await_ack(app, &token, receive).await {
        Ok(state) => {
            validate(&state)?;
            entries(app, |all| {
                let e = all.get_mut(&id).ok_or("Workspace closed")?;
                for key in [
                    "tabs",
                    "browsers",
                    "view",
                    "drafts",
                    "editorDrafts",
                    "terminalScreens",
                    "dirtyFileIds",
                    "closedSurfaceIds",
                ] {
                    if let Some(v) = state.get(key) {
                        e.state[key] = v.clone();
                    }
                }
                Ok(snapshot(&id, e))
            })
        }
        Err(error) => {
            let _ = emit(app, &id, "workspace-window-resume", ());
            Err(error)
        }
    }
}
#[tauri::command]
pub fn workspace_window_resume(caller: Webview, id: String) -> Result<(), String> {
    authorized(&caller, Some(&id))?;
    emit(caller.app_handle(), &id, "workspace-window-resume", ())
}
#[tauri::command]
pub async fn workspace_window_close(caller: Webview, id: String) -> Result<(), String> {
    authorized(&caller, Some(&id))?;
    emit(
        caller.app_handle(),
        &id,
        "workspace-window-return-requested",
        (),
    )
}
#[tauri::command]
pub fn workspace_window_set_pinned(
    caller: Webview,
    pinned: bool,
    id: Option<String>,
) -> Result<(), String> {
    let (label, _) = authorized(&caller, id.as_deref())?;
    caller
        .app_handle()
        .get_window(&label)
        .ok_or("Workspace closed")?
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    let current = entries(caller.app_handle(), |all| {
        let entry = all.get_mut(&label).ok_or("Workspace closed")?;
        entry.pinned = pinned;
        Ok(snapshot(&label, entry))
    })?;
    emit(
        caller.app_handle(),
        &label,
        "workspace-window-state",
        current,
    )
}
#[tauri::command]
pub fn workspace_window_show(caller: Webview, id: String) -> Result<(), String> {
    authorized(&caller, Some(&id))?;
    let w = caller
        .app_handle()
        .get_window(&id)
        .ok_or("Workspace closed")?;
    placement::recover(&w, &caller.window())?;
    w.unminimize().map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn workspace_window_recover(caller: Webview, id: Option<String>) -> Result<(), String> {
    let (label, _) = authorized(&caller, id.as_deref())?;
    let w = caller
        .app_handle()
        .get_window(&label)
        .ok_or("Workspace closed")?;
    placement::recover(&w, &caller.window())
}
#[tauri::command]
pub fn workspace_window_list(caller: Webview) -> Result<Vec<WorkspaceWindowSnapshot>, String> {
    let own = owner(&caller)?;
    entries(caller.app_handle(), |all| {
        Ok(all
            .iter()
            .filter(|(_, e)| e.owner == own)
            .map(|(id, e)| snapshot(id, e))
            .collect())
    })
}
#[tauri::command]
pub fn workspace_window_visibility(
    caller: Webview,
    session_ids: Vec<String>,
) -> Result<(), String> {
    let label = child(&caller)?;
    let (_, entry) = authorized(&caller, None)?;
    let allowed: HashSet<_> = entry.state["sessions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["session"]["id"].as_str())
        .collect();
    let ids: Vec<_> = session_ids
        .into_iter()
        .filter(|id| allowed.contains(id.as_str()))
        .collect();
    emit(
        caller.app_handle(),
        &entry.owner,
        "workspace-window-visibility",
        json!({"id":label,"sessionIds":ids}),
    )
}
#[tauri::command]
pub async fn workspace_window_focus(
    caller: Webview,
    id: String,
    session_id: Option<String>,
    url: Option<String>,
    browser: Option<Value>,
    file: Option<WorkspaceFileRequest>,
) -> Result<(), String> {
    let (_, entry) = authorized(&caller, Some(&id))?;
    if let Some(file) = &file {
        if session_id.is_none() || url.is_some() || browser.is_some() {
            return Err("A file request must target exactly one task".into());
        }
        if entry.returning || entry.transitioning {
            return Err("This task is moving between windows. Try again in a moment.".into());
        }
        validate_file_request(file)?;
    }
    if let Some(session) = &session_id {
        if !entry.state["sessions"].as_array().is_some_and(|list| {
            list.iter()
                .any(|s| s["session"]["id"].as_str() == Some(session))
        }) {
            return Err("Session is not in this window".into());
        }
    }
    if let Some(url) = &url {
        if !url.starts_with("https://") && !url.starts_with("http://") {
            return Err("Invalid browser URL".into());
        }
    }
    if let Some(browser) = &browser {
        if browser["id"].as_str().is_none()
            || browser["url"]
                .as_str()
                .is_none_or(|url| !url.starts_with("http://") && !url.starts_with("https://"))
        {
            return Err("Invalid browser request".into());
        }
    }
    let app = caller.app_handle().clone();
    let request_token = file.as_ref().map(|_| uuid::Uuid::new_v4().to_string());
    let expires_at = request_token.as_ref().map(|_| {
        (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            + Duration::from_secs(10))
        .as_millis() as u64
    });
    let receive = request_token
        .as_ref()
        .map(|token| reserve_ack(&app, token, &id))
        .transpose()?;
    let result = async {
        emit(
            &app,
            &id,
            "workspace-window-focus",
            json!({"sessionId":session_id,"url":url,"browser":browser,"file":file,"requestToken":request_token,"expiresAt":expires_at}),
        )?;
        workspace_window_show(caller, id)?;
        if let (Some(token), Some(receive)) = (&request_token, receive) {
            await_ack_with_timeout(&app, token, receive, Duration::from_secs(10),
                "The task window did not respond. Try opening the file again.").await.map_err(|error| {
                format!("Could not open the file in its task window: {error}")
            })?;
        }
        Ok(())
    }.await;
    if let Some(token) = request_token {
        let _ = app
            .state::<WorkspaceWindowState>()
            .acknowledgements
            .lock()
            .map(|mut pending| pending.remove(&token));
    }
    result
}
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let children = entries(app, |all| {
        Ok(all
            .iter()
            .filter(|(_, e)| e.owner == label)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>())
    })
    .unwrap_or_default();
    for id in children {
        let _ = entries(app, |all| {
            all.remove(&id);
            Ok(())
        });
        if let Some(w) = app.get_window(&id) {
            let _ = w.destroy();
        }
    }
    if owner_for_child(app, label).is_some() {
        let (app, label) = (app.clone(), label.to_string());
        tauri::async_runtime::spawn(async move {
            let _ = return_window(app, label).await;
        });
    }
}

#[tauri::command]
pub fn workspace_window_new_session(caller: Webview) -> Result<(), String> {
    let label = child(&caller)?;
    let (_, entry) = authorized(&caller, None)?;
    if entry.state["canNewSession"] != Value::Bool(true) {
        return Err("New sessions are unavailable in this window".into());
    }
    emit(
        caller.app_handle(),
        &entry.owner,
        "workspace-window-new-session",
        json!({"id":label,"cwd":entry.state["cwd"]}),
    )
}

#[tauri::command]
pub async fn workspace_window_return_selection(
    caller: Webview,
    state: Value,
    remaining: Value,
) -> Result<(), String> {
    let label = child(&caller)?;
    validate(&state)?;
    validate(&remaining)?;
    fn ids(state: &Value) -> HashSet<String> {
        state["tabs"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(state["browsers"].as_array().into_iter().flatten())
            .filter_map(|v| v["id"].as_str().map(str::to_owned))
            .collect()
    }
    let selected = ids(&state);
    let rest = ids(&remaining);
    if selected.is_empty() {
        return Err("Choose a tab to return".into());
    }
    if rest.is_empty() {
        return workspace_window_return(caller).await;
    }
    let app = caller.app_handle().clone();
    let entry = entries(&app, |all| {
        let e = all.get_mut(&label).ok_or("Workspace closed")?;
        if e.returning || e.transitioning {
            return Err("Workspace is already moving".into());
        }
        if !selected.is_disjoint(&rest)
            || selected.union(&rest).cloned().collect::<HashSet<_>>() != ids(&e.state)
        {
            return Err("Workspace changed before its tabs could return".into());
        }
        for browser in state["browsers"].as_array().into_iter().flatten() {
            if !e.state["browsers"].as_array().is_some_and(|all| {
                all.iter()
                    .any(|b| b["id"] == browser["id"] && b["nativeId"] == browser["nativeId"])
            }) {
                return Err("Browser transfer identity changed".into());
            }
        }
        e.returning = true;
        Ok(e.clone())
    })?;
    let owner = app
        .get_webview(&entry.owner)
        .ok_or("Original workspace closed")?;
    let result = async {
        move_browsers(owner.clone(), browser_ids(&state), None).await?;
        let token = uuid::Uuid::new_v4().to_string();
        let receive = reserve_ack(&app, &token, &entry.owner)?;
        let mut returned = snapshot(&label, &entry);
        returned.state = state.clone();
        returned.remaining = Some(remaining.clone());
        returned.return_token = Some(token.clone());
        emit(&app, &entry.owner, "workspace-window-returned", returned)?;
        await_ack(&app, &token, receive).await?;
        entries(&app, |all| {
            let e = all.get_mut(&label).ok_or("Workspace closed")?;
            let remaining_sessions: HashSet<String> = remaining["sessions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|s| s["session"]["id"].as_str().map(str::to_owned))
                .collect();
            let latest_sessions: Vec<Value> = e.state["sessions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|s| {
                    s["session"]["id"]
                        .as_str()
                        .is_some_and(|id| remaining_sessions.contains(id))
                })
                .cloned()
                .collect();
            let theme = e.state["theme"].clone();
            e.state = remaining;
            e.state["sessions"] = json!(latest_sessions);
            e.state["theme"] = theme;
            e.returning = false;
            Ok(())
        })?;
        emit(&app, &label, "workspace-window-resume", ())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let rollback = move_browsers(owner, browser_ids(&state), Some(label.clone())).await;
        let _ = entries(&app, |all| {
            if let Some(e) = all.get_mut(&label) {
                e.returning = false;
            }
            Ok(())
        });
        let _ = emit(&app, &label, "workspace-window-resume", ());
        if let Err(error) = rollback {
            return Err(format!(
                "Tab return failed; browser recovery needs retry: {error}"
            ));
        }
    }
    result
}
