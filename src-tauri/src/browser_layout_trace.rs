//! Temporary, opt-in debug diagnostics. Never records page content or URLs.
use serde_json::Value;

pub fn enabled() -> bool {
    #[cfg(debug_assertions)]
    {
        writer().is_some()
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

pub fn record(phase: &str, id: &str, window: &str, visible: bool, geometry: Value) {
    #[cfg(debug_assertions)]
    if let Some(writer) = writer() {
        if let Ok(mut writer) = writer.lock() {
            let _ = writer.append(&serde_json::json!({
                "phase": phase, "id": id, "window": window,
                "visible": visible, "geometry": geometry,
            }));
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = (phase, id, window, visible, geometry);
}

#[cfg(debug_assertions)]
const MAX_BYTES: usize = 256 * 1024;

#[cfg(debug_assertions)]
struct TraceWriter {
    file: std::fs::File,
    bytes: usize,
}

#[cfg(debug_assertions)]
impl TraceWriter {
    fn create(path: &std::path::Path) -> std::io::Result<Self> {
        use std::os::unix::fs::OpenOptionsExt;
        Ok(Self {
            file: std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)?,
            bytes: 0,
        })
    }

    fn append(&mut self, event: &Value) -> std::io::Result<()> {
        use std::io::Write;
        if self.bytes >= MAX_BYTES {
            return Ok(());
        }
        let mut line = serde_json::to_vec(event)?;
        line.push(b'\n');
        if self.bytes + line.len() > MAX_BYTES {
            self.bytes = MAX_BYTES;
            return Ok(());
        }
        self.file.write_all(&line)?;
        self.bytes += line.len();
        Ok(())
    }
}

#[cfg(debug_assertions)]
fn writer() -> &'static Option<std::sync::Mutex<TraceWriter>> {
    static WRITER: std::sync::OnceLock<Option<std::sync::Mutex<TraceWriter>>> =
        std::sync::OnceLock::new();
    WRITER.get_or_init(|| {
        if std::env::var_os("AVEN_DEV_BROWSER_LAYOUT_TRACE").as_deref()
            != Some(std::ffi::OsStr::new("1"))
        {
            return None;
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "aven-browser-layout-{}-{stamp}.jsonl",
            std::process::id()
        ));
        let writer = TraceWriter::create(&path).ok()?;
        eprintln!("[aven] Browser layout trace: {}", path.display());
        Some(std::sync::Mutex::new(writer))
    })
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn trace_is_private_exclusive_and_bounded() {
        let path = std::env::temp_dir().join(format!(
            "aven-layout-trace-test-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut writer = TraceWriter::create(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(TraceWriter::create(&path).is_err());
        let event = serde_json::json!({"phase": "native-after", "visible": false});
        writer.append(&event).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            format!("{event}\n")
        );
        writer
            .append(&Value::String("x".repeat(MAX_BYTES)))
            .unwrap();
        let size = std::fs::metadata(&path).unwrap().len();
        writer.append(&event).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        assert!(size < MAX_BYTES as u64);
        drop(writer);
        std::fs::remove_file(path).unwrap();
    }
}
