//! Forward macOS memory-pressure notices to the interface.
//!
//! macOS tells processes when physical memory is tight. Chromium already
//! trims its own caches on that signal, but Aven's retained browser tabs and
//! workspace state are the interface's decision, so the notice is published
//! as an event and the frontend releases what it can.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "aven:memory-pressure";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Warn,
    Critical,
}

#[derive(Clone, Copy, Serialize)]
struct Notice {
    level: Level,
}

/// Map dispatch memory-pressure flags to a published level, if any.
pub fn level_for_flags(flags: usize) -> Option<Level> {
    const WARN: usize = 0x2;
    const CRITICAL: usize = 0x4;
    if flags & CRITICAL != 0 {
        Some(Level::Critical)
    } else if flags & WARN != 0 {
        Some(Level::Warn)
    } else {
        None
    }
}

pub fn publish(app: &AppHandle, level: Level) {
    let _ = app.emit(EVENT, Notice { level });
}

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    use block2::RcBlock;
    use dispatch2::{DispatchObject, DispatchQueue, DispatchRetained, DispatchSource};
    use std::sync::OnceLock;

    struct Listener {
        _source: DispatchRetained<DispatchSource>,
        _handler: RcBlock<dyn Fn()>,
    }
    // Retained for the process lifetime; dispatch holds raw pointers to both.
    unsafe impl Send for Listener {}
    unsafe impl Sync for Listener {}
    static LISTENER: OnceLock<Listener> = OnceLock::new();

    if LISTENER.get().is_some() {
        return;
    }
    const WARN: usize = 0x2;
    const CRITICAL: usize = 0x4;
    let queue = DispatchQueue::global_queue(dispatch2::GlobalQueueIdentifier::QualityOfService(
        dispatch2::DispatchQoS::Utility,
    ));
    // SAFETY: a memory-pressure source takes no handle; the mask selects the
    // levels of interest. The source and its handler block outlive the
    // registration because both are stored in `LISTENER`.
    let source = unsafe {
        DispatchSource::new(
            std::ptr::addr_of!(dispatch2::_dispatch_source_type_memorypressure) as *mut _,
            0,
            WARN | CRITICAL,
            Some(&queue),
        )
    };
    let app = app.clone();
    let source_for_handler = source.clone();
    let handler = RcBlock::new(move || {
        if let Some(level) = level_for_flags(source_for_handler.data()) {
            publish(&app, level);
        }
    });
    unsafe {
        source.set_event_handler_with_block(RcBlock::as_ptr(&handler) as *mut _);
    }
    source.activate();
    let _ = LISTENER.set(Listener {
        _source: source,
        _handler: handler,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn critical_outranks_warn_and_normal_is_ignored() {
        assert_eq!(level_for_flags(0x1), None);
        assert_eq!(level_for_flags(0x2), Some(Level::Warn));
        assert_eq!(level_for_flags(0x4), Some(Level::Critical));
        assert_eq!(level_for_flags(0x6), Some(Level::Critical));
        assert_eq!(
            serde_json::to_string(&Notice {
                level: Level::Critical
            })
            .unwrap(),
            r#"{"level":"critical"}"#
        );
    }
}
