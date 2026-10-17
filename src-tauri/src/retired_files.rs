//! Files earlier versions of Aven wrote that nothing reads any more.
//!
//! Linear support saved its API key in plain text as `linear-token` in the
//! app data folder. Linear is gone, so the key is only a live credential
//! left on disk. It is removed once at startup: only that exact file, only
//! when it exists, and without reading or logging what it held.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use tauri::{AppHandle, Manager};

/// The plain-text Linear API key the removed Linear integration saved.
const LINEAR_TOKEN_FILE: &str = "linear-token";

pub fn remove(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Err(kind) = remove_linear_token(&dir) {
        eprintln!("[aven] Could not remove the old Linear key file: {kind:?}");
    }
}

/// Remove `<dir>/linear-token` if it is a file (or a link, which is removed
/// without touching its target). Anything else by that name is left alone.
fn remove_linear_token(dir: &Path) -> Result<bool, ErrorKind> {
    let path = dir.join(LINEAR_TOKEN_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() => Ok(false),
        Ok(_) => match fs::remove_file(&path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.kind()),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.kind()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("aven-retired-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn removes_only_the_linear_key_file() {
        let dir = temp_dir();
        fs::write(dir.join("linear-token"), "lin_api_secret").unwrap();
        fs::write(dir.join("linear-token.bak"), "keep").unwrap();
        fs::write(dir.join("monocode.db"), "keep").unwrap();

        assert_eq!(remove_linear_token(&dir), Ok(true));
        assert!(!dir.join("linear-token").exists());
        assert!(dir.join("linear-token.bak").exists());
        assert!(dir.join("monocode.db").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn does_nothing_when_there_is_no_key_file() {
        let dir = temp_dir();
        assert_eq!(remove_linear_token(&dir), Ok(false));
        assert_eq!(remove_linear_token(&dir.join("missing")), Ok(false));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn leaves_a_folder_by_that_name_alone() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("linear-token")).unwrap();
        fs::write(dir.join("linear-token").join("inside"), "keep").unwrap();
        assert_eq!(remove_linear_token(&dir), Ok(false));
        assert!(dir.join("linear-token").join("inside").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn removes_a_link_without_touching_its_target() {
        let dir = temp_dir();
        let target = dir.join("elsewhere");
        fs::write(&target, "keep").unwrap();
        std::os::unix::fs::symlink(&target, dir.join("linear-token")).unwrap();
        assert_eq!(remove_linear_token(&dir), Ok(true));
        assert!(fs::symlink_metadata(dir.join("linear-token")).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
        fs::remove_dir_all(&dir).unwrap();
    }
}
