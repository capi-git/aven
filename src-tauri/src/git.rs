use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::fs::{expand_home, path_to_js, same_entry, MAX_TEXT_FILE_BYTES};

#[derive(Debug, Clone, Default)]
pub(crate) struct GitInfo {
    pub branch: Option<String>,
    pub repo: Option<String>,
}

/// `git_info_for` costs up to three `git` subprocesses, and it sits inside
/// both `session_upsert` (which runs every time a transcript is persisted) and
/// `list_by_project` (every project switch). Caching it for a beat keeps a
/// busy session from respawning git on every keystroke-driven save; the branch
/// can lag by at most `GIT_INFO_TTL`, which only affects a label.
const GIT_INFO_TTL: Duration = Duration::from_secs(3);

static GIT_INFO_CACHE: Mutex<Option<HashMap<PathBuf, (Instant, GitInfo)>>> = Mutex::new(None);

pub(crate) fn git_info_for(root: &Path) -> GitInfo {
    if let Ok(mut guard) = GIT_INFO_CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        cache.retain(|_, (at, _)| at.elapsed() < GIT_INFO_TTL);
        if let Some((_, info)) = cache.get(root) {
            return info.clone();
        }
    }
    let info = git_info_uncached(root);
    if let Ok(mut guard) = GIT_INFO_CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(root.to_path_buf(), (Instant::now(), info.clone()));
    }
    info
}

fn git_info_uncached(root: &Path) -> GitInfo {
    let Some(top) = git_stdout(root, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    else {
        return GitInfo {
            branch: None,
            repo: file_name(root),
        };
    };
    GitInfo {
        branch: git_branch(&top),
        repo: git_origin_repo(&top).or_else(|| file_name(&top)),
    }
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStats {
    pub files: i64,
    pub additions: i64,
    pub deletions: i64,
}

/// Uncommitted line counts for the opened folder: staged + unstaged vs HEAD,
/// plus untracked (gitignore-aware) files counted as additions.
#[tauri::command]
pub async fn git_diff_stats(cwd: String) -> Result<GitDiffStats, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_stats_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffIndex {
    pub branch: Option<String>,
    pub files: Vec<GitChangedFile>,
    pub additions: i64,
    pub deletions: i64,
    pub remote: Option<String>,
    pub upstream: Option<String>,
    pub default_branch: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub ahead_of_default: i64,
}

/// Changed files in the opened folder, with per-file line counts and status.
#[tauri::command]
pub async fn git_diff_index(cwd: String) -> Result<GitDiffIndex, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_index_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())
}

/// Changed files and counts without branch/upstream synchronization metadata.
#[tauri::command]
pub async fn git_diff_files(cwd: String) -> Result<GitDiffIndex, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_files_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: Option<String>,
    /// The checkout containing the queried folder.
    pub current: bool,
    /// The repository's main checkout (listed first by Git).
    pub primary: bool,
    pub files: Vec<GitChangedFile>,
    pub additions: i64,
    pub deletions: i64,
    /// Commits in this checkout that the default branch does not have.
    pub ahead_of_default: i64,
    /// Default-branch commits this checkout does not have yet.
    pub behind_default: i64,
    /// No uncommitted files, and merging this checkout into the default
    /// branch would change nothing. True after a squash merge too, when the
    /// commits themselves differ from the default branch's.
    pub merged_into_default: bool,
}

/// Every checkout of the repository containing `cwd`, with its uncommitted
/// files and how far it is from the default branch.
#[tauri::command]
pub async fn git_worktrees(cwd: String) -> Result<Vec<GitWorktree>, String> {
    tauri::async_runtime::spawn_blocking(move || git_worktrees_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())
}

pub(crate) fn git_worktrees_for(root: &Path) -> Vec<GitWorktree> {
    let Some(text) = git_run(root, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let current = git_stdout(root, &["rev-parse", "--show-toplevel"]).map(PathBuf::from);
    let remote = git_remote_name(root);
    let base = git_default_branch(root, remote.as_deref()).map(|branch| match &remote {
        Some(remote) if git_ref_exists(root, &format!("refs/remotes/{remote}/{branch}")) => {
            format!("{remote}/{branch}")
        }
        _ => branch,
    });
    let base_tree = base
        .as_deref()
        .and_then(|base| git_stdout(root, &["rev-parse", &format!("{base}^{{tree}}")]));
    parse_worktree_list(&text)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (path, branch))| {
            let dir = PathBuf::from(&path);
            if !dir.is_dir() {
                return None;
            }
            let changes = git_diff_files_for(&dir);
            let (ahead_of_default, behind_default) = base
                .as_deref()
                .map(|base| git_ahead_behind(&dir, base))
                .unwrap_or((0, 0));
            let merged_into_default = changes.files.is_empty()
                && match (base.as_deref(), base_tree.as_deref()) {
                    (Some(_), _) if ahead_of_default == 0 => true,
                    (Some(base), Some(tree)) => {
                        git_merges_cleanly_into(&dir, base, tree)
                            || git_landed_as_one_commit(&dir, base)
                    }
                    _ => false,
                };
            Some(GitWorktree {
                current: current
                    .as_deref()
                    .is_some_and(|current| same_entry(current, &dir)),
                primary: index == 0,
                path,
                branch,
                files: changes.files,
                additions: changes.additions,
                deletions: changes.deletions,
                ahead_of_default,
                behind_default,
                merged_into_default,
            })
        })
        .collect()
}

/// Whether merging `HEAD` of `dir` into `base` would leave `base_tree`
/// unchanged, i.e. its changes already landed, e.g. through a squash merge.
/// A failed or conflicting merge counts as not merged.
fn git_merges_cleanly_into(dir: &Path, base: &str, base_tree: &str) -> bool {
    git_stdout(dir, &["merge-tree", "--write-tree", base, "HEAD"])
        .is_some_and(|text| text.lines().next() == Some(base_tree))
}

/// Commits on `base` searched for a squash of this copy's work.
const SQUASH_SEARCH_LIMIT: &str = "--max-count=400";

/// Whether this copy's combined changes landed on `base` as one commit, as a
/// squash-merged pull request does. Later commits that change the same lines
/// make the merge-tree check conflict, but the squash commit's patch id still
/// matches the copy's combined diff.
fn git_landed_as_one_commit(dir: &Path, base: &str) -> bool {
    let Some(fork) = git_stdout(dir, &["merge-base", base, "HEAD"]) else {
        return false;
    };
    let Some(diff) = git_output(dir, &["diff", "--binary", &fork, "HEAD"]) else {
        return false;
    };
    let Some(copy_id) = git_patch_ids(dir, &diff).into_iter().next() else {
        return false;
    };
    let range = format!("{fork}..{base}");
    let Some(log) = git_output(
        dir,
        &[
            "log",
            "-p",
            "--binary",
            "--no-merges",
            SQUASH_SEARCH_LIMIT,
            "--format=commit %H",
            &range,
        ],
    ) else {
        return false;
    };
    git_patch_ids(dir, &log).contains(&copy_id)
}

/// Stable patch ids for each patch in `input`, in order.
fn git_patch_ids(dir: &Path, input: &[u8]) -> Vec<String> {
    if input.is_empty() {
        return Vec::new();
    }
    let Ok(mut child) = git_cmd()
        .arg("-C")
        .arg(dir)
        .args(["patch-id", "--stable"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    // Feed stdin from a thread so a large patch can't deadlock on a full pipe.
    let writer = child.stdin.take().map(|mut stdin| {
        let input = input.to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&input);
        })
    });
    let output = child.wait_with_output();
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_whitespace().next().map(str::to_string))
        .collect()
}

/// Remove another checkout of this repository that is no longer needed. Its
/// uncommitted files are discarded; a branch that still holds commits the
/// default branch lacks is kept so that work stays reachable.
#[tauri::command]
pub async fn git_worktree_remove(cwd: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_worktree_for(&expand_home(&cwd), &expand_home(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn remove_worktree_for(root: &Path, path: &Path) -> Result<(), String> {
    let copies = git_worktrees_for(root);
    let copy = copies
        .iter()
        .find(|copy| same_entry(Path::new(&copy.path), path))
        .ok_or("This copy is no longer part of the project.")?;
    if copy.primary {
        return Err("The main copy can't be removed.".into());
    }
    if copy.current {
        return Err("The copy that's open here can't be removed.".into());
    }
    if copy
        .branch
        .as_deref()
        .is_some_and(|branch| branch.starts_with("aven/race/"))
    {
        return Err("Race copies are removed through their race.".into());
    }
    if copy.branch.is_none() {
        return Err(
            "This copy has no branch. Create a branch in it before removing it so its commits stay reachable."
                .into(),
        );
    }
    // The Changes list deliberately excludes ignored files. A clean-looking
    // copy can still hold local data, so never discard that data with --force.
    // Collapse ignored directories rather than walking every dependency file.
    let ignored = git_run(
        Path::new(&copy.path),
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "--no-empty-directory",
            "-z",
            "--",
            ".",
        ],
    )
    .ok_or("Could not check this copy for ignored files. Nothing was removed.")?;
    if !ignored.is_empty() {
        return Err(
            "This copy contains ignored files or folders. Back up anything you need and remove those files before removing the copy. Nothing was removed."
                .into(),
        );
    }
    let primary = copies
        .iter()
        .find(|copy| copy.primary)
        .map(|copy| PathBuf::from(&copy.path))
        .unwrap_or_else(|| root.to_path_buf());
    let output = git_cmd()
        .arg("--no-pager")
        .arg("-C")
        .arg(&primary)
        .args(["worktree", "remove", "--force", &copy.path])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Git could not remove this copy.".into()
        } else {
            message
        });
    }
    if let (Some(branch), 0) = (copy.branch.as_deref(), copy.ahead_of_default) {
        // Git's safe delete still refuses a branch it considers unmerged.
        let _ = git_run(&primary, &["branch", "-d", branch]);
    }
    let _ = git_run(&primary, &["worktree", "prune"]);
    Ok(())
}

/// `(path, branch)` for each usable entry of `git worktree list --porcelain`.
fn parse_worktree_list(text: &str) -> Vec<(String, Option<String>)> {
    text.split("\n\n")
        .filter_map(|block| {
            let mut path = None;
            let mut branch = None;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    path = Some(value.to_string());
                } else if let Some(value) = line.strip_prefix("branch ") {
                    branch = Some(
                        value
                            .strip_prefix("refs/heads/")
                            .unwrap_or(value)
                            .to_string(),
                    );
                } else if line == "bare" || line.starts_with("prunable") {
                    return None;
                }
            }
            path.map(|path| (path, branch))
        })
        .collect()
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub relative: String,
    pub status: String,
    pub original: String,
    pub current: String,
    pub binary: bool,
    pub too_large: bool,
}

/// Contents for one changed file. Staged diffs compare HEAD to the index;
/// unstaged diffs compare the index to the working tree.
#[tauri::command]
pub async fn git_file_diff(
    cwd: String,
    relative: String,
    staged: bool,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_file_diff_for(&expand_home(&cwd), &relative, staged)
    })
    .await
    .map_err(|e| e.to_string())?
}

const GIT_HISTORY_DEFAULT: u32 = 200;
const GIT_HISTORY_MAX: u32 = 500;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryRef {
    pub name: String,
    pub kind: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryCommit {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
    pub refs: Vec<GitHistoryRef>,
    pub head: bool,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub head: Option<String>,
    pub commits: Vec<GitHistoryCommit>,
}

/// Recent commits for the Graph view: HEAD, upstream, and the default
/// branch. Newest first, with parent SHAs for the graph.
#[tauri::command]
pub async fn git_history(cwd: String, limit: Option<u32>) -> Result<GitHistory, String> {
    tauri::async_runtime::spawn_blocking(move || git_history_for(&expand_home(&cwd), limit))
        .await
        .map_err(|e| e.to_string())?
}

/// Files changed in one commit (first parent / root).
#[tauri::command]
pub async fn git_commit_files(cwd: String, sha: String) -> Result<Vec<GitChangedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_files_for(&expand_home(&cwd), &sha))
        .await
        .map_err(|e| e.to_string())?
}

/// Parent vs commit contents for one path in a historical commit.
#[tauri::command]
pub async fn git_commit_file_diff(
    cwd: String,
    sha: String,
    relative: String,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_commit_file_diff_for(&expand_home(&cwd), &sha, &relative)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stage a changed file (`git add`).
#[tauri::command]
pub async fn git_stage_file(cwd: String, relative: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_stage_file_for(&expand_home(&cwd), &relative))
        .await
        .map_err(|e| e.to_string())?
}

/// Write `contents` into the index for one path, leaving the working tree alone.
#[tauri::command]
pub async fn git_stage_contents(
    cwd: String,
    relative: String,
    contents: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_stage_contents_for(&expand_home(&cwd), &relative, contents.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unstage a file (`git restore --staged`).
#[tauri::command]
pub async fn git_unstage_file(cwd: String, relative: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_unstage_file_for(&expand_home(&cwd), &relative)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Discard uncommitted changes so the file matches HEAD (or delete if untracked).
#[tauri::command]
pub async fn git_discard_file(cwd: String, relative: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_discard_file_for(&expand_home(&cwd), &relative)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Discard every unstaged change (restore tracked files; delete untracked).
#[tauri::command]
pub async fn git_discard_all(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_discard_all_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Stage every changed file in the repo.
#[tauri::command]
pub async fn git_stage_all(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_checked(&expand_home(&cwd), &["add", "-A", "--", "."])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Unstage every staged file.
#[tauri::command]
pub async fn git_unstage_all(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_checked(&expand_home(&cwd), &["restore", "--staged", "--", "."])
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStagedContext {
    pub branch: Option<String>,
    pub summary: String,
    pub patch: String,
}

/// Staged diff (or unstaged vs HEAD if nothing is staged) for commit text generation.
#[tauri::command]
pub async fn git_staged_context(cwd: String) -> Result<GitStagedContext, String> {
    tauri::async_runtime::spawn_blocking(move || git_staged_context_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Create a commit from the current index.
#[tauri::command]
pub async fn git_commit(cwd: String, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_for(&expand_home(&cwd), &message))
        .await
        .map_err(|e| e.to_string())?
}

/// Push the current branch to its upstream, or set upstream on first push.
#[tauri::command]
pub async fn git_push(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_push_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Fast-forward the current branch from its upstream.
#[tauri::command]
pub async fn git_pull(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_checked(&expand_home(&cwd), &["pull", "--ff-only"])
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pull incoming commits, then push local commits.
#[tauri::command]
pub async fn git_sync(cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_sync_changes_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRangeContext {
    pub base: String,
    pub head: String,
    pub commit_summary: String,
    pub diff_summary: String,
    pub diff_patch: String,
}

/// Commits and diff between the default branch and HEAD, for PR text generation.
#[tauri::command]
pub async fn git_range_context(cwd: String) -> Result<GitRangeContext, String> {
    tauri::async_runtime::spawn_blocking(move || git_range_context_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
}

/// Latest pull request for the current branch, if `gh` can see one.
#[tauri::command]
pub async fn git_pr_status(cwd: String) -> Result<Option<GitPr>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_pr_status_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
struct GitPrCreateInput {
    title: String,
    body: String,
    base: String,
    head: String,
}

/// Create a GitHub pull request with `gh` and return its URL.
#[tauri::command]
pub async fn git_pr_create(
    cwd: String,
    title: String,
    body: String,
    base: String,
    head: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_pr_create_for(
            &expand_home(&cwd),
            &GitPrCreateInput {
                title,
                body,
                base,
                head,
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAssignee {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItem {
    pub kind: String,
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    /// Issue closure reason such as `completed` or `not_planned`; empty otherwise.
    pub state_reason: String,
    pub updated_at: String,
    pub labels: Vec<GitHubLabel>,
    pub assignees: Vec<GitHubAssignee>,
    pub draft: bool,
    pub repo: String,
}

/// `owner/repo` for the GitHub remote of this working copy, via `gh`.
#[tauri::command]
pub async fn git_github_repo(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_github_repo_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

/// Open issues or pull requests for the current GitHub remote, via `gh`.
#[tauri::command]
pub async fn git_github_work_items(
    cwd: String,
    kind: String,
    assigned_to_me: bool,
    state: String,
    search: String,
    limit: Option<u32>,
) -> Result<Vec<GitHubWorkItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_items_for(
            &expand_home(&cwd),
            &kind,
            assigned_to_me,
            &state,
            &search,
            limit.unwrap_or(40),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemDetails {
    pub body: String,
    pub author: String,
    pub author_avatar_url: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub review_decision: String,
}

/// Issue or pull request body for the inbox detail pane.
#[tauri::command]
pub async fn git_github_work_item_details(
    cwd: String,
    kind: String,
    number: i64,
) -> Result<GitHubWorkItemDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_details_for(&expand_home(&cwd), &kind, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemComment {
    pub id: String,
    pub kind: String,
    pub author: String,
    pub author_avatar_url: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
    pub state: String,
    pub path: String,
    pub line: Option<i64>,
    pub resolved: bool,
    pub thread_id: String,
    pub replies: Vec<GitHubWorkItemComment>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItemThread {
    pub comments: Vec<GitHubWorkItemComment>,
    pub truncated: bool,
    pub review_decision: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
}

/// Conversation for the inbox detail pane: comments, reviews, and review threads.
#[tauri::command]
pub async fn git_github_work_item_thread(
    cwd: String,
    kind: String,
    number: i64,
) -> Result<GitHubWorkItemThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_thread_for(&expand_home(&cwd), &kind, number)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Post a conversation comment, or a reply on a review thread.
#[tauri::command]
pub async fn git_github_work_item_comment(
    cwd: String,
    kind: String,
    number: i64,
    body: String,
    in_reply_to: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_github_work_item_comment_for(&expand_home(&cwd), &kind, number, &body, &in_reply_to)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrFile {
    pub path: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrDiff {
    pub additions: i64,
    pub deletions: i64,
    pub files: Vec<GitHubPrFile>,
    pub patch: String,
    pub truncated: bool,
}

const MAX_PR_DIFF_BYTES: usize = 2 * 1024 * 1024;

/// Unified diff and file stats for a pull request, via `gh`.
#[tauri::command]
pub async fn git_github_pr_diff(cwd: String, number: i64) -> Result<GitHubPrDiff, String> {
    tauri::async_runtime::spawn_blocking(move || git_github_pr_diff_for(&expand_home(&cwd), number))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub current: Option<String>,
    pub detached: bool,
    pub branches: Vec<GitBranchEntry>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    pub current: bool,
    pub remote: Option<String>,
}

/// Local branches, plus remote-only branches that can be checked out.
#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<GitBranches, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(git_branches_for(&expand_home(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// Switch to an existing local branch, or create a local tracking branch from a remote.
#[tauri::command]
pub async fn git_checkout(
    cwd: String,
    name: String,
    remote: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_checkout_for(&expand_home(&cwd), &name, remote.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create a branch from HEAD and switch to it.
#[tauri::command]
pub async fn git_create_branch(cwd: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_branch_for(&expand_home(&cwd), &name))
        .await
        .map_err(|e| e.to_string())?
}

/// Stash tracked and untracked local changes so a checkout can proceed.
#[tauri::command]
pub async fn git_stash(cwd: String, message: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_stash_for(&expand_home(&cwd), message.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn git_diff_stats_for(root: &Path) -> GitDiffStats {
    if !git_is_work_tree(root) {
        return GitDiffStats::default();
    }
    let mut files: HashMap<String, FileAcc> = HashMap::new();
    if let Some(text) = git_run(
        root,
        &[
            "diff",
            "--relative",
            "--no-ext-diff",
            "--numstat",
            "HEAD",
            "--",
            ".",
        ],
    ) {
        add_numstat_map(&text, &mut files);
    } else {
        if let Some(text) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--numstat",
                "--",
                ".",
            ],
        ) {
            add_numstat_map(&text, &mut files);
        }
        if let Some(text) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--cached",
                "--numstat",
                "--",
                ".",
            ],
        ) {
            add_numstat_map(&text, &mut files);
        }
    }
    add_untracked_map(root, &mut files);
    let mut additions = 0i64;
    let mut deletions = 0i64;
    for acc in files.values() {
        additions += acc.additions;
        deletions += acc.deletions;
    }
    GitDiffStats {
        files: files.len() as i64,
        additions,
        deletions,
    }
}

#[derive(Clone, Default)]
struct FileAcc {
    additions: i64,
    deletions: i64,
    untracked: bool,
    staged: bool,
    unstaged: bool,
}

pub(crate) fn git_diff_index_for(root: &Path) -> GitDiffIndex {
    git_diff_index_with(root, true)
}

/// File list + counts only. Skips ahead/behind/remote lookups used by Git chrome.
pub(crate) fn git_diff_files_for(root: &Path) -> GitDiffIndex {
    git_diff_index_with(root, false)
}

fn git_diff_index_with(root: &Path, include_sync: bool) -> GitDiffIndex {
    let mut files: HashMap<String, FileAcc> = HashMap::new();
    let mut statuses: HashMap<String, &'static str> = HashMap::new();

    if let Some(text) = git_run(
        root,
        &[
            "diff",
            "--relative",
            "--no-ext-diff",
            "--numstat",
            "HEAD",
            "--",
            ".",
        ],
    ) {
        add_numstat_map(&text, &mut files);
        if let Some(names) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--name-status",
                "--no-renames",
                "HEAD",
                "--",
                ".",
            ],
        ) {
            add_name_status(&names, &mut statuses);
        }
    } else {
        if let Some(text) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--numstat",
                "--",
                ".",
            ],
        ) {
            add_numstat_map(&text, &mut files);
        }
        if let Some(text) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--cached",
                "--numstat",
                "--",
                ".",
            ],
        ) {
            add_numstat_map(&text, &mut files);
        }
        if let Some(names) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--name-status",
                "--no-renames",
                "--",
                ".",
            ],
        ) {
            add_name_status(&names, &mut statuses);
        }
        if let Some(names) = git_run(
            root,
            &[
                "diff",
                "--relative",
                "--no-ext-diff",
                "--cached",
                "--name-status",
                "--no-renames",
                "--",
                ".",
            ],
        ) {
            add_name_status(&names, &mut statuses);
        }
    }
    add_untracked_map(root, &mut files);
    mark_cached_and_unstaged(root, &mut files);

    let mut out = Vec::with_capacity(files.len());
    let mut additions = 0i64;
    let mut deletions = 0i64;
    for (relative, acc) in files {
        additions += acc.additions;
        deletions += acc.deletions;
        let abs = root.join(&relative);
        let status = if acc.untracked {
            "untracked"
        } else if let Some(status) = statuses.get(&relative) {
            *status
        } else if !abs.exists() {
            "deleted"
        } else {
            "modified"
        };
        out.push(GitChangedFile {
            path: path_to_js(&abs),
            relative,
            status: status.to_string(),
            additions: acc.additions,
            deletions: acc.deletions,
            staged: acc.staged,
            unstaged: acc.untracked || acc.unstaged,
        });
    }
    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    let sync = if include_sync {
        git_sync_for(root)
    } else {
        GitSync::default()
    };
    GitDiffIndex {
        branch: git_branch(root),
        files: out,
        additions,
        deletions,
        remote: sync.remote,
        upstream: sync.upstream,
        default_branch: sync.default_branch,
        ahead: sync.ahead,
        behind: sync.behind,
        ahead_of_default: sync.ahead_of_default,
    }
}

fn add_numstat_map(text: &str, files: &mut HashMap<String, FileAcc>) {
    for line in text.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(add) = parts.next() else { continue };
        let Some(del) = parts.next() else { continue };
        let Some(path) = parts.next() else { continue };
        let relative = normalize_diff_path(path);
        if relative.is_empty() {
            continue;
        }
        let entry = files.entry(relative).or_default();
        if add != "-" && del != "-" {
            entry.additions += add.parse::<i64>().unwrap_or(0);
            entry.deletions += del.parse::<i64>().unwrap_or(0);
        }
    }
}

fn add_name_status(text: &str, statuses: &mut HashMap<String, &'static str>) {
    for line in text.lines() {
        let Some((code, rest)) = line.split_once('\t') else {
            continue;
        };
        let status = match code.as_bytes().first() {
            Some(b'A') => "added",
            Some(b'D') => "deleted",
            Some(b'M' | b'T') => "modified",
            _ => continue,
        };
        let relative = normalize_diff_path(rest);
        if !relative.is_empty() {
            statuses.insert(relative, status);
        }
    }
}

fn normalize_diff_path(path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        return String::new();
    }
    let path = if let Some((_, new)) = path.split_once(" => ") {
        new.trim_end_matches('}')
    } else {
        path
    };
    path_to_js(Path::new(path))
}

const MAX_UNTRACKED_BYTES: u64 = 1024 * 1024;

fn add_untracked_map(root: &Path, files: &mut HashMap<String, FileAcc>) {
    let Some(stdout) = git_run(
        root,
        &["ls-files", "-o", "--exclude-standard", "-z", "--", "."],
    ) else {
        return;
    };
    for rel in stdout.split('\0') {
        if rel.is_empty() {
            continue;
        }
        let relative = path_to_js(Path::new(rel));
        let entry = files.entry(relative.clone()).or_default();
        entry.untracked = true;
        if entry.additions == 0 {
            entry.additions = text_line_count(&root.join(rel));
        }
    }
}

fn text_line_count(path: &Path) -> i64 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_UNTRACKED_BYTES {
        return 0;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return 0;
    };
    if bytes.contains(&0) {
        return 0;
    }
    let mut lines = 1i64;
    for byte in &bytes {
        if *byte == b'\n' {
            lines += 1;
        }
    }
    if bytes.last() == Some(&b'\n') {
        lines -= 1;
    }
    lines
}

fn mark_cached_and_unstaged(root: &Path, files: &mut HashMap<String, FileAcc>) {
    if let Some(names) = git_run(
        root,
        &[
            "diff",
            "--relative",
            "--cached",
            "--name-only",
            "--no-renames",
            "--",
            ".",
        ],
    ) {
        for line in names.lines() {
            let relative = normalize_diff_path(line);
            if !relative.is_empty() {
                files.entry(relative).or_default().staged = true;
            }
        }
    }
    if let Some(names) = git_run(
        root,
        &[
            "diff",
            "--relative",
            "--name-only",
            "--no-renames",
            "--",
            ".",
        ],
    ) {
        for line in names.lines() {
            let relative = normalize_diff_path(line);
            if !relative.is_empty() {
                files.entry(relative).or_default().unstaged = true;
            }
        }
    }
}

fn git_file_diff_for(root: &Path, relative: &str, staged: bool) -> Result<GitFileDiff, String> {
    let relative = normalize_diff_path(relative);
    if relative.is_empty()
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "..")
    {
        return Err("Invalid path".into());
    }
    let abs = root.join(&relative);
    if !abs.starts_with(root) {
        return Err("Invalid path".into());
    }
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }

    let prefix = git_stdout(root, &["rev-parse", "--show-prefix"]).unwrap_or_default();
    let index_spec = format!(":{prefix}{relative}");
    let (original, current) = if staged {
        let head_spec = format!("HEAD:{prefix}{relative}");
        (git_blob(root, &head_spec), git_blob(root, &index_spec))
    } else {
        let current = if abs.is_file() {
            Some(std::fs::read(&abs).unwrap_or_default())
        } else {
            None
        };
        (git_blob(root, &index_spec), current)
    };
    let had_original = original.is_some();
    let had_current = current.is_some();
    let orig = original.unwrap_or_default();
    let current = current.unwrap_or_default();
    let binary = orig.contains(&0) || current.contains(&0);
    let too_large =
        orig.len() as u64 > MAX_TEXT_FILE_BYTES || current.len() as u64 > MAX_TEXT_FILE_BYTES;
    let status = if !had_original && had_current {
        if staged {
            "added"
        } else {
            "untracked"
        }
    } else if had_original && !had_current {
        "deleted"
    } else {
        "modified"
    };
    let (original_text, current_text) = if binary || too_large {
        (String::new(), String::new())
    } else {
        (
            String::from_utf8_lossy(&orig).into_owned(),
            String::from_utf8_lossy(&current).into_owned(),
        )
    };
    Ok(GitFileDiff {
        path: path_to_js(&abs),
        relative,
        status: status.to_string(),
        original: original_text,
        current: current_text,
        binary,
        too_large,
    })
}

/// Tips for the Graph filter: current HEAD, its upstream, and
/// the repo default branch. Omits `refs/stash` and unmerged local branches.
fn git_history_tips(root: &Path) -> Vec<String> {
    let mut tips = vec!["HEAD".to_string()];
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        tips.push("@{upstream}".to_string());
    }
    if let Some(remote) = git_remote_name(root) {
        if let Some(branch) = git_default_branch(root, Some(remote.as_str())) {
            let spec = format!("{remote}/{branch}");
            if git_ref_exists(root, &format!("refs/remotes/{spec}")) {
                tips.push(spec);
            }
        }
    }
    tips
}

fn git_history_for(root: &Path, limit: Option<u32>) -> Result<GitHistory, String> {
    if !git_is_work_tree(root) {
        return Ok(GitHistory::default());
    }
    let n = limit
        .unwrap_or(GIT_HISTORY_DEFAULT)
        .clamp(1, GIT_HISTORY_MAX);
    let count = n.to_string();
    let head = git_stdout(root, &["rev-parse", "HEAD"]);
    let remotes = git_remote_names(root);
    let tips = git_history_tips(root);
    let mut args = vec![
        "log".to_string(),
        "--topo-order".to_string(),
        "--decorate=short".to_string(),
        "--max-count".to_string(),
        count,
        "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%D%x00%s%x1e".to_string(),
    ];
    args.extend(tips);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let Some(text) = git_run(root, &args_ref) else {
        return Ok(GitHistory {
            head,
            commits: Vec::new(),
        });
    };
    Ok(GitHistory {
        commits: parse_git_history_log(&text, head.as_deref(), &remotes),
        head,
    })
}

fn parse_git_history_log(
    text: &str,
    head: Option<&str>,
    remotes: &[String],
) -> Vec<GitHistoryCommit> {
    let mut commits = Vec::new();
    for record in text.split('\u{1e}') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let mut fields = record.split('\0');
        let Some(sha) = fields.next() else { continue };
        let Some(short_sha) = fields.next() else {
            continue;
        };
        let Some(parents) = fields.next() else {
            continue;
        };
        let Some(author) = fields.next() else {
            continue;
        };
        let Some(timestamp) = fields.next() else {
            continue;
        };
        let Some(decorations) = fields.next() else {
            continue;
        };
        let subject = fields.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        let (is_head, refs) = parse_git_decorations(decorations, head, sha, remotes);
        commits.push(GitHistoryCommit {
            sha: sha.to_string(),
            short_sha: if short_sha.is_empty() {
                sha.chars().take(7).collect()
            } else {
                short_sha.to_string()
            },
            parents: parents.split_whitespace().map(str::to_string).collect(),
            author: author.to_string(),
            timestamp: timestamp.parse().unwrap_or(0),
            subject: subject.to_string(),
            refs,
            head: is_head,
        });
    }
    commits
}

fn parse_git_decorations(
    raw: &str,
    head: Option<&str>,
    sha: &str,
    remotes: &[String],
) -> (bool, Vec<GitHistoryRef>) {
    let mut is_head = head == Some(sha);
    let mut refs = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some(name) = part.strip_prefix("HEAD -> ") {
            is_head = true;
            if !name.is_empty() {
                refs.push(GitHistoryRef {
                    name: name.to_string(),
                    kind: "local".into(),
                });
            }
        } else if part == "HEAD" {
            is_head = true;
        } else if let Some(tag) = part.strip_prefix("tag: ") {
            if !tag.is_empty() {
                refs.push(GitHistoryRef {
                    name: tag.to_string(),
                    kind: "tag".into(),
                });
            }
        } else if part.ends_with("/HEAD") {
            continue;
        } else if remotes
            .iter()
            .any(|remote| part == remote || part.starts_with(&format!("{remote}/")))
        {
            refs.push(GitHistoryRef {
                name: part.to_string(),
                kind: "remote".into(),
            });
        } else {
            refs.push(GitHistoryRef {
                name: part.to_string(),
                kind: "local".into(),
            });
        }
    }
    (is_head, refs)
}

fn git_remote_names(root: &Path) -> Vec<String> {
    git_run(root, &["remote"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

fn git_peel_commit(root: &Path, spec: &str) -> Result<String, String> {
    let spec = spec.trim();
    if spec.len() < 4 || spec.len() > 40 || !spec.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid commit".into());
    }
    let peeled = format!("{spec}^{{commit}}");
    git_stdout(root, &["rev-parse", "--verify", &peeled]).ok_or_else(|| "Unknown commit".into())
}

fn git_commit_files_for(root: &Path, sha: &str) -> Result<Vec<GitChangedFile>, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let sha = git_peel_commit(root, sha)?;
    let mut files: HashMap<String, FileAcc> = HashMap::new();
    let mut statuses: HashMap<String, &'static str> = HashMap::new();
    if let Some(text) = git_run(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--no-renames",
            "--numstat",
            &sha,
        ],
    ) {
        add_numstat_map(&text, &mut files);
    }
    if let Some(names) = git_run(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "--no-renames",
            "--name-status",
            &sha,
        ],
    ) {
        add_name_status(&names, &mut statuses);
    }
    let mut out = Vec::with_capacity(files.len().max(statuses.len()));
    let mut seen = HashSet::new();
    for (relative, acc) in files {
        seen.insert(relative.clone());
        let status = statuses.get(&relative).copied().unwrap_or("modified");
        out.push(GitChangedFile {
            path: path_to_js(&root.join(&relative)),
            relative,
            status: status.to_string(),
            additions: acc.additions,
            deletions: acc.deletions,
            staged: false,
            unstaged: false,
        });
    }
    for (relative, status) in statuses {
        if seen.contains(&relative) {
            continue;
        }
        out.push(GitChangedFile {
            path: path_to_js(&root.join(&relative)),
            relative,
            status: status.to_string(),
            additions: 0,
            deletions: 0,
            staged: false,
            unstaged: false,
        });
    }
    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok(out)
}

fn git_commit_file_diff_for(root: &Path, sha: &str, relative: &str) -> Result<GitFileDiff, String> {
    let relative = resolve_repo_path(root, relative)?;
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let sha = git_peel_commit(root, sha)?;
    let parent = git_stdout(root, &["rev-parse", "--verify", &format!("{sha}^")]);
    let original_bytes = match &parent {
        Some(parent) => git_blob(root, &format!("{parent}:{relative}")).unwrap_or_default(),
        None => Vec::new(),
    };
    let current_bytes = git_blob(root, &format!("{sha}:{relative}")).unwrap_or_default();
    let binary = original_bytes.contains(&0) || current_bytes.contains(&0);
    let too_large = original_bytes.len() as u64 > MAX_TEXT_FILE_BYTES
        || current_bytes.len() as u64 > MAX_TEXT_FILE_BYTES;
    let status = if original_bytes.is_empty() && !current_bytes.is_empty() {
        "added"
    } else if !original_bytes.is_empty() && current_bytes.is_empty() {
        "deleted"
    } else {
        "modified"
    };
    let (original, current) = if binary || too_large {
        (String::new(), String::new())
    } else {
        (
            String::from_utf8_lossy(&original_bytes).into_owned(),
            String::from_utf8_lossy(&current_bytes).into_owned(),
        )
    };
    Ok(GitFileDiff {
        path: path_to_js(&root.join(&relative)),
        relative,
        status: status.to_string(),
        original,
        current,
        binary,
        too_large,
    })
}

fn git_stage_file_for(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    git_checked(root, &["add", "--", &relative])
}

fn git_stage_contents_for(root: &Path, relative: &str, contents: &[u8]) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    if contents.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("File too large".into());
    }
    let hash = git_hash_object(root, &relative, contents)?;
    let mode = git_index_mode(root, &relative).unwrap_or_else(|| "100644".into());
    git_checked(
        root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &mode,
            &hash,
            &relative,
        ],
    )
}

fn git_index_mode(root: &Path, relative: &str) -> Option<String> {
    let out = git_run(root, &["ls-files", "--stage", "--", relative])?;
    let mode = out.lines().next()?.split_whitespace().next()?;
    if mode.len() == 6 && mode.bytes().all(|b| b.is_ascii_digit()) {
        Some(mode.to_string())
    } else {
        None
    }
}

fn git_hash_object(root: &Path, relative: &str, contents: &[u8]) -> Result<String, String> {
    let mut child = git_cmd()
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(["hash-object", "-w", "--path", relative, "--stdin"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "hash-object stdin".to_string())?;
    stdin.write_all(contents).map_err(|e| e.to_string())?;
    drop(stdin);
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = stderr.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        let msg = stdout.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        return Err("git hash-object failed".into());
    }
    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if hash.len() != 40 && hash.len() != 64 {
        return Err("git hash-object returned an invalid hash".into());
    }
    Ok(hash)
}

fn git_unstage_file_for(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    git_checked(root, &["restore", "--staged", "--", &relative])
}

fn git_discard_file_for(root: &Path, relative: &str) -> Result<(), String> {
    let relative = resolve_repo_path(root, relative)?;
    let abs = root.join(&relative);
    if git_checked(root, &["ls-files", "--error-unmatch", "--", &relative]).is_err() {
        if abs.is_file() {
            std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
        } else if abs.exists() {
            git_checked(root, &["clean", "-fd", "--", &relative])?;
        }
        return Ok(());
    }
    git_checked(root, &["restore", "--worktree", "--", &relative])
}

fn git_discard_all_for(root: &Path) -> Result<(), String> {
    let files: Vec<String> = git_diff_index_for(root)
        .files
        .into_iter()
        .filter(|file| file.unstaged)
        .map(|file| file.relative)
        .collect();
    for relative in files {
        git_discard_file_for(root, &relative)?;
    }
    Ok(())
}

fn git_staged_context_for(root: &Path) -> Result<GitStagedContext, String> {
    let mut summary = git_run(root, &["diff", "--cached", "--stat", "--", "."]).unwrap_or_default();
    let mut patch =
        git_run(root, &["diff", "--cached", "--no-ext-diff", "--", "."]).unwrap_or_default();

    if summary.trim().is_empty() && patch.trim().is_empty() {
        summary = git_run(root, &["diff", "HEAD", "--stat", "--", "."]).unwrap_or_default();
        patch = git_run(root, &["diff", "HEAD", "--no-ext-diff", "--", "."]).unwrap_or_default();
        if let Some(untracked) = git_run(root, &["ls-files", "--others", "--exclude-standard"]) {
            let names = untracked.trim();
            if !names.is_empty() {
                if !summary.trim().is_empty() {
                    summary.push('\n');
                }
                summary.push_str("Untracked files:\n");
                summary.push_str(names);
            }
        }
    }

    if summary.trim().is_empty() && patch.trim().is_empty() {
        return Err("No changes to summarize".into());
    }

    Ok(GitStagedContext {
        branch: git_branch(root),
        summary,
        patch,
    })
}

fn git_commit_for(root: &Path, message: &str) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    git_checked(root, &["commit", "--cleanup=strip", "-m", message]).map_err(with_signing_hint)
}

/// Explain why signing fails here when the same commit works in a terminal.
fn with_signing_hint(error: String) -> String {
    if !error.contains("failed to sign") && !error.contains("ssh-keygen") {
        return error;
    }
    format!(
        "{error}\n\nGit couldn't sign this commit. Aven runs git without a terminal, \
         so your signer needs a GUI passphrase prompt (e.g. pinentry-mac) or an unlocked agent."
    )
}

fn git_push_for(root: &Path) -> Result<(), String> {
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        return git_checked(root, &["push"]);
    }
    let remote = git_remote_name(root).ok_or_else(|| "No git remote to push to".to_string())?;
    git_checked(root, &["push", "-u", &remote, "HEAD"])
}

fn git_sync_changes_for(root: &Path) -> Result<(), String> {
    if git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_some() {
        git_checked(root, &["pull", "--no-edit", "--ff"]).map_err(with_signing_hint)?;
        return git_checked(root, &["push"]);
    }
    git_push_for(root)
}

fn git_range_context_for(root: &Path) -> Result<GitRangeContext, String> {
    let head = git_branch(root).ok_or_else(|| "Not on a branch".to_string())?;
    let remote = git_remote_name(root);
    let default_branch = git_default_branch(root, remote.as_deref())
        .ok_or_else(|| "Could not resolve the default branch".to_string())?;
    let base_ref = match &remote {
        Some(remote)
            if git_ref_exists(root, &format!("refs/remotes/{remote}/{default_branch}")) =>
        {
            format!("{remote}/{default_branch}")
        }
        _ => default_branch.clone(),
    };
    let spec = format!("{base_ref}...HEAD");
    let commit_summary =
        git_run(root, &["log", "--format=%s", &format!("{base_ref}..HEAD")]).unwrap_or_default();
    let diff_summary = git_run(root, &["diff", "--stat", &spec]).unwrap_or_default();
    let diff_patch = git_run(root, &["diff", "--no-ext-diff", &spec]).unwrap_or_default();
    if commit_summary.trim().is_empty() && diff_patch.trim().is_empty() {
        return Err("No commits to include in a pull request".into());
    }
    Ok(GitRangeContext {
        base: default_branch,
        head,
        commit_summary,
        diff_summary,
        diff_patch,
    })
}

fn git_pr_status_for(root: &Path) -> Option<GitPr> {
    let branch = git_branch(root)?;
    let repo = git_github_repo_for(root).ok()?;
    let head = github_pr_head_filter(&repo, &branch)?;
    let json = gh_stdout(
        root,
        &[
            "pr",
            "list",
            "--head",
            &head,
            "--json",
            "number,title,url,state",
            "--limit",
            "20",
            "--state",
            "all",
        ],
    )?;
    parse_gh_pr_list(&json)
}

fn github_pr_head_filter(repo: &str, branch: &str) -> Option<String> {
    let (owner, _) = split_github_repo(repo).ok()?;
    Some(format!("{owner}:{branch}"))
}

fn git_github_repo_for(root: &Path) -> Result<String, String> {
    let json = gh_checked(root, &["repo", "view", "--json", "nameWithOwner"])?;
    #[derive(Deserialize)]
    struct View {
        #[serde(rename = "nameWithOwner")]
        name_with_owner: String,
    }
    let view: View = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    let slug = view.name_with_owner.trim();
    if slug.is_empty() || !slug.contains('/') {
        return Err("GitHub did not return a repository".into());
    }
    Ok(slug.to_string())
}

fn git_github_work_items_for(
    root: &Path,
    kind: &str,
    assigned_to_me: bool,
    state: &str,
    search: &str,
    limit: u32,
) -> Result<Vec<GitHubWorkItem>, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    let state = if state.trim().eq_ignore_ascii_case("all") {
        "all"
    } else {
        "open"
    };
    let limit = limit.clamp(1, 100).to_string();
    let fields = if kind == "pr" {
        "number,title,url,state,updatedAt,labels,assignees,isDraft"
    } else {
        "number,title,url,state,stateReason,updatedAt,labels,assignees"
    };
    let mut args = vec![
        kind.to_string(),
        "list".into(),
        "--state".into(),
        state.into(),
        "--limit".into(),
        limit,
        "--json".into(),
        fields.into(),
    ];
    if assigned_to_me {
        args.push("--assignee".into());
        args.push("@me".into());
    }
    let search = search.trim();
    if !search.is_empty() {
        args.push("--search".into());
        args.push(search.to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let json = gh_checked(root, &refs)?;
    let repo = git_github_repo_for(root).unwrap_or_default();
    parse_github_work_items(&json, kind, &repo)
}

fn git_github_work_item_details_for(
    root: &Path,
    kind: &str,
    number: i64,
) -> Result<GitHubWorkItemDetails, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    let number = number.to_string();
    let fields = if kind == "pr" {
        "body,author,baseRefName,headRefName,reviewDecision"
    } else {
        "body,author"
    };
    let json = gh_checked(root, &[kind, "view", &number, "--json", fields])?;
    parse_github_work_item_details(&json)
}

fn parse_github_work_item_details(json: &str) -> Result<GitHubWorkItemDetails, String> {
    #[derive(Deserialize)]
    struct Author {
        #[serde(default)]
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        #[serde(default)]
        body: String,
        #[serde(default)]
        author: Option<Author>,
        #[serde(default)]
        base_ref_name: String,
        #[serde(default)]
        head_ref_name: String,
        #[serde(default)]
        review_decision: Option<String>,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let author = row.author.map(|author| author.login).unwrap_or_default();
    let author_avatar_url = github_avatar_url(&author);
    Ok(GitHubWorkItemDetails {
        body: row.body,
        author,
        author_avatar_url,
        base_ref_name: row.base_ref_name,
        head_ref_name: row.head_ref_name,
        review_decision: row.review_decision.unwrap_or_default(),
    })
}

const GITHUB_ISSUE_THREAD_QUERY: &str = r#"
query InboxIssueThread($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          createdAt
          url
          isMinimized
        }
      }
    }
  }
}
"#;

const GITHUB_PR_THREAD_QUERY: &str = r#"
query InboxPullRequestThread($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      baseRefName
      headRefName
      comments(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          createdAt
          url
          isMinimized
        }
      }
      reviews(last: 40) {
        totalCount
        nodes {
          id
          author { login }
          body
          state
          submittedAt
          url
        }
      }
      reviewThreads(last: 20) {
        totalCount
        nodes {
          id
          isResolved
          path
          comments(first: 8) {
            totalCount
            nodes {
              id
              author { login }
              body
              createdAt
              url
              path
              line
              originalLine
              isMinimized
            }
          }
        }
      }
    }
  }
}
"#;

const GITHUB_REVIEW_REPLY_MUTATION: &str = r#"
mutation InboxReviewReply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $threadId
    body: $body
  }) {
    comment { url }
  }
}
"#;

fn git_github_work_item_thread_for(
    root: &Path,
    kind: &str,
    number: i64,
) -> Result<GitHubWorkItemThread, String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("Invalid GitHub item number".into());
    }
    let repo = git_github_repo_for(root)?;
    let (owner, name) = split_github_repo(&repo)?;
    let query = if kind == "pr" {
        GITHUB_PR_THREAD_QUERY
    } else {
        GITHUB_ISSUE_THREAD_QUERY
    };
    let owner_field = format!("owner={owner}");
    let name_field = format!("name={name}");
    let number_field = format!("number={number}");
    let json = gh_checked(
        root,
        &[
            "api",
            "graphql",
            "-f",
            &format!("query={query}"),
            "-F",
            &owner_field,
            "-F",
            &name_field,
            "-F",
            &number_field,
        ],
    )?;
    parse_github_work_item_thread(&json, kind)
}

fn github_comment_input<'a>(
    kind: &'a str,
    number: i64,
    body: &'a str,
) -> Result<(&'a str, &'a str), String> {
    let kind = kind.trim();
    if kind != "issue" && kind != "pr" {
        return Err("Unknown GitHub task kind".into());
    }
    if number <= 0 {
        return Err("Invalid GitHub item number".into());
    }
    let body = body.trim();
    if body.is_empty() {
        return Err("Comment cannot be empty".into());
    }
    Ok((kind, body))
}

fn git_github_work_item_comment_for(
    root: &Path,
    kind: &str,
    number: i64,
    body: &str,
    in_reply_to: &str,
) -> Result<String, String> {
    let (kind, body) = github_comment_input(kind, number, body)?;
    let reply = in_reply_to.trim();
    if !reply.is_empty() {
        return git_github_review_reply_for(root, reply, body);
    }
    let number = number.to_string();
    with_temp_markdown(body, |path| {
        let output = gh_checked_write(root, &[kind, "comment", &number, "--body-file", path])?;
        github_url_from_output(&output, "GitHub did not return a comment URL")
    })
}

fn git_github_review_reply_for(root: &Path, thread_id: &str, body: &str) -> Result<String, String> {
    if !valid_github_node_id(thread_id) {
        return Err("Invalid review thread".into());
    }
    let thread_field = format!("threadId={thread_id}");
    with_temp_markdown(body, |path| {
        let body_field = format!("body=@{path}");
        let json = gh_checked_write(
            root,
            &[
                "api",
                "graphql",
                "-f",
                &format!("query={GITHUB_REVIEW_REPLY_MUTATION}"),
                "-F",
                &thread_field,
                "-F",
                &body_field,
            ],
        )?;
        parse_github_review_reply_url(&json)
    })
}

fn with_temp_markdown(
    body: &str,
    run: impl FnOnce(&str) -> Result<String, String>,
) -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("aven-comment-{stamp}.md"));
    std::fs::write(&path, body).map_err(|error| error.to_string())?;
    let path_str = path.to_string_lossy().into_owned();
    let result = run(&path_str);
    let _ = std::fs::remove_file(&path);
    result
}

fn valid_github_node_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && id.len() < 256
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '='))
}

fn github_url_from_output(output: &str, missing: &str) -> Result<String, String> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| {
            if output.trim().is_empty() {
                missing.to_string()
            } else {
                output.trim().to_string()
            }
        })
}

fn parse_github_review_reply_url(json: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if let Some(message) = value
        .get("errors")
        .and_then(|errors| errors.as_array())
        .and_then(|errors| errors.first())
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        return Err(message.to_string());
    }
    let url = value
        .pointer("/data/addPullRequestReviewThreadReply/comment/url")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(url.to_string());
    }
    Err("GitHub did not return a comment URL".into())
}

fn split_github_repo(slug: &str) -> Result<(String, String), String> {
    let slug = slug.trim();
    let Some((owner, name)) = slug.split_once('/') else {
        return Err("GitHub did not return a repository".into());
    };
    let owner = owner.trim();
    let name = name.trim();
    if owner.is_empty()
        || name.is_empty()
        || name.contains('/')
        || owner.chars().any(char::is_whitespace)
        || name.chars().any(char::is_whitespace)
    {
        return Err("GitHub did not return a repository".into());
    }
    Ok((owner.to_string(), name.to_string()))
}

#[derive(Deserialize)]
struct GithubGraphqlEnvelope {
    #[serde(default)]
    data: Option<GithubGraphqlData>,
    #[serde(default)]
    errors: Vec<GithubGraphqlError>,
}

#[derive(Deserialize)]
struct GithubGraphqlError {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct GithubGraphqlData {
    repository: Option<GithubGraphqlRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlRepository {
    issue: Option<GithubGraphqlIssue>,
    pull_request: Option<GithubGraphqlPullRequest>,
}

#[derive(Deserialize)]
struct GithubGraphqlIssue {
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlPullRequest {
    #[serde(default)]
    review_decision: Option<String>,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
    #[serde(default)]
    reviews: GithubGraphqlNodes<GithubGraphqlReview>,
    #[serde(default)]
    review_threads: GithubGraphqlNodes<GithubGraphqlReviewThread>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlNodes<T> {
    total_count: i64,
    nodes: Vec<T>,
}

impl<T> Default for GithubGraphqlNodes<T> {
    fn default() -> Self {
        Self {
            total_count: 0,
            nodes: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlComment {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<GithubGraphqlActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    line: Option<i64>,
    #[serde(default)]
    original_line: Option<i64>,
}

#[derive(Deserialize)]
struct GithubGraphqlReview {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: Option<GithubGraphqlActor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    state: String,
    #[serde(default, rename = "submittedAt")]
    submitted_at: Option<String>,
    #[serde(default)]
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubGraphqlReviewThread {
    #[serde(default)]
    id: String,
    #[serde(default)]
    is_resolved: bool,
    #[serde(default)]
    path: String,
    #[serde(default)]
    comments: GithubGraphqlNodes<GithubGraphqlComment>,
}

#[derive(Deserialize)]
struct GithubGraphqlActor {
    #[serde(default)]
    login: String,
}

fn parse_github_work_item_thread(json: &str, kind: &str) -> Result<GitHubWorkItemThread, String> {
    let envelope: GithubGraphqlEnvelope =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    let graphql_error = envelope
        .errors
        .iter()
        .map(|error| error.message.trim())
        .find(|message| !message.is_empty())
        .map(str::to_string);
    let Some(repository) = envelope.data.and_then(|data| data.repository) else {
        return Err(graphql_error.unwrap_or_else(|| "GitHub item not found".into()));
    };

    let mut comments = Vec::new();
    let mut truncated = false;
    let mut review_decision = String::new();
    let mut base_ref_name = String::new();
    let mut head_ref_name = String::new();

    if kind == "pr" {
        let Some(pull) = repository.pull_request else {
            return Err(graphql_error.unwrap_or_else(|| "GitHub pull request not found".into()));
        };
        review_decision = pull.review_decision.unwrap_or_default();
        base_ref_name = pull.base_ref_name;
        head_ref_name = pull.head_ref_name;
        truncated |= github_nodes_truncated(&pull.comments);
        comments.extend(
            pull.comments
                .nodes
                .into_iter()
                .filter_map(github_issue_comment),
        );
        truncated |= github_nodes_truncated(&pull.reviews);
        comments.extend(
            pull.reviews
                .nodes
                .into_iter()
                .filter_map(github_review_comment),
        );
        truncated |= github_nodes_truncated(&pull.review_threads);
        comments.extend(
            pull.review_threads
                .nodes
                .into_iter()
                .filter_map(github_review_thread),
        );
    } else {
        let Some(issue) = repository.issue else {
            return Err(graphql_error.unwrap_or_else(|| "GitHub issue not found".into()));
        };
        truncated |= github_nodes_truncated(&issue.comments);
        comments.extend(
            issue
                .comments
                .nodes
                .into_iter()
                .filter_map(github_issue_comment),
        );
    }

    comments.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(GitHubWorkItemThread {
        comments,
        truncated,
        review_decision,
        base_ref_name,
        head_ref_name,
    })
}

fn github_nodes_truncated<T>(nodes: &GithubGraphqlNodes<T>) -> bool {
    (nodes.nodes.len() as i64) < nodes.total_count
}

fn github_actor_login(author: Option<GithubGraphqlActor>) -> String {
    author
        .map(|author| author.login)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn github_comment_id(kind: &str, id: &str, author: &str, created_at: &str) -> String {
    let id = id.trim();
    if !id.is_empty() {
        return id.to_string();
    }
    format!("{kind}:{author}:{created_at}")
}

fn github_issue_comment(comment: GithubGraphqlComment) -> Option<GitHubWorkItemComment> {
    github_mapped_comment(comment, "comment", "", false)
}

fn github_mapped_comment(
    comment: GithubGraphqlComment,
    kind: &str,
    fallback_path: &str,
    resolved: bool,
) -> Option<GitHubWorkItemComment> {
    if comment.is_minimized {
        return None;
    }
    let author = github_actor_login(comment.author);
    let created_at = comment.created_at.trim().to_string();
    let path = if comment.path.trim().is_empty() {
        fallback_path.trim().to_string()
    } else {
        comment.path.trim().to_string()
    };
    Some(GitHubWorkItemComment {
        id: github_comment_id(kind, &comment.id, &author, &created_at),
        kind: kind.to_string(),
        author_avatar_url: github_avatar_url(&author),
        author,
        body: comment.body,
        created_at,
        url: comment.url,
        state: String::new(),
        path,
        line: comment.line.or(comment.original_line),
        resolved,
        thread_id: String::new(),
        replies: Vec::new(),
    })
}

fn github_review_comment(review: GithubGraphqlReview) -> Option<GitHubWorkItemComment> {
    let state = review.state.trim().to_uppercase();
    if state.is_empty() || state == "PENDING" {
        return None;
    }
    let body = review.body.trim();
    if state == "COMMENTED" && body.is_empty() {
        return None;
    }
    let created_at = review
        .submitted_at
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if created_at.is_empty() {
        return None;
    }
    let author = github_actor_login(review.author);
    Some(GitHubWorkItemComment {
        id: github_comment_id("review", &review.id, &author, &created_at),
        kind: "review".into(),
        author_avatar_url: github_avatar_url(&author),
        author,
        body: review.body,
        created_at,
        url: review.url,
        state,
        path: String::new(),
        line: None,
        resolved: false,
        thread_id: String::new(),
        replies: Vec::new(),
    })
}

fn github_review_thread(thread: GithubGraphqlReviewThread) -> Option<GitHubWorkItemComment> {
    let thread_id = thread.id.trim().to_string();
    let mut mapped = thread.comments.nodes.into_iter().filter_map(|comment| {
        github_mapped_comment(comment, "review_comment", &thread.path, thread.is_resolved)
    });
    let mut first = mapped.next()?;
    first.thread_id = thread_id.clone();
    first.replies = mapped
        .map(|mut reply| {
            reply.thread_id = thread_id.clone();
            reply
        })
        .collect();
    Some(first)
}

fn github_avatar_url(login: &str) -> String {
    let login = login.trim();
    if login.is_empty() {
        return String::new();
    }
    let mut encoded = String::with_capacity(login.len());
    for byte in login.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    format!("https://avatars.githubusercontent.com/{encoded}?s=64")
}

fn git_github_pr_diff_for(root: &Path, number: i64) -> Result<GitHubPrDiff, String> {
    if number <= 0 {
        return Err("Invalid pull request number".into());
    }
    let number = number.to_string();
    let json = gh_run(
        root,
        &["pr", "view", &number, "--json", "files,additions,deletions"],
        false,
    )?;
    let mut diff = parse_github_pr_diff_meta(&json)?;
    let patch = gh_run(root, &["pr", "diff", &number], true)?;
    if patch.len() > MAX_PR_DIFF_BYTES {
        diff.truncated = true;
    } else {
        diff.patch = patch;
    }
    if diff.additions == 0 && diff.deletions == 0 {
        diff.additions = diff.files.iter().map(|file| file.additions).sum();
        diff.deletions = diff.files.iter().map(|file| file.deletions).sum();
    }
    Ok(diff)
}

fn parse_github_pr_diff_meta(json: &str) -> Result<GitHubPrDiff, String> {
    #[derive(Deserialize)]
    struct FileRow {
        path: String,
        #[serde(default)]
        additions: i64,
        #[serde(default)]
        deletions: i64,
    }
    #[derive(Deserialize)]
    struct Row {
        #[serde(default)]
        additions: i64,
        #[serde(default)]
        deletions: i64,
        #[serde(default)]
        files: Vec<FileRow>,
    }
    let row: Row = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(GitHubPrDiff {
        additions: row.additions,
        deletions: row.deletions,
        files: row
            .files
            .into_iter()
            .map(|file| GitHubPrFile {
                path: file.path,
                additions: file.additions,
                deletions: file.deletions,
            })
            .collect(),
        patch: String::new(),
        truncated: false,
    })
}

fn parse_github_work_items(
    json: &str,
    kind: &str,
    repo: &str,
) -> Result<Vec<GitHubWorkItem>, String> {
    #[derive(Deserialize)]
    struct RowLabel {
        name: String,
        #[serde(default)]
        color: String,
    }
    #[derive(Deserialize)]
    struct RowAssignee {
        login: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Row {
        number: i64,
        title: String,
        url: String,
        state: String,
        #[serde(default)]
        state_reason: Option<String>,
        #[serde(default)]
        updated_at: String,
        #[serde(default)]
        labels: Vec<RowLabel>,
        #[serde(default)]
        assignees: Vec<RowAssignee>,
        #[serde(default)]
        is_draft: bool,
    }
    let rows: Vec<Row> = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| GitHubWorkItem {
            kind: kind.to_string(),
            number: row.number,
            title: row.title,
            url: row.url,
            state: row.state.to_lowercase(),
            state_reason: row.state_reason.unwrap_or_default().to_lowercase(),
            updated_at: row.updated_at,
            labels: row
                .labels
                .into_iter()
                .map(|label| GitHubLabel {
                    name: label.name,
                    color: label.color,
                })
                .collect(),
            assignees: row
                .assignees
                .into_iter()
                .map(|assignee| GitHubAssignee {
                    avatar_url: github_avatar_url(&assignee.login),
                    login: assignee.login,
                })
                .collect(),
            draft: row.is_draft,
            repo: repo.to_string(),
        })
        .collect())
}

fn parse_gh_pr_list(json: &str) -> Option<GitPr> {
    #[derive(Deserialize)]
    struct Row {
        number: i64,
        title: String,
        url: String,
        state: String,
    }
    let rows: Vec<Row> = serde_json::from_str(json).ok()?;
    let mut best: Option<GitPr> = None;
    for row in rows {
        let pr = GitPr {
            number: row.number,
            title: row.title,
            url: row.url,
            state: row.state.to_lowercase(),
        };
        if pr.state == "open" {
            return Some(pr);
        }
        if best.is_none() {
            best = Some(pr);
        }
    }
    best
}

fn git_pr_create_for(root: &Path, input: &GitPrCreateInput) -> Result<String, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Pull request title cannot be empty".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let body_path = std::env::temp_dir().join(format!("aven-pr-{stamp}.md"));
    std::fs::write(&body_path, input.body.trim()).map_err(|e| e.to_string())?;
    let result = gh_checked_write(
        root,
        &[
            "pr",
            "create",
            "--title",
            title,
            "--body-file",
            &body_path.to_string_lossy(),
            "--base",
            input.base.trim(),
            "--head",
            input.head.trim(),
        ],
    );
    let _ = std::fs::remove_file(&body_path);
    result.and_then(|output| {
        output
            .lines()
            .rev()
            .find(|line| line.starts_with("http://") || line.starts_with("https://"))
            .map(|line| line.trim().to_string())
            .ok_or_else(|| {
                if output.trim().is_empty() {
                    "gh returned no pull request URL".into()
                } else {
                    output
                }
            })
    })
}

fn gh_stdout(root: &Path, args: &[&str]) -> Option<String> {
    gh_run(root, args, false).ok()
}

fn gh_checked(root: &Path, args: &[&str]) -> Result<String, String> {
    gh_run(root, args, false)
}

fn gh_checked_write(root: &Path, args: &[&str]) -> Result<String, String> {
    gh_run_for(root, args, false, true)
}

pub(crate) fn github_route(root: &Path) -> Result<crate::github_account::Route, String> {
    let remote = git_remote_name(root).ok_or("This project has no GitHub remote.")?;
    let url = git_stdout(root, &["remote", "get-url", &remote])
        .ok_or("Could not read this project's GitHub remote.")?;
    crate::github_account::route(root, &url)
}

fn gh_run(root: &Path, args: &[&str], allow_empty: bool) -> Result<String, String> {
    gh_run_for(root, args, allow_empty, false)
}

fn gh_run_for(
    root: &Path,
    args: &[&str],
    allow_empty: bool,
    write: bool,
) -> Result<String, String> {
    let route = github_route(root)?;
    let mut cmd = route.command(root)?;
    cmd.args(args);
    // Resolve the repository and verify its explicit identity for every write.
    if write {
        route.verify_identity(root)?;
    }
    let output = cmd.output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "The routed GitHub account command is not installed.".to_string()
        } else {
            error.to_string()
        }
    })?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            if allow_empty {
                return Ok(String::new());
            }
            return Err("gh returned no output".into());
        }
        return Ok(text);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("gh {} failed", args.join(" "))
    };
    Err(detail)
}

pub(crate) fn resolve_repo_path(root: &Path, relative: &str) -> Result<String, String> {
    let relative = normalize_diff_path(relative);
    if relative.is_empty()
        || relative.starts_with('/')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "..")
    {
        return Err("Invalid path".into());
    }
    let abs = root.join(&relative);
    if !abs.starts_with(root) {
        return Err("Invalid path".into());
    }
    Ok(relative)
}

pub(crate) fn git_cmd() -> Command {
    let mut cmd = Command::new("git");
    crate::hide_window_console(&mut cmd);
    cmd
}

/// Finder and Dock launches inherit launchd's bare PATH. Commands that can run
/// signers, hooks, credential helpers, or git-lfs get the login-shell PATH;
/// read-only commands skip it so they never wait on the login shell.
fn git_cmd_for_args_with_path(args: &[&str], gui_path: impl FnOnce() -> String) -> Command {
    let mut cmd = git_cmd();
    if matches!(
        args.first().copied(),
        Some("commit" | "push" | "pull" | "fetch" | "clone")
    ) {
        cmd.env("PATH", gui_path());
    }
    cmd
}

fn git_cmd_for_args(args: &[&str]) -> Command {
    git_cmd_for_args_with_path(args, crate::harness::gui_search_path)
}

pub(crate) fn git_checked(root: &Path, args: &[&str]) -> Result<(), String> {
    let output = git_cmd_for_args(args)
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let msg = stderr.trim();
    if !msg.is_empty() {
        return Err(msg.to_string());
    }
    let msg = stdout.trim();
    if !msg.is_empty() {
        return Err(msg.to_string());
    }
    Err(format!("git {} failed", args.join(" ")))
}

fn git_blob(root: &Path, spec: &str) -> Option<Vec<u8>> {
    git_output(root, &["cat-file", "-p", spec])
}

fn git_run(root: &Path, args: &[&str]) -> Option<String> {
    git_output(root, args).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn git_output(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = git_cmd_for_args(args)
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    if output.status.success() {
        return Some(output.stdout);
    }
    // `git diff` exits 1 when the files differ.
    if output.status.code() == Some(1) && args.first().copied() == Some("diff") {
        return Some(output.stdout);
    }
    None
}

fn git_branch(root: &Path) -> Option<String> {
    git_head_branch(root).or_else(|| git_stdout(root, &["rev-parse", "--short", "HEAD"]))
}

fn git_head_branch(root: &Path) -> Option<String> {
    git_stdout(root, &["symbolic-ref", "--short", "HEAD"]).filter(|branch| branch != "HEAD")
}

fn git_is_work_tree(root: &Path) -> bool {
    git_stdout(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true")
}

fn git_branches_for(root: &Path) -> GitBranches {
    if !git_is_work_tree(root) {
        return GitBranches::default();
    }

    let current_branch = git_head_branch(root);
    let head_sha = git_stdout(root, &["rev-parse", "--short", "HEAD"]);
    let detached = current_branch.is_none() && head_sha.is_some();
    let current = current_branch.clone().or(head_sha);

    let mut branches = Vec::new();
    let mut local_names = HashSet::new();
    if let Some(text) = git_run(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)\t%(HEAD)",
            "refs/heads",
        ],
    ) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let (name, head) = line.split_once('\t').unwrap_or((line, ""));
            if name.is_empty() {
                continue;
            }
            local_names.insert(name.to_string());
            branches.push(GitBranchEntry {
                name: name.to_string(),
                current: head.trim() == "*",
                remote: None,
            });
        }
    }

    if let Some(name) = &current_branch {
        if !local_names.contains(name) {
            local_names.insert(name.clone());
            branches.push(GitBranchEntry {
                name: name.clone(),
                current: true,
                remote: None,
            });
        }
    }

    if let Some(text) = git_run(
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    ) {
        for line in text.lines() {
            let full = line.trim();
            if full.is_empty() {
                continue;
            }
            let Some((remote, name)) = full.split_once('/') else {
                continue;
            };
            if remote.is_empty() || name.is_empty() || name == "HEAD" || name.ends_with("/HEAD") {
                continue;
            }
            if local_names.contains(name) {
                continue;
            }
            branches.push(GitBranchEntry {
                name: name.to_string(),
                current: false,
                remote: Some(remote.to_string()),
            });
        }
    }

    branches.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then(a.remote.is_some().cmp(&b.remote.is_some()))
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
            .then_with(|| a.remote.cmp(&b.remote))
    });

    GitBranches {
        current,
        detached,
        branches,
    }
}

fn git_checkout_for(root: &Path, name: &str, remote: Option<&str>) -> Result<String, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let name = git_branch_name(root, name)?;
    if let Some(remote) = remote.map(str::trim).filter(|value| !value.is_empty()) {
        if git_head_branch(root).as_deref() == Some(name.as_str()) {
            return Ok(name);
        }
        git_switch(root, &["checkout", "--track", &format!("{remote}/{name}")])?;
        return Ok(name);
    }
    if git_head_branch(root).as_deref() == Some(name.as_str()) {
        return Ok(name);
    }
    if git_ref_exists(root, &format!("refs/heads/{name}")) {
        git_switch(root, &["checkout", &name])?;
        return Ok(name);
    }
    if let Some(remote) = git_remote_name(root) {
        let spec = format!("refs/remotes/{remote}/{name}");
        if git_ref_exists(root, &spec) {
            git_switch(root, &["checkout", "--track", &format!("{remote}/{name}")])?;
            return Ok(name);
        }
    }
    Err(format!("Branch {name} not found"))
}

fn git_create_branch_for(root: &Path, name: &str) -> Result<String, String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    let name = git_branch_name(root, name)?;
    if git_ref_exists(root, &format!("refs/heads/{name}"))
        || git_head_branch(root).as_deref() == Some(name.as_str())
    {
        return Err(format!("Branch {name} already exists"));
    }
    git_switch(root, &["checkout", "-b", &name])?;
    Ok(name)
}

fn git_stash_for(root: &Path, message: Option<&str>) -> Result<(), String> {
    if !git_is_work_tree(root) {
        return Err("Not a git repository".into());
    }
    match message.map(str::trim).filter(|value| !value.is_empty()) {
        Some(message) => git_checked(
            root,
            &["stash", "push", "--include-untracked", "-m", message],
        ),
        None => git_checked(root, &["stash", "push", "--include-untracked"]),
    }
}

fn git_switch(root: &Path, args: &[&str]) -> Result<(), String> {
    git_checked(root, args).map_err(map_local_changes_err)
}

fn map_local_changes_err(err: String) -> String {
    if checkout_blocked_by_changes(&err) {
        "Your local changes would be overwritten. Commit or stash them first.".into()
    } else {
        err
    }
}

fn checkout_blocked_by_changes(err: &str) -> bool {
    let text = err.to_ascii_lowercase();
    text.contains("would be overwritten")
        || text.contains("commit your changes or stash")
        || text.contains("please move or remove them before")
}

fn git_branch_name(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".into());
    }
    let output = git_cmd()
        .arg("-C")
        .arg(root)
        .args(["check-ref-format", "--branch", name])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("'{name}' is not a valid branch name"));
    }
    let normalized = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if normalized.is_empty() {
        return Err(format!("'{name}' is not a valid branch name"));
    }
    Ok(normalized)
}

fn git_origin_repo(root: &Path) -> Option<String> {
    git_url_repo_name(&git_stdout(root, &["remote", "get-url", "origin"])?)
}

#[derive(Default)]
struct GitSync {
    remote: Option<String>,
    upstream: Option<String>,
    default_branch: Option<String>,
    ahead: i64,
    behind: i64,
    ahead_of_default: i64,
}

fn git_sync_for(root: &Path) -> GitSync {
    let remote = git_remote_name(root);
    let upstream = git_stdout(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]);
    let default_branch = git_default_branch(root, remote.as_deref());
    let default_ref = match (&remote, &default_branch) {
        (Some(remote), Some(branch)) => Some(format!("{remote}/{branch}")),
        _ => None,
    };
    let (ahead, behind) = if upstream.is_some() {
        git_ahead_behind(root, "@{upstream}")
    } else if let Some(base) = default_ref.as_deref() {
        git_ahead_behind(root, base)
    } else {
        (0, 0)
    };
    let ahead_of_default = if let Some(base) = default_ref.as_deref() {
        git_ahead_behind(root, base).0
    } else {
        ahead
    };
    GitSync {
        remote,
        upstream,
        default_branch,
        ahead,
        behind,
        ahead_of_default,
    }
}

fn git_remote_name(root: &Path) -> Option<String> {
    let remotes = git_stdout(root, &["remote"])?;
    let mut names = remotes
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let first = names.next()?.to_string();
    if first == "origin" || names.any(|name| name == "origin") {
        return Some("origin".into());
    }
    Some(first)
}

fn git_default_branch(root: &Path, remote: Option<&str>) -> Option<String> {
    if let Some(remote) = remote {
        if let Some(head) = git_stdout(
            root,
            &[
                "symbolic-ref",
                "--short",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        ) {
            if let Some((_, name)) = head.split_once('/') {
                return Some(name.to_string());
            }
            return Some(head);
        }
        for name in ["main", "master"] {
            if git_ref_exists(root, &format!("refs/remotes/{remote}/{name}")) {
                return Some(name.to_string());
            }
        }
    }
    for name in ["main", "master"] {
        if git_ref_exists(root, &format!("refs/heads/{name}")) {
            return Some(name.to_string());
        }
    }
    None
}

fn git_ref_exists(root: &Path, spec: &str) -> bool {
    git_output(root, &["show-ref", "--verify", "--quiet", spec]).is_some()
}

fn git_ahead_behind(root: &Path, base: &str) -> (i64, i64) {
    let spec = format!("{base}...HEAD");
    let Some(text) = git_stdout(root, &["rev-list", "--left-right", "--count", &spec]) else {
        return (0, 0);
    };
    let mut parts = text.split_whitespace();
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn git_stdout(root: &Path, args: &[&str]) -> Option<String> {
    let output = git_cmd().arg("-C").arg(root).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// Clone `url` into `parent`/`<repo-name>` and return the new directory.
#[tauri::command]
pub async fn clone_repo(url: String, parent: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || clone_repo_sync(&url, &parent))
        .await
        .map_err(|e| e.to_string())?
}

fn clone_repo_sync(url: &str, parent: &str) -> Result<String, String> {
    let url = url.trim();
    if !is_git_url(url) {
        return Err("Enter an https, ssh, or git URL".into());
    }
    let name = repo_name(url)?;
    let dest = expand_home(parent).join(&name);
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let dest_str = dest.to_str().ok_or("Invalid destination path")?;
    let output = git_cmd_for_args(&["clone"])
        .args(["clone", "--", url, dest_str])
        .output()
        .map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                "git is not installed".into()
            } else {
                format!("git clone failed: {e}")
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("git clone failed");
        return Err(msg.trim().to_string());
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn is_git_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("git@")
        || url.starts_with("ssh://")
        || url.starts_with("git://")
}

fn repo_name(url: &str) -> Result<String, String> {
    git_url_repo_name(url).ok_or_else(|| "Could not infer repository name from URL".into())
}

fn git_url_repo_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let name = trimmed.rsplit(['/', ':']).next().unwrap_or("").trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['\\', '/']) {
        return None;
    }
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("aven-{label}-{}-{stamp}-{seq}", std::process::id()));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Tmp(dir),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{}", error),
            }
        }
    }

    fn init_git(dir: &Path, branch: &str, origin: Option<&str>) -> bool {
        let init = Command::new("git").args(["init"]).current_dir(dir).output();
        let Ok(init) = init else { return false };
        if !init.status.success() {
            return false;
        }
        let head = Command::new("git")
            .args(["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")])
            .current_dir(dir)
            .status();
        if head.map(|status| !status.success()).unwrap_or(true) {
            return false;
        }
        if let Some(url) = origin {
            let remote = Command::new("git")
                .args(["remote", "add", "origin", url])
                .current_dir(dir)
                .status();
            if remote.map(|status| !status.success()).unwrap_or(true) {
                return false;
            }
        }
        git(dir, &["config", "user.name", "Aven"])
            && git(dir, &["config", "user.email", "aven@test"])
            && git(dir, &["config", "commit.gpgsign", "false"])
            && git(dir, &["config", "core.autocrlf", "false"])
    }

    #[test]
    fn git_info_reads_branch_and_origin_repo() {
        let dir = tmp("git-info");
        if !init_git(
            &dir.0,
            "fix-sidebar",
            Some("https://github.com/acme/widget.git"),
        ) {
            return;
        }
        let info = git_info_for(&dir.0);
        assert_eq!(info.branch.as_deref(), Some("fix-sidebar"));
        assert_eq!(info.repo.as_deref(), Some("widget"));
    }

    #[test]
    fn git_info_falls_back_to_folder_name_without_origin() {
        let dir = tmp("git-info-local");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        let info = git_info_for(&dir.0);
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(
            info.repo.as_deref(),
            dir.0.file_name().and_then(|name| name.to_str())
        );
    }

    #[test]
    fn parses_worktree_list_and_skips_unusable_entries() {
        let text = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /copies/a\nHEAD def\ndetached\n\nworktree /copies/gone\nHEAD 123\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
        assert_eq!(
            parse_worktree_list(text),
            vec![
                ("/repo".to_string(), Some("main".to_string())),
                ("/copies/a".to_string(), None),
            ]
        );
    }

    #[test]
    fn lists_every_checkout_with_its_uncommitted_work() {
        let dir = tmp("git-worktrees");
        let repo = dir.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(git(&repo, &["init", "-q", "-b", "main"]));
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        assert!(git(&repo, &["add", "."]));
        assert!(git(&repo, &["commit", "-q", "-m", "first"]));
        let copy = dir.0.join("copy");
        assert!(git(
            &repo,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "agent",
                copy.to_str().unwrap()
            ]
        ));
        std::fs::write(copy.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(copy.join("b.txt"), "new\n").unwrap();

        let copies = git_worktrees_for(&copy);
        assert_eq!(copies.len(), 2);
        assert!(copies[0].primary && !copies[0].current);
        assert_eq!(copies[0].branch.as_deref(), Some("main"));
        assert!(copies[0].files.is_empty());
        assert!(!copies[1].primary && copies[1].current);
        assert_eq!(copies[1].branch.as_deref(), Some("agent"));
        let mut changed: Vec<_> = copies[1]
            .files
            .iter()
            .map(|file| file.relative.as_str())
            .collect();
        changed.sort();
        assert_eq!(changed, ["a.txt", "b.txt"]);
        assert_eq!(
            (copies[1].ahead_of_default, copies[1].behind_default),
            (0, 0)
        );
    }

    #[test]
    fn detects_copies_whose_changes_already_landed_on_main() {
        let dir = tmp("git-worktrees-merged");
        let repo = dir.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(init_git_commit(&repo, &[("a.txt", "one\n")]));
        let add = |name: &str| {
            let copy = dir.0.join(name);
            assert!(git(
                &repo,
                &["worktree", "add", "-q", "-b", name, copy.to_str().unwrap()]
            ));
            copy
        };
        let commit = |copy: &Path, file: &str, text: &str| {
            std::fs::write(copy.join(file), text).unwrap();
            assert!(git(copy, &["add", "."]));
            assert!(git(copy, &["commit", "-q", "-m", file]));
        };

        let idle = add("idle");
        let plain = add("plain");
        commit(&plain, "plain.txt", "plain\n");
        assert!(git(
            &repo,
            &["merge", "-q", "--no-ff", "-m", "merge", "plain"]
        ));

        let squash = add("squash");
        commit(&squash, "s1.txt", "first\n");
        commit(&squash, "s2.txt", "second\n");
        assert!(git(&repo, &["merge", "-q", "--squash", "squash"]));
        assert!(git(&repo, &["commit", "-q", "-m", "squash"]));

        let partial = add("partial");
        commit(&partial, "p1.txt", "kept\n");
        let first = git_stdout(&partial, &["rev-parse", "HEAD"]).unwrap();
        commit(&partial, "p2.txt", "left out\n");
        commit(&repo, "between.txt", "between\n");
        assert!(git(&repo, &["cherry-pick", &first]));

        let conflict = add("conflict");
        commit(&conflict, "a.txt", "copy\n");
        commit(&repo, "a.txt", "main\n");

        // Squash-merged, then main edits the same lines again: merging the
        // copy now conflicts, but its work landed as the squash commit.
        let reworked = add("reworked");
        commit(&reworked, "r.txt", "copy line\n");
        commit(&reworked, "r2.txt", "second file\n");
        assert!(git(&repo, &["merge", "-q", "--squash", "reworked"]));
        assert!(git(&repo, &["commit", "-q", "-m", "squash reworked"]));
        commit(&repo, "r.txt", "main rewrote it\n");

        // A squash-merged checkout with an unsaved file still holds work.
        let dirty = dir.0.join("dirty");
        assert!(git(
            &repo,
            &[
                "worktree",
                "add",
                "-q",
                "--detach",
                dirty.to_str().unwrap(),
                "squash"
            ]
        ));
        std::fs::write(dirty.join("draft.txt"), "draft\n").unwrap();
        // Main moves on after the squash merge; that alone changes nothing.
        commit(&repo, "later.txt", "later\n");

        let copies = git_worktrees_for(&repo);
        let state = |path: &Path| {
            let copy = copies
                .iter()
                .find(|copy| same_entry(Path::new(&copy.path), path))
                .unwrap();
            (copy.ahead_of_default, copy.merged_into_default)
        };
        assert_eq!(state(&repo), (0, true));
        assert_eq!(state(&idle), (0, true));
        assert_eq!(state(&plain), (0, true));
        assert_eq!(state(&squash), (2, true));
        assert_eq!(state(&partial), (2, false));
        assert_eq!(state(&conflict), (1, false));
        assert_eq!(state(&dirty), (2, false));
        assert_eq!(state(&reworked), (2, true));
        // Checking never moves a branch or touches a checkout.
        assert!(git_diff_files_for(&squash).files.is_empty());
        assert_eq!(
            git_stdout(&repo, &["symbolic-ref", "--short", "HEAD"]).as_deref(),
            Some("main")
        );
    }

    #[test]
    fn worktree_removal_keeps_branches_with_unmerged_work() {
        let dir = tmp("git-worktree-remove");
        let repo = dir.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(git(&repo, &["init", "-q", "-b", "main"]));
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        assert!(git(&repo, &["add", "."]));
        assert!(git(&repo, &["commit", "-q", "-m", "first"]));
        let add = |name: &str| {
            let copy = dir.0.join(name);
            assert!(git(
                &repo,
                &["worktree", "add", "-q", "-b", name, copy.to_str().unwrap()]
            ));
            copy
        };
        let branch_exists = |name: &str| {
            git(
                &repo,
                &[
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{name}"),
                ],
            )
        };

        // Unsaved files are discarded; a merged branch goes with the folder.
        let finished = add("finished");
        std::fs::write(finished.join("scratch.txt"), "draft\n").unwrap();
        remove_worktree_for(&repo, &finished).unwrap();
        assert!(!finished.exists());
        assert!(!branch_exists("finished"));

        // Commits main lacks stay reachable on their branch.
        let ahead = add("ahead");
        std::fs::write(ahead.join("b.txt"), "two\n").unwrap();
        assert!(git(&ahead, &["add", "."]));
        assert!(git(&ahead, &["commit", "-q", "-m", "second"]));
        remove_worktree_for(&repo, &ahead).unwrap();
        assert!(!ahead.exists());
        assert!(branch_exists("ahead"));

        // The main checkout, the open copy and race copies are refused.
        assert!(remove_worktree_for(&repo, &repo).is_err());
        let open = add("open");
        assert!(remove_worktree_for(&open, &open).is_err());
        assert!(open.exists());
        let race = add("aven/race/abc-0");
        assert!(remove_worktree_for(&repo, &race).is_err());
        assert!(race.exists());
        assert!(remove_worktree_for(&repo, &dir.0.join("missing")).is_err());
        assert_eq!(git_worktrees_for(&repo).len(), 3);
    }

    #[test]
    fn worktree_removal_refuses_ignored_files_and_folders() {
        let dir = tmp("git-worktree-remove-ignored");
        let repo = dir.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(init_git_commit(
            &repo,
            &[(".gitignore", ".env\nlocal-data/\n")]
        ));
        let copy = dir.0.join("copy");
        assert!(git(
            &repo,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "copy",
                copy.to_str().unwrap()
            ]
        ));
        std::fs::write(copy.join(".env"), "local configuration\n").unwrap();
        std::fs::create_dir(copy.join("local-data")).unwrap();
        std::fs::write(copy.join("local-data/draft.txt"), "private draft\n").unwrap();

        // These files never appear in the Changes list, but must survive.
        assert!(git_diff_files_for(&copy).files.is_empty());
        let error = remove_worktree_for(&repo, &copy).unwrap_err();
        assert!(error.contains("ignored files or folders"));
        assert_eq!(
            std::fs::read_to_string(copy.join(".env")).unwrap(),
            "local configuration\n"
        );
        assert_eq!(
            std::fs::read_to_string(copy.join("local-data/draft.txt")).unwrap(),
            "private draft\n"
        );
        assert!(git_ref_exists(&repo, "refs/heads/copy"));

        // An ignored directory alone still blocks removal. Once the user has
        // cleared its files, removing the otherwise finished copy succeeds.
        std::fs::remove_file(copy.join(".env")).unwrap();
        assert!(remove_worktree_for(&repo, &copy).is_err());
        assert!(copy.join("local-data/draft.txt").is_file());
        std::fs::remove_dir_all(copy.join("local-data")).unwrap();
        remove_worktree_for(&repo, &copy).unwrap();
        assert!(!copy.exists());
    }

    #[test]
    fn worktree_removal_refuses_detached_commits() {
        let dir = tmp("git-worktree-remove-detached");
        let repo = dir.0.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        assert!(init_git_commit(&repo, &[("a.txt", "base\n")]));
        let copy = dir.0.join("copy");
        assert!(git(
            &repo,
            &["worktree", "add", "-q", "--detach", copy.to_str().unwrap()]
        ));
        std::fs::write(copy.join("a.txt"), "unique detached work\n").unwrap();
        assert!(git(&copy, &["add", "."]));
        assert!(git(&copy, &["commit", "-q", "-m", "detached work"]));
        let head = git_stdout(&copy, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(
            git_run(&repo, &["for-each-ref", "--contains", &head]),
            Some(String::new())
        );

        let error = remove_worktree_for(&repo, &copy).unwrap_err();
        assert!(error.contains("Create a branch"));
        assert_eq!(
            git_stdout(&copy, &["rev-parse", "HEAD"]),
            Some(head.clone())
        );
        assert!(git_run(&copy, &["reflog", "show", "--format=%H", "HEAD"])
            .unwrap()
            .contains(&head));
        assert_eq!(
            std::fs::read_to_string(copy.join("a.txt")).unwrap(),
            "unique detached work\n"
        );

        // Following the refusal's guidance makes removal safe: the new branch
        // retains the unique commit after the checkout itself is gone.
        assert!(git(&copy, &["switch", "-q", "-c", "recovered"]));
        remove_worktree_for(&repo, &copy).unwrap();
        assert!(!copy.exists());
        assert_eq!(
            git_stdout(&repo, &["rev-parse", "refs/heads/recovered"]),
            Some(head)
        );
    }

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .args([
                "-c",
                "user.name=Aven",
                "-c",
                "user.email=aven@test",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "Aven")
            .env("GIT_AUTHOR_EMAIL", "aven@test")
            .env("GIT_COMMITTER_NAME", "Aven")
            .env("GIT_COMMITTER_EMAIL", "aven@test")
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn init_git_commit(dir: &Path, files: &[(&str, &str)]) -> bool {
        if !init_git(dir, "main", None) {
            return false;
        }
        for (name, contents) in files {
            if std::fs::write(dir.join(name), contents).is_err() {
                return false;
            }
        }
        git(dir, &["add", "."]) && git(dir, &["commit", "-m", "init"])
    }

    #[test]
    fn read_only_git_never_resolves_login_shell_path() {
        for action in ["status", "diff", "rev-parse", "ls-files", "cat-file"] {
            let cmd = git_cmd_for_args_with_path(&[action], || {
                panic!("read-only git must not resolve the login-shell PATH")
            });
            assert!(!cmd
                .get_envs()
                .any(|(key, _)| key == std::ffi::OsStr::new("PATH")));
        }
    }

    #[test]
    fn git_actions_that_need_helpers_use_login_shell_path() {
        for action in ["commit", "push", "pull", "fetch", "clone"] {
            let cmd = git_cmd_for_args_with_path(&[action], || "gui-git-path".into());
            assert!(cmd.get_envs().any(|(key, value)| {
                key == std::ffi::OsStr::new("PATH")
                    && value == Some(std::ffi::OsStr::new("gui-git-path"))
            }));
        }
    }

    #[test]
    fn signing_hint_ignores_other_errors() {
        let error = "nothing to commit, working tree clean".to_string();
        assert_eq!(with_signing_hint(error.clone()), error);
    }

    #[test]
    fn git_commit_reports_signing_failure_with_hint() {
        let dir = tmp("git-commit-signing");
        if !init_git_commit(&dir.0, &[("a.txt", "a\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "b\n").unwrap();
        for args in [
            ["config", "commit.gpgsign", "true"],
            ["config", "gpg.format", "openpgp"],
            ["config", "gpg.program", "/nonexistent/aven-gpg"],
        ] {
            assert!(git(&dir.0, &args));
        }
        assert!(git(&dir.0, &["add", "."]));
        let error = git_commit_for(&dir.0, "signed").unwrap_err();
        assert!(error.contains("Git couldn't sign this commit"), "{error}");
    }

    #[test]
    fn git_diff_stats_are_zero_outside_a_repo() {
        let dir = tmp("git-diff-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert_eq!(
            git_diff_stats_for(&dir.0),
            GitDiffStats {
                files: 0,
                additions: 0,
                deletions: 0
            }
        );
    }

    #[test]
    fn git_diff_stats_count_unstaged_and_untracked() {
        let dir = tmp("git-diff-dirty");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\nworld\n").unwrap();
        std::fs::write(dir.0.join("ignored.txt"), "nope\n").unwrap();
        std::fs::write(dir.0.join(".gitignore"), "ignored.txt\n").unwrap();

        let stats = git_diff_stats_for(&dir.0);
        // a.txt: -beta +delta; new.txt: +2; .gitignore: +1 untracked
        assert_eq!(stats.files, 3);
        assert_eq!(stats.additions, 4);
        assert_eq!(stats.deletions, 1);
    }

    #[test]
    fn git_diff_stats_are_zero_when_clean() {
        let dir = tmp("git-diff-clean");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(
            git_diff_stats_for(&dir.0),
            GitDiffStats {
                files: 0,
                additions: 0,
                deletions: 0
            }
        );
    }

    #[test]
    fn git_diff_index_lists_modified_and_untracked() {
        let dir = tmp("git-diff-index");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\nworld\n").unwrap();

        let index = git_diff_index_for(&dir.0);
        assert_eq!(index.branch.as_deref(), Some("main"));
        assert_eq!(index.files.len(), 2);

        let modified = index
            .files
            .iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert_eq!(modified.status, "modified");
        assert_eq!(modified.additions, 1);
        assert_eq!(modified.deletions, 1);

        let untracked = index
            .files
            .iter()
            .find(|file| file.relative == "new.txt")
            .unwrap();
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
        assert_eq!(untracked.deletions, 0);
    }

    #[test]
    fn git_diff_files_keep_paths_relative_to_nested_workspace() {
        let dir = tmp("git-diff-nested-workspace");
        let workspace = dir.0.join("sub");
        std::fs::create_dir_all(workspace.join("sub")).unwrap();
        if !init_git_commit(
            &dir.0,
            &[("sub/file.txt", "original\n"), ("sub/second.txt", "old\n")],
        ) {
            return;
        }
        std::fs::write(workspace.join("file.txt"), "staged\n").unwrap();
        assert!(git(&dir.0, &["add", "--", "sub/file.txt"]));
        std::fs::write(workspace.join("second.txt"), "unstaged\n").unwrap();
        // Without --relative this collides with the tracked sub/file.txt key.
        std::fs::write(workspace.join("sub/file.txt"), "untracked\n").unwrap();

        let changes = git_diff_files_for(&workspace);
        assert_eq!(changes.files.len(), 3);
        for (relative, staged, unstaged) in [
            ("file.txt", true, false),
            ("second.txt", false, true),
            ("sub/file.txt", false, true),
        ] {
            let file = changes
                .files
                .iter()
                .find(|file| file.relative == relative)
                .unwrap();
            assert_eq!(file.path, path_to_js(&workspace.join(relative)));
            assert_eq!((file.staged, file.unstaged), (staged, unstaged));
        }
        assert_eq!(git_diff_stats_for(&workspace).files, 3);
        let staged = git_file_diff_for(&workspace, "file.txt", true).unwrap();
        assert_eq!(staged.original, "original\n");
        assert_eq!(staged.current, "staged\n");
    }

    #[test]
    fn git_file_diff_returns_both_sides() {
        let dir = tmp("git-file-diff");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\ngamma\ndelta\n").unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.original, "alpha\nbeta\ngamma\n");
        assert_eq!(diff.current, "alpha\ngamma\ndelta\n");
        assert!(!diff.binary);
        assert!(!diff.too_large);
    }

    #[test]
    fn git_file_diff_staged_reads_head_and_index() {
        let dir = tmp("git-file-diff-staged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", true).unwrap();
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "beta\n");
    }

    #[test]
    fn git_file_diff_staged_handles_additions_and_deletions() {
        let dir = tmp("git-file-diff-staged-status");
        if !init_git_commit(&dir.0, &[("gone.txt", "old\n")]) {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "new\n").unwrap();
        std::fs::remove_file(dir.0.join("gone.txt")).unwrap();
        assert!(git(&dir.0, &["add", "-A"]));

        let added = git_file_diff_for(&dir.0, "new.txt", true).unwrap();
        assert_eq!(added.status, "added");
        assert_eq!(added.original, "");
        assert_eq!(added.current, "new\n");

        let deleted = git_file_diff_for(&dir.0, "gone.txt", true).unwrap();
        assert_eq!(deleted.status, "deleted");
        assert_eq!(deleted.original, "old\n");
        assert_eq!(deleted.current, "");
    }

    #[test]
    fn git_file_diff_separates_staged_and_unstaged_changes() {
        let dir = tmp("git-file-diff-partial");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\ndelta\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\nBETA\ngamma\nDELTA\n").unwrap();
        git_stage_contents_for(&dir.0, "a.txt", b"alpha\nBETA\ngamma\ndelta\n").unwrap();

        let staged = git_file_diff_for(&dir.0, "a.txt", true).unwrap();
        assert_eq!(staged.original, "alpha\nbeta\ngamma\ndelta\n");
        assert_eq!(staged.current, "alpha\nBETA\ngamma\ndelta\n");

        let unstaged = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(unstaged.original, "alpha\nBETA\ngamma\ndelta\n");
        assert_eq!(unstaged.current, "alpha\nBETA\ngamma\nDELTA\n");
    }

    #[test]
    fn git_file_diff_untracked_has_empty_original() {
        let dir = tmp("git-file-diff-new");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        let diff = git_file_diff_for(&dir.0, "new.txt", false).unwrap();
        assert_eq!(diff.status, "untracked");
        assert_eq!(diff.original, "");
        assert_eq!(diff.current, "hello\n");
    }

    #[test]
    fn git_file_diff_deleted_has_empty_current() {
        let dir = tmp("git-file-diff-del");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::remove_file(dir.0.join("a.txt")).unwrap();

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.status, "deleted");
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "");
    }

    #[test]
    fn git_file_diff_rejects_path_escape() {
        let dir = tmp("git-file-diff-escape");
        assert!(git_file_diff_for(&dir.0, "../secret.txt", false).is_err());
    }

    #[test]
    fn git_file_diff_rejects_outside_a_repo() {
        let dir = tmp("git-file-diff-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert!(git_file_diff_for(&dir.0, "notes.txt", false).is_err());
    }

    #[test]
    fn parse_git_decorations_classifies_head_local_remote_and_tags() {
        let remotes = vec!["origin".to_string()];
        let (head, refs) = parse_git_decorations(
            "HEAD -> main, origin/main, origin/HEAD, tag: v0.1.30, fix/foo",
            Some("abc"),
            "abc",
            &remotes,
        );
        assert!(head);
        assert_eq!(
            refs,
            vec![
                GitHistoryRef {
                    name: "main".into(),
                    kind: "local".into()
                },
                GitHistoryRef {
                    name: "origin/main".into(),
                    kind: "remote".into()
                },
                GitHistoryRef {
                    name: "v0.1.30".into(),
                    kind: "tag".into()
                },
                GitHistoryRef {
                    name: "fix/foo".into(),
                    kind: "local".into()
                },
            ]
        );
    }

    #[test]
    fn git_history_lists_commits_parents_and_head() {
        let dir = tmp("git-history");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "second"]));

        let history = git_history_for(&dir.0, Some(10)).unwrap();
        assert_eq!(history.commits.len(), 2);
        assert_eq!(history.commits[0].subject, "second");
        assert_eq!(history.commits[1].subject, "init");
        assert_eq!(
            history.commits[0].parents,
            vec![history.commits[1].sha.clone()]
        );
        assert!(history.commits[0].head);
        assert!(!history.commits[1].head);
        assert!(history.commits[0]
            .refs
            .iter()
            .any(|r| r.kind == "local" && r.name == "main"));
    }

    #[test]
    fn git_history_empty_outside_a_repo() {
        let dir = tmp("git-history-none");
        assert_eq!(
            git_history_for(&dir.0, None).unwrap(),
            GitHistory::default()
        );
    }

    #[test]
    fn git_commit_diff_reads_parent_and_current() {
        let dir = tmp("git-commit-diff");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "update a"]));
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;

        let files = git_commit_files_for(&dir.0, sha).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative, "a.txt");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].path, path_to_js(&dir.0.join("a.txt")));

        let diff = git_commit_file_diff_for(&dir.0, sha, "a.txt").unwrap();
        assert_eq!(diff.original, "alpha\n");
        assert_eq!(diff.current, "beta\n");
        assert_eq!(diff.status, "modified");
        assert_eq!(diff.path, path_to_js(&dir.0.join("a.txt")));
    }

    #[test]
    fn git_commit_diff_root_commit_is_added() {
        let dir = tmp("git-commit-root");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;
        let files = git_commit_files_for(&dir.0, sha).unwrap();
        assert_eq!(files[0].status, "added");
        let diff = git_commit_file_diff_for(&dir.0, sha, "a.txt").unwrap();
        assert_eq!(diff.original, "");
        assert_eq!(diff.current, "alpha\n");
        assert_eq!(diff.status, "added");
    }

    #[test]
    fn git_commit_diff_rejects_bad_sha_and_path() {
        let dir = tmp("git-commit-bad");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git_commit_files_for(&dir.0, "../oops").is_err());
        assert!(git_commit_files_for(&dir.0, "not-hex!").is_err());
        let history = git_history_for(&dir.0, Some(1)).unwrap();
        let sha = &history.commits[0].sha;
        assert!(git_commit_file_diff_for(&dir.0, sha, "../secret.txt").is_err());
    }

    #[test]
    fn git_history_records_merge_parents() {
        let dir = tmp("git-history-merge");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "feature"]));
        std::fs::write(dir.0.join("feat.txt"), "one\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "feature work"]));
        assert!(git(&dir.0, &["checkout", "main"]));
        std::fs::write(dir.0.join("main.txt"), "two\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "main work"]));
        assert!(git(
            &dir.0,
            &["merge", "feature", "--no-ff", "-m", "Merge feature"]
        ));

        let history = git_history_for(&dir.0, Some(20)).unwrap();
        let merge = history
            .commits
            .iter()
            .find(|commit| commit.subject == "Merge feature")
            .unwrap();
        assert_eq!(merge.parents.len(), 2);
    }

    #[test]
    fn git_history_skips_stash_and_unmerged_branches() {
        let dir = tmp("git-history-auto");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert!(git(&dir.0, &["checkout", "-b", "feature"]));
        std::fs::write(dir.0.join("feat.txt"), "one\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "feature only"]));
        std::fs::write(dir.0.join("wip.txt"), "stash me\n").unwrap();
        assert!(git(&dir.0, &["stash", "push", "-u", "-m", "wip stash"]));
        assert!(git(&dir.0, &["checkout", "main"]));
        std::fs::write(dir.0.join("main.txt"), "two\n").unwrap();
        assert!(git(&dir.0, &["add", "."]));
        assert!(git(&dir.0, &["commit", "-m", "main only"]));

        let history = git_history_for(&dir.0, Some(20)).unwrap();
        let subjects: Vec<&str> = history
            .commits
            .iter()
            .map(|commit| commit.subject.as_str())
            .collect();
        assert!(subjects.contains(&"main only"));
        assert!(subjects.contains(&"init"));
        assert!(!subjects.iter().any(|s| s.contains("feature only")));
        assert!(!subjects
            .iter()
            .any(|s| s.contains("wip stash") || s.contains("WIP on")));
        assert!(!history
            .commits
            .iter()
            .any(|commit| commit.refs.iter().any(|r| r.name.contains("stash"))));
    }

    #[test]
    fn git_stage_and_unstage_file() {
        let dir = tmp("git-stage");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        let staged = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(staged.staged);
        assert!(!staged.unstaged);

        git_unstage_file_for(&dir.0, "a.txt").unwrap();
        let unstaged = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(!unstaged.staged);
        assert!(unstaged.unstaged);
    }

    #[test]
    fn git_stage_contents_stages_partial_hunk() {
        let dir = tmp("git-stage-contents");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\nbeta\ngamma\ndelta\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "alpha\nBETA\ngamma\nDELTA\n").unwrap();
        git_stage_contents_for(&dir.0, "a.txt", b"alpha\nBETA\ngamma\ndelta\n").unwrap();

        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(file.staged);
        assert!(file.unstaged);

        let diff = git_file_diff_for(&dir.0, "a.txt", false).unwrap();
        assert_eq!(diff.original, "alpha\nBETA\ngamma\ndelta\n");
        assert_eq!(diff.current, "alpha\nBETA\ngamma\nDELTA\n");
    }

    #[test]
    fn git_discard_restores_tracked_and_deletes_untracked() {
        let dir = tmp("git-discard");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        git_discard_file_for(&dir.0, "a.txt").unwrap();
        git_discard_file_for(&dir.0, "new.txt").unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert!(!dir.0.join("new.txt").exists());
        assert!(git_diff_index_for(&dir.0).files.is_empty());
    }

    #[test]
    fn git_discard_all_restores_unstaged_and_keeps_staged() {
        let dir = tmp("git-discard-all");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n"), ("b.txt", "one\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        std::fs::write(dir.0.join("b.txt"), "two\n").unwrap();
        git_stage_file_for(&dir.0, "b.txt").unwrap();
        std::fs::write(dir.0.join("b.txt"), "three\n").unwrap();
        std::fs::write(dir.0.join("new.txt"), "hello\n").unwrap();

        git_discard_all_for(&dir.0).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "alpha\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("b.txt")).unwrap(),
            "two\n"
        );
        assert!(!dir.0.join("new.txt").exists());
        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "b.txt")
            .unwrap();
        assert!(file.staged);
        assert!(!file.unstaged);
        assert!(git_diff_index_for(&dir.0)
            .files
            .iter()
            .all(|file| !file.unstaged));
    }

    #[test]
    fn git_discard_keeps_staged_hunks() {
        let dir = tmp("git-discard-staged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        std::fs::write(dir.0.join("a.txt"), "gamma\n").unwrap();
        git_discard_file_for(&dir.0, "a.txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "beta\n"
        );
        let file = git_diff_index_for(&dir.0)
            .files
            .into_iter()
            .find(|file| file.relative == "a.txt")
            .unwrap();
        assert!(file.staged);
        assert!(!file.unstaged);
    }

    #[test]
    fn git_commit_clears_staged_files() {
        let dir = tmp("git-commit");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        git_commit_for(&dir.0, "update a").unwrap();
        assert!(git_diff_index_for(&dir.0).files.is_empty());
        assert_eq!(
            git_stdout(&dir.0, &["log", "-1", "--pretty=%s"]).as_deref(),
            Some("update a")
        );
    }

    #[test]
    fn git_commit_rejects_empty_message() {
        let dir = tmp("git-commit-empty");
        assert!(git_commit_for(&dir.0, "   ").is_err());
    }

    #[test]
    fn git_staged_context_reads_cached_diff() {
        let dir = tmp("git-staged-context");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&dir.0, "a.txt").unwrap();
        let context = git_staged_context_for(&dir.0).unwrap();
        assert_eq!(context.branch.as_deref(), Some("main"));
        assert!(context.summary.contains("a.txt"));
        assert!(context.patch.contains("beta"));
    }

    #[test]
    fn git_staged_context_falls_back_to_unstaged() {
        let dir = tmp("git-staged-unstaged");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "gamma\n").unwrap();
        let context = git_staged_context_for(&dir.0).unwrap();
        assert!(context.patch.contains("gamma"));
    }

    #[test]
    fn git_sync_counts_unpushed_commits() {
        let repo = tmp("git-ahead-repo");
        let origin = tmp("git-ahead-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
        {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&repo.0, "a.txt").unwrap();
        git_commit_for(&repo.0, "second").unwrap();
        let index = git_diff_index_for(&repo.0);
        assert_eq!(index.remote.as_deref(), Some("origin"));
        assert_eq!(index.upstream.as_deref(), Some("origin/main"));
        assert_eq!(index.default_branch.as_deref(), Some("main"));
        assert_eq!(index.ahead, 1);
        assert_eq!(index.behind, 0);
        assert_eq!(index.ahead_of_default, 1);
    }

    #[test]
    fn git_sync_counts_feature_branch_without_upstream() {
        let repo = tmp("git-feature-repo");
        let origin = tmp("git-feature-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
            || !git(&repo.0, &["checkout", "-b", "feature"])
        {
            return;
        }
        std::fs::write(repo.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&repo.0, "a.txt").unwrap();
        git_commit_for(&repo.0, "feature work").unwrap();
        let index = git_diff_index_for(&repo.0);
        assert_eq!(index.branch.as_deref(), Some("feature"));
        assert_eq!(index.upstream, None);
        assert_eq!(index.ahead, 1);
        assert_eq!(index.ahead_of_default, 1);
        let range = git_range_context_for(&repo.0).unwrap();
        assert_eq!(range.base, "main");
        assert_eq!(range.head, "feature");
        assert!(range.commit_summary.contains("feature work"));
    }

    #[test]
    fn git_sync_pulls_then_pushes() {
        let origin = tmp("git-sync-origin");
        let a = tmp("git-sync-a");
        let b = tmp("git-sync-b");
        if !init_git_commit(&a.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&a.0, &["remote", "add", "origin", &origin_url])
            || !git(&a.0, &["push", "-u", "origin", "main"])
            || !git(&origin.0, &["symbolic-ref", "HEAD", "refs/heads/main"])
            || Command::new("git")
                .args(["clone", "-b", "main", &origin_url, "."])
                .current_dir(&b.0)
                .status()
                .map(|status| !status.success())
                .unwrap_or(true)
            || !git(&b.0, &["config", "user.name", "Aven"])
            || !git(&b.0, &["config", "user.email", "aven@test"])
            || !git(&b.0, &["config", "commit.gpgsign", "false"])
            || !git(&b.0, &["config", "core.autocrlf", "false"])
            || !git(&b.0, &["checkout", "--", "."])
        {
            return;
        }

        std::fs::write(a.0.join("a.txt"), "beta\n").unwrap();
        git_stage_file_for(&a.0, "a.txt").unwrap();
        git_commit_for(&a.0, "from-a").unwrap();
        git_sync_changes_for(&a.0).unwrap();

        git_sync_changes_for(&b.0).unwrap();
        assert_eq!(
            std::fs::read_to_string(b.0.join("a.txt")).unwrap(),
            "beta\n"
        );
        assert_eq!(git_diff_index_for(&b.0).ahead, 0);
        assert_eq!(git_diff_index_for(&b.0).behind, 0);

        std::fs::write(b.0.join("b.txt"), "from-b\n").unwrap();
        git_stage_file_for(&b.0, "b.txt").unwrap();
        git_commit_for(&b.0, "from-b").unwrap();
        std::fs::write(a.0.join("c.txt"), "from-a-again\n").unwrap();
        git_stage_file_for(&a.0, "c.txt").unwrap();
        git_commit_for(&a.0, "from-a-again").unwrap();
        git_sync_changes_for(&a.0).unwrap();
        git_sync_changes_for(&b.0).unwrap();
        assert!(b.0.join("c.txt").exists());
        git_sync_changes_for(&a.0).unwrap();
        assert!(a.0.join("b.txt").exists());
    }

    #[test]
    fn parse_gh_pr_list_prefers_open() {
        let json = r#"[{"number":2,"title":"Old","url":"https://example.com/2","state":"MERGED"},{"number":3,"title":"Now","url":"https://example.com/3","state":"OPEN"}]"#;
        let pr = parse_gh_pr_list(json).unwrap();
        assert_eq!(pr.number, 3);
        assert_eq!(pr.state, "open");
        assert_eq!(pr.title, "Now");
    }

    #[test]
    fn pr_head_filter_qualifies_branch_with_repo_owner() {
        assert_eq!(
            github_pr_head_filter("acme/aven", "main").as_deref(),
            Some("acme:main")
        );
    }

    #[test]
    fn parse_github_work_items_maps_issue_fields() {
        let json = r#"[{
            "number": 5138,
            "title": "Promo codes fail to apply",
            "url": "https://github.com/acme/web/issues/5138",
            "state": "OPEN",
            "updatedAt": "2026-08-27T08:00:00Z",
            "labels": [{"name": "bug", "color": "d73a4a"}],
            "assignees": [{"login": "maya"}]
        }]"#;
        let items = parse_github_work_items(json, "issue", "acme/web").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "issue");
        assert_eq!(items[0].number, 5138);
        assert_eq!(items[0].state, "open");
        assert_eq!(items[0].repo, "acme/web");
        assert_eq!(items[0].labels[0].name, "bug");
        assert_eq!(items[0].assignees[0].login, "maya");
        assert_eq!(
            items[0].assignees[0].avatar_url,
            "https://avatars.githubusercontent.com/maya?s=64"
        );
        assert!(!items[0].draft);
    }

    #[test]
    fn parse_github_work_items_reads_issue_state_reason() {
        let json = r#"[{
            "number": 42,
            "title": "Ship the fix",
            "url": "https://github.com/acme/web/issues/42",
            "state": "CLOSED",
            "stateReason": "COMPLETED"
        }, {
            "number": 43,
            "title": "Open issue",
            "url": "https://github.com/acme/web/issues/43",
            "state": "OPEN",
            "stateReason": null
        }]"#;
        let items = parse_github_work_items(json, "issue", "acme/web").unwrap();
        assert_eq!(items[0].state, "closed");
        assert_eq!(items[0].state_reason, "completed");
        assert_eq!(
            serde_json::to_value(&items[0]).unwrap()["stateReason"],
            "completed"
        );
        assert_eq!(items[1].state_reason, "");
    }

    #[test]
    fn parse_github_work_items_reads_draft_prs() {
        let json = r#"[{
            "number": 12,
            "title": "WIP checkout",
            "url": "https://github.com/acme/web/pull/12",
            "state": "OPEN",
            "isDraft": true
        }]"#;
        let items = parse_github_work_items(json, "pr", "acme/web").unwrap();
        assert_eq!(items[0].kind, "pr");
        assert!(items[0].draft);
        assert!(items[0].labels.is_empty());
        assert_eq!(items[0].repo, "acme/web");
    }

    #[test]
    fn parse_github_work_item_details_reads_body_and_author() {
        let json = r#"{
            "body": "Steps to reproduce",
            "author": {"login": "maya"}
        }"#;
        let details = parse_github_work_item_details(json).unwrap();
        assert_eq!(details.body, "Steps to reproduce");
        assert_eq!(details.author, "maya");
        assert_eq!(
            details.author_avatar_url,
            "https://avatars.githubusercontent.com/maya?s=64"
        );
        assert_eq!(details.base_ref_name, "");
        assert_eq!(details.review_decision, "");
    }

    #[test]
    fn parse_github_work_item_details_reads_pr_review_meta() {
        let json = r#"{
            "body": "Move the banner",
            "author": {"login": "ayush-porwal"},
            "baseRefName": "main",
            "headRefName": "agent-terminal",
            "reviewDecision": "REVIEW_REQUIRED"
        }"#;
        let details = parse_github_work_item_details(json).unwrap();
        assert_eq!(details.base_ref_name, "main");
        assert_eq!(details.head_ref_name, "agent-terminal");
        assert_eq!(details.review_decision, "REVIEW_REQUIRED");
    }

    #[test]
    fn split_github_repo_reads_owner_and_name() {
        assert_eq!(
            split_github_repo(" acme/aven ").unwrap(),
            ("acme".into(), "aven".into())
        );
        assert!(split_github_repo("aven").is_err());
        assert!(split_github_repo("acme/web extra").is_err());
    }

    #[test]
    fn parse_github_work_item_thread_merges_conversation() {
        let json = r#"{
            "data": {
                "repository": {
                    "pullRequest": {
                        "reviewDecision": "APPROVED",
                        "baseRefName": "main",
                        "headRefName": "agent-terminal",
                        "comments": {
                            "totalCount": 50,
                            "nodes": [
                                {
                                    "id": "IC_1",
                                    "author": {"login": "maya"},
                                    "body": "Looks good",
                                    "createdAt": "2026-08-31T10:00:00Z",
                                    "url": "https://github.com/acme/web/pull/1#issuecomment-1",
                                    "isMinimized": false
                                },
                                {
                                    "id": "IC_hidden",
                                    "author": {"login": "bot"},
                                    "body": "hidden",
                                    "createdAt": "2026-08-31T10:05:00Z",
                                    "isMinimized": true
                                }
                            ]
                        },
                        "reviews": {
                            "totalCount": 2,
                            "nodes": [
                                {
                                    "id": "PRR_empty",
                                    "author": {"login": "ada"},
                                    "body": "",
                                    "state": "COMMENTED",
                                    "submittedAt": "2026-08-31T11:00:00Z"
                                },
                                {
                                    "id": "PRR_2",
                                    "author": {"login": "ada"},
                                    "body": "Ship it",
                                    "state": "APPROVED",
                                    "submittedAt": "2026-08-31T12:00:00Z",
                                    "url": "https://github.com/acme/web/pull/1#pullrequestreview-2"
                                }
                            ]
                        },
                        "reviewThreads": {
                            "totalCount": 1,
                            "nodes": [
                                {
                                    "id": "PRRT_1",
                                    "isResolved": true,
                                    "path": "src/app.ts",
                                    "comments": {
                                        "totalCount": 2,
                                        "nodes": [
                                            {
                                                "id": "PRRC_1",
                                                "author": {"login": "lin"},
                                                "body": "Nit: name",
                                                "createdAt": "2026-08-31T11:30:00Z",
                                                "url": "https://github.com/acme/web/pull/1#discussion_r1",
                                                "path": "src/app.ts",
                                                "line": 12,
                                                "isMinimized": false
                                            },
                                            {
                                                "id": "PRRC_2",
                                                "author": {"login": "maya"},
                                                "body": "Fixed",
                                                "createdAt": "2026-08-31T11:40:00Z",
                                                "path": "src/app.ts",
                                                "line": 12,
                                                "isMinimized": false
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        }"#;
        let thread = parse_github_work_item_thread(json, "pr").unwrap();
        assert!(thread.truncated);
        assert_eq!(thread.review_decision, "APPROVED");
        assert_eq!(thread.base_ref_name, "main");
        assert_eq!(thread.head_ref_name, "agent-terminal");
        assert_eq!(
            thread
                .comments
                .iter()
                .map(|comment| comment.id.as_str())
                .collect::<Vec<_>>(),
            ["IC_1", "PRRC_1", "PRR_2"]
        );
        assert_eq!(thread.comments[1].kind, "review_comment");
        assert_eq!(thread.comments[1].path, "src/app.ts");
        assert_eq!(thread.comments[1].line, Some(12));
        assert_eq!(thread.comments[1].thread_id, "PRRT_1");
        assert!(thread.comments[1].resolved);
        assert_eq!(thread.comments[1].replies.len(), 1);
        assert_eq!(thread.comments[1].replies[0].author, "maya");
        assert_eq!(thread.comments[1].replies[0].thread_id, "PRRT_1");
        assert_eq!(thread.comments[2].kind, "review");
        assert_eq!(thread.comments[2].state, "APPROVED");
    }

    #[test]
    fn parse_github_work_item_thread_reads_issue_comments() {
        let json = r#"{
            "data": {
                "repository": {
                    "issue": {
                        "comments": {
                            "totalCount": 1,
                            "nodes": [
                                {
                                    "id": "IC_9",
                                    "author": {"login": "maya"},
                                    "body": "Still happens",
                                    "createdAt": "2026-08-31T09:00:00Z"
                                }
                            ]
                        }
                    }
                }
            }
        }"#;
        let thread = parse_github_work_item_thread(json, "issue").unwrap();
        assert!(!thread.truncated);
        assert_eq!(thread.comments.len(), 1);
        assert_eq!(thread.comments[0].author, "maya");
        assert_eq!(thread.comments[0].body, "Still happens");
    }

    #[test]
    fn github_comment_input_rejects_empty_or_unknown() {
        assert_eq!(
            github_comment_input("issue", 12, "Looks good").unwrap(),
            ("issue", "Looks good")
        );
        assert!(github_comment_input("issue", 12, "  ").is_err());
        assert!(github_comment_input("gist", 12, "Hi").is_err());
        assert!(github_comment_input("pr", 0, "Hi").is_err());
    }

    #[test]
    fn valid_github_node_id_allows_graphql_ids() {
        assert!(valid_github_node_id("PRRT_kwDOBQfyJc5nX8x-"));
        assert!(valid_github_node_id("IC_kwDOA=="));
        assert!(!valid_github_node_id(""));
        assert!(!valid_github_node_id("thread id"));
        assert!(!valid_github_node_id("id\nPRRT_1"));
    }

    #[test]
    fn github_url_from_output_reads_the_last_http_line() {
        assert_eq!(
            github_url_from_output(
                "Posted\nhttps://github.com/acme/web/issues/1#issuecomment-9\n",
                "missing"
            )
            .unwrap(),
            "https://github.com/acme/web/issues/1#issuecomment-9"
        );
        assert_eq!(
            github_url_from_output("", "GitHub did not return a comment URL").unwrap_err(),
            "GitHub did not return a comment URL"
        );
    }

    #[test]
    fn parse_github_review_reply_url_reads_graphql() {
        let json = r#"{
            "data": {
                "addPullRequestReviewThreadReply": {
                    "comment": { "url": "https://github.com/acme/web/pull/1#discussion_r9" }
                }
            }
        }"#;
        assert_eq!(
            parse_github_review_reply_url(json).unwrap(),
            "https://github.com/acme/web/pull/1#discussion_r9"
        );
        let error = parse_github_review_reply_url(
            r#"{"data":null,"errors":[{"message":"Could not resolve to a node"}]}"#,
        )
        .unwrap_err();
        assert!(error.contains("Could not resolve to a node"));
    }

    #[test]
    fn parse_github_work_item_thread_reads_graphql_errors() {
        let json = r#"{
            "data": {"repository": null},
            "errors": [{"message": "Could not resolve to a Repository"}]
        }"#;
        let error = parse_github_work_item_thread(json, "pr").unwrap_err();
        assert!(error.contains("Could not resolve to a Repository"));
    }

    #[test]
    fn github_avatar_url_encodes_bot_logins() {
        assert_eq!(
            github_avatar_url("dependabot[bot]"),
            "https://avatars.githubusercontent.com/dependabot%5Bbot%5D?s=64"
        );
        assert_eq!(github_avatar_url("  "), "");
    }

    #[test]
    fn parse_github_pr_diff_meta_reads_files_and_totals() {
        let json = r#"{
            "additions": 971,
            "deletions": 225,
            "files": [
                {"path": "next.config.ts", "additions": 4, "deletions": 0},
                {"path": "package.json", "additions": 2, "deletions": 2}
            ]
        }"#;
        let diff = parse_github_pr_diff_meta(json).unwrap();
        assert_eq!(diff.additions, 971);
        assert_eq!(diff.deletions, 225);
        assert_eq!(diff.files.len(), 2);
        assert_eq!(diff.files[0].path, "next.config.ts");
        assert_eq!(diff.files[0].additions, 4);
        assert_eq!(diff.patch, "");
        assert!(!diff.truncated);
    }

    #[test]
    fn git_stage_rejects_path_escape() {
        let dir = tmp("git-stage-escape");
        assert!(git_stage_file_for(&dir.0, "../secret.txt").is_err());
        assert!(git_discard_file_for(&dir.0, "../secret.txt").is_err());
    }

    #[test]
    fn git_branches_empty_outside_a_repo() {
        let dir = tmp("git-branches-none");
        std::fs::write(dir.0.join("notes.txt"), "hello\n").unwrap();
        assert_eq!(git_branches_for(&dir.0), GitBranches::default());
    }

    #[test]
    fn git_branches_lists_unborn_head() {
        let dir = tmp("git-branches-unborn");
        if !init_git(&dir.0, "main", None) {
            return;
        }
        let listed = git_branches_for(&dir.0);
        assert_eq!(listed.current.as_deref(), Some("main"));
        assert!(!listed.detached);
        assert!(listed
            .branches
            .iter()
            .any(|branch| { branch.name == "main" && branch.current && branch.remote.is_none() }));
    }

    #[test]
    fn git_create_and_checkout_branch() {
        let dir = tmp("git-branch-switch");
        if !init_git_commit(&dir.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        assert_eq!(
            git_create_branch_for(&dir.0, "feat/picker").unwrap(),
            "feat/picker"
        );
        let listed = git_branches_for(&dir.0);
        assert_eq!(listed.current.as_deref(), Some("feat/picker"));
        assert_eq!(git_checkout_for(&dir.0, "main", None).unwrap(), "main");
        assert_eq!(git_head_branch(&dir.0).as_deref(), Some("main"));
        assert!(git_create_branch_for(&dir.0, "feat/picker").is_err());
        assert!(git_create_branch_for(&dir.0, "bad name").is_err());
        assert!(git_checkout_for(&dir.0, "missing", None).is_err());
    }

    #[test]
    fn git_stash_lets_checkout_proceed() {
        let dir = tmp("git-stash-checkout");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "feature"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "dirty\n").unwrap();
        let err = git_checkout_for(&dir.0, "feature", None).unwrap_err();
        assert!(checkout_blocked_by_changes(&err), "{err}");
        git_stash_for(&dir.0, Some("wip")).unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "feature\n"
        );
    }

    #[test]
    fn git_stash_includes_untracked_that_block_checkout() {
        let dir = tmp("git-stash-untracked");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "on-feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "add new"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("new.txt"), "untracked\n").unwrap();
        let err = git_checkout_for(&dir.0, "feature", None).unwrap_err();
        assert!(checkout_blocked_by_changes(&err), "{err}");
        git_stash_for(&dir.0, None).unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("new.txt")).unwrap(),
            "on-feature\n"
        );
    }

    #[test]
    fn git_commit_lets_checkout_proceed() {
        let dir = tmp("git-commit-checkout");
        if !init_git_commit(&dir.0, &[("a.txt", "main\n")]) {
            return;
        }
        if git_create_branch_for(&dir.0, "feature").is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "feature\n").unwrap();
        if !git(&dir.0, &["add", "."]) || !git(&dir.0, &["commit", "-m", "feature"]) {
            return;
        }
        if git_checkout_for(&dir.0, "main", None).is_err() {
            return;
        }
        std::fs::write(dir.0.join("a.txt"), "dirty\n").unwrap();
        git_checked(&dir.0, &["add", "-A", "--", "."]).unwrap();
        git_commit_for(&dir.0, "save dirty").unwrap();
        assert_eq!(
            git_checkout_for(&dir.0, "feature", None).unwrap(),
            "feature"
        );
        assert_eq!(
            std::fs::read_to_string(dir.0.join("a.txt")).unwrap(),
            "feature\n"
        );
    }

    #[test]
    fn git_branches_lists_remote_only_branch() {
        let repo = tmp("git-branch-remote-repo");
        let origin = tmp("git-branch-remote-origin");
        if !init_git_commit(&repo.0, &[("a.txt", "alpha\n")]) {
            return;
        }
        if Command::new("git")
            .args(["init", "--bare"])
            .current_dir(&origin.0)
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let origin_url = origin.0.to_string_lossy().into_owned();
        if !git(&repo.0, &["remote", "add", "origin", &origin_url])
            || !git(&repo.0, &["push", "-u", "origin", "main"])
            || git_create_branch_for(&repo.0, "feature").is_err()
            || !git(&repo.0, &["push", "-u", "origin", "feature"])
            || git_checkout_for(&repo.0, "main", None).is_err()
            || !git(&repo.0, &["branch", "-D", "feature"])
        {
            return;
        }
        let listed = git_branches_for(&repo.0);
        assert_eq!(listed.current.as_deref(), Some("main"));
        let remote = listed
            .branches
            .iter()
            .find(|branch| branch.name == "feature")
            .unwrap();
        assert_eq!(remote.remote.as_deref(), Some("origin"));
        assert!(!listed
            .branches
            .iter()
            .any(|branch| branch.name == "main" && branch.remote.is_some()));
        assert_eq!(
            git_checkout_for(&repo.0, "feature", Some("origin")).unwrap(),
            "feature"
        );
        assert_eq!(git_head_branch(&repo.0).as_deref(), Some("feature"));
    }
}
