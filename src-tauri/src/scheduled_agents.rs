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
