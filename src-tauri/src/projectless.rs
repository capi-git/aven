//! Persistent scratch folders for sessions that have no selected project.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const WORKSPACES_DIR: &str = "projectless-workspaces";

#[tauri::command]
pub async fn projectless_cwd(app: AppHandle, profile_id: String) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_workspace(&data_dir, &profile_id).map(|path| crate::fs::path_to_js(&path))
    })
    .await
    .map_err(|error| format!("Could not prepare the session folder: {error}"))?
}

fn valid_profile_id(profile_id: &str) -> bool {
    !profile_id.is_empty()
        && profile_id.len() <= 96
        && profile_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
        && !matches!(profile_id, "__proto__" | "prototype" | "constructor")
}

fn ensure_workspace(data_dir: &Path, profile_id: &str) -> Result<PathBuf, String> {
    if !valid_profile_id(profile_id) {
        return Err("Invalid workspace identity for a session folder.".into());
    }
    if !data_dir.is_absolute() {
        return Err("The application data folder must be an absolute path.".into());
    }
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("Could not prepare the application data folder: {error}"))?;
    let data_dir = data_dir
        .canonicalize()
        .map_err(|error| format!("Could not resolve the application data folder: {error}"))?;
    let root = data_dir.join(WORKSPACES_DIR);
    create_managed_directory(&root)?;
    let folder = root.join(profile_id);
    create_managed_directory(&folder)?;
    let resolved = folder
        .canonicalize()
        .map_err(|error| format!("Could not resolve the session folder: {error}"))?;
    if resolved != folder {
        return Err("The session folder must stay inside application data.".into());
    }
    Ok(resolved)
}

/// Existing content is retained. Never follow a replacement symlink into an
/// unrelated folder (such as the user's home) when choosing a default cwd.
fn create_managed_directory(path: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("Could not prepare the session folder: {error}")),
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect the session folder: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The session folder must be a directory, not a file or symbolic link.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "supermono-projectless-{}-{stamp}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reuses_a_durable_folder_and_keeps_profiles_separate() {
        let fixture = Fixture::new();
        let data = fixture.0.join("Application Data");
        let personal = ensure_workspace(&data, "personal").unwrap();
        std::fs::write(personal.join("keep.txt"), "Keep my work").unwrap();
        assert_eq!(ensure_workspace(&data, "personal").unwrap(), personal);
        assert_eq!(
            std::fs::read_to_string(personal.join("keep.txt")).unwrap(),
            "Keep my work"
        );
        let work = ensure_workspace(&data, "work").unwrap();
        assert_ne!(work, personal);
        assert!(!work.join("keep.txt").exists());
        assert!(personal.starts_with(data.canonicalize().unwrap().join(WORKSPACES_DIR)));
        assert!(!personal.join(".git").exists());
    }

    #[test]
    fn rejects_profile_traversal_before_creating_any_folders() {
        let fixture = Fixture::new();
        let data = fixture.0.join("not-created");
        for id in [
            "",
            "..",
            "../outside",
            "/tmp",
            "work/personal",
            "work\\personal",
            "~",
            "a\n",
            "__proto__",
        ] {
            assert!(ensure_workspace(&data, id).is_err(), "{id:?}");
            assert!(!data.exists());
        }
        assert!(valid_profile_id("workspace-1234_abcd"));
        assert!(!valid_profile_id(&"a".repeat(97)));
        assert!(ensure_workspace(Path::new("relative"), "personal").is_err());
    }

    #[test]
    fn refuses_an_existing_file_without_overwriting_it() {
        let fixture = Fixture::new();
        let root = fixture.0.join(WORKSPACES_DIR);
        std::fs::write(&root, "Retain this file").unwrap();
        assert!(ensure_workspace(&fixture.0, "personal").is_err());
        assert_eq!(std::fs::read_to_string(root).unwrap(), "Retain this file");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_at_either_managed_directory_level() {
        use std::os::unix::fs::symlink;
        for replace_root in [true, false] {
            let fixture = Fixture::new();
            let external = fixture.0.join("unrelated");
            std::fs::create_dir(&external).unwrap();
            let data = fixture.0.join("app-data");
            std::fs::create_dir(&data).unwrap();
            let root = data.join(WORKSPACES_DIR);
            if replace_root {
                symlink(&external, &root).unwrap();
            } else {
                std::fs::create_dir(&root).unwrap();
                symlink(&external, root.join("personal")).unwrap();
            }
            assert!(ensure_workspace(&data, "personal").is_err());
            assert_eq!(std::fs::read_dir(&external).unwrap().count(), 0);
        }
    }
}
