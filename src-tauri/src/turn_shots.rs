//! Page screenshots that agents show in their replies, usually a before and
//! after pair. Each chat owns one folder under app data, deleted with the chat.
//! New screenshots are compressed JPEG files (see `turn_shot_image`); PNG files
//! saved by earlier versions stay as they are.
//!
//! A file is named `<millis>-<label>.jpg`; an unlabelled one uses the label
//! `page`. When a turn ends, its unlabelled screenshots that the chat's
//! messages do not show are deleted (`tidy_turn`).
#![cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::session_store::SessionStore;
use crate::turn_shot_image::Jpeg;

const DIR: &str = "turn-shots";
/// Native capture already bounds images to 8 MB of base64; this guards disk.
const MAX_BYTES: usize = 8 * 1024 * 1024;
/// New screenshots; earlier versions saved `png`.
const EXTENSION: &str = "jpg";
const EXTENSIONS: [&str; 2] = [EXTENSION, "png"];
const MAX_PER_SESSION: usize = 300;
const MAX_LABEL_BYTES: usize = 64;
const MAX_FILE_LABEL_CHARS: usize = 32;
/// The file label of a screenshot taken without a label.
const UNLABELLED: &str = "page";
/// Bounds the file names a turn's end may report as shown in the chat.
const MAX_REFERENCED: usize = 10_000;

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

/// `page`, or `page-2` for a second capture in the same millisecond.
fn is_unlabelled(slug: &str) -> bool {
    slug == UNLABELLED
        || slug
            .strip_prefix(UNLABELLED)
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|attempt| {
                !attempt.is_empty() && attempt.bytes().all(|byte| byte.is_ascii_digit())
            })
}

/// Labels become part of a file name, so keep only a lowercase ASCII slug.
/// A labelled file never looks unlabelled: a label of "Page", or one with no
/// ASCII letters or digits, is marked `labelled`.
fn file_label(label: Option<&str>) -> String {
    let Some(label) = label else {
        return UNLABELLED.into();
    };
    let mut slug = String::new();
    for character in label.chars() {
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
        "labelled".into()
    } else if is_unlabelled(slug) {
        format!("labelled-{slug}")
    } else {
        slug.into()
    }
}

/// A saved screenshot, read from its file name.
#[derive(Debug)]
struct Shot {
    name: String,
    path: PathBuf,
    millis: u64,
    labelled: bool,
}

/// `<millis>-<slug>[-<attempt>].<jpg|png>`, as `store` names files.
fn parse_shot(name: &str) -> Option<(u64, bool)> {
    let (stem, extension) = name.rsplit_once('.')?;
    let (millis, slug) = stem.split_once('-')?;
    let valid = EXTENSIONS.contains(&extension)
        && !millis.is_empty()
        && millis.bytes().all(|byte| byte.is_ascii_digit())
        && !slug.is_empty()
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    valid.then_some((millis.parse().ok()?, !is_unlabelled(slug)))
}

/// The chat's screenshots, oldest first. Other files are never included.
fn shots(dir: &Path) -> std::io::Result<Vec<Shot>> {
    let mut shots = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        // Not followed: a link is never a screenshot this module saved.
        if !entry.file_type()?.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some((millis, labelled)) = parse_shot(&name) {
            shots.push(Shot {
                path: entry.path(),
                name,
                millis,
                labelled,
            });
        }
    }
    shots.sort_by(|a, b| (a.millis, &a.name).cmp(&(b.millis, &b.name)));
    Ok(shots)
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

/// Write `<app data>/turn-shots/<session>/<millis>-<label>.jpg` without ever
/// replacing an earlier image, and return the agent's JSON result. A chat at
/// its limit first makes room (`make_room`); `mentions` answers which of some
/// lowercase file names its saved messages show, as in `tidy_turn`.
pub(crate) fn store(
    app_data: &Path,
    session_id: &str,
    label: Option<&str>,
    image: &Jpeg,
    millis: u128,
    mentions: impl FnOnce(&[String]) -> Result<Option<HashSet<String>>, String>,
) -> Result<Value, String> {
    if !image.bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Err("Screenshot is not a JPEG image".into());
    }
    if image.bytes.len() > MAX_BYTES {
        return Err("Screenshot exceeds the size limit".into());
    }
    let (width, height) = (image.width, image.height);
    let dir = session_dir(app_data, session_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not save the screenshot: {error}"))?;
    let existing =
        shots(&dir).map_err(|error| format!("Could not save the screenshot: {error}"))?;
    if existing.len() >= MAX_PER_SESSION {
        make_room(existing, mentions)?;
    }
    let slug = file_label(label);
    for attempt in 1..=16 {
        let name = if attempt == 1 {
            format!("{millis}-{slug}.{EXTENSION}")
        } else {
            format!("{millis}-{slug}-{attempt}.{EXTENSION}")
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
        if let Err(error) = file.write_all(&image.bytes).and_then(|()| file.sync_all()) {
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

/// A full chat makes room for one more screenshot by deleting its oldest
/// unlabelled ones that its saved messages do not show. When none can go, or
/// what the chat shows cannot be read, the screenshot is refused.
fn make_room(
    shots: Vec<Shot>,
    mentions: impl FnOnce(&[String]) -> Result<Option<HashSet<String>>, String>,
) -> Result<(), String> {
    let needed = shots.len() + 1 - MAX_PER_SESSION;
    let unlabelled: Vec<Shot> = shots.into_iter().filter(|shot| !shot.labelled).collect();
    let names: Vec<String> = unlabelled
        .iter()
        .map(|shot| shot.name.to_ascii_lowercase())
        .collect();
    let shown = if unlabelled.is_empty() {
        Some(HashSet::new())
    } else {
        mentions(&names).ok().flatten()
    };
    let Some(shown) = shown else {
        return Err(format!(
            "This chat already has {MAX_PER_SESSION} screenshots. Start a new chat to take more."
        ));
    };
    let mut removed = 0;
    for (shot, name) in unlabelled.iter().zip(&names) {
        if removed == needed {
            break;
        }
        if !shown.contains(name) && std::fs::remove_file(&shot.path).is_ok() {
            removed += 1;
        }
    }
    if removed < needed {
        return Err(format!(
            "This chat already has {MAX_PER_SESSION} screenshots, each labelled or shown in its \
             messages. Start a new chat to take more."
        ));
    }
    Ok(())
}

/// Missing folders are already clean; a chat never shares its folder.
pub(crate) fn remove_session(app_data: &Path, session_id: &str) -> Result<(), String> {
    match std::fs::remove_dir_all(session_dir(app_data, session_id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// After a turn ends: delete the screenshots taken between `from` and `to`
/// (milliseconds) that are unlabelled and that neither `referenced` (file
/// names the window found in the chat's messages) nor the saved chat
/// mentions. `mentions` answers which of some lowercase file names the
/// chat's saved messages show or mention (`None` when the chat has no saved
/// transcript); when it fails, everything is kept. Returns the names removed.
pub(crate) fn tidy_turn(
    app_data: &Path,
    session_id: &str,
    from: u64,
    to: u64,
    referenced: &HashSet<String>,
    mentions: impl FnOnce(&[String]) -> Result<Option<HashSet<String>>, String>,
) -> Result<Vec<String>, String> {
    let dir = session_dir(app_data, session_id)?;
    let shots = match shots(&dir) {
        Ok(shots) => shots,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let mut candidates: Vec<Shot> = shots
        .into_iter()
        .filter(|shot| {
            !shot.labelled
                && (from..=to).contains(&shot.millis)
                && !referenced.contains(&shot.name.to_ascii_lowercase())
        })
        .collect();
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<String> = candidates
        .iter()
        .map(|shot| shot.name.to_ascii_lowercase())
        .collect();
    let saved = mentions(&names)?.unwrap_or_default();
    candidates.retain(|shot| !saved.contains(&shot.name.to_ascii_lowercase()));
    Ok(candidates
        .into_iter()
        .filter_map(|shot| std::fs::remove_file(&shot.path).ok().map(|()| shot.name))
        .collect())
}

/// The window saw a chat stop working: tidy the screenshots of that turn.
#[tauri::command(async)]
pub fn turn_shots_tidy(
    app: AppHandle,
    store: State<'_, SessionStore>,
    session_id: String,
    from: u64,
    to: u64,
    referenced: Vec<String>,
) -> Result<usize, String> {
    if referenced.len() > MAX_REFERENCED || from > to {
        return Err("Invalid screenshot cleanup request".into());
    }
    let referenced = referenced
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tidy_turn(&app_data, &session_id, from, to, &referenced, |names| {
        store.chat_mentions(&session_id, names)
    })
    .map(|removed| removed.len())
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

    /// A real JPEG of a page-like image, stored at its own size.
    pub(crate) fn jpeg(width: u32, height: u32) -> Jpeg {
        let png = crate::turn_shot_image::tests::page_png(width, height, false);
        crate::turn_shot_image::compress(&png, 1.0).unwrap()
    }

    /// A chat that was never saved.
    pub(crate) fn unsaved(_: &[String]) -> Result<Option<HashSet<String>>, String> {
        Ok(None)
    }

    /// Only a PNG signature and header: enough for `decode_png`, not to decode.
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
        // A labelled file never takes the unlabelled name.
        assert_eq!(file_label(Some("☃☃")), "labelled");
        assert_eq!(file_label(Some("Page")), "labelled-page");
        assert_eq!(file_label(Some("page 2")), "labelled-page-2");
        assert_eq!(file_label(Some("Pages")), "pages");
        assert_eq!(file_label(Some("page two")), "page-two");
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
    fn file_names_tell_when_and_whether_a_screenshot_was_labelled() {
        assert_eq!(
            parse_shot("1792438599200-page.jpg"),
            Some((1792438599200, false))
        );
        assert_eq!(
            parse_shot("1792438599200-page-2.jpg"),
            Some((1792438599200, false))
        );
        assert_eq!(
            parse_shot("1792438599200-page.png"),
            Some((1792438599200, false))
        );
        assert_eq!(parse_shot("1700-before.jpg"), Some((1700, true)));
        assert_eq!(parse_shot("1700-before-2.png"), Some((1700, true)));
        assert_eq!(parse_shot("1700-labelled-page.jpg"), Some((1700, true)));
        assert_eq!(parse_shot("1700-page-two.jpg"), Some((1700, true)));
        for other in [
            "1700-page.gif",
            "1700-page",
            "page.jpg",
            "-page.jpg",
            "17a0-page.jpg",
            "1700-.jpg",
            "1700-Page.jpg",
            "1700-page.jpg.tmp",
            ".DS_Store",
        ] {
            assert_eq!(parse_shot(other), None, "{other}");
        }
        // Every name `store` writes reads back with its label state.
        for label in [
            None,
            Some("Before"),
            Some("page"),
            Some("☃"),
            Some("page 3"),
        ] {
            let name = format!("1700-{}.{EXTENSION}", file_label(label));
            assert_eq!(parse_shot(&name), Some((1700, label.is_some())), "{name}");
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn a_turn_keeps_only_labelled_and_shown_screenshots() {
        let root = TemporaryDirectory::new();
        let dir = root.0.join("turn-shots").join("s1");
        // Earlier turn, this turn (1000..=2000), and a later turn.
        store(&root.0, "s1", None, &jpeg(1, 1), 900, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 1000, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 1000, unsaved).unwrap();
        store(&root.0, "s1", Some("before"), &jpeg(1, 1), 1100, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 1200, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 1300, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 1400, unsaved).unwrap();
        store(&root.0, "s1", Some("after"), &jpeg(1, 1), 2000, unsaved).unwrap();
        store(&root.0, "s1", None, &jpeg(1, 1), 2001, unsaved).unwrap();
        // An earlier version's PNG from this turn, and files that are not
        // screenshots, are judged by name only.
        std::fs::write(dir.join("1500-page.png"), b"png").unwrap();
        std::fs::write(dir.join("1600-notes.txt"), b"keep").unwrap();
        std::fs::create_dir(dir.join("1700-page.jpg")).unwrap();
        let mut asked = Vec::new();
        let removed = tidy_turn(
            &root.0,
            "s1",
            1000,
            2000,
            // The reply shows one (in any case); the saved chat mentions another.
            &set(&["1200-page.jpg", "unrelated.jpg"]),
            |names| {
                asked = names.to_vec();
                Ok(Some(set(&["1300-page.jpg"])))
            },
        )
        .unwrap();
        assert_eq!(
            asked,
            [
                "1000-page-2.jpg",
                "1000-page.jpg",
                "1300-page.jpg",
                "1400-page.jpg",
                "1500-page.png"
            ]
        );
        let mut removed = removed;
        removed.sort();
        assert_eq!(
            removed,
            [
                "1000-page-2.jpg",
                "1000-page.jpg",
                "1400-page.jpg",
                "1500-page.png"
            ]
        );
        assert_eq!(
            names(&dir),
            [
                "1100-before.jpg",
                "1200-page.jpg",
                "1300-page.jpg",
                "1600-notes.txt",
                "1700-page.jpg",
                "2000-after.jpg",
                "2001-page.jpg",
                "900-page.jpg"
            ]
        );
    }

    #[test]
    fn a_turn_keeps_everything_when_the_chat_cannot_be_read() {
        let root = TemporaryDirectory::new();
        let dir = root.0.join("turn-shots").join("s1");
        store(&root.0, "s1", None, &jpeg(1, 1), 1000, unsaved).unwrap();
        let unreadable = tidy_turn(&root.0, "s1", 0, 5000, &HashSet::new(), |_| {
            Err("Chat history could not be opened".into())
        });
        assert!(unreadable.is_err());
        assert_eq!(names(&dir), ["1000-page.jpg"]);
        // Nothing to judge: the saved chat is not even asked.
        let quiet = tidy_turn(&root.0, "s1", 0, 999, &HashSet::new(), |_| {
            panic!("not asked")
        });
        assert_eq!(quiet.unwrap(), Vec::<String>::new());
        // A chat that was never saved relies on the window's references.
        let unsaved = tidy_turn(&root.0, "s1", 0, 5000, &HashSet::new(), |_| Ok(None));
        assert_eq!(unsaved.unwrap(), ["1000-page.jpg"]);
        // A chat without screenshots, or with an invalid id.
        assert_eq!(
            tidy_turn(&root.0, "none", 0, 5000, &HashSet::new(), |_| Ok(None)).unwrap(),
            Vec::<String>::new()
        );
        assert!(tidy_turn(&root.0, "../s1", 0, 5000, &HashSet::new(), |_| Ok(None)).is_err());
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
        let first = store(
            &root.0,
            "session-a",
            Some("Before"),
            &jpeg(2, 3),
            1700,
            unsaved,
        )
        .unwrap();
        let second = store(
            &root.0,
            "session-a",
            Some("Before"),
            &jpeg(4, 5),
            1700,
            unsaved,
        )
        .unwrap();
        let dir = root.0.join("turn-shots").join("session-a");
        assert_eq!(
            first["path"],
            dir.join("1700-before.jpg").to_string_lossy().as_ref()
        );
        assert_eq!(
            second["path"],
            dir.join("1700-before-2.jpg").to_string_lossy().as_ref()
        );
        assert_eq!(
            (first["width"].as_u64(), first["height"].as_u64()),
            (Some(2), Some(3))
        );
        assert_eq!(
            first["markdown"],
            format!("![Before](<{}>)", dir.join("1700-before.jpg").display())
        );
        assert_eq!(
            std::fs::read(dir.join("1700-before.jpg")).unwrap(),
            jpeg(2, 3).bytes
        );
        let unlabeled = store(&root.0, "session-a", None, &jpeg(1, 1), 1800, unsaved).unwrap();
        assert_eq!(
            unlabeled["path"],
            dir.join("1800-page.jpg").to_string_lossy().as_ref()
        );
        assert!(unlabeled["markdown"]
            .as_str()
            .unwrap()
            .starts_with("![Screenshot](<"));
        for session in ["", "../other", "a/b"] {
            assert!(store(&root.0, session, None, &jpeg(1, 1), 1, unsaved).is_err());
        }
        let not_jpeg = Jpeg {
            bytes: png(1, 1),
            width: 1,
            height: 1,
        };
        assert!(store(&root.0, "session-a", None, &not_jpeg, 1, unsaved).is_err());
    }

    /// Fill a chat to its limit: `labelled` labelled files first, then
    /// unlabelled ones, one millisecond apart, alternating JPEG and PNG.
    fn fill(root: &Path, session: &str, labelled: usize) -> PathBuf {
        let dir = root.join("turn-shots").join(session);
        std::fs::create_dir_all(&dir).unwrap();
        for index in 0..MAX_PER_SESSION {
            let label = if index < labelled {
                "before"
            } else {
                UNLABELLED
            };
            let extension = EXTENSIONS[index % 2];
            let name = format!("{}-{label}.{extension}", 1000 + index);
            std::fs::write(dir.join(name), b"").unwrap();
        }
        dir
    }

    #[test]
    fn a_full_chat_makes_room_from_its_oldest_unshown_screenshots() {
        let root = TemporaryDirectory::new();
        // 1000-1009 are labelled; 1010 and 1011 (an earlier PNG) are shown.
        let dir = fill(&root.0, "busy", 10);
        let mut asked = Vec::new();
        let saved = store(&root.0, "busy", None, &jpeg(1, 1), 9000, |names| {
            asked = names.to_vec();
            Ok(Some(set(&["1010-page.jpg", "1011-page.png"])))
        })
        .unwrap();
        assert!(saved["path"].as_str().unwrap().ends_with("9000-page.jpg"));
        // Only unlabelled screenshots are considered, oldest first.
        assert_eq!(asked.len(), MAX_PER_SESSION - 10);
        assert_eq!(
            asked[..3],
            ["1010-page.jpg", "1011-page.png", "1012-page.jpg"]
        );
        let left = names(&dir);
        assert_eq!(left.len(), MAX_PER_SESSION);
        assert!(!left.contains(&"1012-page.jpg".to_string()));
        for kept in [
            "1000-before.jpg",
            "1009-before.png",
            "1010-page.jpg",
            "1011-page.png",
        ] {
            assert!(left.contains(&kept.to_string()), "{kept}");
        }
        // The next one removes the next oldest unshown screenshot.
        store(&root.0, "busy", Some("after"), &jpeg(1, 1), 9001, |_| {
            Ok(Some(HashSet::new()))
        })
        .unwrap();
        let left = names(&dir);
        assert_eq!(left.len(), MAX_PER_SESSION);
        assert!(!left.contains(&"1010-page.jpg".to_string()));
        assert!(left.contains(&"9001-after.jpg".to_string()));
        assert!(store(&root.0, "other", None, &jpeg(1, 1), 1, unsaved).is_ok());
    }

    #[test]
    fn a_full_chat_refuses_only_when_nothing_can_go() {
        let root = TemporaryDirectory::new();
        // Every screenshot labelled: the saved chat is not even asked.
        let dir = fill(&root.0, "labelled", MAX_PER_SESSION);
        let error = store(&root.0, "labelled", None, &jpeg(1, 1), 9000, |_| {
            panic!("not asked")
        })
        .unwrap_err();
        assert_eq!(
            error,
            "This chat already has 300 screenshots, each labelled or shown in its messages. \
             Start a new chat to take more."
        );
        assert_eq!(names(&dir).len(), MAX_PER_SESSION);
        // Every unlabelled one shown in the chat.
        let dir = fill(&root.0, "shown", 100);
        let error = store(&root.0, "shown", None, &jpeg(1, 1), 9000, |names| {
            Ok(Some(names.iter().cloned().collect()))
        })
        .unwrap_err();
        assert!(error.starts_with("This chat already has 300 screenshots, each labelled"));
        assert_eq!(names(&dir).len(), MAX_PER_SESSION);
        // Unsure what the chat shows: keep everything.
        for (session, mentions) in [
            ("unsaved", Ok(None)),
            (
                "unreadable",
                Err("Chat history could not be opened".to_string()),
            ),
        ] {
            let dir = fill(&root.0, session, 0);
            let error = store(&root.0, session, None, &jpeg(1, 1), 9000, |_| mentions).unwrap_err();
            assert_eq!(
                error,
                "This chat already has 300 screenshots. Start a new chat to take more."
            );
            assert_eq!(names(&dir).len(), MAX_PER_SESSION);
        }
    }

    #[test]
    fn removing_a_session_deletes_only_its_folder() {
        let root = TemporaryDirectory::new();
        store(&root.0, "gone", Some("after"), &jpeg(1, 1), 1, unsaved).unwrap();
        store(&root.0, "kept", Some("after"), &jpeg(1, 1), 1, unsaved).unwrap();
        remove_session(&root.0, "gone").unwrap();
        remove_session(&root.0, "gone").unwrap();
        assert!(!root.0.join("turn-shots/gone").exists());
        assert!(root.0.join("turn-shots/kept/1-after.jpg").is_file());
        assert!(remove_session(&root.0, "../kept").is_err());
        assert!(root.0.join("turn-shots/kept").is_dir());
    }
}
