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
    /// Restart its home screen once if CoreDevice announced its HID daemon.
    /// `since_boot` is set for a boot Aven started in this session: the
    /// announcement may still be on its way (see `announcement`).
    Fix { since_boot: Option<Duration> },
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
pub(crate) fn input_step(facts: &BootFacts, picked: bool, live: bool) -> InputStep {
    if !live || same_boot(facts.ready, facts.current) {
        return InputStep::Ready;
    }
    if facts.aven_booted() {
        let since_boot = facts.started_by_aven.and_then(|(_, since)| since);
        return InputStep::Fix { since_boot };
    }
    if picked {
        InputStep::Fix { since_boot: None }
    } else {
        InputStep::Check
    }
}

/// Whether a device a pane uses joins its project's agent scope: only Aven's
/// own boot or one the person picked in the pane. A running simulator the
/// pane merely suggested or remembered (someone else started it) stays out
/// until the person picks it.
pub(crate) fn joins_scope(facts: &BootFacts, picked: bool) -> bool {
    picked || facts.aven_booted()
}

/// CoreDevice's HID daemon in a simulator, from `launchctl list`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Daemon {
    /// Not in this runtime (before iOS 27): input needs no fix.
    Absent,
    /// Listed, not running: no CoreDevice client (such as DeviceHub) uses it.
    Idle,
    Running,
}

pub(crate) fn parse_daemon(listed: &str, label: &str) -> Daemon {
    let mut found = Daemon::Absent;
    for line in listed.lines() {
        let mut parts = line.split_whitespace();
        let (Some(pid), Some(_), Some(job)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if job == label {
            found = if pid.parse::<u32>().is_ok() {
                Daemon::Running
            } else {
                Daemon::Idle
            };
        }
    }
    found
}

/// The daemon announces itself (and the fix is needed) about a second after
/// a boot, when a CoreDevice client such as DeviceHub is open; without one
/// it never does, and touches work as they are. So a boot is waited on only
/// briefly while the daemon is idle, and at most this long while it runs.
pub(crate) const ANNOUNCE_GRACE: Duration = Duration::from_secs(3);
pub(crate) const ANNOUNCE_WAIT: Duration = Duration::from_secs(60);

/// What to do about CoreDevice's announcement for a device being prepared.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Announcement {
    /// It happened: restart the home screen once.
    Fix,
    /// A boot Aven just started may still announce: look again shortly.
    Wait,
    /// None, and none is expected: touches work as they are. A later one
    /// (DeviceHub opened afterwards) is watched for.
    Clear,
}

/// `flag` is the announcement flag (1 once announced); `since_boot` is set
/// only for a boot Aven started in this session.
pub(crate) fn announcement(
    flag: Option<u64>,
    daemon: Daemon,
    since_boot: Option<Duration>,
) -> Announcement {
    if daemon == Daemon::Absent {
        return Announcement::Clear;
    }
    if flag == Some(1) {
        return Announcement::Fix;
    }
    match since_boot {
        Some(since) if since < ANNOUNCE_GRACE => Announcement::Wait,
        Some(since) if daemon == Daemon::Running && since < ANNOUNCE_WAIT => Announcement::Wait,
        _ => Announcement::Clear,
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
            input_step(&device, false, true),
            InputStep::Fix {
                since_boot: Some(Duration::from_secs(2))
            }
        );
        // Done: picking it again, remembering it or running on it never
        // restarts its home screen again during this boot.
        device.ready = Some(BOOT);
        for picked in [false, true] {
            assert_eq!(input_step(&device, picked, true), InputStep::Ready);
        }
        // Rebooted elsewhere (Xcode, DeviceHub, simctl): fixed again.
        device.current = Some(LATER);
        assert_eq!(input_step(&device, false, true), InputStep::Check);
        assert_eq!(
            input_step(&device, true, true),
            InputStep::Fix { since_boot: None }
        );
        // Basic mode needs no fix.
        assert_eq!(input_step(&device, true, false), InputStep::Ready);
    }

    #[test]
    fn restarts_only_boots_aven_started_unless_picked() {
        let running = facts(Some(BOOT));
        assert_eq!(input_step(&running, false, true), InputStep::Check);
        assert_eq!(
            input_step(&running, true, true),
            InputStep::Fix { since_boot: None }
        );
        // Aven's boot from before a restart of Aven: fixed without waiting.
        let mut ours = facts(Some(BOOT));
        ours.started_by_aven = Some((BOOT, None));
        assert_eq!(
            input_step(&ours, false, true),
            InputStep::Fix { since_boot: None }
        );
        // An old boot of Aven's does not make a later boot Aven's.
        ours.current = Some(LATER);
        assert!(!ours.aven_booted());
        assert_eq!(input_step(&ours, false, true), InputStep::Check);
    }

    #[test]
    fn waits_for_coredevices_announcement_only_while_one_can_come() {
        use Announcement::*;
        use Daemon::*;
        let just = Some(Duration::from_secs(1));
        let later = Some(Duration::from_secs(10));
        // Announced: fix, however long ago the boot was.
        assert_eq!(announcement(Some(1), Running, later), Fix);
        assert_eq!(announcement(Some(1), Idle, None), Fix);
        // A boot Aven just started: give DeviceHub a moment to connect.
        assert_eq!(announcement(Some(0), Idle, just), Wait);
        assert_eq!(announcement(Some(0), Running, just), Wait);
        // Nothing connected after the grace: no fix, and no 60-second wait.
        assert_eq!(announcement(Some(0), Idle, later), Clear);
        // Connected but not announced yet: keep waiting, up to a minute.
        assert_eq!(announcement(Some(0), Running, later), Wait);
        assert_eq!(announcement(Some(0), Running, Some(ANNOUNCE_WAIT)), Clear);
        // Someone else's or an earlier boot: only what has happened counts.
        assert_eq!(announcement(Some(0), Running, None), Clear);
        assert_eq!(announcement(None, Idle, None), Clear);
        // Runtimes without the daemon never need the fix.
        assert_eq!(announcement(Some(1), Absent, just), Clear);
    }

    #[test]
    fn reads_the_hid_daemon_from_launchctl() {
        let job = "com.apple.coredevice.dtuhidd";
        let running = "PID\tStatus\tLabel\n88812\t0\tcom.apple.coredevice.dtuhidd\n-\t0\tcom.apple.coredevice.dthidd\n";
        assert_eq!(parse_daemon(running, job), Daemon::Running);
        assert_eq!(
            parse_daemon("-\t0\tcom.apple.coredevice.dtuhidd\n", job),
            Daemon::Idle
        );
        assert_eq!(
            parse_daemon("-\t0\tcom.apple.coredevice.dtuhidd.helper\n", job),
            Daemon::Absent
        );
        assert_eq!(parse_daemon("", job), Daemon::Absent);
    }

    #[test]
    fn scopes_only_aven_boots_and_picked_devices() {
        // Someone else's running simulator, suggested or remembered: out.
        let mut device = facts(Some(BOOT));
        assert!(!joins_scope(&device, false));
        // The person picked it in the pane: in.
        assert!(joins_scope(&device, true));
        // Aven booted it (in this session or before a restart): in.
        device.started_by_aven = Some((BOOT, None));
        assert!(joins_scope(&device, false));
        // Rebooted elsewhere since: no longer Aven's.
        device.current = Some(LATER);
        assert!(!joins_scope(&device, false));
    }

    #[test]
    fn trusts_records_when_the_boot_cannot_be_read() {
        let mut device = facts(None);
        assert_eq!(input_step(&device, false, true), InputStep::Check);
        device.ready = Some(BOOT);
        assert_eq!(input_step(&device, true, true), InputStep::Ready);
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
