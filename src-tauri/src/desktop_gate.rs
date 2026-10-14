//! Admission and native-event proof for one desktop request. The platform
//! adapter supplies OS facts; the gate owns consent, lock order and tickets.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use super::*;
use std::sync::Arc;
use std::time::Instant;

pub(super) trait Port: Send + Sync {
    fn status(&self) -> Result<DesktopStatus, String>;
    fn hide_cursor(&self);
    fn session_state(&self) -> presence::Session;
    fn session_changed(&self);
    fn target(&self, scope: &str, request: &Request) -> Result<PresenceTarget, String>;
    fn confirm_target(&self, target: &PresenceTarget) -> Result<(), String>;
    fn show(&self, anchor: Option<(f64, f64)>, input: bool) -> Result<(), String>;
    fn presence_changed(&self);
    fn actor_changed(&self, actor: &presence::Actor);
    fn session_alive(&self, scope: &str) -> bool;
    fn execute(&self, scope: &str, request: Request, guard: &Guard) -> Result<Value, String>;
}

/// Only admission creates this proof. Clones retain the original ticket and
/// destination when an action hops to the main thread or releases a button.
#[derive(Clone)]
pub(super) struct Guard {
    port: Arc<dyn Port>,
    store: Arc<presence::Store>,
    ticket: presence::Ticket,
    scope: String,
    target: PresenceTarget,
}

impl Guard {
    pub(super) fn target(&self) -> &PresenceTarget {
        &self.target
    }

    pub(super) fn check(&self) -> Result<(), String> {
        // Only admission records a return to Active. An in-flight action
        // cannot undo a lock notification with a lagging session read.
        let read = self.port.session_state();
        if read != presence::Session::Active && self.store.with(|state| state.observe_session(read))
        {
            self.port.session_changed();
        }
        self.store.with(|state| state.check(&self.ticket))?;
        self.port.confirm_target(&self.target)?;
        if !self.port.session_alive(&self.scope) {
            return Err("Desktop control session is unavailable.".into());
        }
        Ok(())
    }
}

fn session(port: &dyn Port, store: &presence::Store) -> Result<(), String> {
    let read = port.session_state();
    let (changed, recorded) = store.with(|state| (state.observe_session(read), state.session()));
    if changed {
        port.session_changed();
    }
    recorded
        .refusal()
        .map_or(Ok(()), |refusal| Err(refusal.into()))
}

pub(super) fn execute(
    port: Arc<dyn Port>,
    store: Arc<presence::Store>,
    control: &Mutex<()>,
    scope: &str,
    request: Request,
    connected: &dyn Fn() -> bool,
) -> Result<Value, String> {
    // Wait outside the execution lock, then re-admit from fresh OS facts.
    // The request may show at most one consent prompt.
    let mut may_prompt = true;
    let mut approved_target: Option<PresenceTarget> = None;
    loop {
        if !connected() {
            return Err(presence::CANCELLED.into());
        }
        let prompt = {
            let _lock = control.try_lock().map_err(|_| "Desktop control is busy. Wait for the current action or Settings prompt to finish, then retry.")?;
            let status = port.status()?;
            if !status.enabled
                || status
                    .permissions
                    .iter()
                    .any(|permission| !permission.granted)
            {
                port.hide_cursor();
            }
            if status.state == "unsupported" {
                return Err(UNSUPPORTED.into());
            }
            request.validate()?;
            if matches!(request, Request::Status {}) {
                return serde_json::to_value(status).map_err(|error| error.to_string());
            }
            require_action_access(&status, &request)?;
            session(&*port, &store)?;
            let input = presence::is_input(&request);
            let target = port.target(scope, &request)?;
            if input
                && (target.shared_input != (request.input_mode() == InputMode::Pointer)
                    || target.window_id != request.input_window())
            {
                return Err(
                    "Desktop input target could not be confirmed. No input was sent.".into(),
                );
            }
            if approved_target
                .as_ref()
                .is_some_and(|expected| expected != &target)
            {
                if let Some(expected) = &approved_target {
                    if expected.shared_input {
                        if let Some(identity) = &expected.app {
                            store.with(|state| state.forget_approval(scope, &identity.key));
                        }
                    }
                }
                return Err("The target changed while waiting for consent. Take a fresh screenshot before retrying.".into());
            }
            let admission = store.with(|state| {
                state.admit(
                    scope,
                    input,
                    target.app.as_ref(),
                    status.ask_before_app_use || target.shared_input,
                    may_prompt,
                    Instant::now(),
                )
            });
            match admission {
                presence::Admission::Go => {
                    return run(
                        Arc::clone(&port),
                        Arc::clone(&store),
                        scope,
                        request,
                        target,
                    );
                }
                presence::Admission::Refuse(error) => return Err(error),
                presence::Admission::Ask(id) => {
                    if let Err(error) = port.show(target.anchor, false) {
                        store.with(|state| state.withdraw(id));
                        return Err(error);
                    }
                    approved_target = Some(target);
                    id
                }
            }
        };
        may_prompt = false;
        let answer = store.wait_for_answer(prompt, || {
            connected()
                && port.session_alive(scope)
                && port.session_state() == presence::Session::Active
        });
        port.presence_changed();
        if answer.is_err() {
            session(&*port, &store)?;
        }
        answer?;
    }
}

fn run(
    port: Arc<dyn Port>,
    store: Arc<presence::Store>,
    scope: &str,
    request: Request,
    target: PresenceTarget,
) -> Result<Value, String> {
    let Some(step) = presence::step_for(&request) else {
        return Err("Status must be checked through the desktop control gate.".into());
    };
    let input = presence::is_input(&request);
    let ticket = store.with(|state| {
        let ticket = state.begin(
            scope,
            step,
            target.app.as_ref().map(|app| app.name.clone()),
            Instant::now(),
        );
        // Publish delivery and the element with the activity, so an observer
        // never mistakes background input for shared mouse/keyboard control.
        state.set_delivery(&ticket, target.shared_input, target.pid);
        state.set_element(&ticket, target.label.clone());
        ticket
    });
    let guard = Guard {
        port: Arc::clone(&port),
        store: Arc::clone(&store),
        ticket,
        scope: scope.into(),
        target,
    };
    let actor = store.with(|state| state.actor(scope));
    port.actor_changed(&actor);
    let result = port
        .show(guard.target.anchor, input)
        .and_then(|()| port.execute(scope, request, &guard));
    store.with(|state| state.end(&guard.ticket, Instant::now()));
    port.presence_changed();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::time::Duration;

    #[derive(Clone, Copy)]
    enum Answer {
        Allow,
        Decline,
        Cancel,
        Disconnect,
        Lock,
        StopAfterAllow,
    }

    #[derive(Default)]
    struct Script {
        calls: Vec<&'static str>,
        targets: VecDeque<PresenceTarget>,
        answer: Option<Answer>,
        session: presence::Session,
        status: Option<(bool, bool, bool, bool, bool)>,
        show_error: bool,
        execute_error: bool,
        stop_during_action: bool,
        pause_during_action: bool,
        lock_during_action: bool,
        target_changed: bool,
        change_target_during_action: bool,
        disconnected: bool,
        in_action: bool,
        revoked: bool,
        revoke_during_action: bool,
    }

    struct Fake {
        store: Arc<presence::Store>,
        control: Arc<Mutex<()>>,
        script: Mutex<Script>,
    }

    impl Fake {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                store: Arc::new(presence::Store::new()),
                control: Arc::new(Mutex::new(())),
                script: Mutex::new(Script::default()),
            })
        }

        fn run(self: &Arc<Self>, value: Value) -> Result<Value, String> {
            let request = serde_json::from_value(value).unwrap();
            execute(
                Arc::clone(self) as Arc<dyn Port>,
                Arc::clone(&self.store),
                &self.control,
                "chat",
                request,
                &|| !self.script.lock().unwrap().disconnected,
            )
        }

        fn calls(&self) -> Vec<&'static str> {
            self.script.lock().unwrap().calls.clone()
        }

        fn call(&self, call: &'static str) {
            self.script.lock().unwrap().calls.push(call);
        }

        fn finished(&self) {
            assert!(
                self.store
                    .with(|state| {
                        state.model(Instant::now() + presence::IDLE_FADE + Duration::from_secs(1))
                    })
                    .is_none(),
                "the presence ticket is still in flight"
            );
            assert_eq!(self.calls().last(), Some(&"presence_changed"));
        }
    }

    fn target(shared: bool, pid: i32) -> PresenceTarget {
        PresenceTarget {
            pid: Some(pid),
            window_id: Some(1),
            shared_input: shared,
            app: Some(presence::AppIdentity::new("example:1", "Example")),
            label: Some("Button".into()),
            ..PresenceTarget::default()
        }
    }

    fn click(shared: bool) -> Value {
        json!({"action":"click", "windowId":1, "x":5, "y":5,
            "inputMode":if shared { "pointer" } else { "app" }})
    }

    impl Port for Fake {
        fn status(&self) -> Result<DesktopStatus, String> {
            self.call("status");
            let (supported, enabled, screen, accessibility, ask) = self
                .script
                .lock()
                .unwrap()
                .status
                .unwrap_or((true, true, true, true, true));
            Ok(status_from(supported, enabled, screen, accessibility, ask))
        }
        fn hide_cursor(&self) {
            self.call("hide_cursor");
        }
        fn session_state(&self) -> presence::Session {
            self.call("session");
            self.script.lock().unwrap().session
        }
        fn session_changed(&self) {
            self.call("session_changed");
        }
        fn target(&self, _: &str, request: &Request) -> Result<PresenceTarget, String> {
            self.call("target");
            Ok(self
                .script
                .lock()
                .unwrap()
                .targets
                .pop_front()
                .unwrap_or_else(|| {
                    if presence::is_input(request) {
                        target(request.input_mode() == InputMode::Pointer, 10)
                    } else {
                        PresenceTarget::default()
                    }
                }))
        }
        fn confirm_target(&self, _: &PresenceTarget) -> Result<(), String> {
            self.call("confirm_target");
            if self.script.lock().unwrap().target_changed {
                Err(
                    "The target app or window changed. Take a fresh screenshot before retrying."
                        .into(),
                )
            } else {
                Ok(())
            }
        }
        fn show(&self, _: Option<(f64, f64)>, _: bool) -> Result<(), String> {
            self.call("show");
            let (error, answer) = {
                let mut script = self.script.lock().unwrap();
                (script.show_error, script.answer.take())
            };
            if error {
                return Err("show failed".into());
            }
            let prompt = self.store.with(|state| {
                state.model(Instant::now()).and_then(|model| {
                    model
                        .buttons
                        .into_iter()
                        .find_map(|button| match button.action {
                            presence::ButtonAction::Allow(id) => Some(id),
                            _ => None,
                        })
                })
            });
            if let Some(id) = prompt {
                self.call("prompt");
                match answer.unwrap_or(Answer::Allow) {
                    Answer::Allow => {
                        self.store.with(|state| state.answer(id, true));
                    }
                    Answer::Decline => {
                        self.store.with(|state| state.answer(id, false));
                    }
                    Answer::Cancel => {
                        self.store.with(|state| state.withdraw(id));
                    }
                    Answer::Disconnect => {
                        self.script.lock().unwrap().disconnected = true;
                    }
                    Answer::Lock => {
                        self.script.lock().unwrap().session = presence::Session::Locked;
                        self.store
                            .with(|state| state.notify_locked(presence::Session::Locked));
                    }
                    Answer::StopAfterAllow => {
                        self.store.with(|state| {
                            state.answer(id, true);
                            state.stop("chat", Instant::now());
                        });
                    }
                }
            }
            Ok(())
        }
        fn presence_changed(&self) {
            self.call("presence_changed");
        }
        fn actor_changed(&self, _: &presence::Actor) {
            self.call("actor_changed");
        }
        fn session_alive(&self, _: &str) -> bool {
            self.call("alive");
            let script = self.script.lock().unwrap();
            if !script.in_action {
                assert!(
                    self.control.try_lock().is_ok(),
                    "consent wait held the execution lock"
                );
            }
            !script.revoked
        }
        fn execute(&self, _: &str, _: Request, guard: &Guard) -> Result<Value, String> {
            self.call("execute");
            self.script.lock().unwrap().in_action = true;
            guard.check()?;
            let script = self.script.lock().unwrap();
            let (error, stop, pause, locked, changed, revoked) = (
                script.execute_error,
                script.stop_during_action,
                script.pause_during_action,
                script.lock_during_action,
                script.change_target_during_action,
                script.revoke_during_action,
            );
            drop(script);
            if stop {
                self.store.with(|state| state.stop("chat", Instant::now()));
            }
            if pause {
                self.store
                    .with(|state| state.pause(presence::Pause::ByUser));
            }
            if locked {
                self.script.lock().unwrap().session = presence::Session::Locked;
            }
            if changed {
                self.script.lock().unwrap().target_changed = true;
            }
            if revoked {
                self.script.lock().unwrap().revoked = true;
            }
            // A proof crosses the same thread hop as activation. There is no
            // thread-local state whose absence could silently allow input.
            let moved_guard = guard.clone();
            std::thread::spawn(move || moved_guard.check())
                .join()
                .unwrap()?;
            if error {
                return Err("execute failed".into());
            }
            self.call("input");
            Ok(json!({"done":true}))
        }
    }

    #[test]
    fn status_short_circuits_before_session_target_and_admission() {
        let fake = Fake::new();
        fake.script.lock().unwrap().session = presence::Session::Locked;
        assert_eq!(
            fake.run(json!({"action":"status"})).unwrap()["state"],
            "ready"
        );
        assert_eq!(fake.calls(), ["status"]);
    }

    #[test]
    fn unsupported_disabled_and_missing_permissions_hide_the_cursor_before_refusal() {
        for (status, message) in [
            ((false, false, false, false, true), UNSUPPORTED),
            ((true, false, true, true, true), DISABLED),
            ((true, true, false, true, true), "Aven needs Screen Recording permission to click; ask the user to allow Aven in Settings, Skills & tools."),
            ((true, true, true, false, true), "Aven needs Accessibility permission to click; ask the user to allow Aven in Settings, Skills & tools."),
        ] {
            let fake = Fake::new();
            fake.script.lock().unwrap().status = Some(status);
            assert_eq!(fake.run(click(false)).unwrap_err(), message);
            assert_eq!(fake.calls(), ["status", "hide_cursor"]);
        }
    }

    #[test]
    fn observation_needs_screen_recording_but_not_accessibility() {
        let fake = Fake::new();
        fake.script.lock().unwrap().status = Some((true, true, true, false, true));
        assert!(fake.run(json!({"action":"windows"})).is_ok());
        assert!(fake.calls().contains(&"hide_cursor"));
        assert!(!fake.calls().contains(&"prompt"));
        fake.finished();
    }

    #[test]
    fn lock_screen_refuses_before_target_resolution_or_consent() {
        for session in [presence::Session::Locked, presence::Session::Away] {
            let fake = Fake::new();
            fake.script.lock().unwrap().session = session;
            assert_eq!(
                fake.run(click(false)).unwrap_err(),
                session.refusal().unwrap()
            );
            assert_eq!(fake.calls(), ["status", "session", "session_changed"]);
            assert!(fake.run(click(false)).is_err());
            assert_eq!(
                fake.calls()
                    .iter()
                    .filter(|&&call| call == "session_changed")
                    .count(),
                1
            );
        }
    }

    #[test]
    fn a_stale_session_read_cannot_undo_a_lock_notification() {
        let fake = Fake::new();
        fake.store
            .with(|state| state.notify_locked(presence::Session::Active));
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::SCREEN_LOCKED);
        assert!(!fake.calls().contains(&"target"));
        fake.script.lock().unwrap().session = presence::Session::Away;
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::SESSION_AWAY);
        fake.script.lock().unwrap().session = presence::Session::Active;
        assert!(fake.run(click(false)).is_ok());
        fake.store
            .with(|state| state.notify_locked(presence::Session::Active));
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::SCREEN_LOCKED);
        fake.store
            .with(|state| state.notify_unlocked(presence::Session::Active));
        assert!(fake.run(click(false)).is_ok());
    }

    #[test]
    fn input_target_mismatch_never_prompts_or_sends_input() {
        for invalid in [target(true, 10), PresenceTarget::default()] {
            let fake = Fake::new();
            fake.script.lock().unwrap().targets.push_back(invalid);
            assert_eq!(
                fake.run(click(false)).unwrap_err(),
                "Desktop input target could not be confirmed. No input was sent."
            );
            assert!(!fake.calls().contains(&"show"));
            assert!(!fake.calls().contains(&"execute"));
        }
    }

    #[test]
    fn consent_is_waited_outside_the_lock_then_status_and_target_are_read_again() {
        let fake = Fake::new();
        assert!(fake.run(click(false)).is_ok());
        let calls = fake.calls();
        assert_eq!(calls.iter().filter(|&&call| call == "prompt").count(), 1);
        assert_eq!(calls.iter().filter(|&&call| call == "status").count(), 2);
        assert_eq!(calls.iter().filter(|&&call| call == "target").count(), 2);
        assert!(
            calls
                .iter()
                .position(|&call| call == "actor_changed")
                .unwrap()
                < calls.iter().position(|&call| call == "input").unwrap()
        );
        fake.finished();
        // The same chat's answer covers the pointer as well as another app.
        assert!(fake.run(click(true)).is_ok());
        assert_eq!(
            fake.calls()
                .iter()
                .filter(|&&call| call == "prompt")
                .count(),
            1
        );
    }

    #[test]
    fn a_target_change_while_waiting_is_refused_without_input_or_a_second_prompt() {
        for shared in [false, true] {
            let fake = Fake::new();
            fake.script.lock().unwrap().targets =
                VecDeque::from([target(shared, 10), target(shared, 20)]);
            assert_eq!(fake.run(click(shared)).unwrap_err(), "The target changed while waiting for consent. Take a fresh screenshot before retrying.");
            assert_eq!(
                fake.calls()
                    .iter()
                    .filter(|&&call| call == "prompt")
                    .count(),
                1
            );
            assert!(!fake.calls().contains(&"execute"));
        }
    }

    #[test]
    fn stopping_after_an_answer_cannot_show_a_second_prompt() {
        let fake = Fake::new();
        fake.script.lock().unwrap().answer = Some(Answer::StopAfterAllow);
        assert_eq!(
            fake.run(click(false)).unwrap_err(),
            "The target app changed while waiting for the user. Take a fresh screenshot and retry."
        );
        assert_eq!(
            fake.calls()
                .iter()
                .filter(|&&call| call == "prompt")
                .count(),
            1
        );
        assert!(!fake.calls().contains(&"execute"));
    }

    #[test]
    fn declined_and_cancelled_answers_never_execute() {
        for (answer, message) in [
            (Answer::Decline, "The user declined desktop control of Example. Do not retry; ask the user in the chat."),
            (Answer::Cancel, presence::CANCELLED),
        ] {
            let fake = Fake::new();
            fake.script.lock().unwrap().answer = Some(answer);
            assert_eq!(fake.run(click(false)).unwrap_err(), message);
            assert!(!fake.calls().contains(&"execute"));
        }
    }

    #[test]
    fn show_failure_withdraws_the_prompt() {
        let fake = Fake::new();
        fake.script.lock().unwrap().show_error = true;
        assert_eq!(fake.run(click(false)).unwrap_err(), "show failed");
        fake.script.lock().unwrap().show_error = false;
        assert!(
            fake.run(click(false)).is_ok(),
            "the failed prompt blocked a later request"
        );
    }

    #[test]
    fn the_ticket_ends_on_platform_execution_or_bar_failure() {
        for show_error in [false, true] {
            let fake = Fake::new();
            {
                let mut script = fake.script.lock().unwrap();
                script.status = Some((true, true, true, true, false));
                script.show_error = show_error;
                script.execute_error = !show_error;
            }
            assert_eq!(
                fake.run(click(false)).unwrap_err(),
                if show_error {
                    "show failed"
                } else {
                    "execute failed"
                }
            );
            fake.finished();
        }
    }

    #[test]
    fn proof_on_another_thread_still_refuses_stop_lock_or_window_changes() {
        for reason in ["stop", "pause", "lock", "target", "scope"] {
            let fake = Fake::new();
            {
                let mut script = fake.script.lock().unwrap();
                script.stop_during_action = reason == "stop";
                script.pause_during_action = reason == "pause";
                script.lock_during_action = reason == "lock";
                script.change_target_during_action = reason == "target";
                script.revoke_during_action = reason == "scope";
            }
            let error = fake.run(click(false)).unwrap_err();
            match reason {
                "stop" => assert_eq!(error, presence::STOPPED),
                "pause" => assert!(error.starts_with(presence::PAUSED_BY_USER)),
                "lock" => assert!(error.starts_with(presence::SCREEN_LOCKED)),
                "scope" => assert_eq!(error, "Desktop control session is unavailable."),
                _ => assert_eq!(
                    error,
                    "The target app or window changed. Take a fresh screenshot before retrying."
                ),
            }
            assert!(!fake.calls().contains(&"input"));
            assert_eq!(fake.calls().last(), Some(&"presence_changed"));
        }
    }

    #[test]
    fn disconnecting_refuses_before_any_platform_call() {
        let fake = Fake::new();
        fake.script.lock().unwrap().disconnected = true;
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::CANCELLED);
        assert!(fake.calls().is_empty());
    }

    #[test]
    fn a_disconnect_during_consent_withdraws_the_prompt_and_cancels() {
        let fake = Fake::new();
        fake.script.lock().unwrap().answer = Some(Answer::Disconnect);
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::CANCELLED);
        assert!(!fake.calls().contains(&"execute"));
        fake.script.lock().unwrap().disconnected = false;
        assert!(
            fake.run(click(false)).is_ok(),
            "the disconnected prompt was not withdrawn"
        );
    }

    #[test]
    fn a_lock_during_consent_cancels_before_readmitting_the_target() {
        let fake = Fake::new();
        fake.script.lock().unwrap().answer = Some(Answer::Lock);
        assert_eq!(fake.run(click(false)).unwrap_err(), presence::SCREEN_LOCKED);
        assert_eq!(
            fake.calls()
                .iter()
                .filter(|&&call| call == "target")
                .count(),
            1
        );
        assert!(!fake.calls().contains(&"execute"));
    }

    #[test]
    fn a_busy_control_lock_never_reads_status_or_reaches_the_os() {
        let fake = Fake::new();
        let _lock = fake.control.lock().unwrap();
        assert_eq!(fake.run(click(false)).unwrap_err(), "Desktop control is busy. Wait for the current action or Settings prompt to finish, then retry.");
        assert!(fake.calls().is_empty());
    }
}
