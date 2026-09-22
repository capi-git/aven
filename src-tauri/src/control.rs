//! Authenticated loopback transport. App windows own execution; callers never
//! receive arbitrary Tauri command access or direct database write access.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Clone)]
struct Grant {
    window: String,
    session: String,
    cwd: String,
    token: String,
}
struct Pending {
    window: String,
    session: String,
    reply: mpsc::Sender<Value>,
}
struct ActiveTurn {
    window: String,
    cwd: String,
}
#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    pending: HashMap<String, Pending>,
    workers: HashMap<String, String>,
    active: HashMap<String, ActiveTurn>,
}
impl Inner {
    fn ensure_owner(&self, window: &str, session: &str) -> Result<(), String> {
        let granted = self.grants.get(session).or_else(|| {
            self.workers
                .get(session)
                .and_then(|lead| self.grants.get(lead))
        });
        if granted.is_some_and(|grant| grant.window != window)
            || self
                .active
                .get(session)
                .is_some_and(|turn| turn.window != window)
        {
            return Err("Session is owned by another window".into());
        }
        Ok(())
    }

    fn finish_turn(&mut self, window: &str, session: &str) {
        if self
            .active
            .get(session)
            .is_some_and(|turn| turn.window == window)
        {
            self.active.remove(session);
        }
    }

    fn disable(&mut self, window: &str, session: &str) {
        if !self
            .grants
            .get(session)
            .is_some_and(|grant| grant.window == window)
        {
            return;
        }
        self.grants.remove(session);
        self.workers.retain(|_, parent| parent != session);
        self.pending.retain(|_, pending| {
            if pending.session != session || pending.window != window {
                return true;
            }
            let _ = pending
                .reply
                .send(json!({"ok": false, "error": "Lead connection was revoked"}));
            false
        });
    }

    fn window_sessions(&self, label: &str) -> Vec<String> {
        let leads: Vec<String> = self
            .grants
            .values()
            .filter(|grant| grant.window == label)
            .map(|grant| grant.session.clone())
            .collect();
        let mut ids = leads.clone();
        ids.extend(
            self.workers
                .iter()
                .filter(|(_, lead)| leads.contains(lead))
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.active
                .iter()
                .filter(|(_, turn)| turn.window == label)
                .map(|(id, _)| id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }
    fn close_window(&mut self, label: &str) -> Vec<String> {
        let ids = self.window_sessions(label);
        self.grants.retain(|id, _| !ids.contains(id));
        self.workers.retain(|id, _| !ids.contains(id));
        self.active.retain(|id, _| !ids.contains(id));
        self.pending.retain(|_, pending| {
            if pending.window != label {
                return true;
            }
            let _ = pending
                .reply
                .send(json!({"ok":false,"error":"Aven window closed"}));
            false
        });
        ids
    }
}
pub struct ControlHost {
    endpoint: String,
    inner: Arc<Mutex<Inner>>,
}

impl ControlHost {
    pub(crate) fn ensure_update_idle(&self) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Agent activity could not be checked")?;
        inner.ensure_update_idle()
    }
}

impl Inner {
    fn ensure_update_idle(&self) -> Result<(), String> {
        if !self.active.is_empty() || !self.pending.is_empty() {
            return Err("Finish or stop running agents and queued tasks before restarting to update. The update will stay downloaded and ready.".into());
        }
        Ok(())
    }
}

fn paths_overlap(a: &str, b: &str) -> bool {
    Path::new(a).starts_with(b) || Path::new(b).starts_with(a)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    token: String,
    action: String,
    input: Value,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    session_id: String,
    request_id: String,
    action: String,
    input: Value,
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let inner = Arc::new(Mutex::new(Inner::default()));
    app.manage(ControlHost {
        endpoint,
        inner: inner.clone(),
    });
    let app = app.clone();
    std::thread::spawn(move || {
        // Limit concurrent readers, including unauthenticated sockets.
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(32);
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..8 {
            let rx = rx.clone();
            let app = app.clone();
            let inner = inner.clone();
            std::thread::spawn(move || loop {
                let stream = match rx.lock() {
                    Ok(rx) => rx.recv(),
                    Err(_) => return,
                };
                let Ok(stream) = stream else { return };
                serve(stream, &app, &inner);
            });
        }
        for stream in listener.incoming().flatten() {
            let _ = tx.try_send(stream);
        }
    });
    Ok(())
}

fn serve(mut stream: TcpStream, app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let _work = match crate::window::begin_runtime_work(app) {
        Ok(work) => work,
        Err(error) => {
            let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
            let _ = writeln!(stream, "{}", json!({"ok": false, "error": error}));
            return;
        }
    };
    serve_request(stream, inner, |window, event| {
        app.emit_to(window, "monocode-control-request", event)
            .map_err(|e| e.to_string())
    });
}

fn serve_request(
    mut stream: TcpStream,
    inner: &Arc<Mutex<Inner>>,
    emit: impl FnOnce(&str, Event) -> Result<(), String>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let mut raw = String::new();
    let read = BufReader::new(&mut stream)
        .take(262_145)
        .read_line(&mut raw);
    if raw.len() > 262_144 {
        // Oversized frames are dropped before dispatch. Closing with unread
        // input may yield EOF or a TCP reset, so do not promise a framed reply
        // or keep a worker occupied draining an untrusted, unbounded stream.
        return;
    }
    let result = (|| -> Result<Value, String> {
        read.map_err(|e| e.to_string())?;
        let request: Request = serde_json::from_str(&raw).map_err(|_| "Invalid control request")?;
        if !request.input.is_object()
            || request.request_id.is_empty()
            || request.request_id.len() > 128
        {
            return Err("Invalid input or request ID".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        let grant = {
            let mut host = inner.lock().map_err(|_| "Control service unavailable")?;
            let grant = host
                .grants
                .values()
                .find(|g| g.token == request.token)
                .cloned()
                .ok_or("Connection revoked or unauthorized")?;
            if host.pending.len() >= 24 {
                return Err("Too many pending control requests".into());
            }
            host.pending.insert(
                id.clone(),
                Pending {
                    window: grant.window.clone(),
                    session: grant.session.clone(),
                    reply: tx,
                },
            );
            grant
        };
        let event = Event {
            id: id.clone(),
            session_id: grant.session,
            request_id: request.request_id,
            action: request.action,
            input: request.input,
        };
        let delivered = emit(grant.window.as_str(), event);
        let result = if delivered.is_err() {
            Err("Aven executor is unavailable".into())
        } else {
            rx.recv_timeout(Duration::from_secs(35))
                .map_err(|_| "Control request timed out. Retry with the same request ID.".into())
        };
        if let Ok(mut host) = inner.lock() {
            host.pending.remove(&id);
        }
        result
    })();
    let response = result.unwrap_or_else(|error| json!({"ok": false, "error": error}));
    let _ = writeln!(stream, "{response}");
}

#[tauri::command]
pub fn control_enable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    let _work = crate::window::begin_runtime_work(window.app_handle())?;
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    if !cwd.is_dir() {
        return Err("Choose a project folder first".into());
    }
    let cwd = cwd.to_string_lossy().replace('\\', "/").to_lowercase();
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    inner.ensure_owner(window.label(), &session_id)?;
    if inner
        .active
        .iter()
        .any(|(id, turn)| id != &session_id && paths_overlap(&turn.cwd, &cwd))
    {
        return Err(
            "Another session is running in this checkout. Stop it before enabling orchestration."
                .into(),
        );
    }
    if inner.grants.values().any(|g| {
        paths_overlap(&g.cwd, &cwd) && (g.session != session_id || g.window != window.label())
    }) {
        return Err("This checkout already has an orchestrator in another session".into());
    }
    inner.grants.insert(
        session_id.clone(),
        Grant {
            window: window.label().into(),
            session: session_id,
            cwd,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        },
    );
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(executable.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn control_disable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    inner.disable(window.label(), &session_id);
    Ok(())
}

#[tauri::command]
pub fn control_attach_worker(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    lead_id: String,
    session_id: String,
) -> Result<(), String> {
    let _work = crate::window::begin_runtime_work(window.app_handle())?;
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if !inner
        .grants
        .get(&lead_id)
        .is_some_and(|grant| grant.window == window.label())
    {
        return Err("Lead connection is inactive".into());
    }
    inner.ensure_owner(window.label(), &session_id)?;
    if session_id == lead_id
        || inner.grants.contains_key(&session_id)
        || inner
            .workers
            .get(&session_id)
            .is_some_and(|parent| parent != &lead_id)
    {
        return Err("Session already belongs to another orchestration role".into());
    }
    inner.workers.insert(session_id, lead_id);
    Ok(())
}

#[tauri::command]
pub fn control_authorize_turn(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
) -> Result<(), String> {
    let _work = crate::window::begin_runtime_work(window.app_handle())?;
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd))
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    inner.ensure_owner(window.label(), &session_id)?;
    if let Some(lead) = inner
        .grants
        .values()
        .find(|grant| paths_overlap(&grant.cwd, &cwd))
    {
        if lead.window != window.label()
            || (lead.session != session_id && inner.workers.get(&session_id) != Some(&lead.session))
        {
            return Err("This checkout is controlled by an orchestrator. Stop that run before starting independent work.".into());
        }
    }
    inner.active.insert(
        session_id,
        ActiveTurn {
            window: window.label().to_string(),
            cwd,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn control_turn_finished(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) {
    if let Ok(mut inner) = host.inner.lock() {
        inner.finish_turn(window.label(), &session_id);
    }
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    let ids = {
        let Ok(mut inner) = host.inner.lock() else {
            return;
        };
        // Revoke credentials before stopping children so an exiting process
        // cannot enqueue another request while teardown is in progress.
        inner.close_window(label)
    };
    for id in ids {
        let _ = crate::harness::harness_kill(app.state(), id);
    }
}

pub fn configure_child(app: &AppHandle, window: &str, session_id: &str, cmd: &mut Command) {
    cmd.env_remove("MONOCODE_CONTROL_ENDPOINT")
        .env_remove("MONOCODE_CONTROL_TOKEN");
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    if let Ok(inner) = host.inner.lock() {
        configure_environment(&inner, &host.endpoint, window, session_id, cmd);
    };
}

fn configure_environment(
    inner: &Inner,
    endpoint: &str,
    window: &str,
    session_id: &str,
    cmd: &mut Command,
) {
    cmd.env_remove("MONOCODE_CONTROL_ENDPOINT")
        .env_remove("MONOCODE_CONTROL_TOKEN");
    if let Some(grant) = inner
        .grants
        .get(session_id)
        .filter(|grant| grant.window == window)
    {
        cmd.env("MONOCODE_CONTROL_ENDPOINT", endpoint)
            .env("MONOCODE_CONTROL_TOKEN", &grant.token);
    }
}

#[tauri::command]
pub fn control_reply(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .pending
        .get(&id)
        .is_some_and(|p| p.window == window.label())
    {
        if let Some(pending) = inner.pending.remove(&id) {
            let _ = pending.reply.send(response);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn control_save(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(&state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    crate::session_store::save_orchestration(&conn, &lead_id, &run).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn control_load(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    store
        .lock_conn()?
        .query_row(
            "SELECT state FROM orchestration_runs WHERE lead_id=?1",
            [lead_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn resolve_scope(root: &Path, value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Write scopes must be project-relative paths without '..'".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut existing = root.join(path);
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(&existing) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(existing.file_name().ok_or("Invalid scope")?.to_os_string());
                if !existing.pop() {
                    return Err("Invalid scope".into());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    existing = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Err("Write scope points outside the project".into());
    }
    for part in missing.into_iter().rev() {
        existing.push(part);
    }
    Ok(existing.to_string_lossy().replace('\\', "/").to_lowercase())
}

#[tauri::command]
pub fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    if files.len() > 64 {
        return Err("At most 64 write scopes per task".into());
    }
    files
        .iter()
        .map(|file| resolve_scope(&crate::fs::expand_home(&cwd), file))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_rejects_active_turns_and_pending_control_but_allows_idle_grants() {
        let mut inner = Inner::default();
        inner.grants.insert(
            "lead".into(),
            Grant {
                window: "main".into(),
                session: "lead".into(),
                cwd: "/project".into(),
                token: "test".into(),
            },
        );
        assert!(inner.ensure_update_idle().is_ok());
        inner.active.insert(
            "lead".into(),
            ActiveTurn {
                window: "main".into(),
                cwd: "/project".into(),
            },
        );
        assert!(inner.ensure_update_idle().is_err());
        inner.finish_turn("main", "lead");
        assert!(inner.ensure_update_idle().is_ok());
        let (reply, _) = mpsc::channel();
        inner.pending.insert(
            "request".into(),
            Pending {
                window: "main".into(),
                session: "lead".into(),
                reply,
            },
        );
        assert!(inner.ensure_update_idle().is_err());
        inner.pending.clear();
        assert!(inner.ensure_update_idle().is_ok());
    }
    #[test]
    fn closing_a_window_releases_ordinary_turns_and_owned_orchestration() {
        let mut inner = Inner::default();
        for (id, window) in [
            ("ordinary", "closing"),
            ("lead", "closing"),
            ("other", "open"),
        ] {
            inner.active.insert(
                id.into(),
                ActiveTurn {
                    window: window.into(),
                    cwd: format!("/{id}"),
                },
            );
        }
        for (id, window) in [("lead", "closing"), ("other", "open")] {
            inner.grants.insert(
                id.into(),
                Grant {
                    window: window.into(),
                    session: id.into(),
                    cwd: format!("/{id}"),
                    token: id.into(),
                },
            );
        }
        inner.workers.insert("worker".into(), "lead".into());
        inner.workers.insert("other-worker".into(), "other".into());
        let (reply, response) = mpsc::channel();
        inner.pending.insert(
            "pending".into(),
            Pending {
                window: "closing".into(),
                session: "lead".into(),
                reply,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other-pending".into(),
            Pending {
                window: "open".into(),
                session: "other".into(),
                reply,
            },
        );

        assert_eq!(
            inner.close_window("closing"),
            ["lead", "ordinary", "worker"]
        );
        assert_eq!(inner.active.len(), 1);
        assert_eq!(inner.active["other"].window, "open");
        assert_eq!(inner.grants.len(), 1);
        assert!(inner.grants.contains_key("other"));
        assert_eq!(inner.workers.len(), 1);
        assert_eq!(inner.workers["other-worker"], "other");
        assert_eq!(response.try_recv().unwrap()["ok"], false);
        assert!(other_response.try_recv().is_err());
        assert!(inner.pending.contains_key("other-pending"));
        assert!(inner.close_window("closing").is_empty());
    }

    #[test]
    fn scopes_reject_escape_and_resolve_new_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        assert!(resolve_scope(&root, "../escape").is_err());
        assert!(resolve_scope(&root, "/absolute").is_err());
        assert!(resolve_scope(&root, "src/new.ts")
            .unwrap()
            .ends_with("/src/new.ts"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
            assert!(resolve_scope(&root, "outside/file").is_err());
            std::os::unix::fs::symlink(root.with_extension("missing"), root.join("dangling"))
                .unwrap();
            assert!(resolve_scope(&root, "dangling/file").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn checkout_reservations_include_nested_folders() {
        assert!(paths_overlap("/repo", "/repo/src"));
        assert!(paths_overlap("/repo/src", "/repo"));
        assert!(!paths_overlap("/repo", "/repo2"));
        assert!(paths_overlap("/", "/repo"));
        assert!(paths_overlap("/repo/", "/repo/src"));
    }
    fn fixture() -> Inner {
        let mut inner = Inner::default();
        inner.grants.insert(
            "lead".into(),
            Grant {
                window: "owner".into(),
                session: "lead".into(),
                cwd: "/repo".into(),
                token: "test-secret".into(),
            },
        );
        inner.workers.insert("worker".into(), "lead".into());
        inner
    }

    #[test]
    fn capabilities_and_turn_completion_are_bound_to_the_owning_window() {
        let mut inner = fixture();
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "owner".into(),
                cwd: "/elsewhere".into(),
            },
        );
        for id in ["lead", "worker", "ordinary"] {
            assert!(inner.ensure_owner("owner", id).is_ok());
            assert!(inner.ensure_owner("other", id).is_err());
        }
        inner.finish_turn("other", "ordinary");
        assert!(inner.active.contains_key("ordinary"));
        inner.finish_turn("owner", "ordinary");
        assert!(!inner.active.contains_key("ordinary"));
        assert!(inner.ensure_owner("other", "new-session").is_ok());
    }

    #[test]
    fn revoking_a_lead_cancels_its_pending_requests_only() {
        let mut inner = fixture();
        let (reply, response) = mpsc::channel();
        inner.pending.insert(
            "pending".into(),
            Pending {
                window: "owner".into(),
                session: "lead".into(),
                reply,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other".into(),
            Pending {
                window: "owner".into(),
                session: "other-lead".into(),
                reply,
            },
        );
        inner.disable("other-window", "lead");
        assert!(inner.grants.contains_key("lead"));
        inner.disable("owner", "lead");
        assert!(!inner.grants.contains_key("lead"));
        assert!(!inner.workers.contains_key("worker"));
        assert_eq!(response.try_recv().unwrap()["ok"], false);
        assert!(inner.pending.contains_key("other"));
        assert!(other_response.try_recv().is_err());
    }

    #[test]
    fn only_the_lead_process_in_its_own_window_receives_credentials() {
        let inner = fixture();
        for (window, session, allowed) in [
            ("owner", "lead", true),
            ("other", "lead", false),
            ("owner", "worker", false),
            ("owner", "ordinary", false),
        ] {
            let mut cmd = Command::new("unused-test-command");
            cmd.env("MONOCODE_CONTROL_TOKEN", "inherited-test-secret");
            cmd.env("MONOCODE_CONTROL_ENDPOINT", "inherited-test-endpoint");
            configure_environment(&inner, "127.0.0.1:12345", window, session, &mut cmd);
            let vars: HashMap<_, _> = cmd.get_envs().collect();
            assert_eq!(
                vars[std::ffi::OsStr::new("MONOCODE_CONTROL_TOKEN")],
                allowed.then_some(std::ffi::OsStr::new("test-secret"))
            );
            assert_eq!(
                vars[std::ffi::OsStr::new("MONOCODE_CONTROL_ENDPOINT")],
                allowed.then_some(std::ffi::OsStr::new("127.0.0.1:12345"))
            );
        }
    }

    fn transport_exchange(raw: String, expect_dispatch: bool) -> std::io::Result<String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let inner = Arc::new(Mutex::new(fixture()));
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve_request(stream, &inner, |window, event| {
                assert!(
                    expect_dispatch,
                    "unauthorized input was forwarded to the app"
                );
                assert_eq!(window, "owner");
                assert_eq!(event.session_id, "lead");
                assert_eq!(event.request_id, "retry-id");
                assert_eq!(event.action, "list");
                assert_eq!(event.input, json!({}));
                inner
                    .lock()
                    .unwrap()
                    .pending
                    .remove(&event.id)
                    .unwrap()
                    .reply
                    .send(json!({"ok":true,"result":[]}))
                    .unwrap();
                Ok(())
            });
            assert!(inner.lock().unwrap().pending.is_empty());
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut response = String::new();
        let result =
            writeln!(client, "{raw}").and_then(|_| BufReader::new(client).read_line(&mut response));
        server.join().unwrap();
        result.map(|_| response)
    }

    fn transport_request(raw: String, expect_dispatch: bool) -> Value {
        let response = transport_exchange(raw, expect_dispatch).unwrap();
        serde_json::from_str(&response).unwrap()
    }

    #[test]
    fn loopback_transport_authenticates_and_routes_only_to_the_lead() {
        let request =
            json!({"token":"test-secret","action":"list","input":{},"requestId":"retry-id"});
        assert_eq!(transport_request(request.to_string(), true)["ok"], true);
        let mut unauthorized = request.clone();
        unauthorized["token"] = json!("wrong-test-secret");
        assert_eq!(
            transport_request(unauthorized.to_string(), false)["ok"],
            false
        );
        let mut invalid = request;
        invalid["input"] = json!("not an object");
        assert_eq!(transport_request(invalid.to_string(), false)["ok"], false);
    }

    #[test]
    fn oversized_frames_are_disconnected_before_dispatch() {
        match transport_exchange("x".repeat(262_145), false) {
            Ok(response) => assert!(
                response.is_empty(),
                "Oversized input must not receive a success reply"
            ),
            Err(error) => assert!(matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
            )),
        }
    }
}
