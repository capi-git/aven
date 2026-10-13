//! One shared keep-awake hold for the whole app.
//!
//! Three kinds of demand share it, so they never fight over one switch:
//! - Automations waiting to run (Settings: keep awake for automations). Only
//!   idle system sleep is held off; App Nap is unchanged while merely waiting.
//! - Agent sessions that are working, reported by each window as its set of
//!   busy chats (Settings: keep the Mac awake while agents work).
//! - In-flight browser-agent requests, counted by an RAII guard so every exit
//!   path, including a panic, releases them.
//!
//! While agents work, macOS gets both a `PreventUserIdleSystemSleep` power
//! assertion and an `NSActivityUserInitiated` activity, which also keeps App
//! Nap from slowing Aven's timers. The display may still sleep and the screen
//! may still lock; closing the lid or choosing Sleep still sleeps the Mac.
//! macOS drops both automatically if Aven exits or crashes.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A window that stops reporting (a hung or reloaded renderer that never
/// sent its empty set) loses its claim after this long. Windows refresh a
/// non-empty set every minute.
const STALE_AFTER: Duration = Duration::from_secs(5 * 60);
const MAX_SESSIONS: usize = 512;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Want {
    /// Hold off idle system sleep.
    pub system: bool,
    /// Keep the process at user-initiated priority (no App Nap).
    pub activity: bool,
}

#[derive(Debug)]
struct Demand {
    automations: bool,
    agents_enabled: bool,
    windows: HashMap<String, (HashSet<String>, Instant)>,
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
            && (self.requests > 0
                || self.windows.values().any(|(sessions, seen)| {
                    !sessions.is_empty() && now.duration_since(*seen) < STALE_AFTER
                }))
    }

    fn want(&self, now: Instant) -> Want {
        let agents = self.agents_working(now);
        Want {
            system: self.automations || agents,
            activity: agents,
        }
    }

    fn prune(&mut self, now: Instant) {
        self.windows.retain(|_, (sessions, seen)| {
            !sessions.is_empty() && now.duration_since(*seen) < STALE_AFTER
        });
    }
}

pub(crate) trait Backend: Send {
    fn set_system(&mut self, on: bool);
    fn set_activity(&mut self, on: bool);
}

struct Keeper<B: Backend> {
    demand: Demand,
    applied: Want,
    backend: B,
}

impl<B: Backend> Keeper<B> {
    fn new(backend: B) -> Self {
        Self {
            demand: Demand::default(),
            applied: Want::default(),
            backend,
        }
    }

    /// Apply only the changes, so repeated identical reports are free.
    fn apply(&mut self, now: Instant) -> Want {
        self.demand.prune(now);
        let want = self.demand.want(now);
        if want.system != self.applied.system {
            self.backend.set_system(want.system);
        }
        if want.activity != self.applied.activity {
            self.backend.set_activity(want.activity);
        }
        self.applied = want;
        want
    }

    fn set_automations(&mut self, on: bool, now: Instant) -> Want {
        self.demand.automations = on;
        self.apply(now)
    }

    fn set_window(
        &mut self,
        window: &str,
        enabled: bool,
        sessions: HashSet<String>,
        now: Instant,
    ) -> Want {
        self.demand.agents_enabled = enabled;
        if sessions.is_empty() {
            self.demand.windows.remove(window);
        } else {
            self.demand
                .windows
                .insert(window.to_owned(), (sessions, now));
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

/// Each window reports its working chats; an empty list releases its claim.
/// Declarative rather than acquire/release, so a reload or crash cannot leave
/// an unbalanced count: a closed window is forgotten, and a silent one expires.
#[tauri::command]
pub fn agent_keep_awake(
    caller: tauri::Webview,
    enabled: bool,
    session_ids: Vec<String>,
) -> Result<(), String> {
    if session_ids.len() > MAX_SESSIONS || !session_ids.iter().all(|id| valid_session(id)) {
        return Err("Invalid agent sessions".into());
    }
    let sessions = session_ids.into_iter().collect();
    with(|keeper| keeper.set_window(caller.label(), enabled, sessions, Instant::now()));
    ensure_watchdog();
    Ok(())
}

/// Expire silent windows without waiting for another report.
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
        fn set_system(&mut self, on: bool) {
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
        }

        fn set_activity(&mut self, on: bool) {
            let Some(info) = process_info() else { return };
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
        fn set_system(&mut self, on: bool) {
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
        }

        fn set_activity(&mut self, _: bool) {}
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    #[derive(Default)]
    pub(super) struct Native;

    impl super::Backend for Native {
        fn set_system(&mut self, _: bool) {}
        fn set_activity(&mut self, _: bool) {}
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
    }

    impl Backend for Fake {
        fn set_system(&mut self, on: bool) {
            assert_ne!(self.system, on, "redundant system change");
            self.system = on;
            self.calls += 1;
        }
        fn set_activity(&mut self, on: bool) {
            assert_ne!(self.activity, on, "redundant activity change");
            self.activity = on;
            self.calls += 1;
        }
    }

    fn set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|id| (*id).to_owned()).collect()
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
        assert!(valid_session("4b0e-12"));
        assert!(!valid_session(""));
        assert!(!valid_session("a/b"));
        assert!(!valid_session(&"x".repeat(81)));
    }
}
