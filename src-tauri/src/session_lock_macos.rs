//! Whether this Mac's login session is locked, or switched to another user.
//!
//! Agents keep working in the background while the screen is locked; Aven
//! never bypasses the lock. This helper only lets work report honestly that
//! page rendering is throttled and pixels may be unavailable.
//!
//! Shared API (any thread, cheap):
//! - [`state`]: an authoritative `CGSessionCopyCurrentDictionary` query,
//!   `{ locked, on_console }`.
//! - [`is_locked`]: locked, or this session is not on the console.
//! - [`epoch`]: increases on every observed lock or unlock, so a caller can
//!   remember "this already failed during the current lock".
//! - [`install`]: idempotent, main thread. Listens for the
//!   `com.apple.screenIsLocked` / `com.apple.screenIsUnlocked` distributed
//!   notifications, so transitions are seen promptly even between queries.
//! - [`on_change`]: run a callback (main thread) on each transition.
//! - [`LOCKED_NOTE`]: the short agent-facing explanation.
use std::ffi::{c_char, c_void};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;

pub(crate) const LOCKED_NOTE: &str =
    "The Mac is locked; page rendering is throttled and screenshots may be unavailable.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LockState {
    /// The screen is locked, or another user owns the console.
    pub locked: bool,
    /// This login session is the one on the display.
    pub on_console: bool,
}

type Cf = *const c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> Cf;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: Cf);
    fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
    fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
    fn CFGetTypeID(value: Cf) -> usize;
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: Cf) -> bool;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(number: Cf, kind: isize, output: *mut c_void) -> bool;
}

const UTF8: u32 = 0x0800_0100;
/// kCFNumberSInt64Type
const SINT64: isize = 4;

/// Pure decision from the two session keys. A missing lock key means
/// unlocked; a missing console key (no window-server session) means unknown,
/// which is reported as not locked rather than inventing a note.
pub(crate) fn decide(screen_is_locked: Option<bool>, on_console: Option<bool>) -> LockState {
    LockState {
        locked: screen_is_locked == Some(true) || on_console == Some(false),
        on_console: on_console.unwrap_or(true),
    }
}

unsafe fn flag(dictionary: Cf, name: &std::ffi::CStr) -> Option<bool> {
    let key = CFStringCreateWithCString(std::ptr::null(), name.as_ptr(), UTF8);
    if key.is_null() {
        return None;
    }
    let value = CFDictionaryGetValue(dictionary, key);
    CFRelease(key);
    if value.is_null() {
        return None;
    }
    let kind = CFGetTypeID(value);
    if kind == CFBooleanGetTypeID() {
        return Some(CFBooleanGetValue(value));
    }
    if kind == CFNumberGetTypeID() {
        let mut number = 0_i64;
        if CFNumberGetValue(value, SINT64, std::ptr::from_mut(&mut number).cast()) {
            return Some(number != 0);
        }
    }
    None
}

/// Query the window server now. Also advances [`epoch`] on a transition.
pub(crate) fn state() -> LockState {
    let current = unsafe {
        let dictionary = CGSessionCopyCurrentDictionary();
        if dictionary.is_null() {
            decide(None, None)
        } else {
            let locked = flag(dictionary, c"CGSSessionScreenIsLocked");
            let console = flag(dictionary, c"kCGSSessionOnConsoleKey");
            CFRelease(dictionary);
            decide(locked, console)
        }
    };
    observe(current.locked);
    current
}

pub(crate) fn is_locked() -> bool {
    state().locked
}

/// Lock transitions seen so far, from queries and notifications.
struct Tracker {
    /// 0 unknown, 1 unlocked, 2 locked.
    last: AtomicU8,
    epoch: AtomicU64,
}

impl Tracker {
    const fn new() -> Self {
        Self {
            last: AtomicU8::new(0),
            epoch: AtomicU64::new(0),
        }
    }

    /// Record an observation; returns true when it is a transition.
    fn observe(&self, locked: bool) -> bool {
        let next = if locked { 2 } else { 1 };
        let previous = self.last.swap(next, Ordering::AcqRel);
        if previous != 0 && previous != next {
            self.epoch.fetch_add(1, Ordering::AcqRel);
            return true;
        }
        false
    }
}

static TRACKER: Tracker = Tracker::new();

fn observe(locked: bool) -> bool {
    TRACKER.observe(locked)
}

pub(crate) fn epoch() -> u64 {
    TRACKER.epoch.load(Ordering::Acquire)
}

type Listener = Box<dyn Fn(bool) + Send + Sync>;
static LISTENERS: Mutex<Vec<Listener>> = Mutex::new(Vec::new());

// Shared with native desktop control, which reacts to lock changes.
#[allow(dead_code)]
pub(crate) fn on_change(listener: impl Fn(bool) + Send + Sync + 'static) {
    LISTENERS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .push(Box::new(listener));
}

fn notify(locked: bool) {
    // The notification name says which way it went.
    observe(locked);
    for listener in LISTENERS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .iter()
    {
        listener(locked);
    }
}

static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Main thread. Observers live for the rest of the process.
pub(crate) fn install() {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    if objc2_foundation::MainThreadMarker::new().is_none() || INSTALLED.swap(true, Ordering::AcqRel)
    {
        return;
    }
    let _ = state();
    let (Some(center_class), Some(queue_class)) = (
        AnyClass::get(c"NSDistributedNotificationCenter"),
        AnyClass::get(c"NSOperationQueue"),
    ) else {
        return;
    };
    unsafe {
        let center: *mut AnyObject = msg_send![center_class, defaultCenter];
        let queue: *mut AnyObject = msg_send![queue_class, mainQueue];
        if center.is_null() || queue.is_null() {
            return;
        }
        for (name, locked) in [
            ("com.apple.screenIsLocked", true),
            ("com.apple.screenIsUnlocked", false),
        ] {
            let block = RcBlock::new(move |_: *mut AnyObject| notify(locked));
            let name = NSString::from_str(name);
            let object: *const AnyObject = std::ptr::null();
            let observer: *mut AnyObject = msg_send![
                center,
                addObserverForName: &*name,
                object: object,
                queue: queue,
                usingBlock: &*block
            ];
            // The center retains the observer token; it is never removed.
            let _ = observer;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decides_lock_state_from_session_keys() {
        assert_eq!(
            decide(None, Some(true)),
            LockState {
                locked: false,
                on_console: true
            }
        );
        assert!(decide(Some(true), Some(true)).locked);
        assert!(!decide(Some(false), Some(true)).locked);
        // Fast user switching: our session is not on the display.
        let away = decide(None, Some(false));
        assert!(away.locked && !away.on_console);
        // No window-server session: unknown, never a false "locked".
        assert_eq!(
            decide(None, None),
            LockState {
                locked: false,
                on_console: true
            }
        );
    }

    #[test]
    fn epoch_advances_only_on_transitions() {
        let tracker = Tracker::new();
        assert!(!tracker.observe(false));
        assert!(!tracker.observe(false));
        assert!(tracker.observe(true));
        assert!(!tracker.observe(true));
        assert!(tracker.observe(false));
        assert_eq!(tracker.epoch.load(Ordering::Acquire), 2);
        // The first observation is a baseline, not a transition.
        let fresh = Tracker::new();
        assert!(!fresh.observe(true));
        assert_eq!(fresh.epoch.load(Ordering::Acquire), 0);
    }

    #[test]
    fn live_query_is_consistent() {
        // The test host is a normal login session; only check internal consistency.
        let state = state();
        assert!(state.locked || state.on_console);
    }
}
