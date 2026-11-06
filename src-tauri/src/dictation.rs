//! Speaking into the message box. Apple's speech recogniser turns the
//! microphone into words on this Mac only (`macos/dictation.m` requires
//! on-device recognition), so no audio leaves it. macOS only.
//!
//! One listen runs at a time. Each start gets a generation and the message
//! box's own channel, so words reach only the box that asked, and a listen
//! that was replaced can't speak into the next one.

use std::ffi::{c_char, c_void, CStr};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, Once};

use serde_json::{json, Value};
use tauri::ipc::Channel;

type EventCallback = unsafe extern "C" fn(json: *const c_char, context: *mut c_void);

extern "C" {
    fn aven_dictation_set_callback(callback: Option<EventCallback>, context: *mut c_void);
    fn aven_dictation_start(generation: u64);
    fn aven_dictation_stop(generation: u64);
    fn aven_dictation_cancel(generation: u64);
}

struct Listener {
    generation: u64,
    channel: Channel<Value>,
}

static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(0);
static INSTALL: Once = Once::new();

/// What to do with an event from the bridge, given the listen now open.
#[derive(Debug, PartialEq, Eq)]
enum Route {
    /// For the open listen: pass it on.
    Deliver,
    /// For the open listen, and its last: pass it on and close the listen.
    DeliverAndClose,
    /// From a listen that was replaced or closed, or unreadable.
    Drop,
}

fn route(open: Option<u64>, event: &Value) -> Route {
    let Some(generation) = event.get("generation").and_then(Value::as_u64) else {
        return Route::Drop;
    };
    if open != Some(generation) {
        return Route::Drop;
    }
    match event.get("kind").and_then(Value::as_str) {
        Some("end") => Route::DeliverAndClose,
        Some("listening" | "words" | "error") => Route::Deliver,
        _ => Route::Drop,
    }
}

fn lock() -> std::sync::MutexGuard<'static, Option<Listener>> {
    LISTENER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn deliver(text: &str) {
    let Ok(event) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let mut listener = lock();
    match route(listener.as_ref().map(|open| open.generation), &event) {
        Route::Drop => {}
        Route::Deliver => {
            if let Some(open) = listener.as_ref() {
                let _ = open.channel.send(event);
            }
        }
        Route::DeliverAndClose => {
            if let Some(open) = listener.take() {
                let _ = open.channel.send(event);
            }
        }
    }
}

unsafe extern "C" fn native_event(json: *const c_char, _context: *mut c_void) {
    // No panic or borrowed native string may escape the FFI callback.
    let _ = std::panic::catch_unwind(|| {
        if json.is_null() {
            return;
        }
        let text = unsafe { CStr::from_ptr(json) }
            .to_string_lossy()
            .into_owned();
        deliver(&text);
    });
}

/// Starts listening for the message box that owns `on_event`, and returns
/// the listen's generation for stopping it. A listen already open elsewhere
/// ends first, keeping what it heard.
#[tauri::command]
pub(crate) fn dictation_start(on_event: Channel<Value>) -> u64 {
    INSTALL.call_once(|| unsafe {
        aven_dictation_set_callback(Some(native_event as EventCallback), std::ptr::null_mut());
    });
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let previous = lock().replace(Listener {
        generation,
        channel: on_event,
    });
    if let Some(previous) = previous {
        let _ = previous
            .channel
            .send(json!({ "kind": "end", "generation": previous.generation }));
    }
    unsafe { aven_dictation_start(generation) };
    generation
}

/// Stops listening; the last words and the end still arrive.
#[tauri::command]
pub(crate) fn dictation_stop(generation: u64) {
    unsafe { aven_dictation_stop(generation) };
}

/// Stops listening at once. Nothing more reaches the message box.
#[tauri::command]
pub(crate) fn dictation_cancel(generation: u64) {
    {
        let mut listener = lock();
        if listener.as_ref().map(|open| open.generation) == Some(generation) {
            listener.take();
        }
    }
    unsafe { aven_dictation_cancel(generation) };
}

fn settings_url(pane: &str) -> Option<&'static str> {
    match pane {
        "microphone" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
        "speech" => Some(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
        ),
        "keyboard" => Some("x-apple.systempreferences:com.apple.Keyboard-Settings.extension"),
        _ => None,
    }
}

/// Opens the System Settings page that fixes a refusal: the microphone or
/// speech recognition privacy list, or Keyboard for Dictation's languages.
#[tauri::command]
pub(crate) fn dictation_open_settings(pane: String) -> Result<(), String> {
    let url = settings_url(&pane).ok_or("Unknown settings page")?;
    Command::new("/usr/bin/open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        })
        .map_err(|_| "Couldn't open System Settings.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_open_listen_is_heard() {
        let words = json!({ "kind": "words", "text": "hello", "generation": 2 });
        assert_eq!(route(Some(2), &words), Route::Deliver);
        assert_eq!(route(Some(3), &words), Route::Drop);
        assert_eq!(route(None, &words), Route::Drop);
    }

    #[test]
    fn the_end_closes_the_listen() {
        let end = json!({ "kind": "end", "generation": 4 });
        assert_eq!(route(Some(4), &end), Route::DeliverAndClose);
        assert_eq!(route(Some(5), &end), Route::Drop);
    }

    #[test]
    fn unreadable_events_are_dropped() {
        for event in [
            json!({ "kind": "words" }),
            json!({ "kind": "surprise", "generation": 1 }),
            json!({ "generation": 1 }),
            json!("words"),
        ] {
            assert_eq!(route(Some(1), &event), Route::Drop, "{event}");
        }
    }

    #[test]
    fn settings_open_only_the_three_pages() {
        assert!(settings_url("microphone")
            .unwrap()
            .ends_with("Privacy_Microphone"));
        assert!(settings_url("speech")
            .unwrap()
            .ends_with("Privacy_SpeechRecognition"));
        assert!(settings_url("keyboard").unwrap().contains("Keyboard"));
        assert_eq!(settings_url("https://example.com"), None);
        assert_eq!(settings_url(""), None);
    }
}
