use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalProjectInfo {
    root: String,
    branch: Option<String>,
    remote_url: Option<String>,
    default_branch: Option<String>,
}

/// Local metadata for preparing a browser PR form. This never contacts a
/// remote, authenticates, stages, commits, or pushes.
#[tauri::command]
pub async fn personal_project_info(cwd: String) -> Result<PersonalProjectInfo, String> {
    tauri::async_runtime::spawn_blocking(move || read_project_info(&cwd))
        .await
        .map_err(|error| format!("Could not read project information: {error}"))?
}

fn read_project_info(cwd: &str) -> Result<PersonalProjectInfo, String> {
    if cwd.trim().is_empty() {
        return Err("Open a project folder before preparing a pull request.".into());
    }
    let cwd = crate::fs::expand_home(cwd);
    let root = git_output(&cwd, &["rev-parse", "--show-toplevel"])?.ok_or_else(|| {
        "This folder is not a Git working copy. Open a folder inside the repository.".to_string()
    })?;
    let root = PathBuf::from(root);
    let branch = git_output(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;

    let origin = git_output(&root, &["remote", "get-url", "--", "origin"])?;
    let (remote, remote_url) = if origin.is_some() {
        (Some("origin".to_string()), origin)
    } else {
        let remote = git_output(&root, &["remote"])?.and_then(|names| {
            names
                .lines()
                .find(|name| !name.is_empty())
                .map(str::to_owned)
        });
        let url = match remote.as_deref() {
            Some(name) => git_output(&root, &["remote", "get-url", "--", name])?,
            None => None,
        };
        (remote, url)
    };
    let default_branch = match remote {
        Some(remote) => {
            let prefix = format!("refs/remotes/{remote}/");
            git_output(
                &root,
                &["symbolic-ref", "--quiet", &format!("{prefix}HEAD")],
            )?
            .and_then(|head| head.strip_prefix(&prefix).map(str::to_owned))
        }
        None => None,
    };

    Ok(PersonalProjectInfo {
        root: crate::fs::path_to_js(&root),
        branch,
        remote_url,
        default_branch,
    })
}

/// Missing optional refs/remotes return None. Only fixed read commands are
/// passed by this module; values are individual arguments, never shell code.
fn git_output(cwd: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let mut command = Command::new("git");
    crate::hide_window_console(&mut command);
    let output = command
        .arg("--no-pager")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .output()
        .map_err(|error| format!("Could not run Git. Check that Git is installed: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn directory() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "monocode personal project {} {stamp} {}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn repository() -> Self {
            let fixture = Self::directory();
            fixture.git(&["init", "--initial-branch=feature"]);
            fixture
        }

        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args([
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "user.name=MonoCode Test",
                    "-c",
                    "user.email=test@example.invalid",
                ])
                .args(args)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn info(&self) -> PersonalProjectInfo {
            read_project_info(self.0.to_str().unwrap()).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn resolves_spaces_nested_folders_and_origin_metadata_without_fetching() {
        let fixture = Fixture::repository();
        fixture.git(&[
            "remote",
            "add",
            "upstream",
            "https://example.invalid/upstream/repo.git",
        ]);
        fixture.git(&[
            "remote",
            "add",
            "origin",
            "https://example.invalid/personal/repo.git",
        ]);
        fixture.git(&[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ]);
        let nested = fixture.0.join("nested folder");
        std::fs::create_dir(&nested).unwrap();
        let info = read_project_info(nested.to_str().unwrap()).unwrap();
        assert_eq!(
            Path::new(&info.root).canonicalize().unwrap(),
            fixture.0.canonicalize().unwrap()
        );
        assert_eq!(info.branch.as_deref(), Some("feature"));
        assert_eq!(
            info.remote_url.as_deref(),
            Some("https://example.invalid/personal/repo.git")
        );
        assert_eq!(info.default_branch.as_deref(), Some("main"));
        let json = serde_json::to_value(info).unwrap();
        assert!(json.get("remoteUrl").is_some());
        assert!(json.get("defaultBranch").is_some());
    }

    #[test]
    fn falls_back_to_the_first_local_remote_when_origin_is_absent() {
        let fixture = Fixture::repository();
        fixture.git(&[
            "remote",
            "add",
            "upstream",
            "https://example.invalid/upstream/repo.git",
        ]);
        fixture.git(&[
            "symbolic-ref",
            "refs/remotes/upstream/HEAD",
            "refs/remotes/upstream/release/main",
        ]);
        let info = fixture.info();
        assert_eq!(
            info.remote_url.as_deref(),
            Some("https://example.invalid/upstream/repo.git")
        );
        assert_eq!(info.default_branch.as_deref(), Some("release/main"));
    }

    #[test]
    fn keeps_missing_remotes_and_unknown_defaults_absent() {
        let fixture = Fixture::repository();
        let info = fixture.info();
        assert_eq!(info.branch.as_deref(), Some("feature"));
        assert!(info.remote_url.is_none());
        assert!(info.default_branch.is_none());
        fixture.git(&[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ]);
        assert!(fixture.info().default_branch.is_none());
    }

    #[test]
    fn reports_a_detached_head_without_inventing_a_branch() {
        let fixture = Fixture::repository();
        fixture.git(&["commit", "--allow-empty", "-m", "fixture"]);
        fixture.git(&["checkout", "--detach", "HEAD"]);
        assert!(fixture.info().branch.is_none());
    }

    #[test]
    fn rejects_non_git_folders_with_an_actionable_message() {
        let fixture = Fixture::directory();
        let error = read_project_info(fixture.0.to_str().unwrap()).unwrap_err();
        assert!(error.contains("not a Git working copy"));
        assert!(error.contains("Open a folder"));
        assert!(read_project_info("")
            .unwrap_err()
            .contains("Open a project"));
    }
}
