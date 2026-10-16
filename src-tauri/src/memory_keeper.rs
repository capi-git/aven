//! What the memory keeper may read from a project: a few named files at the
//! project's top level, read here so the rules cannot be bypassed by the
//! project itself. A symbolic link (a README pointing at `~/.ssh/id_rsa`),
//! a path outside the folder, a secret-looking name, a large or binary file
//! is never read. The keeper's model gets only the text Aven builds from
//! these excerpts; it has no tools of its own.

use serde::Serialize;
use std::io::Read;
use std::path::Path;

use crate::fs::expand_home;

/// Files larger than this are skipped rather than read in part.
const FILE_MAX_BYTES: u64 = 1024 * 1024;
/// The most read from any one file.
const EXCERPT_MAX_BYTES: usize = 64 * 1024;
const NAMES_MAX: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeeperFile {
    pub name: String,
    pub text: String,
    /// The file was longer than the excerpt.
    pub truncated: bool,
}

/// Environment files, keys and credentials, matched like the TypeScript
/// filter so neither side alone decides.
fn secret_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with(".env")
        || lower.starts_with("id_rsa")
        || lower.starts_with("id_dsa")
        || lower.starts_with("id_ecdsa")
        || lower.starts_with("id_ed25519")
        || [
            ".pem",
            ".key",
            ".p8",
            ".p12",
            ".pfx",
            ".jks",
            ".keystore",
            ".kdbx",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
        || [
            ".npmrc",
            ".pypirc",
            ".netrc",
            ".git-credentials",
            ".htpasswd",
            ".pgpass",
        ]
        .contains(&lower.as_str())
        || ["secret", "credential", "password", "passwd", "token"]
            .iter()
            .any(|word| lower.contains(word))
}

/// A single file name in the folder itself: no separators, no `..`.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
}

fn read_one(root: &Path, name: &str, max_bytes: usize) -> Option<KeeperFile> {
    if !plain_name(name) || secret_name(name) {
        return None;
    }
    let path = root.join(name);
    // Not followed: a link may point anywhere on the Mac.
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.file_type().is_file() || meta.len() > FILE_MAX_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .ok()?
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.contains(&0) {
        return None;
    }
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);
    // A cut may split a character; drop the partial end rather than fail.
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            let valid = error.utf8_error().valid_up_to();
            if !truncated || valid == 0 {
                return None;
            }
            let mut bytes = error.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).ok()?
        }
    };
    Some(KeeperFile {
        name: name.to_string(),
        text,
        truncated,
    })
}

pub(crate) fn read_project_files(
    root: &Path,
    names: &[String],
    max_bytes: usize,
) -> Vec<KeeperFile> {
    let max_bytes = max_bytes.clamp(1, EXCERPT_MAX_BYTES);
    if !root.is_dir() {
        return Vec::new();
    }
    names
        .iter()
        .take(NAMES_MAX)
        .filter_map(|name| read_one(root, name, max_bytes))
        .collect()
}

/// The named top-level files of `root` that the keeper may read, as text.
/// Files it may not read are left out without an error.
#[tauri::command(async)]
pub fn memory_keeper_read_files(
    root: String,
    names: Vec<String>,
    max_bytes: usize,
) -> Result<Vec<KeeperFile>, String> {
    if root.trim().is_empty() || root.chars().any(char::is_control) {
        return Err("Invalid project".into());
    }
    Ok(read_project_files(&expand_home(&root), &names, max_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(std::path::PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp(label: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "aven-memory-keeper-{label}-{}-{}",
            std::process::id(),
            crate::session_store::now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn reads_named_top_level_files() {
        let dir = temp("read");
        std::fs::write(dir.0.join("README.md"), "# App\nRun it.").unwrap();
        std::fs::write(dir.0.join("package.json"), "{}").unwrap();
        let files = read_project_files(
            &dir.0,
            &names(&["README.md", "package.json", "missing.md"]),
            4096,
        );
        assert_eq!(
            files,
            vec![
                KeeperFile {
                    name: "README.md".into(),
                    text: "# App\nRun it.".into(),
                    truncated: false
                },
                KeeperFile {
                    name: "package.json".into(),
                    text: "{}".into(),
                    truncated: false
                },
            ]
        );
    }

    #[test]
    fn never_reads_secrets_paths_or_folders() {
        let dir = temp("secrets");
        std::fs::write(dir.0.join(".env"), "TOKEN=1").unwrap();
        std::fs::write(dir.0.join(".env.local"), "TOKEN=1").unwrap();
        std::fs::write(dir.0.join("server.pem"), "key").unwrap();
        std::fs::write(dir.0.join("credentials.json"), "{}").unwrap();
        std::fs::create_dir_all(dir.0.join("docs")).unwrap();
        std::fs::write(dir.0.join("docs/README.md"), "nested").unwrap();
        let files = read_project_files(
            &dir.0,
            &names(&[
                ".env",
                ".env.local",
                "server.pem",
                "credentials.json",
                "docs",
                "docs/README.md",
                "../README.md",
                "..",
            ]),
            4096,
        );
        assert!(files.is_empty(), "{files:?}");
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_a_link_out_of_the_project() {
        let dir = temp("link");
        let outside = temp("outside");
        std::fs::write(outside.0.join("id_rsa"), "-----BEGIN PRIVATE KEY-----").unwrap();
        std::os::unix::fs::symlink(outside.0.join("id_rsa"), dir.0.join("README.md")).unwrap();
        assert!(read_project_files(&dir.0, &names(&["README.md"]), 4096).is_empty());
    }

    #[test]
    fn cuts_long_files_and_skips_binary_ones() {
        let dir = temp("long");
        std::fs::write(dir.0.join("README.md"), "é".repeat(100)).unwrap();
        std::fs::write(dir.0.join("logo.txt"), [b'a', 0, b'b']).unwrap();
        let files = read_project_files(&dir.0, &names(&["README.md", "logo.txt"]), 11);
        assert_eq!(files.len(), 1);
        // 11 bytes would split the sixth "é"; the partial character is dropped.
        assert_eq!(files[0].text, "é".repeat(5));
        assert!(files[0].truncated);
    }

    #[test]
    fn skips_files_too_large_to_read() {
        let dir = temp("large");
        let file = std::fs::File::create(dir.0.join("README.md")).unwrap();
        file.set_len(FILE_MAX_BYTES + 1).unwrap();
        assert!(read_project_files(&dir.0, &names(&["README.md"]), 4096).is_empty());
    }
}
