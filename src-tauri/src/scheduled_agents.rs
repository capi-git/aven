//! Scheduled agents are timed in the web view, and every full Aven window
//! checks the same saved schedules. The first window to claim a due slot
//! starts the agent; the claim lasts for the process, so later windows skip
//! that slot instead of starting a duplicate chat.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

/// Slots are `<schedule id>:<due time>`; anything longer is not one of ours.
const MAX_SLOT_LEN: usize = 256;

fn claims() -> &'static Mutex<HashSet<String>> {
    static CLAIMS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CLAIMS.get_or_init(Default::default)
}

fn claim(claims: &Mutex<HashSet<String>>, slot: String) -> bool {
    if slot.is_empty() || slot.len() > MAX_SLOT_LEN {
        return false;
    }
    claims
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(slot)
}

/// True for the first caller of a slot, false for every later one.
#[tauri::command]
pub fn scheduled_agent_claim(slot: String) -> bool {
    claim(claims(), slot)
}

/// While on, the computer is kept from idle sleep so automations still run
/// at their time. The display can still sleep, and closing a Mac's lid
/// still puts it to sleep. Every window sends the same saved preference.
#[tauri::command]
pub fn scheduled_agents_keep_awake(enabled: bool) {
    keep_awake::set(enabled);
}

#[cfg(target_os = "macos")]
mod keep_awake {
    use std::process::{Child, Command, Stdio};
    use std::sync::Mutex;

    static HOLD: Mutex<Option<Child>> = Mutex::new(None);

    /// `caffeinate -w` also lets go on its own if Aven exits or crashes.
    pub fn set(on: bool) {
        let mut hold = HOLD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(child) = hold.as_mut() {
            if !matches!(child.try_wait(), Ok(None)) {
                *hold = None;
            }
        }
        if on && hold.is_none() {
            *hold = Command::new("/usr/bin/caffeinate")
                .args(["-i", "-w", &std::process::id().to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
        } else if !on {
            if let Some(mut child) = hold.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(windows)]
mod keep_awake {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    static HOLD: Mutex<Option<Sender<()>>> = Mutex::new(None);

    /// The request belongs to the thread that made it, so a parked thread
    /// holds it until the sender is dropped.
    pub fn set(on: bool) {
        let mut hold = HOLD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if on && hold.is_none() {
            let (release, released) = channel::<()>();
            let spawned = std::thread::Builder::new()
                .name("aven-keep-awake".into())
                .spawn(move || {
                    unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                    let _ = released.recv();
                    unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                });
            if spawned.is_ok() {
                *hold = Some(release);
            }
        } else if !on {
            hold.take();
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod keep_awake {
    pub fn set(_on: bool) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_claim_of_a_slot_succeeds() {
        let claims = Mutex::new(HashSet::new());
        assert!(claim(&claims, "daily:1000".into()));
        assert!(!claim(&claims, "daily:1000".into()));
        assert!(claim(&claims, "daily:2000".into()));
        assert!(claim(&claims, "hourly:1000".into()));
    }

    #[test]
    fn rejects_empty_and_oversized_slots() {
        let claims = Mutex::new(HashSet::new());
        assert!(!claim(&claims, String::new()));
        assert!(!claim(&claims, "x".repeat(MAX_SLOT_LEN + 1)));
    }
}
