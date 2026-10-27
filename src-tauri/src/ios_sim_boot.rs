//! Simulator boots: which ones Aven started and which ones it made ready for
//! touches. Pure decisions, so they can be tested without a simulator.
//!
//! A boot is named by when the simulator's launchd started: each boot writes
//! `<data>/var/run/launchd_bootstrap.plist` once, so its modification time
//! changes with every boot, including one started outside Aven.
// The iPhone pane runs on macOS only; other builds keep the shared parts.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

/// One boot of one simulator: when its launchd started, in nanoseconds.
pub(crate) type BootId = u64;

/// The current boot of the simulator whose data folder is `data_path`.
pub(crate) fn boot_id(data_path: &Path) -> Option<BootId> {
    let modified = std::fs::metadata(data_path.join("var/run/launchd_bootstrap.plist"))
        .ok()?
        .modified()
        .ok()?;
    u64::try_from(modified.duration_since(UNIX_EPOCH).ok()?.as_nanos()).ok()
}

/// Whether a remembered boot is the device's current one. When the current
/// boot cannot be read, the record is trusted, as before boots were named.
fn same_boot(remembered: Option<BootId>, current: Option<BootId>) -> bool {
    match (remembered, current) {
        (Some(remembered), Some(current)) => remembered == current,
        (Some(_), None) => true,
        (None, _) => false,
    }
}

/// What a booted device needs before touches reach it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InputStep {
    /// Already done for this boot (or not needed): nothing to run.
    Ready,
    /// Restart its home screen once if CoreDevice announced its HID daemon,
    /// waiting up to `wait` for that announcement.
    Fix { wait: Duration },
    /// Someone else's running simulator: only find out whether it needs the
    /// fix; its home screen is never restarted unless the person picks it.
    Check,
}

/// What a device knows about its current boot, for `input_step`.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct BootFacts {
    /// The current boot, when it can be read.
    pub current: Option<BootId>,
    /// The boot whose input Aven made (or found) ready.
    pub ready: Option<BootId>,
    /// A boot Aven started, and how long ago when it was in this session.
    pub started_by_aven: Option<(BootId, Option<Duration>)>,
}

impl BootFacts {
    /// Aven started the device's current boot.
    pub fn aven_booted(&self) -> bool {
        self.started_by_aven
            .is_some_and(|(boot, _)| same_boot(Some(boot), self.current))
    }
}

/// The input fix runs once per boot: never again for a boot already made
/// ready, again after any reboot (in Aven or elsewhere). It runs on its own
/// only for boots Aven started; a running simulator someone else started is
/// fixed only when the person picks it (`picked`).
pub(crate) fn input_step(
    facts: &BootFacts,
    picked: bool,
    live: bool,
    announce_wait: Duration,
) -> InputStep {
    if !live || same_boot(facts.ready, facts.current) {
        return InputStep::Ready;
    }
    if facts.aven_booted() {
        // A boot started just now: CoreDevice announces its HID daemon a
        // moment later. One from earlier has announced (or never will).
        let since = facts.started_by_aven.and_then(|(_, since)| since);
        let wait = since.map_or(Duration::ZERO, |since| announce_wait.saturating_sub(since));
        return InputStep::Fix { wait };
    }
    if picked {
        InputStep::Fix {
            wait: Duration::ZERO,
        }
    } else {
        InputStep::Check
    }
}

/// Whether Aven may shut down a simulator a pane just moved away from: only
/// its own current boot, and only when no pane shows it and no other
/// project's run uses it.
pub(crate) fn may_release(facts: &BootFacts, shown_elsewhere: bool, used_elsewhere: bool) -> bool {
    facts.aven_booted() && facts.current.is_some() && !shown_elsewhere && !used_elsewhere
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOT: BootId = 1_793_138_996_000_000_000;
    const LATER: BootId = BOOT + 600_000_000_000;
    const WAIT: Duration = Duration::from_secs(60);

    fn facts(current: Option<BootId>) -> BootFacts {
        BootFacts {
            current,
            ..Default::default()
        }
    }

    #[test]
    fn fixes_input_once_per_boot() {
        // A device Aven just booted: fix it, waiting for the announcement.
        let mut device = facts(Some(BOOT));
        device.started_by_aven = Some((BOOT, Some(Duration::from_secs(2))));
        assert_eq!(
            input_step(&device, false, true, WAIT),
            InputStep::Fix {
                wait: Duration::from_secs(58)
            }
        );
        // Done: picking it again, remembering it or running on it never
        // restarts its home screen again during this boot.
        device.ready = Some(BOOT);
        for picked in [false, true] {
            assert_eq!(input_step(&device, picked, true, WAIT), InputStep::Ready);
        }
        // Rebooted elsewhere (Xcode, DeviceHub, simctl): fixed again.
        device.current = Some(LATER);
        assert_eq!(input_step(&device, false, true, WAIT), InputStep::Check);
        assert_eq!(
            input_step(&device, true, true, WAIT),
            InputStep::Fix {
                wait: Duration::ZERO
            }
        );
        // Basic mode needs no fix.
        assert_eq!(input_step(&device, true, false, WAIT), InputStep::Ready);
    }

    #[test]
    fn restarts_only_boots_aven_started_unless_picked() {
        let running = facts(Some(BOOT));
        assert_eq!(input_step(&running, false, true, WAIT), InputStep::Check);
        assert_eq!(
            input_step(&running, true, true, WAIT),
            InputStep::Fix {
                wait: Duration::ZERO
            }
        );
        // Aven's boot from before a restart of Aven: fixed without waiting.
        let mut ours = facts(Some(BOOT));
        ours.started_by_aven = Some((BOOT, None));
        assert_eq!(
            input_step(&ours, false, true, WAIT),
            InputStep::Fix {
                wait: Duration::ZERO
            }
        );
        // An old boot of Aven's does not make a later boot Aven's.
        ours.current = Some(LATER);
        assert!(!ours.aven_booted());
        assert_eq!(input_step(&ours, false, true, WAIT), InputStep::Check);
    }

    #[test]
    fn trusts_records_when_the_boot_cannot_be_read() {
        let mut device = facts(None);
        assert_eq!(input_step(&device, false, true, WAIT), InputStep::Check);
        device.ready = Some(BOOT);
        assert_eq!(input_step(&device, true, true, WAIT), InputStep::Ready);
    }

    #[test]
    fn releases_only_aven_boots_nobody_uses() {
        let mut device = facts(Some(BOOT));
        assert!(!may_release(&device, false, false), "someone else's");
        device.started_by_aven = Some((BOOT, None));
        assert!(may_release(&device, false, false));
        assert!(!may_release(&device, true, false), "another pane shows it");
        assert!(!may_release(&device, false, true), "another run uses it");
        device.current = Some(LATER);
        assert!(!may_release(&device, false, false), "rebooted elsewhere");
        device.current = None;
        assert!(!may_release(&device, false, false), "boot unknown");
    }

    #[test]
    fn names_a_boot_by_its_launchd_bootstrap_file() {
        let dir = std::env::temp_dir().join(format!("aven-boot-id-{}", std::process::id()));
        let run = dir.join("var/run");
        std::fs::create_dir_all(&run).unwrap();
        assert_eq!(boot_id(&dir), None);
        std::fs::write(run.join("launchd_bootstrap.plist"), "<plist/>").unwrap();
        let first = boot_id(&dir).unwrap();
        assert!(first > BOOT / 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
