//! One shared keep-awake hold for the whole app.
//!
//! Three kinds of demand share it, so they never fight over one switch:
//! - Automations waiting to run (Settings: keep awake for automations). Only
//!   idle system sleep is held off; App Nap is unchanged while merely waiting.
//! - Agent sessions that are working, reported by each window as its set of
//!   working chats (Settings: keep the Mac awake while agents work). Chats
//!   waiting for the user are not reported. Each chat carries its own progress
//!   fingerprint; a chat that shows no progress for [`MAX_UNCHANGED_HOLD`]
//!   stops holding, so a stuck turn cannot hold the Mac awake indefinitely,
//!   however busy the other chats in its window are.
//! - In-flight browser-agent requests, counted by an RAII guard so every exit
//!   path, including a panic, releases them.
//!
//! While agents work, macOS gets both a `PreventUserIdleSystemSleep` power
//! assertion and an `NSActivityUserInitiated` activity, which also keeps App
//! Nap from slowing Aven's timers. The display may still sleep and the screen
//! may still lock; closing the lid or choosing Sleep still sleeps the Mac.
//! macOS drops both automatically if Aven exits or crashes.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A window that stops reporting (a hung or reloaded renderer that never
/// sent its empty set) loses its claim after this long. Windows refresh a
/// non-empty set every minute.
const STALE_AFTER: Duration = Duration::from_secs(5 * 60);
/// A chat reported with the same progress fingerprint for this long is
/// treated as stuck and stops holding the Mac awake until it makes progress
/// or stops and starts working again. Real turns stream output well within this.
const MAX_UNCHANGED_HOLD: Duration = Duration::from_secs(4 * 60 * 60);
const MAX_SESSIONS: usize = 512;
const MAX_PROGRESS: usize = 64;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Want {
    /// Hold off idle system sleep.
    pub system: bool,
    /// Keep the process at user-initiated priority (no App Nap).
    pub activity: bool,
}

/// One working chat in a window's report.
#[derive(Debug)]
struct Turn {
    progress: String,
    /// When this chat started working or last made progress.
    since: Instant,
    /// The unchanged-hold limit was reached and logged.
    capped: bool,
}

impl Turn {
    fn new(progress: String, now: Instant) -> Self {
        Self {
            progress,
            since: now,
            capped: false,
        }
    }

    fn holds(&self, now: Instant) -> bool {
        now.duration_since(self.since) < MAX_UNCHANGED_HOLD
    }
}

/// One window's working chats, each with its own progress.
#[derive(Debug)]
struct Claim {
    sessions: HashMap<String, Turn>,
    /// Last report from the window.
    seen: Instant,
}

impl Claim {
    fn fresh(&self, now: Instant) -> bool {
        !self.sessions.is_empty() && now.duration_since(self.seen) < STALE_AFTER
    }

    fn holds(&self, now: Instant) -> bool {
        self.fresh(now) && self.sessions.values().any(|turn| turn.holds(now))
    }
}

#[derive(Debug)]
struct Demand {
    automations: bool,
    agents_enabled: bool,
    windows: HashMap<String, Claim>,
    requests: usize,
}

impl Default for Demand {
    fn default() -> Self {
        Self {
            automations: false,
            // On by default; a window sends the saved preference on start.
            agents_enabled: true,
            windows: HashMap::new(),
            requests: 0,
        }
    }
}

impl Demand {
    fn agents_working(&self, now: Instant) -> bool {
        self.agents_enabled
            && (self.requests > 0 || self.windows.values().any(|claim| claim.holds(now)))
    }

    fn want(&self, now: Instant) -> Want {
        let agents = self.agents_working(now);
        Want {
            system: self.automations || agents,
            activity: agents,
        }
    }

    fn prune(&mut self, now: Instant) {
        // A capped chat stays (while its window keeps reporting it) so the
        // same unchanged report cannot restart its hold.
        self.windows.retain(|_, claim| claim.fresh(now));
        for (window, claim) in &mut self.windows {
            for (session, turn) in &mut claim.sessions {
                if !turn.capped && !turn.holds(now) {
                    turn.capped = true;
                    eprintln!(
                        "[keep-awake] Chat {session} in window {window} showed no progress for {} hours; it no longer keeps the computer awake.",
                        MAX_UNCHANGED_HOLD.as_secs() / 3600
                    );
                }
            }
        }
    }
}

/// Each call returns whether the platform is now in the requested state, so a
/// failed acquisition is retried on the next apply rather than recorded.
pub(crate) trait Backend: Send {
    fn set_system(&mut self, on: bool) -> bool;
    fn set_activity(&mut self, on: bool) -> bool;
}

struct Keeper<B: Backend> {
    demand: Demand,
    applied: Want,
    backend: B,
    /// A failed change was logged; stay quiet while retries keep failing.
    failure_logged: bool,
}

impl<B: Backend> Keeper<B> {
    fn new(backend: B) -> Self {
        Self {
            demand: Demand::default(),
            applied: Want::default(),
            backend,
            failure_logged: false,
        }
    }

    /// Apply only the changes, so repeated identical reports are free. Only
    /// a change the platform accepted is recorded; a failed one is retried on
    /// the next report or watchdog tick.
    fn apply(&mut self, now: Instant) -> Want {
        self.demand.prune(now);
        let want = self.demand.want(now);
        let mut failed = false;
        if want.system != self.applied.system {
            if self.backend.set_system(want.system) {
                self.applied.system = want.system;
            } else {
                failed = true;
            }
        }
        if want.activity != self.applied.activity {
            if self.backend.set_activity(want.activity) {
                self.applied.activity = want.activity;
            } else {
                failed = true;
            }
        }
        if failed && !self.failure_logged {
            eprintln!("[keep-awake] The system did not accept a sleep hold change; retrying.");
        }
        self.failure_logged = failed;
        want
    }

    fn set_automations(&mut self, on: bool, now: Instant) -> Want {
        self.demand.automations = on;
        self.apply(now)
    }

    /// `sessions` maps each working chat to its progress fingerprint. A chat
    /// keeps its start time while its fingerprint is unchanged; chats that
    /// join, leave or progress never reset the others.
    fn set_window(
        &mut self,
        window: &str,
        enabled: bool,
        sessions: HashMap<String, String>,
        now: Instant,
    ) -> Want {
        self.demand.agents_enabled = enabled;
        if sessions.is_empty() {
            self.demand.windows.remove(window);
        } else {
            let mut previous = self
                .demand
                .windows
                .remove(window)
                .map(|claim| claim.sessions)
                .unwrap_or_default();
            let sessions = sessions
                .into_iter()
                .map(|(id, progress)| {
                    let turn = match previous.remove(&id) {
                        Some(turn) if turn.progress == progress => turn,
                        _ => Turn::new(progress, now),
                    };
                    (id, turn)
                })
                .collect();
            self.demand.windows.insert(
                window.to_owned(),
                Claim {
                    sessions,
                    seen: now,
                },
            );
        }
        self.apply(now)
    }

    fn forget_window(&mut self, window: &str, now: Instant) -> Want {
        self.demand.windows.remove(window);
        self.apply(now)
    }

    fn begin_request(&mut self, now: Instant) -> Want {
        self.demand.requests += 1;
        self.apply(now)
    }

    fn end_request(&mut self, now: Instant) -> Want {
        self.demand.requests = self.demand.requests.saturating_sub(1);
        self.apply(now)
    }
}

fn keeper() -> &'static Mutex<Keeper<platform::Native>> {
    static KEEPER: OnceLock<Mutex<Keeper<platform::Native>>> = OnceLock::new();
    KEEPER.get_or_init(|| Mutex::new(Keeper::new(platform::Native::default())))
}

fn with<T>(operation: impl FnOnce(&mut Keeper<platform::Native>) -> T) -> T {
    let mut keeper = keeper().lock().unwrap_or_else(|error| error.into_inner());
    operation(&mut keeper)
}

/// Automations waiting to run (system sleep only).
pub(crate) fn set_automations(on: bool) {
    with(|keeper| keeper.set_automations(on, Instant::now()));
    // Also retries a hold the system refused.
    if on {
        ensure_watchdog();
    }
}

/// The window closed; its busy chats no longer hold the Mac awake.
pub(crate) fn forget_window(window: &str) {
    with(|keeper| keeper.forget_window(window, Instant::now()));
}

/// Held for the life of one browser-agent request.
pub(crate) struct RequestHold(());

impl Drop for RequestHold {
    fn drop(&mut self) {
        with(|keeper| keeper.end_request(Instant::now()));
    }
}

pub(crate) fn hold_request() -> RequestHold {
    with(|keeper| keeper.begin_request(Instant::now()));
    RequestHold(())
}

fn valid_session(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_progress(progress: &str) -> bool {
    progress.len() <= MAX_PROGRESS && progress.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Pair each reported chat with its progress fingerprint (empty if none).
fn session_progress(
    session_ids: Vec<String>,
    progress: Option<HashMap<String, String>>,
) -> Result<HashMap<String, String>, String> {
    if session_ids.len() > MAX_SESSIONS || !session_ids.iter().all(|id| valid_session(id)) {
        return Err("Invalid agent sessions".into());
    }
    let mut progress = progress.unwrap_or_default();
    if progress.len() > MAX_SESSIONS
        || !progress
            .iter()
            .all(|(id, value)| valid_session(id) && valid_progress(value))
    {
        return Err("Invalid agent progress".into());
    }
    Ok(session_ids
        .into_iter()
        .map(|id| {
            let value = progress.remove(&id).unwrap_or_default();
            (id, value)
        })
        .collect())
}

/// Each window reports its working chats; an empty list releases its claim.
/// Declarative rather than acquire/release, so a reload or crash cannot leave
/// an unbalanced count: a closed window is forgotten, and a silent one expires.
/// `progress` maps each chat to an opaque fingerprint of its latest output.
#[tauri::command]
pub fn agent_keep_awake(
    caller: tauri::Webview,
    enabled: bool,
    session_ids: Vec<String>,
    progress: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let sessions = session_progress(session_ids, progress)?;
    with(|keeper| keeper.set_window(caller.label(), enabled, sessions, Instant::now()));
    ensure_watchdog();
    Ok(())
}

/// Expire silent windows and retry refused holds without waiting for another
/// report.
fn ensure_watchdog() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let _ = std::thread::Builder::new()
            .name("aven-keep-awake".into())
            .spawn(|| loop {
                std::thread::sleep(Duration::from_secs(60));
                with(|keeper| keeper.apply(Instant::now()));
            });
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;
    use std::ffi::{c_char, c_void};

    type Cf = *const c_void;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(kind: Cf, level: u32, name: Cf, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
        fn CFRelease(value: Cf);
    }

    const UTF8: u32 = 0x0800_0100;
    const ASSERTION_LEVEL_ON: u32 = 255;
    /// NSActivityUserInitiated: includes NSActivityIdleSystemSleepDisabled and
    /// keeps App Nap off. NSActivityUserInitiatedAllowingIdleSystemSleep would not.
    const ACTIVITY_USER_INITIATED: u64 = 0x00FF_FFFF;

    /// Retained activity token. NSProcessInfo's activity API is thread-safe.
    struct Activity(Retained<AnyObject>);
    // SAFETY: the token is an immutable NSObject only passed back to
    // NSProcessInfo, whose begin/end activity API may be called on any thread.
    unsafe impl Send for Activity {}

    #[derive(Default)]
    pub(super) struct Native {
        assertion: Option<u32>,
        activity: Option<Activity>,
    }

    fn cf_string(text: &std::ffi::CStr) -> Cf {
        unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8) }
    }

    fn process_info() -> Option<*mut AnyObject> {
        let class = AnyClass::get(c"NSProcessInfo")?;
        let info: *mut AnyObject = unsafe { msg_send![class, processInfo] };
        (!info.is_null()).then_some(info)
    }

    impl super::Backend for Native {
        fn set_system(&mut self, on: bool) -> bool {
            if on && self.assertion.is_none() {
                let kind = cf_string(c"PreventUserIdleSystemSleep");
                let name = cf_string(c"Aven agents or automations are working");
                if !kind.is_null() && !name.is_null() {
                    let mut id = 0_u32;
                    if unsafe {
                        IOPMAssertionCreateWithName(kind, ASSERTION_LEVEL_ON, name, &mut id)
                    } == 0
                    {
                        self.assertion = Some(id);
                    }
                }
                for value in [kind, name] {
                    if !value.is_null() {
                        unsafe { CFRelease(value) };
                    }
                }
            } else if !on {
                if let Some(id) = self.assertion.take() {
                    unsafe { IOPMAssertionRelease(id) };
                }
            }
            self.assertion.is_some() == on
        }

        fn set_activity(&mut self, on: bool) -> bool {
            let Some(info) = process_info() else {
                return !on;
            };
            if on && self.activity.is_none() {
                let reason = NSString::from_str("Aven agents are working");
                let token: Option<Retained<AnyObject>> = unsafe {
                    msg_send![info, beginActivityWithOptions: ACTIVITY_USER_INITIATED, reason: &*reason]
                };
                self.activity = token.map(Activity);
            } else if !on {
                if let Some(Activity(token)) = self.activity.take() {
                    let _: () = unsafe { msg_send![info, endActivity: &*token] };
                }
            }
            self.activity.is_some() == on
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{channel, Sender};
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    /// The request belongs to the thread that made it, so a parked thread
    /// holds it until the sender is dropped.
    #[derive(Default)]
    pub(super) struct Native {
        hold: Option<Sender<()>>,
    }

    impl super::Backend for Native {
        fn set_system(&mut self, on: bool) -> bool {
            if on && self.hold.is_none() {
                let (release, released) = channel::<()>();
                let spawned = std::thread::Builder::new()
                    .name("aven-keep-awake-hold".into())
                    .spawn(move || {
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                        let _ = released.recv();
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                    });
                if spawned.is_ok() {
                    self.hold = Some(release);
                }
            } else if !on {
                self.hold.take();
            }
            self.hold.is_some() == on
        }

        fn set_activity(&mut self, _: bool) -> bool {
            true
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    #[derive(Default)]
    pub(super) struct Native;

    impl super::Backend for Native {
        fn set_system(&mut self, _: bool) -> bool {
            true
        }
        fn set_activity(&mut self, _: bool) -> bool {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        system: bool,
        activity: bool,
        calls: usize,
        /// Fail this many system acquisitions, like a refused power assertion.
        refuse_system: usize,
    }

    impl Backend for Fake {
        fn set_system(&mut self, on: bool) -> bool {
            assert_ne!(self.system, on, "redundant system change");
            self.calls += 1;
            if on && self.refuse_system > 0 {
                self.refuse_system -= 1;
                return false;
            }
            self.system = on;
            true
        }
        fn set_activity(&mut self, on: bool) -> bool {
            assert_ne!(self.activity, on, "redundant activity change");
            self.activity = on;
            self.calls += 1;
            true
        }
    }

    /// Working chats that share one progress fingerprint.
    fn progressed(ids: &[&str], progress: &str) -> HashMap<String, String> {
        ids.iter()
            .map(|id| ((*id).to_owned(), progress.to_owned()))
            .collect()
    }

    fn set(ids: &[&str]) -> HashMap<String, String> {
        progressed(ids, "")
    }

    fn chats(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(id, progress)| ((*id).to_owned(), (*progress).to_owned()))
            .collect()
    }

    #[test]
    fn busy_sessions_hold_both_and_release_when_idle() {
        let now = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        let want = keeper.set_window("main", true, set(&["a", "b"]), now);
        assert_eq!(
            want,
            Want {
                system: true,
                activity: true
            }
        );
        // Identical reports change nothing.
        let calls = keeper.backend.calls;
        keeper.set_window("main", true, set(&["a", "b"]), now);
        keeper.set_window("main", true, set(&["b"]), now);
        assert_eq!(keeper.backend.calls, calls);
        // A second window keeps the hold while the first goes idle.
        keeper.set_window("window-2", true, set(&["c"]), now);
        keeper.set_window("main", true, set(&[]), now);
        assert!(keeper.backend.system && keeper.backend.activity);
        keeper.forget_window("window-2", now);
        assert!(!keeper.backend.system && !keeper.backend.activity);
    }

    #[test]
    fn requests_are_reference_counted_and_never_underflow() {
        let now = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        keeper.begin_request(now);
        keeper.begin_request(now);
        keeper.end_request(now);
        assert!(keeper.backend.activity);
        keeper.end_request(now);
        assert!(!keeper.backend.activity && !keeper.backend.system);
        // An extra release (never expected) cannot go negative or re-acquire.
        keeper.end_request(now);
        assert_eq!(keeper.demand.requests, 0);
        assert!(!keeper.backend.system);
    }

    #[test]
    fn automations_hold_only_system_sleep_and_combine_with_agents() {
        let now = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        assert_eq!(
            keeper.set_automations(true, now),
            Want {
                system: true,
                activity: false
            }
        );
        keeper.set_window("main", true, set(&["a"]), now);
        assert!(keeper.backend.system && keeper.backend.activity);
        // Agents finishing must not release the automations' hold.
        keeper.set_window("main", true, set(&[]), now);
        assert!(keeper.backend.system && !keeper.backend.activity);
        // Turning automations off while agents work keeps the agents' hold.
        keeper.set_window("main", true, set(&["a"]), now);
        keeper.set_automations(false, now);
        assert!(keeper.backend.system && keeper.backend.activity);
        keeper.set_window("main", true, set(&[]), now);
        assert!(!keeper.backend.system);
    }

    #[test]
    fn the_setting_disables_agent_holds_but_not_automations() {
        let now = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        keeper.set_automations(true, now);
        keeper.set_window("main", false, set(&["a"]), now);
        assert!(keeper.backend.system && !keeper.backend.activity);
        keeper.begin_request(now);
        assert!(!keeper.backend.activity);
        keeper.end_request(now);
        keeper.set_window("main", true, set(&["a"]), now);
        assert!(keeper.backend.activity);
    }

    #[test]
    fn silent_windows_expire() {
        let start = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        keeper.set_window("main", true, set(&["a"]), start);
        assert!(keeper.backend.activity);
        keeper.apply(start + STALE_AFTER - Duration::from_secs(1));
        assert!(keeper.backend.activity);
        keeper.apply(start + STALE_AFTER);
        assert!(!keeper.backend.activity && !keeper.backend.system);
        assert!(keeper.demand.windows.is_empty());
    }

    #[test]
    fn a_hold_without_progress_for_hours_is_released_until_progress() {
        let start = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        let report = |keeper: &mut Keeper<Fake>, ids: &[&str], progress: &str, at: Duration| {
            keeper.set_window("main", true, progressed(ids, progress), start + at);
        };
        // Heartbeats with the same chats and the same progress keep the
        // original start time.
        let minute = Duration::from_secs(60);
        let mut at = Duration::ZERO;
        while at < MAX_UNCHANGED_HOLD - minute {
            report(&mut keeper, &["a"], "p1", at);
            at += minute;
        }
        assert!(keeper.backend.system && keeper.backend.activity);
        report(&mut keeper, &["a"], "p1", MAX_UNCHANGED_HOLD);
        assert!(!keeper.backend.system && !keeper.backend.activity);
        assert!(keeper.demand.windows["main"].sessions["a"].capped);
        // Further identical reports cannot restart the hold.
        report(&mut keeper, &["a"], "p1", MAX_UNCHANGED_HOLD + minute);
        assert!(!keeper.backend.activity);
        // Progress restarts it.
        report(&mut keeper, &["a"], "p2", MAX_UNCHANGED_HOLD + 2 * minute);
        assert!(keeper.backend.system && keeper.backend.activity);
        // So does a change in the working chats.
        report(
            &mut keeper,
            &["a"],
            "p2",
            MAX_UNCHANGED_HOLD * 2 + 2 * minute,
        );
        assert!(!keeper.backend.activity);
        report(
            &mut keeper,
            &["a", "b"],
            "p2",
            MAX_UNCHANGED_HOLD * 2 + 3 * minute,
        );
        assert!(keeper.backend.activity);
    }

    #[test]
    fn each_chat_has_its_own_no_progress_limit() {
        let start = Instant::now();
        let minute = Duration::from_secs(60);
        let mut keeper = Keeper::new(Fake::default());
        // "stuck" never progresses while "busy" streams output and other chats
        // come and go in the same window. None of that restarts "stuck".
        let mut at = Duration::ZERO;
        let mut step = 0;
        while at < MAX_UNCHANGED_HOLD + minute {
            let busy = format!("p{step}");
            let mut report = vec![("stuck", "s"), ("busy", busy.as_str())];
            if step % 2 == 0 {
                report.push(("brief", "b"));
            }
            keeper.set_window("main", true, chats(&report), start + at);
            assert!(keeper.backend.activity, "a progressing chat holds");
            at += minute;
            step += 1;
        }
        let claim = &keeper.demand.windows["main"];
        assert!(claim.sessions["stuck"].capped);
        assert!(!claim.sessions["busy"].capped);
        // The progressing chat finishes: the stuck one alone does not hold.
        keeper.set_window("main", true, chats(&[("stuck", "s")]), start + at);
        assert!(!keeper.backend.system && !keeper.backend.activity);
        // Another chat starting does not revive it, but holds on its own.
        at += minute;
        keeper.set_window(
            "main",
            true,
            chats(&[("stuck", "s"), ("new", "n")]),
            start + at,
        );
        assert!(keeper.backend.activity);
        assert!(keeper.demand.windows["main"].sessions["stuck"].capped);
        // Its own progress restarts it.
        keeper.set_window("main", true, chats(&[("stuck", "s2")]), start + at);
        assert!(keeper.backend.activity);
        assert!(!keeper.demand.windows["main"].sessions["stuck"].capped);
    }

    #[test]
    fn pairs_each_chat_with_its_own_progress() {
        let ids = |list: &[&str]| list.iter().map(|id| (*id).to_owned()).collect::<Vec<_>>();
        let sessions =
            session_progress(ids(&["a", "b"]), Some(chats(&[("a", "f1"), ("z", "f9")]))).unwrap();
        // Missing progress is empty; progress for unreported chats is ignored.
        assert_eq!(sessions, chats(&[("a", "f1"), ("b", "")]));
        assert_eq!(session_progress(ids(&["a"]), None).unwrap(), set(&["a"]));
        assert!(session_progress(ids(&["a b"]), None).is_err());
        assert!(session_progress(ids(&["a"]), Some(chats(&[("a", "not hex!")]))).is_err());
        assert!(session_progress(ids(&["a"]), Some(chats(&[("a/b", "f")]))).is_err());
        let many = (0..=MAX_SESSIONS)
            .map(|index| (format!("s{index}"), String::new()))
            .collect();
        assert!(session_progress(ids(&["a"]), Some(many)).is_err());
    }

    #[test]
    fn the_unchanged_hold_limit_does_not_affect_automations_or_requests() {
        let start = Instant::now();
        let mut keeper = Keeper::new(Fake::default());
        keeper.set_automations(true, start);
        keeper.set_window("main", true, progressed(&["a"], "p"), start);
        keeper.set_window(
            "main",
            true,
            progressed(&["a"], "p"),
            start + MAX_UNCHANGED_HOLD,
        );
        assert!(keeper.backend.system && !keeper.backend.activity);
        keeper.begin_request(start + MAX_UNCHANGED_HOLD);
        assert!(keeper.backend.activity);
    }

    #[test]
    fn a_refused_power_assertion_is_retried_instead_of_recorded() {
        let start = Instant::now();
        let mut keeper = Keeper::new(Fake {
            refuse_system: 2,
            ..Fake::default()
        });
        keeper.set_window("main", true, progressed(&["a"], "p"), start);
        assert!(!keeper.backend.system && keeper.backend.activity);
        assert!(!keeper.applied.system && keeper.applied.activity);
        assert!(keeper.failure_logged);
        // The next heartbeat (or watchdog tick) retries.
        keeper.apply(start + Duration::from_secs(60));
        assert!(!keeper.backend.system);
        keeper.apply(start + Duration::from_secs(120));
        assert!(keeper.backend.system && keeper.applied.system);
        assert!(!keeper.failure_logged);
        // Once held, identical reports make no further calls.
        let calls = keeper.backend.calls;
        keeper.apply(start + Duration::from_secs(180));
        assert_eq!(keeper.backend.calls, calls);
        keeper.set_window("main", true, set(&[]), start);
        assert!(!keeper.backend.system && !keeper.applied.system);
    }

    #[test]
    fn request_guard_releases_on_unwind() {
        let before = with(|keeper| keeper.demand.requests);
        let result = std::panic::catch_unwind(|| {
            let _hold = hold_request();
            assert_eq!(with(|keeper| keeper.demand.requests), before + 1);
            panic!("request failed");
        });
        assert!(result.is_err());
        assert_eq!(with(|keeper| keeper.demand.requests), before);
    }

    #[test]
    fn rejects_invalid_session_ids() {
        assert!(valid_progress(""));
        assert!(valid_progress("8f3a91c2"));
        assert!(!valid_progress("a b"));
        assert!(!valid_progress(&"f".repeat(65)));
        assert!(valid_session("4b0e-12"));
        assert!(!valid_session(""));
        assert!(!valid_session("a/b"));
        assert!(!valid_session(&"x".repeat(81)));
    }
}
