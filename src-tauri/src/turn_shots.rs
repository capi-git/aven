//! Page screenshots that agents show in their replies, usually a before and
//! after pair. Each task owns one folder under app data, deleted with the task.
#![cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]

use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};

const DIR: &str = "turn-shots";
/// Native capture already bounds images to 8 MB of base64; this guards disk.
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_PER_SESSION: usize = 300;
const MAX_LABEL_BYTES: usize = 64;
const MAX_FILE_LABEL_CHARS: usize = 32;

fn session_dir(app_data: &Path, session_id: &str) -> Result<PathBuf, String> {
    crate::session_store::validate_id(session_id, "session")?;
    Ok(app_data.join(DIR).join(session_id))
}

pub(crate) fn validate_label(label: &str) -> Result<(), String> {
    if label.trim().is_empty()
        || label.len() > MAX_LABEL_BYTES
        || label.chars().any(char::is_control)
    {
        return Err(format!(
            "Screenshot labels need 1 to {MAX_LABEL_BYTES} bytes of plain text, such as \"before\""
        ));
    }
    Ok(())
}

/// Labels become part of a file name, so keep only a lowercase ASCII slug.
fn file_label(label: Option<&str>) -> String {
    let mut slug = String::new();
    for character in label.unwrap_or_default().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= MAX_FILE_LABEL_CHARS {
            break;
        }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        "page".into()
    } else {
        slug.into()
    }
}

/// Markdown the agent can paste unchanged. App data paths contain spaces on
/// macOS, so the destination is always wrapped in angle brackets.
fn markdown(path: &Path, label: Option<&str>) -> String {
    let alt: String = label
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .unwrap_or("Screenshot")
        .chars()
        .filter(|character| !matches!(character, '[' | ']' | '<' | '>' | '\\'))
        .collect();
    let mut characters = alt.chars();
    let alt = characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    });
    format!("![{alt}](<{}>)", path.display())
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[8..16] != b"\0\0\0\rIHDR" {
        return None;
    }
    let number =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (width, height) = (number(16), number(20));
    (width > 0 && height > 0).then_some((width, height))
}

/// Decode the native capture, refusing anything that is not a bounded PNG.
pub(crate) fn decode_png(data: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let too_large = || {
        format!(
            "Screenshot exceeds the {} MB limit. Make the browser pane smaller and retry.",
            MAX_BYTES / 1024 / 1024
        )
    };
    if data.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err(too_large());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Chromium returned an invalid image".to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(too_large());
    }
    let (width, height) = png_dimensions(&bytes).ok_or("Chromium returned an invalid image")?;
    Ok((bytes, width, height))
}

/// Write `<app data>/turn-shots/<session>/<millis>-<label>.png` without ever
/// replacing an earlier image, and return the agent's JSON result.
pub(crate) fn store(
    app_data: &Path,
    session_id: &str,
    label: Option<&str>,
    png: &[u8],
    millis: u128,
) -> Result<Value, String> {
    let (width, height) = png_dimensions(png).ok_or("Screenshot is not a PNG image")?;
    if png.len() > MAX_BYTES {
        return Err("Screenshot exceeds the size limit".into());
    }
    let dir = session_dir(app_data, session_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not save the screenshot: {error}"))?;
    let existing = std::fs::read_dir(&dir)
        .map_err(|error| format!("Could not save the screenshot: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "png"))
        .count();
    if existing >= MAX_PER_SESSION {
        return Err(format!(
            "This task already has {MAX_PER_SESSION} screenshots. Start a new task to take more."
        ));
    }
    let slug = file_label(label);
    for attempt in 1..=16 {
        let name = if attempt == 1 {
            format!("{millis}-{slug}.png")
        } else {
            format!("{millis}-{slug}-{attempt}.png")
        };
        let path = dir.join(name);
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save the screenshot: {error}")),
        };
        if let Err(error) = file.write_all(png).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(format!("Could not save the screenshot: {error}"));
        }
        return Ok(json!({
            "path": path.to_string_lossy(),
            "width": width,
            "height": height,
            "markdown": markdown(&path, label),
        }));
    }
    Err("Could not choose a screenshot file name. Retry shortly.".into())
}

/// Missing folders are already clean; a task never shares its folder.
pub(crate) fn remove_session(app_data: &Path, session_id: &str) -> Result<(), String> {
    match std::fs::remove_dir_all(session_dir(app_data, session_id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) struct TemporaryDirectory(pub(crate) PathBuf);
    impl TemporaryDirectory {
        pub(crate) fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("aven-turn-shots-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TemporaryDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub(crate) fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13];
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn labels_become_short_safe_file_names() {
        assert_eq!(file_label(None), "page");
        assert_eq!(file_label(Some("Before")), "before");
        assert_eq!(
            file_label(Some("  After: settings / dark  ")),
            "after-settings-dark"
        );
        assert_eq!(file_label(Some("../../etc/passwd")), "etc-passwd");
        assert_eq!(file_label(Some("☃☃")), "page");
        assert_eq!(
            file_label(Some(&"x".repeat(60))).len(),
            MAX_FILE_LABEL_CHARS
        );
        assert!(validate_label("before").is_ok());
        assert!(validate_label("After — dark mode").is_ok());
        for label in ["", "   ", "a\nb", "tab\there", &"x".repeat(65)] {
            assert!(validate_label(label).is_err(), "{label:?}");
        }
    }

    #[test]
    fn decodes_only_bounded_png_images() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(png(640, 400));
        let (bytes, width, height) = decode_png(&encoded).unwrap();
        assert_eq!(
            (bytes.len(), width, height),
            (png(640, 400).len(), 640, 400)
        );
        for data in [
            "not base64!",
            &base64::engine::general_purpose::STANDARD.encode(b"<html>not an image</html>"),
            &base64::engine::general_purpose::STANDARD.encode(png(0, 10)),
        ] {
            assert!(decode_png(data).is_err());
        }
        let oversized = "A".repeat(MAX_BYTES.div_ceil(3) * 4 + 4);
        assert!(decode_png(&oversized).unwrap_err().contains("8 MB"));
    }

    #[test]
    fn stores_each_capture_under_its_session_without_overwriting() {
        let root = TemporaryDirectory::new();
        let first = store(&root.0, "session-a", Some("Before"), &png(2, 3), 1700).unwrap();
        let second = store(&root.0, "session-a", Some("Before"), &png(4, 5), 1700).unwrap();
        let dir = root.0.join("turn-shots").join("session-a");
        assert_eq!(
            first["path"],
            dir.join("1700-before.png").to_string_lossy().as_ref()
        );
        assert_eq!(
            second["path"],
            dir.join("1700-before-2.png").to_string_lossy().as_ref()
        );
        assert_eq!(
            (first["width"].as_u64(), first["height"].as_u64()),
            (Some(2), Some(3))
        );
        assert_eq!(
            first["markdown"],
            format!("![Before](<{}>)", dir.join("1700-before.png").display())
        );
        assert_eq!(
            std::fs::read(dir.join("1700-before.png")).unwrap(),
            png(2, 3)
        );
        let unlabeled = store(&root.0, "session-a", None, &png(1, 1), 1800).unwrap();
        assert_eq!(
            unlabeled["path"],
            dir.join("1800-page.png").to_string_lossy().as_ref()
        );
        assert!(unlabeled["markdown"]
            .as_str()
            .unwrap()
            .starts_with("![Screenshot](<"));
        for session in ["", "../other", "a/b"] {
            assert!(store(&root.0, session, None, &png(1, 1), 1).is_err());
        }
        assert!(store(&root.0, "session-a", None, b"not a png", 1).is_err());
    }

    #[test]
    fn refuses_more_than_the_session_limit() {
        let root = TemporaryDirectory::new();
        let dir = root.0.join("turn-shots").join("busy");
        std::fs::create_dir_all(&dir).unwrap();
        for index in 0..MAX_PER_SESSION {
            std::fs::write(dir.join(format!("{index}-page.png")), b"").unwrap();
        }
        assert!(store(&root.0, "busy", None, &png(1, 1), 1)
            .unwrap_err()
            .contains("already has"));
        assert!(store(&root.0, "other", None, &png(1, 1), 1).is_ok());
    }

    #[test]
    fn removing_a_session_deletes_only_its_folder() {
        let root = TemporaryDirectory::new();
        store(&root.0, "gone", Some("after"), &png(1, 1), 1).unwrap();
        store(&root.0, "kept", Some("after"), &png(1, 1), 1).unwrap();
        remove_session(&root.0, "gone").unwrap();
        remove_session(&root.0, "gone").unwrap();
        assert!(!root.0.join("turn-shots/gone").exists());
        assert!(root.0.join("turn-shots/kept/1-after.png").is_file());
        assert!(remove_session(&root.0, "../kept").is_err());
        assert!(root.0.join("turn-shots/kept").is_dir());
    }
}
