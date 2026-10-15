//! Restart-to-update guard. While an update restart is being prepared, new
//! native work is refused, so nothing can start between the final checks and
//! the restart itself. Work that was already running gets a short, bounded
//! wait to finish; anything that is still running afterwards is named.
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview};

use crate::window::{is_workspace_label, prepare_process_exit};
const UPDATE_BUSY: &str = "Aven is getting ready to restart for an update. Try again in a moment.";
pub(crate) const UPDATE_BROWSER_BUSY: &str = "Save and close your browser tabs before restarting to update. The update will stay downloaded and ready.";
/// How long a restart waits for native work that was already running, such as
/// a terminal that is starting, before asking stoppable work to stop early.
const WORK_PATIENCE: Duration = Duration::from_secs(15);
/// How long stoppable work, such as a provider CLI update, has to stop.
const WORK_STOP_GRACE: Duration = Duration::from_secs(5);
/// Tells the restarting window what it is waiting for, by name.
const WAITING_EVENT: &str = "update-restart-waiting";

#[derive(Default)]
pub(crate) struct UpdateRestartState {
    shared: Arc<Shared>,
}

#[derive(Default)]
struct Shared {
    inner: Mutex<UpdateRestartInner>,
    /// Signalled whenever work finishes or the reservation changes, so a
    /// waiting restart wakes on events instead of polling.
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, UpdateRestartInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Default)]
struct UpdateRestartInner {
    owner: Option<String>,
    /// Identifies each reservation, so a cancelled wait never claims a newer one.
    reservation: u64,
    ready: bool,
    restarting: bool,
    next_work: u64,
    work: BTreeMap<u64, Work>,
    close_terminals: bool,
}

struct Work {
    /// What Aven is doing, worded to finish the sentence "Aven is still …".
    label: &'static str,
    /// Present for work that can stop early without losing anything.
    stop: Option<Arc<AtomicBool>>,
}

impl UpdateRestartInner {
    fn labels(&self) -> Vec<&'static str> {
        let mut labels: Vec<_> = self.work.values().map(|work| work.label).collect();
        labels.sort_unstable();
        labels.dedup();
        labels
    }

    fn release(&mut self) {
        self.owner = None;
        self.ready = false;
        self.restarting = false;
        self.close_terminals = false;
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRestartPreparation {
    browser_states: Vec<crate::browser::BrowserState>,
    open_terminals: usize,
}

/// Held only while a native operation starts or performs work, not throughout
/// the lifetime of an idle provider process. Reservation and operation starts
/// share one lock, so neither can slip between the other's check and mutation.
pub(crate) struct RuntimeWorkPermit {
    shared: Arc<Shared>,
    id: u64,
    stop: Option<Arc<AtomicBool>>,
}

impl RuntimeWorkPermit {
    /// A restart asked this stoppable work to stop early.
    pub(crate) fn stop_requested(&self) -> bool {
        self.stop
            .as_ref()
            .is_some_and(|stop| stop.load(Ordering::SeqCst))
    }
}

impl Drop for RuntimeWorkPermit {
    fn drop(&mut self) {
        self.shared.lock().work.remove(&self.id);
        self.shared.changed.notify_all();
    }
}

/// "a", "a and b", "a, b and c".
fn plain_list(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [only] => (*only).to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn still_working(labels: &[&str]) -> String {
    format!(
        "Aven couldn't restart yet because it is still {}. Try again in a moment. The update will stay downloaded and ready.",
        plain_list(labels)
    )
}

impl UpdateRestartState {
    fn begin_work(
        &self,
        label: &'static str,
        stoppable: bool,
    ) -> Result<RuntimeWorkPermit, String> {
        let mut state = self.shared.lock();
        if state.owner.is_some() {
            return Err(UPDATE_BUSY.into());
        }
        state.next_work += 1;
        let id = state.next_work;
        let stop = stoppable.then(|| Arc::new(AtomicBool::new(false)));
        state.work.insert(
            id,
            Work {
                label,
                stop: stop.clone(),
            },
        );
        Ok(RuntimeWorkPermit {
            shared: self.shared.clone(),
            id,
            stop,
        })
    }

    /// Take the restart for `owner`. New work is refused at once. Work that is
    /// already running gets `patience` to finish, then stoppable work is asked
    /// to stop and gets `grace`. If anything is still running after that, the
    /// reservation is released and the error names it. `waiting` hears each
    /// change in what the restart is waiting for.
    fn reserve(
        &self,
        owner: &str,
        patience: Duration,
        grace: Duration,
        mut waiting: impl FnMut(&[&'static str]),
    ) -> Result<(), String> {
        if !is_workspace_label(owner) {
            return Err("Update restart must be requested from the workspace window".into());
        }
        let mut state = self.shared.lock();
        if state.owner.is_some() {
            return Err(UPDATE_BUSY.into());
        }
        state.release();
        state.owner = Some(owner.into());
        state.reservation += 1;
        let reservation = state.reservation;
        let mut deadline = Instant::now() + patience;
        let mut stopping = false;
        let mut announced = Vec::new();
        loop {
            if state.owner.as_deref() != Some(owner) || state.reservation != reservation {
                return Err(
                    "The update restart was cancelled. The update will stay downloaded and ready."
                        .into(),
                );
            }
            if state.work.is_empty() {
                return Ok(());
            }
            let labels = state.labels();
            if labels != announced {
                announced = labels;
                drop(state);
                waiting(&announced);
                state = self.shared.lock();
                continue;
            }
            let now = Instant::now();
            if now >= deadline {
                let mut asked = false;
                if !stopping {
                    for stop in state.work.values().filter_map(|work| work.stop.as_ref()) {
                        stop.store(true, Ordering::SeqCst);
                        asked = true;
                    }
                    stopping = true;
                }
                if asked {
                    deadline = now + grace;
                    continue;
                }
                state.release();
                drop(state);
                self.shared.changed.notify_all();
                return Err(still_working(&labels));
            }
            state = self
                .shared
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    fn ready(&self, owner: &str, close_terminals: bool) -> Result<(), String> {
        let mut state = self.shared.lock();
        if state.owner.as_deref() != Some(owner) || state.restarting {
            return Err("Update restart preparation is no longer active in this window".into());
        }
        state.ready = true;
        state.close_terminals = close_terminals;
        Ok(())
    }

    fn start_restart(&self, owner: &str) -> Result<bool, String> {
        let mut state = self.shared.lock();
        if state.owner.as_deref() != Some(owner) || !state.ready || state.restarting {
            return Err("Save the workspace and prepare the update before restarting".into());
        }
        state.restarting = true;
        Ok(state.close_terminals)
    }

    fn cancel(&self, owner: &str) -> Result<(), String> {
        let mut state = self.shared.lock();
        if state.owner.is_none() {
            return Ok(());
        }
        if state.owner.as_deref() != Some(owner) {
            return Err("Another workspace owns the update restart".into());
        }
        if state.restarting {
            return Err("The update restart is already in progress".into());
        }
        state.release();
        drop(state);
        // A restart still waiting for work wakes and gives up.
        self.shared.changed.notify_all();
        Ok(())
    }

    fn restart_failed(&self, owner: &str) {
        let mut state = self.shared.lock();
        if state.owner.as_deref() == Some(owner) {
            state.release();
            drop(state);
            self.shared.changed.notify_all();
        }
    }

    fn owns(&self, owner: &str) -> bool {
        self.shared.lock().owner.as_deref() == Some(owner)
    }
}

pub(crate) fn update_window_event(app: &AppHandle, label: &str, event: &tauri::WindowEvent) {
    let Some(state) = app.try_state::<UpdateRestartState>() else {
        return;
    };
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } if state.owns(label) => api.prevent_close(),
        tauri::WindowEvent::Destroyed => {
            // Unexpected owner destruction must not strand the app in a
            // prepared state. A normal restart already owns final shutdown.
            let _ = state.cancel(label);
        }
        _ => {}
    }
}

/// Start native work that a restart waits for. `label` names it in plain
/// words for "Aven is still …", such as "starting a terminal".
pub(crate) fn begin_runtime_work(
    app: &AppHandle,
    label: &'static str,
) -> Result<RuntimeWorkPermit, String> {
    app.try_state::<UpdateRestartState>()
        .ok_or("Update restart guard is unavailable")?
        .begin_work(label, false)
}

/// Like `begin_runtime_work`, for work that can stop early without losing
/// anything. It checks `RuntimeWorkPermit::stop_requested` and stops promptly.
pub(crate) fn begin_stoppable_runtime_work(
    app: &AppHandle,
    label: &'static str,
) -> Result<RuntimeWorkPermit, String> {
    app.try_state::<UpdateRestartState>()
        .ok_or("Update restart guard is unavailable")?
        .begin_work(label, true)
}

/// Reserve the restart off the async runtime: waiting for work to finish
/// blocks. The owner window hears what the restart is waiting for.
async fn reserve_restart(app: &AppHandle, owner: &str) -> Result<(), String> {
    let app = app.clone();
    let owner = owner.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let target = EventTarget::webview(owner.as_str());
        app.state::<UpdateRestartState>().reserve(
            &owner,
            WORK_PATIENCE,
            WORK_STOP_GRACE,
            |labels| {
                let _ = app.emit_to(target.clone(), WAITING_EVENT, labels);
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn update_caller(caller: &Webview) -> Result<&str, String> {
    if !is_workspace_label(caller.label()) || caller.window().label() != caller.label() {
        return Err("Update restart must be requested from the workspace window".into());
    }
    Ok(caller.label())
}

fn check_update_windows(owner: &str, labels: &[String]) -> Result<(), String> {
    let content: Vec<_> = labels
        .iter()
        .filter(|label| {
            !label.starts_with("access-panel-")
                && !label.starts_with("usage-panel-")
                && !label.starts_with("workspace-menu-panel-")
        })
        .collect();
    if content.len() != 1 || content[0] != owner {
        return Err("Return Picture in Picture and detached tabs, then close other Aven windows before restarting to update. The update will stay downloaded and ready.".into());
    }
    Ok(())
}

async fn check_update_idle(
    app: &AppHandle,
    owner: &str,
    close_terminals: bool,
) -> Result<usize, String> {
    check_update_windows(owner, &app.windows().into_keys().collect::<Vec<_>>())?;
    app.try_state::<crate::control::ControlHost>()
        .ok_or("Agent activity could not be checked")?
        .ensure_update_idle()?;
    app.try_state::<crate::pty::PtyHost>()
        .ok_or("Terminal activity could not be checked")?
        .ensure_update_idle(close_terminals)
}

#[tauri::command]
pub async fn prepare_update_restart(caller: Webview) -> Result<UpdateRestartPreparation, String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    reserve_restart(app, owner).await?;
    // Reservation prevents terminal creation/input while the frontend asks for
    // consent. Existing terminals keep running until the actual restart.
    let open_terminals = match check_update_idle(app, owner, true).await {
        Ok(count) => count,
        Err(error) => {
            let _ = state.cancel(owner);
            return Err(error);
        }
    };
    match crate::browser::prepare_update_restart(app).await {
        Ok(browser_states) => Ok(UpdateRestartPreparation {
            browser_states,
            open_terminals,
        }),
        Err(error) => {
            // Always leave update mode, even if a tab could not be restored:
            // a held reservation blocks every later task and browser action.
            let _ = crate::browser::cancel_update_restart(app).await;
            let _ = state.cancel(owner);
            Err(error)
        }
    }
}

/// The frontend calls this after strict persistence, before installing bytes.
/// Browser tabs are closed without overriding a page's unsaved-work warning.
#[tauri::command]
pub async fn finish_update_restart_preparation(
    caller: Webview,
    close_terminals: Option<bool>,
) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    if !state.owns(owner) {
        return Err("Update restart preparation is no longer active in this window".into());
    }
    let close_terminals = close_terminals.unwrap_or(false);
    if let Err(error) = check_update_idle(app, owner, close_terminals).await {
        let _ = crate::browser::cancel_update_restart(app).await;
        let _ = state.cancel(owner);
        return Err(error);
    }
    if let Err(error) = crate::browser::finish_update_restart(app).await {
        let _ = crate::browser::cancel_update_restart(app).await;
        let _ = state.cancel(owner);
        return Err(error);
    }
    state.ready(owner, close_terminals)
}

#[tauri::command]
pub async fn cancel_update_restart(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let restored = if app.state::<UpdateRestartState>().owns(owner) {
        crate::browser::cancel_update_restart(app).await
    } else {
        Ok(())
    };
    app.state::<UpdateRestartState>().cancel(owner)?;
    restored
}

#[tauri::command]
pub async fn relaunch_after_update(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    let close_terminals = state.start_restart(owner)?;
    let result = async {
        ensure_restart_idle(app, owner, close_terminals).await?;
        #[cfg(all(feature = "chromium", target_os = "macos"))]
        crate::browser::prepare_shutdown(app).await?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        state.restart_failed(owner);
        return Err(error);
    }
    prepare_process_exit(app);
    // Unlike a raw plugin/process restart, this delivers the normal Exit event
    // after Chromium shutdown and lets Tauri own the one replacement process.
    app.request_restart();
    Ok(())
}

async fn ensure_restart_idle(
    app: &AppHandle,
    owner: &str,
    close_terminals: bool,
) -> Result<(), String> {
    check_update_idle(app, owner, close_terminals).await?;
    crate::browser::ensure_update_idle(app).await
}

/// Windows installs through the NSIS installer: Tauri's updater starts it and
/// exits Aven at once, then the installer reopens Aven. The final idle checks a
/// macOS restart makes therefore run here, before the installer is started.
/// Agent and terminal processes belong to Aven's kill-on-close job object, so
/// the process exit stops them without a separate shutdown pass.
#[tauri::command]
pub async fn prepare_update_install(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    let close_terminals = state.start_restart(owner)?;
    if let Err(error) = ensure_restart_idle(app, owner, close_terminals).await {
        state.restart_failed(owner);
        return Err(error);
    }
    Ok(())
}

/// Leave update mode when the Windows installer could not be started, so new
/// work is accepted again and the downloaded update stays ready to retry.
#[tauri::command]
pub async fn abandon_update_install(caller: Webview) -> Result<(), String> {
    let owner = update_caller(&caller)?;
    let app = caller.app_handle();
    let state = app.state::<UpdateRestartState>();
    if !state.owns(owner) {
        return Ok(());
    }
    let restored = crate::browser::cancel_update_restart(app).await;
    state.restart_failed(owner);
    restored
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    impl UpdateRestartState {
        fn work(&self) -> Result<RuntimeWorkPermit, String> {
            self.begin_work("starting a terminal", false)
        }

        fn reserve_now(&self, owner: &str) -> Result<(), String> {
            self.reserve(owner, Duration::ZERO, Duration::ZERO, |_| {})
        }
    }

    /// Reserve on a worker thread; report each "waiting for" list, then the result.
    fn reserve_in_background(
        guard: &Arc<UpdateRestartState>,
        patience: Duration,
        grace: Duration,
    ) -> (
        mpsc::Receiver<Vec<&'static str>>,
        std::thread::JoinHandle<Result<(), String>>,
    ) {
        let (send, waiting) = mpsc::channel();
        let guard = guard.clone();
        let worker = std::thread::spawn(move || {
            guard.reserve("main", patience, grace, |labels| {
                let _ = send.send(labels.to_vec());
            })
        });
        (waiting, worker)
    }

    #[test]
    fn a_restart_waits_for_running_work_while_refusing_new_work() {
        let guard = Arc::new(UpdateRestartState::default());
        let terminal = guard.work().unwrap();
        let (waiting, worker) =
            reserve_in_background(&guard, Duration::from_secs(30), Duration::ZERO);
        assert_eq!(waiting.recv().unwrap(), ["starting a terminal"]);
        let refused = guard.begin_work("opening a browser page", false);
        assert_eq!(refused.err().as_deref(), Some(UPDATE_BUSY));
        drop(terminal);
        worker.join().unwrap().unwrap();
        assert!(guard.owns("main"));
        assert!(guard.work().is_err());
        guard.cancel("main").unwrap();
        assert!(guard.work().is_ok());
    }

    #[test]
    fn waiting_names_each_kind_of_work_once() {
        let guard = Arc::new(UpdateRestartState::default());
        let first = guard.begin_work("updating Claude Code", true).unwrap();
        let second = guard.work().unwrap();
        let third = guard.work().unwrap();
        let (waiting, worker) =
            reserve_in_background(&guard, Duration::from_secs(30), Duration::ZERO);
        assert_eq!(
            waiting.recv().unwrap(),
            ["starting a terminal", "updating Claude Code"]
        );
        drop(second);
        drop(first);
        assert_eq!(waiting.recv().unwrap(), ["starting a terminal"]);
        drop(third);
        worker.join().unwrap().unwrap();
    }

    #[test]
    fn unfinished_work_is_named_and_the_restart_steps_aside() {
        let guard = UpdateRestartState::default();
        let _terminal = guard.work().unwrap();
        let _page = guard.begin_work("opening a browser page", false).unwrap();
        let started = Instant::now();
        let error = guard
            .reserve(
                "main",
                Duration::from_millis(30),
                Duration::from_secs(30),
                |_| {},
            )
            .unwrap_err();
        assert_eq!(
            error,
            "Aven couldn't restart yet because it is still opening a browser page and starting a terminal. Try again in a moment. The update will stay downloaded and ready."
        );
        // Nothing here can stop early, so the restart does not wait for a grace period.
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!guard.owns("main"));
        assert!(guard.work().is_ok());
    }

    #[test]
    fn stoppable_work_is_asked_to_stop_only_after_the_wait() {
        let guard = Arc::new(UpdateRestartState::default());
        let update = guard.begin_work("updating Claude Code", true).unwrap();
        let (asked, was_asked) = mpsc::channel();
        let started = Instant::now();
        let updater = std::thread::spawn(move || {
            while !update.stop_requested() {
                std::thread::park_timeout(Duration::from_millis(5));
            }
            asked.send(started.elapsed()).unwrap();
        });
        let (_, worker) =
            reserve_in_background(&guard, Duration::from_millis(50), Duration::from_secs(30));
        worker.join().unwrap().unwrap();
        assert!(was_asked.recv().unwrap() >= Duration::from_millis(50));
        updater.join().unwrap();
        assert!(guard.owns("main"));
    }

    #[test]
    fn work_that_ignores_a_stop_request_is_named_after_the_grace_period() {
        let guard = UpdateRestartState::default();
        let update = guard.begin_work("updating Codex", true).unwrap();
        let error = guard
            .reserve(
                "main",
                Duration::from_millis(10),
                Duration::from_millis(10),
                |_| {},
            )
            .unwrap_err();
        assert!(update.stop_requested());
        assert!(error.contains("still updating Codex"), "{error}");
        assert!(!guard.owns("main"));
    }

    #[test]
    fn cancelling_a_waiting_restart_ends_the_wait_and_accepts_work_again() {
        let guard = Arc::new(UpdateRestartState::default());
        let terminal = guard.work().unwrap();
        let (waiting, worker) =
            reserve_in_background(&guard, Duration::from_secs(30), Duration::ZERO);
        waiting.recv().unwrap();
        assert!(guard.cancel("window-2").is_err());
        guard.cancel("main").unwrap();
        let error = worker.join().unwrap().unwrap_err();
        assert!(error.contains("cancelled"), "{error}");
        assert!(guard.work().is_ok());
        drop(terminal);
        guard.reserve_now("main").unwrap();
    }

    #[test]
    fn a_cancelled_wait_never_claims_a_later_reservation() {
        let guard = Arc::new(UpdateRestartState::default());
        let terminal = guard.work().unwrap();
        let (waiting, worker) =
            reserve_in_background(&guard, Duration::from_secs(30), Duration::ZERO);
        waiting.recv().unwrap();
        // Cancel and reserve again without letting the first wait observe the gap.
        {
            let mut state = guard.shared.lock();
            state.release();
            state.owner = Some("main".into());
            state.reservation += 1;
        }
        guard.shared.changed.notify_all();
        assert!(worker.join().unwrap().is_err());
        drop(terminal);
        assert!(guard.owns("main"));
    }

    #[test]
    fn plain_lists_read_naturally() {
        assert_eq!(plain_list(&["a"]), "a");
        assert_eq!(plain_list(&["a", "b"]), "a and b");
        assert_eq!(plain_list(&["a", "b", "c"]), "a, b and c");
    }

    #[test]
    fn update_reservation_excludes_work_until_owner_cancels() {
        let guard = UpdateRestartState::default();
        let operation = guard.work().unwrap();
        assert!(guard.reserve_now("main").is_err());
        drop(operation);
        guard.reserve_now("main").unwrap();
        assert!(guard.work().is_err());
        assert!(guard.reserve_now("main").is_err());
        assert!(guard.cancel("window-2").is_err());
        assert!(guard.work().is_err());
        guard.cancel("main").unwrap();
        guard.cancel("main").unwrap();
        assert!(guard.work().is_ok());
    }

    #[test]
    fn update_requires_saved_preparation_and_correct_owner_before_relaunch() {
        let guard = UpdateRestartState::default();
        assert!(guard.reserve_now("pip-session-a").is_err());
        assert!(guard.start_restart("main").is_err());
        guard.reserve_now("main").unwrap();
        assert!(guard.start_restart("main").is_err());
        assert!(guard.ready("window-2", true).is_err());
        guard.ready("main", false).unwrap();
        assert!(guard.start_restart("window-2").is_err());
        assert!(!guard.start_restart("main").unwrap());
        assert!(guard.start_restart("main").is_err());
        assert!(guard.cancel("main").is_err());
        assert!(guard.work().is_err());
        guard.restart_failed("window-2");
        assert!(guard.work().is_err());
        guard.restart_failed("main");
        assert!(guard.work().is_ok());
    }

    #[test]
    fn abandoned_installer_start_returns_to_normal_work_and_must_prepare_again() {
        // Windows: prepare_update_install starts the restart, then a failed
        // installer launch abandons it. Ordinary cancel cannot undo a started
        // restart, so the dedicated abandon path must release the guard.
        let guard = UpdateRestartState::default();
        guard.reserve_now("main").unwrap();
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("main").unwrap());
        assert!(guard.work().is_err());
        assert!(guard.cancel("main").is_err());
        assert!(guard.owns("main"));
        guard.restart_failed("main");
        assert!(!guard.owns("main"));
        assert!(guard.work().is_ok());
        guard.reserve_now("main").unwrap();
        assert!(guard.start_restart("main").is_err());
    }

    #[test]
    fn cancelled_update_must_persist_again_before_another_restart() {
        let guard = UpdateRestartState::default();
        guard.reserve_now("main").unwrap();
        guard.ready("main", true).unwrap();
        guard.cancel("main").unwrap();
        guard.reserve_now("main").unwrap();
        assert!(guard.start_restart("main").is_err());
    }

    #[test]
    fn terminal_close_consent_belongs_to_the_prepared_owner() {
        let guard = UpdateRestartState::default();
        guard.reserve_now("main").unwrap();
        assert!(guard.ready("window-2", true).is_err());
        assert!(guard.start_restart("main").is_err());
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("window-2").is_err());
        assert!(guard.start_restart("main").unwrap());
    }

    #[test]
    fn cancelling_or_failing_an_update_does_not_reuse_terminal_close_consent() {
        let guard = UpdateRestartState::default();
        guard.reserve_now("main").unwrap();
        guard.ready("main", true).unwrap();
        guard.cancel("main").unwrap();

        guard.reserve_now("main").unwrap();
        guard.ready("main", false).unwrap();
        assert!(!guard.start_restart("main").unwrap());
        guard.restart_failed("main");

        guard.reserve_now("main").unwrap();
        guard.ready("main", true).unwrap();
        assert!(guard.start_restart("main").unwrap());
        guard.restart_failed("main");

        guard.reserve_now("window-2").unwrap();
        guard.ready("window-2", false).unwrap();
        assert!(!guard.start_restart("window-2").unwrap());
    }

    #[test]
    fn update_blocks_extra_content_windows_but_not_ephemeral_panels() {
        let labels = |values: &[&str]| {
            values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        };
        assert!(check_update_windows("main", &labels(&["main"])).is_ok());
        assert!(check_update_windows(
            "main",
            &labels(&[
                "main",
                "usage-panel-a",
                "access-panel-b",
                "workspace-menu-panel-c"
            ])
        )
        .is_ok());
        for extra in [
            "window-2",
            "pip-session-a",
            "workspace-detached-a",
            "preview-float-1",
            "unknown-window",
        ] {
            assert!(check_update_windows("main", &labels(&["main", extra])).is_err());
        }
        assert!(check_update_windows("main", &[]).is_err());
        assert!(check_update_windows("main", &labels(&["window-2"])).is_err());
    }

    #[test]
    fn operation_permit_holds_exclusion_on_a_worker_thread() {
        let guard = UpdateRestartState::default();
        let permit = guard.work().unwrap();
        let (release, released) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _permit = permit;
            released.recv().unwrap();
        });
        assert!(guard.reserve_now("main").is_err());
        release.send(()).unwrap();
        worker.join().unwrap();
        guard.reserve_now("main").unwrap();
        assert!(guard.work().is_err());
    }
}
