//! macOS workspace windows appear only once their interface has drawn.
//!
//! A workspace window used to be shown the moment it was created, long before
//! its page loaded. Until the interface painted, the window showed a fixed
//! launch colour, then the page's empty boot background, and with glass on the
//! desktop itself through an empty translucent window.
//!
//! Now a macOS workspace window is created hidden and ordered in fully
//! transparent: WebKit only renders, and only runs animation frames, for a
//! window it considers visible, and a hidden window's start is also throttled.
//! The page reports its first frame drawn in the saved theme
//! (`window_reveal`), and the window then becomes visible in one step. A
//! timeout reveals it anyway, so a failed start still shows its error.
//!
//! Windows and Linux create and show their window as before; there the
//! command does nothing. The bookkeeping below is shared so its tests run on
//! every platform.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Webview;
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager, Window};

/// Long enough for a normal start (well under a second), short enough that a
/// start that failed before the interface drew is not mistaken for a hang.
const RELEASE_REVEAL_TIMEOUT: Duration = Duration::from_secs(3);

/// Development builds load the interface from Vite, whose first load after a
/// fresh checkout (as in the release workflow's real-app check) transforms
/// every module on demand. On the release workflow's runner that took 9.4 s
/// for 0.1.143 and just over 10 s for 0.1.144, so allow a wide margin.
const DEVELOPMENT_REVEAL_TIMEOUT: Duration = Duration::from_secs(30);

pub const REVEAL_TIMEOUT: Duration = if cfg!(debug_assertions) {
    DEVELOPMENT_REVEAL_TIMEOUT
} else {
    RELEASE_REVEAL_TIMEOUT
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RevealReason {
    /// The page reported its first frame drawn.
    Painted,
    /// The page did not report in time.
    Timeout,
}

/// When a window was concealed and how it became visible, in milliseconds
/// since the Unix epoch. Read by Aven Dev's real-app check.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealRecord {
    pub concealed_at_ms: u64,
    pub revealed_at_ms: Option<u64>,
    pub reason: Option<RevealReason>,
    /// Whether the window was still concealed when it was revealed, so
    /// nothing else had shown it before its interface drew.
    pub concealed_until_reveal: Option<bool>,
}

struct Entry {
    generation: u64,
    record: RevealRecord,
}

/// Concealed windows by label. A generation keeps a late timeout from an
/// earlier concealment from revealing a window concealed again since.
struct Reveals {
    next: u64,
    windows: BTreeMap<String, Entry>,
}

impl Reveals {
    const fn new() -> Self {
        Self {
            next: 0,
            windows: BTreeMap::new(),
        }
    }

    fn conceal(&mut self, label: &str, now_ms: u64) -> u64 {
        self.next += 1;
        self.windows.insert(
            label.to_string(),
            Entry {
                generation: self.next,
                record: RevealRecord {
                    concealed_at_ms: now_ms,
                    revealed_at_ms: None,
                    reason: None,
                    concealed_until_reveal: None,
                },
            },
        );
        self.next
    }

    /// Claims the reveal: true once per concealment, for the first report or
    /// for a timeout that still belongs to the current concealment.
    fn begin_reveal(&mut self, label: &str, reason: RevealReason, timeout_of: Option<u64>) -> bool {
        let Some(entry) = self.windows.get_mut(label) else {
            return false;
        };
        if entry.record.reason.is_some()
            || timeout_of.is_some_and(|generation| generation != entry.generation)
        {
            return false;
        }
        entry.record.reason = Some(reason);
        true
    }

    fn finish_reveal(&mut self, label: &str, now_ms: u64, was_concealed: bool) {
        if let Some(entry) = self.windows.get_mut(label) {
            entry.record.revealed_at_ms = Some(now_ms);
            entry.record.concealed_until_reveal = Some(was_concealed);
        }
    }

    fn is_pending(&self, label: &str) -> bool {
        self.windows
            .get(label)
            .is_some_and(|entry| entry.record.reason.is_none())
    }

    fn record(&self, label: &str) -> Option<RevealRecord> {
        self.windows.get(label).map(|entry| entry.record.clone())
    }

    fn forget(&mut self, label: &str) {
        self.windows.remove(label);
    }
}

static REVEALS: Mutex<Reveals> = Mutex::new(Reveals::new());

fn reveals() -> std::sync::MutexGuard<'static, Reveals> {
    REVEALS.lock().unwrap_or_else(|err| err.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// Run on the main thread: AppKit window state belongs there. Commands
/// without `async` and the setup hook already run there.
#[cfg(target_os = "macos")]
fn on_main(app: &AppHandle, work: impl FnOnce() + Send + 'static) {
    if objc2::MainThreadMarker::new().is_some() {
        work();
        return;
    }
    let _ = app.run_on_main_thread(work);
}

/// Show a just-built, hidden workspace window without anything visible, and
/// reveal it when its page reports a drawn frame or after `REVEAL_TIMEOUT`.
#[cfg(target_os = "macos")]
pub fn conceal(window: &Window) {
    let label = window.label().to_string();
    let generation = reveals().conceal(&label, now_ms());
    let concealed = window.clone();
    on_main(window.app_handle(), move || {
        crate::macos::set_concealed(&concealed, true);
        // Ordered in and key while transparent, so WebKit draws the page and
        // keystrokes reach it as soon as it appears.
        let _ = concealed.show();
        let _ = concealed.set_focus();
    });
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_TIMEOUT);
        let Some(window) = app.get_window(&label) else {
            return;
        };
        if reveal(&window, RevealReason::Timeout, Some(generation)) {
            eprintln!(
                "[aven] {label}: the interface did not report a drawn frame within {} s; showing the window anyway",
                REVEAL_TIMEOUT.as_secs()
            );
        }
    });
}

/// Make a concealed window visible. Returns whether this call revealed it.
#[cfg(target_os = "macos")]
fn reveal(window: &Window, reason: RevealReason, timeout_of: Option<u64>) -> bool {
    let label = window.label().to_string();
    if !reveals().begin_reveal(&label, reason, timeout_of) {
        return false;
    }
    let shown = window.clone();
    on_main(window.app_handle(), move || {
        let was_concealed = crate::macos::set_concealed(&shown, false);
        reveals().finish_reveal(shown.label(), now_ms(), was_concealed);
    });
    true
}

/// Whether a workspace window is still waiting for its interface to draw. It
/// counts as shown for launch and Dock reopen: it appears on its own shortly.
pub fn is_pending(label: &str) -> bool {
    reveals().is_pending(label)
}

/// How a window became visible, for Aven Dev's real-app check.
pub fn record(label: &str) -> Option<RevealRecord> {
    reveals().record(label)
}

pub fn window_destroyed(label: &str) {
    reveals().forget(label);
}

/// The page has drawn its first frame in its saved theme: show the window.
/// Later reports, reports from other webviews, and every report outside
/// macOS (where the window is already shown) change nothing.
#[tauri::command]
pub fn window_reveal(webview: Webview) {
    #[cfg(target_os = "macos")]
    {
        let window = webview.window();
        if webview.label() != window.label() || !crate::window::is_workspace_label(window.label()) {
            return;
        }
        reveal(&window, RevealReason::Painted, None);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_painted_report_reveals_once_and_the_timeout_then_does_nothing() {
        let mut reveals = Reveals::new();
        let generation = reveals.conceal("main", 10);
        assert!(reveals.is_pending("main"));
        assert!(reveals.begin_reveal("main", RevealReason::Painted, None));
        // Claimed at once, so a timeout firing meanwhile cannot reveal again.
        assert!(!reveals.is_pending("main"));
        assert!(!reveals.begin_reveal("main", RevealReason::Timeout, Some(generation)));
        reveals.finish_reveal("main", 250, true);
        assert!(!reveals.begin_reveal("main", RevealReason::Painted, None));
        assert_eq!(
            reveals.record("main"),
            Some(RevealRecord {
                concealed_at_ms: 10,
                revealed_at_ms: Some(250),
                reason: Some(RevealReason::Painted),
                concealed_until_reveal: Some(true),
            })
        );
    }

    #[test]
    fn the_timeout_reveals_a_window_whose_page_never_reports() {
        let mut reveals = Reveals::new();
        let generation = reveals.conceal("window-2", 0);
        assert!(reveals.begin_reveal("window-2", RevealReason::Timeout, Some(generation)));
        reveals.finish_reveal("window-2", 3000, true);
        assert!(!reveals.is_pending("window-2"));
        // A page that reports late changes nothing.
        assert!(!reveals.begin_reveal("window-2", RevealReason::Painted, None));
        assert_eq!(
            reveals.record("window-2").and_then(|record| record.reason),
            Some(RevealReason::Timeout)
        );
    }

    #[test]
    fn an_earlier_timeout_cannot_reveal_a_newer_concealment() {
        let mut reveals = Reveals::new();
        let first = reveals.conceal("main", 0);
        reveals.forget("main");
        let second = reveals.conceal("main", 5);
        assert_ne!(first, second);
        assert!(!reveals.begin_reveal("main", RevealReason::Timeout, Some(first)));
        assert!(reveals.is_pending("main"));
        assert!(reveals.begin_reveal("main", RevealReason::Timeout, Some(second)));
    }

    #[test]
    fn windows_that_were_never_concealed_are_left_alone() {
        let mut reveals = Reveals::new();
        reveals.conceal("main", 0);
        assert!(!reveals.is_pending("window-3"));
        assert!(!reveals.begin_reveal("window-3", RevealReason::Painted, None));
        assert_eq!(reveals.record("window-3"), None);
        reveals.forget("main");
        assert!(!reveals.is_pending("main"));
        assert_eq!(reveals.record("main"), None);
    }

    #[test]
    fn the_timeout_leaves_time_for_a_normal_start_but_not_a_hang() {
        assert!(RELEASE_REVEAL_TIMEOUT >= Duration::from_secs(2));
        assert!(RELEASE_REVEAL_TIMEOUT <= Duration::from_secs(3));
        assert!(REVEAL_TIMEOUT >= RELEASE_REVEAL_TIMEOUT);
        assert!(REVEAL_TIMEOUT <= DEVELOPMENT_REVEAL_TIMEOUT);
        // A cold Vite load on the release runner has taken over 10 s.
        assert!(DEVELOPMENT_REVEAL_TIMEOUT >= Duration::from_secs(20));
    }
}
