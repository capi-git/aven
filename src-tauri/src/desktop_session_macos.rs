//! The user's login session for desktop control. CoreGraphics is read
//! immediately before every admission and native event; lock notifications
//! additionally interrupt in-flight multi-step input at its next check.
use super::*;
use std::sync::Once;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGSessionCopyCurrentDictionary() -> Cf;
}

type NotificationCallback = unsafe extern "C" fn(Cf, *mut c_void, Cf, *const c_void, Cf);

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(boolean: Cf) -> bool;
    fn CFNotificationCenterGetDistributedCenter() -> Cf;
    fn CFNotificationCenterAddObserver(
        center: Cf,
        observer: *const c_void,
        callback: NotificationCallback,
        name: Cf,
        object: *const c_void,
        suspension: isize,
    );
}

/// kCGSessionOnConsoleKey is a CFSTR macro, so its value is spelled out.
const ON_CONSOLE_KEY: &str = "kCGSSessionOnConsoleKey";
const SCREEN_LOCKED_KEY: &str = "CGSSessionScreenIsLocked";
const LOCKED_NOTIFICATION: &str = "com.apple.screenIsLocked";
const UNLOCKED_NOTIFICATION: &str = "com.apple.screenIsUnlocked";
/// CFNotificationSuspensionBehaviorDeliverImmediately: also while Aven is in
/// the background, which is when agents usually act.
const DELIVER_IMMEDIATELY: isize = 4;

unsafe fn flag(dictionary: Cf, key: &str) -> Option<bool> {
    let key = NSString::from_str(key);
    let value = CFDictionaryGetValue(dictionary, (&*key as *const NSString).cast());
    if value.is_null() {
        return None;
    }
    let kind = CFGetTypeID(value);
    if kind == CFBooleanGetTypeID() {
        Some(CFBooleanGetValue(value))
    } else if kind == CFNumberGetTypeID() {
        let mut output = 0_i64;
        // kCFNumberSInt64Type = 4. The destination matches its exact C width.
        CFNumberGetValue(value, 4, std::ptr::from_mut(&mut output).cast()).then_some(output != 0)
    } else {
        None
    }
}

/// The current session, failing closed when no GUI session can be read.
pub(super) fn current() -> presence::Session {
    unsafe {
        let Ok(dictionary) = OwnedCf::new(CGSessionCopyCurrentDictionary(), "") else {
            return presence::Session::from_dictionary(false, None, None);
        };
        presence::Session::from_dictionary(
            true,
            flag(dictionary.0, ON_CONSOLE_KEY),
            flag(dictionary.0, SCREEN_LOCKED_KEY),
        )
    }
}

/// Hides the agent pointer and redraws the bar, which stays hidden while the
/// session is unavailable.
pub(super) fn changed() {
    agent_cursor::clear_scope(None);
    presence_ui::changed();
}

/// Records an unavailable session read during an action. Only admission
/// records a return to `Active`, so a lagging read can never undo a lock
/// notification while an action is in flight.
pub(super) fn record_unavailable(session: presence::Session) {
    if session != presence::Session::Active && presence::with(|state| state.set_session(session)) {
        changed();
    }
}

unsafe extern "C" fn screen_locked(_: Cf, _: *mut c_void, _: Cf, _: *const c_void, _: Cf) {
    // The notification is the earliest signal; record it before CoreGraphics
    // necessarily reports the lock.
    let session = match current() {
        presence::Session::Active => presence::Session::Locked,
        unavailable => unavailable,
    };
    record_unavailable(session);
}

unsafe extern "C" fn screen_unlocked(_: Cf, _: *mut c_void, _: Cf, _: *const c_void, _: Cf) {
    if presence::with(|state| state.set_session(current())) {
        changed();
    }
}

static OBSERVER: u8 = 0;

/// Subscribes once to the screen lock notifications on the main run loop.
pub(super) fn observe() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        dispatch2::DispatchQueue::main().exec_async(|| unsafe {
            let center = CFNotificationCenterGetDistributedCenter();
            if center.is_null() {
                return;
            }
            for (name, callback) in [
                (LOCKED_NOTIFICATION, screen_locked as NotificationCallback),
                (
                    UNLOCKED_NOTIFICATION,
                    screen_unlocked as NotificationCallback,
                ),
            ] {
                let name = NSString::from_str(name);
                CFNotificationCenterAddObserver(
                    center,
                    (&raw const OBSERVER).cast(),
                    callback,
                    (&*name as *const NSString).cast(),
                    std::ptr::null(),
                    DELIVER_IMMEDIATELY,
                );
                // Kept for the life of the observer, which is Aven's.
                std::mem::forget(name);
            }
            // Admission reads the session itself; this only refreshes the
            // recorded state for a Mac that was already locked at launch.
            record_unavailable(current());
        });
    });
}
