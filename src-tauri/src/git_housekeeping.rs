//! Keep a repository tidy from the Changes panel: merged branch clean-up,
//! squash-merging the current pull request, and the project's release status.
//! GitHub calls go through the project's routed account; nothing here changes a
//! shared CLI login.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

use crate::fs::{expand_home, git_checked, github_route};

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergedBranches {
    /// Branch everything is compared with, e.g. `main`.
    pub base: String,
    pub remote: Option<String>,
    /// Local branches whose work is already in the base branch.
    pub local: Vec<String>,
    /// Branches on the remote whose work is already in the base branch.
    pub remote_branches: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchCleanup {
    pub deleted_local: Vec<String>,
    pub deleted_remote: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag: String,
    pub name: String,
    pub url: String,
    pub published_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRun {
    pub status: String,
    pub conclusion: String,
    pub url: String,
    pub created_at: String,
    pub head_sha: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    pub base: String,
    pub latest: Option<ReleaseInfo>,
    /// Commits on the remote base branch since the latest release.
    pub unreleased: Option<u32>,
    /// Version declared in package.json, when there is one.
    pub version: Option<String>,
    /// True when that version has no release tag yet.
    pub version_unreleased: bool,
    /// Workflow file that can publish, e.g. `release.yml`.
    pub workflow: Option<String>,
    pub workflow_has_publish: bool,
    pub run: Option<ReleaseRun>,
}

#[tauri::command]
pub async fn git_merged_branches(cwd: String) -> Result<MergedBranches, String> {
    tauri::async_runtime::spawn_blocking(move || merged_branches_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_delete_merged_branches(
    cwd: String,
    local: Vec<String>,
    remote: Vec<String>,
) -> Result<BranchCleanup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_merged_branches_for(&expand_home(&cwd), &local, &remote)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pr_squash_merge(cwd: String, number: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || squash_merge_for(&expand_home(&cwd), number))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_release_status(cwd: String) -> Result<ReleaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || release_status_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_release_start(cwd: String, version: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || release_start_for(&expand_home(&cwd), &version))
        .await
        .map_err(|e| e.to_string())?
}

fn git() -> Command {
    let mut command = Command::new("git");
    crate::hide_window_console(&mut command);
    command
}

fn git_text(root: &Path, args: &[&str]) -> Option<String> {
    let output = git()
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn lines(text: Option<String>) -> Vec<String> {
    text.unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn remote_name(root: &Path) -> Option<String> {
    let remotes = lines(git_text(root, &["remote"]));
    if remotes.iter().any(|remote| remote == "origin") {
        return Some("origin".into());
    }
    remotes.into_iter().next()
}

/// The remote's default branch, falling back to a local `main` or `master`.
fn base_branch(root: &Path, remote: Option<&str>) -> Option<String> {
    if let Some(remote) = remote {
        if let Some(head) = git_text(
            root,
            &[
                "symbolic-ref",
                "--short",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        ) {
            if let Some(name) = head.strip_prefix(&format!("{remote}/")) {
                return Some(name.to_string());
            }
        }
    }
    ["main", "master"]
        .into_iter()
        .find(|name| {
            git_text(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{name}"),
                ],
            )
            .is_some()
        })
        .map(str::to_string)
}

/// Branches checked out anywhere cannot be deleted and belong to live work.
fn checked_out_branches(root: &Path) -> HashSet<String> {
    lines(git_text(root, &["worktree", "list", "--porcelain"]))
        .into_iter()
        .filter_map(|line| line.strip_prefix("branch refs/heads/").map(str::to_string))
        .collect()
}

/// A squash merge leaves no shared commit, so ask whether the branch's whole
/// change as one patch is already in the base (the approach `git cherry` uses).
fn squash_merged(root: &Path, base_ref: &str, branch: &str) -> bool {
    let Some(merge_base) = git_text(root, &["merge-base", base_ref, branch]) else {
        return false;
    };
    let Some(tree) = git_text(root, &["rev-parse", &format!("{branch}^{{tree}}")]) else {
        return false;
    };
    let Some(merge_tree) = git_text(root, &["rev-parse", &format!("{merge_base}^{{tree}}")]) else {
        return false;
    };
    // An empty branch is not "merged work"; leave it for the owner.
    if tree == merge_tree {
        return false;
    }
    let Some(probe) = git_text(
        root,
        &[
            "commit-tree",
            &tree,
            "-p",
            &merge_base,
            "-m",
            "aven squash probe",
        ],
    ) else {
        return false;
    };
    git_text(root, &["cherry", base_ref, &probe])
        .is_some_and(|out| out.starts_with('-') && !out.contains('+'))
}

fn merged_branches_for(root: &Path) -> Result<MergedBranches, String> {
    let remote = remote_name(root);
    let base = base_branch(root, remote.as_deref()).ok_or("This project has no main branch.")?;
    let base_ref = match &remote {
        Some(remote)
            if git_text(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/remotes/{remote}/{base}"),
                ],
            )
            .is_some() =>
        {
            format!("{remote}/{base}")
        }
        _ => base.clone(),
    };
    let busy = checked_out_branches(root);
    let merged: HashSet<String> = lines(git_text(
        root,
        &["branch", "--format=%(refname:short)", "--merged", &base_ref],
    ))
    .into_iter()
    .collect();
    let mut local = Vec::new();
    for branch in lines(git_text(root, &["branch", "--format=%(refname:short)"])) {
        if branch == base || busy.contains(&branch) {
            continue;
        }
        if merged.contains(&branch) || squash_merged(root, &base_ref, &branch) {
            local.push(branch);
        }
    }
    let mut remote_branches = Vec::new();
    if let Some(remote) = &remote {
        let prefix = format!("{remote}/");
        for name in lines(git_text(
            root,
            &[
                "branch",
                "-r",
                "--format=%(refname:short)",
                "--merged",
                &base_ref,
            ],
        )) {
            let Some(branch) = name.strip_prefix(&prefix) else {
                continue;
            };
            if branch == base || branch == "HEAD" || name == *remote {
                continue;
            }
            remote_branches.push(branch.to_string());
        }
    }
    local.sort();
    remote_branches.sort();
    Ok(MergedBranches {
        base,
        remote,
        local,
        remote_branches,
    })
}

fn delete_merged_branches_for(
    root: &Path,
    local: &[String],
    remote: &[String],
) -> Result<BranchCleanup, String> {
    // Never trust the request: only delete what is merged right now.
    let current = merged_branches_for(root)?;
    let mut result = BranchCleanup::default();
    for branch in local {
        if !current.local.contains(branch) {
            result.failed.push(branch.clone());
            continue;
        }
        match git_checked(root, &["branch", "-D", "--", branch]) {
            Ok(()) => result.deleted_local.push(branch.clone()),
            Err(_) => result.failed.push(branch.clone()),
        }
    }
    let requested: Vec<&String> = remote
        .iter()
        .filter(|branch| current.remote_branches.contains(branch))
        .collect();
    result.failed.extend(
        remote
            .iter()
            .filter(|branch| !current.remote_branches.contains(branch))
            .map(|branch| {
                format!(
                    "{}/{}",
                    current.remote.as_deref().unwrap_or("remote"),
                    branch
                )
            }),
    );
    if let (Some(name), false) = (current.remote.as_deref(), requested.is_empty()) {
        let mut args = vec!["push", name, "--delete"];
        args.extend(requested.iter().map(|branch| branch.as_str()));
        match git_checked(root, &args) {
            Ok(()) => result.deleted_remote.extend(requested.into_iter().cloned()),
            Err(_) => result.failed.extend(
                requested
                    .into_iter()
                    .map(|branch| format!("{name}/{branch}")),
            ),
        }
        let _ = git_checked(root, &["fetch", "--prune", "--quiet", name]);
    }
    Ok(result)
}

fn gh(root: &Path, args: &[&str], write: bool) -> Result<String, String> {
    let route = github_route(root)?;
    if write {
        route.verify_identity(root)?;
    }
    let output = route
        .command(root)?
        .args(args)
        .output()
        .map_err(|_| "The routed GitHub account command is not installed.".to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        "GitHub did not accept the request.".into()
    } else {
        stderr
    })
}

fn squash_merge_for(root: &Path, number: i64) -> Result<(), String> {
    if number <= 0 {
        return Err("Choose an open pull request.".into());
    }
    // Leave the local checkout alone: another worktree may own the base branch.
    // The repository deletes the remote branch; the local one then shows up in
    // merged branch clean-up.
    gh(
        root,
        &["pr", "merge", &number.to_string(), "--squash"],
        true,
    )
    .map(|_| ())
}

fn release_workflow(root: &Path) -> Option<(String, bool)> {
    for name in ["release.yml", "release.yaml"] {
        let path = root.join(".github/workflows").join(name);
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if text.contains("workflow_dispatch") {
            return Some((name.to_string(), workflow_has_publish_input(&text)));
        }
    }
    None
}

fn workflow_has_publish_input(text: &str) -> bool {
    text.lines().map(str::trim).any(|line| line == "publish:")
}

fn package_version(root: &Path) -> Option<String> {
    #[derive(Deserialize)]
    struct Package {
        version: Option<String>,
    }
    let text = std::fs::read_to_string(root.join("package.json")).ok()?;
    serde_json::from_str::<Package>(&text)
        .ok()?
        .version
        .filter(|version| valid_version(version))
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 40
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

fn parse_latest_release(json: &str) -> Option<ReleaseInfo> {
    #[derive(Deserialize)]
    struct Release {
        #[serde(rename = "tagName")]
        tag_name: String,
        name: Option<String>,
        url: String,
        #[serde(rename = "publishedAt")]
        published_at: Option<String>,
    }
    let release: Release = serde_json::from_str(json).ok()?;
    Some(ReleaseInfo {
        name: release
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| release.tag_name.clone()),
        tag: release.tag_name,
        url: release.url,
        published_at: release.published_at.unwrap_or_default(),
    })
}

fn parse_latest_run(json: &str) -> Option<ReleaseRun> {
    #[derive(Deserialize)]
    struct Run {
        status: String,
        conclusion: Option<String>,
        url: String,
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "headSha")]
        head_sha: String,
    }
    let runs: Vec<Run> = serde_json::from_str(json).ok()?;
    runs.into_iter().next().map(|run| ReleaseRun {
        status: run.status,
        conclusion: run.conclusion.unwrap_or_default(),
        url: run.url,
        created_at: run.created_at,
        head_sha: run.head_sha,
    })
}

fn release_status_for(root: &Path) -> Result<ReleaseStatus, String> {
    let remote = remote_name(root);
    let base = base_branch(root, remote.as_deref()).unwrap_or_else(|| "main".into());
    let workflow = release_workflow(root);
    let version = package_version(root);
    let latest = gh(
        root,
        &["release", "view", "--json", "tagName,name,url,publishedAt"],
        false,
    )
    .ok()
    .and_then(|json| parse_latest_release(&json));
    let unreleased = latest.as_ref().and_then(|release| {
        gh(
            root,
            &[
                "api",
                &format!(
                    "repos/{{owner}}/{{repo}}/compare/{}...{}",
                    release.tag, base
                ),
                "--jq",
                ".ahead_by",
            ],
            false,
        )
        .ok()
        .and_then(|count| count.trim().parse().ok())
    });
    let version_unreleased = match &version {
        Some(version) => gh(
            root,
            &[
                "api",
                &format!("repos/{{owner}}/{{repo}}/git/ref/tags/v{version}"),
                "--silent",
            ],
            false,
        )
        .is_err(),
        None => false,
    };
    let run = workflow.as_ref().and_then(|(name, _)| {
        gh(
            root,
            &[
                "run",
                "list",
                "--workflow",
                name,
                "--limit",
                "1",
                "--json",
                "status,conclusion,url,createdAt,headSha",
            ],
            false,
        )
        .ok()
        .and_then(|json| parse_latest_run(&json))
    });
    Ok(ReleaseStatus {
        base,
        latest,
        unreleased,
        version,
        version_unreleased,
        workflow_has_publish: workflow.as_ref().is_some_and(|(_, publish)| *publish),
        workflow: workflow.map(|(name, _)| name),
        run,
    })
}

fn release_start_for(root: &Path, version: &str) -> Result<(), String> {
    let (workflow, has_publish) =
        release_workflow(root).ok_or("This project has no release workflow to run.")?;
    let status = release_status_for(root)?;
    // The button shows a version; publish only if that is still what GitHub
    // would build and it has not been released since the card was drawn.
    if status.version.as_deref() != Some(version) || !status.version_unreleased {
        return Err(format!(
            "Version {version} is no longer ready to publish. Refresh and check the version."
        ));
    }
    if let Some(run) = &status.run {
        if run.status != "completed" {
            return Err("A release is already running.".into());
        }
    }
    let mut args = vec![
        "workflow",
        "run",
        workflow.as_str(),
        "--ref",
        status.base.as_str(),
    ];
    if has_publish {
        args.extend(["-f", "publish=true"]);
    }
    gh(root, &args, true).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    /// Removed on drop so failed assertions do not leave repositories behind.
    struct Temp(PathBuf);
    impl Temp {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("aven-housekeeping-{name}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }

    fn repo(name: &str) -> Temp {
        let dir = Temp::new(name);
        let root = dir.path();
        run(root, &["init", "-q", "-b", "main"]);
        write(root, "a.txt", "one\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "start"]);
        dir
    }

    #[test]
    fn finds_ordinary_and_squash_merged_branches_but_not_live_work() {
        let dir = repo("branches");
        let root = dir.path();
        // Merged normally.
        run(root, &["branch", "merged"]);
        // Squash merged: same change lands on main as a different commit.
        run(root, &["checkout", "-qb", "squashed"]);
        write(root, "b.txt", "feature\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "feature part 1"]);
        write(root, "b.txt", "feature done\n");
        run(root, &["commit", "-qam", "feature part 2"]);
        run(root, &["checkout", "-q", "main"]);
        run(root, &["merge", "-q", "--squash", "squashed"]);
        run(root, &["commit", "-qm", "Feature (#1)"]);
        // Unmerged work stays.
        run(root, &["checkout", "-qb", "wip"]);
        write(root, "c.txt", "not yet\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "wip"]);
        run(root, &["checkout", "-q", "main"]);
        // Checked out in another worktree stays even though merged.
        let other = Temp::new("busy");
        let other_path = other.path().join("busy");
        run(
            root,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "busy",
                other_path.to_str().unwrap(),
            ],
        );

        let merged = merged_branches_for(root).unwrap();
        assert_eq!(merged.base, "main");
        assert_eq!(
            merged.local,
            vec!["merged".to_string(), "squashed".to_string()]
        );

        let cleanup =
            delete_merged_branches_for(root, &["squashed".into(), "wip".into()], &[]).unwrap();
        assert_eq!(cleanup.deleted_local, vec!["squashed".to_string()]);
        assert_eq!(cleanup.failed, vec!["wip".to_string()]);
        assert!(git_text(
            root,
            &["rev-parse", "--verify", "--quiet", "refs/heads/wip"]
        )
        .is_some());
    }

    #[test]
    fn parses_release_and_run_json() {
        let release = parse_latest_release(
            r#"{"tagName":"v0.1.107","name":"Aven 0.1.107","url":"https://example.com/r","publishedAt":"2026-09-28T19:00:31Z"}"#,
        )
        .unwrap();
        assert_eq!(release.tag, "v0.1.107");
        assert_eq!(release.name, "Aven 0.1.107");
        assert!(parse_latest_release("not json").is_none());

        let run = parse_latest_run(
            r#"[{"status":"in_progress","conclusion":"","url":"https://example.com/run","createdAt":"2026-09-28T19:00:00Z","headSha":"abc"}]"#,
        )
        .unwrap();
        assert_eq!(run.status, "in_progress");
        assert!(parse_latest_run("[]").is_none());
    }

    #[test]
    fn detects_publishable_workflows_and_versions() {
        let dir = repo("workflow");
        let root = dir.path();
        assert!(release_workflow(root).is_none());
        std::fs::create_dir_all(root.join(".github/workflows")).unwrap();
        write(
            &root.join(".github/workflows"),
            "release.yml",
            "on:\n  workflow_dispatch:\n    inputs:\n      publish:\n        type: boolean\n",
        );
        assert_eq!(release_workflow(root), Some(("release.yml".into(), true)));
        write(root, "package.json", r#"{"version":"0.1.108"}"#);
        assert_eq!(package_version(root).as_deref(), Some("0.1.108"));
        write(root, "package.json", r#"{"version":"1.0; rm -rf"}"#);
        assert_eq!(package_version(root), None);
    }
}
