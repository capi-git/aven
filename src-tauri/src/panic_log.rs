//! Records Rust panics to a local log before the default handler runs.
//!
//! A panic inside a native callback (an AppKit event, a window delegate) can
//! reach an `extern "C"` boundary and abort the process. macOS's crash report
//! then shows only `panic_cannot_unwind`, without the message or location.
//! This keeps those two facts, plus the thread and app version, on disk.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Keep the log small; a crash loop must not fill the disk.
const MAX_LOG_BYTES: u64 = 512 * 1024;

pub fn install() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(path) = log_path() {
            let message = match info.payload().downcast_ref::<&str>() {
                Some(text) => (*text).to_string(),
                None => info
                    .payload()
                    .downcast_ref::<String>()
                    .cloned()
                    .unwrap_or_else(|| "non-string panic payload".into()),
            };
            let location = info
                .location()
                .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column()))
                .unwrap_or_else(|| "unknown location".into());
            let thread = std::thread::current();
            let entry = format_entry(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_secs())
                    .unwrap_or(0),
                thread.name().unwrap_or("unnamed"),
                &message,
                &location,
                &std::backtrace::Backtrace::force_capture().to_string(),
            );
            // Never panic while recording a panic.
            let _ = append(&path, &entry);
        }
        previous(info);
    }));
}

fn product_dir() -> &'static str {
    if cfg!(debug_assertions) {
        "Aven Dev"
    } else {
        "Aven"
    }
}

/// `~/Library/Logs/Aven/panics.log` on macOS,
/// `%LOCALAPPDATA%\Aven\logs\panics.log` on Windows.
fn log_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/Logs")
                .join(product_dir())
                .join("panics.log"),
        )
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("LOCALAPPDATA")?;
        Some(
            PathBuf::from(base)
                .join(product_dir())
                .join("logs")
                .join("panics.log"),
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join(".local/state")
                .join(product_dir())
                .join("panics.log"),
        )
    }
}

fn format_entry(
    unix_seconds: u64,
    thread: &str,
    message: &str,
    location: &str,
    backtrace: &str,
) -> String {
    format!(
        "--- panic at unix {unix_seconds} · Aven {} · thread {thread}\n{message}\nat {location}\n{backtrace}\n",
        env!("CARGO_PKG_VERSION"),
    )
}

fn append(path: &Path, entry: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Start over rather than grow without bound.
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) > MAX_LOG_BYTES {
        fs::remove_file(path)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(entry.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_keeps_message_location_thread_and_version() {
        let entry = format_entry(
            1_791_000_000,
            "CrBrowserMain",
            "already borrowed",
            "src/x.rs:1:2",
            "bt",
        );
        assert!(entry.contains("already borrowed"));
        assert!(entry.contains("at src/x.rs:1:2"));
        assert!(entry.contains("thread CrBrowserMain"));
        assert!(entry.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn append_creates_folders_and_restarts_an_oversized_log() {
        let dir = std::env::temp_dir().join(format!("aven-panic-log-{}", std::process::id()));
        let path = dir.join("nested").join("panics.log");
        append(&path, "first\n").unwrap();
        append(&path, "second\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");
        fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();
        append(&path, "fresh\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "fresh\n");
        let _ = fs::remove_dir_all(dir);
    }
}
