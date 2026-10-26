//! A project's bot works in one git copy (worktree) of the project, kept
//! under the app data `bots/` directory on an `aven/bot/*` branch, never in
//! the user's folder.
//!
//! Unlike a race lane, the copy is kept between jobs, so the dependencies an
//! agent installed there (`node_modules` and other git-ignored folders)
//! survive. Before each job it is synced to what the user sees: the base is
//! the project's HEAD plus its uncommitted tracked changes (`git stash
//! create`, as a race starts from), checked out with `--force` and cleaned
//! with `git clean -fd`, never `-x`, so ignored folders stay. Reading the
//! bot's changes, applying them to the user's files and removing the copy go
//! through the race code (see `race.rs`), which never stages into the copy's
//! own index.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::race::{self, RaceDiff, RaceFileDiff, RaceLane};

const BRANCH_PREFIX: &str = "aven/bot/";
const WHO: &str = "A bot";

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCopy {
    pub path: String,
    pub branch: String,
    /// The project's repository root.
    pub root: String,
    /// The repository's shared git folder (usually `<root>/.git`): the copy
    /// shares its branches and other refs with the user's checkout.
    pub git_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotSync {
    pub root: String,
    /// The commit the copy now matches.
    pub base: String,
    /// The base includes the project's uncommitted changes.
    pub uncommitted: bool,
    /// Untracked project files exist; the copy does not have them.
    pub untracked: bool,
}

/// What the bot changed, and a fingerprint of exactly those changes: the
/// fix the user reviews is the fix that is applied (see `apply`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotDiff {
    #[serde(flatten)]
    pub changes: RaceDiff,
    pub hash: String,
}

/// A branch Aven made for a bot: `aven/bot/` and a short lowercase slug.
fn valid_branch(branch: &str) -> bool {
    branch.strip_prefix(BRANCH_PREFIX).is_some_and(|slug| {
        !slug.is_empty()
            && slug.len() <= 48
            && !slug.starts_with('-')
            && !slug.ends_with('-')
            && slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

/// FNV-1a: a stable, dependency-free name for a project's copy folder.
fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// The copy's folder name: the project's folder name, made safe, and a hash
/// of its key, so two projects with one name get two copies.
fn copy_dir_name(key: &str) -> String {
    let key = match key.trim_end_matches(['/', '\\']) {
        "" => key,
        trimmed => trimmed,
    };
    let base = key.rsplit(['/', '\\']).next().unwrap_or("");
    let mut slug: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    slug.truncate(32);
    let slug = slug.trim_end_matches('-');
    let hash = fnv1a(key);
    if slug.is_empty() {
        format!("project-{hash:016x}")
    } else {
        format!("{slug}-{hash:016x}")
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canonical = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.into());
    canonical(a) == canonical(b)
}

/// Whether git lists `path` among the repository's worktrees.
fn registered_worktree(root: &Path, path: &Path) -> bool {
    let Ok(listing) = race::run(root, &["worktree", "list", "--porcelain"]) else {
        return false;
    };
    String::from_utf8_lossy(&listing)
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .any(|listed| same_path(Path::new(listed), path))
}

/// A bot's copy: a folder directly inside `bots`, and (when it exists) the
/// top of its own git checkout, so git never acts on a repository above it.
fn copy_path(bots: &Path, value: &str) -> Result<PathBuf, String> {
    let path = race::lane_path(bots, value)?;
    if path.parent() != Some(bots) {
        return Err("Not one of Aven's copies".into());
    }
    Ok(path)
}

/// Refuse a copy that is not a git checkout of its own (its `.git` file was
/// lost, say): git would otherwise act on a repository further up.
fn checked_copy(bots: &Path, value: &str) -> Result<PathBuf, String> {
    let path = copy_path(bots, value)?;
    let top = race::text(
        race::run(&path, &["rev-parse", "--show-toplevel"])
            .map_err(|_| "The bot's copy is missing. Turn the bot off and on again.".to_string())?,
    );
    if !same_path(Path::new(&top), &path) {
        return Err("The bot's copy is missing. Turn the bot off and on again.".into());
    }
    Ok(path)
}

fn repo_root(cwd: &Path) -> Result<PathBuf, String> {
    let root = race::text(
        race::run(cwd, &["rev-parse", "--show-toplevel"])
            .map_err(|_| format!("{WHO} needs a git repository."))?,
    );
    let root = PathBuf::from(root);
    race::run(&root, &["rev-parse", "--verify", "HEAD"])
        .map_err(|_| format!("{WHO} needs at least one commit in this repository."))?;
    Ok(root)
}

/// The bot's copy of the project at `cwd`, made when missing (or when git
/// no longer knows the folder). An existing copy is left exactly as it is.
pub fn ensure_copy(cwd: &Path, bots: &Path, key: &str, branch: &str) -> Result<BotCopy, String> {
    if key.trim().is_empty() || key.len() > 4096 || !valid_branch(branch) {
        return Err("Invalid bot request".into());
    }
    let root = repo_root(cwd)?;
    let path = bots.join(copy_dir_name(key));
    let path_text = path.to_string_lossy().to_string();
    let common = PathBuf::from(race::text(race::run(
        &root,
        &["rev-parse", "--git-common-dir"],
    )?));
    let git_dir = if common.is_absolute() {
        common
    } else {
        root.join(common)
    };
    let copy = BotCopy {
        path: path_text.clone(),
        branch: branch.to_string(),
        root: root.to_string_lossy().to_string(),
        git_dir: git_dir.to_string_lossy().to_string(),
    };
    if path.is_dir() && registered_worktree(&root, &path) {
        return Ok(copy);
    }
    // A folder git forgot (the project moved, a prune) is made again.
    if path.exists() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Could not replace the bot's old copy: {e}"))?;
    }
    let _ = race::run(&root, &["worktree", "prune"]);
    std::fs::create_dir_all(bots).map_err(|e| format!("Could not create the bot's copy: {e}"))?;
    race::run(
        &root,
        &[
            "worktree", "add", "--quiet", "-B", branch, &path_text, "HEAD",
        ],
    )
    .map_err(|e| format!("Could not create the bot's copy: {e}"))?;
    Ok(copy)
}

/// Bring the copy to the user's current state. Tracked files match the base
/// exactly; untracked files that git does not ignore are removed; ignored
/// folders such as installed dependencies stay.
pub fn sync(cwd: &Path, bots: &Path, copy: &str, branch: &str) -> Result<BotSync, String> {
    if !valid_branch(branch) {
        return Err("Invalid bot request".into());
    }
    let copy = checked_copy(bots, copy)?;
    let base = race::prepare_for(cwd, WHO)?;
    reset_to(&copy, &base.base, branch)?;
    Ok(BotSync {
        root: base.root,
        base: base.base,
        uncommitted: base.uncommitted,
        untracked: base.untracked,
    })
}

fn reset_to(copy: &Path, base: &str, branch: &str) -> Result<(), String> {
    if !race::is_sha(base) {
        return Err("Invalid bot base".into());
    }
    // The project's own hooks (post-checkout and the like) are not run for
    // Aven's bookkeeping in the copy.
    race::run(
        copy,
        &[
            "-c",
            "core.hooksPath=/dev/null",
            "checkout",
            "--quiet",
            "--force",
            "-B",
            branch,
            base,
        ],
    )
    .map_err(|e| format!("Could not update the bot's copy: {e}"))?;
    race::run(copy, &["clean", "-f", "-d", "--quiet"])
        .map_err(|e| format!("Could not tidy the bot's copy: {e}"))?;
    Ok(())
}

/// Throw the bot's changes away: the copy goes back to `base`.
pub fn discard(bots: &Path, copy: &str, base: &str, branch: &str) -> Result<(), String> {
    if !valid_branch(branch) {
        return Err("Invalid bot request".into());
    }
    reset_to(&checked_copy(bots, copy)?, base, branch)
}

fn patch_hash(patch: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in patch {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}-{}", patch.len())
}

/// What the bot changed in its copy since `base`.
pub fn diff(bots: &Path, copy: &str, base: &str) -> Result<BotDiff, String> {
    let worktree = checked_copy(bots, copy)?;
    let changes = race::diff(&worktree, base)?;
    let hash = patch_hash(&race::patch(&worktree, base)?);
    Ok(BotDiff { changes, hash })
}

pub fn file_diff(bots: &Path, copy: &str, base: &str, path: &str) -> Result<RaceFileDiff, String> {
    race::file_diff(&checked_copy(bots, copy)?, base, path)
}

/// Apply what the bot changed onto the user's working tree, only when it is
/// exactly the fix the user reviewed (`hash`, from `diff`). The patch is
/// checked first, so a conflict changes nothing and the fix stays in the
/// copy.
pub fn apply(
    cwd: &Path,
    bots: &Path,
    copy: &str,
    base: &str,
    hash: &str,
) -> Result<RaceDiff, String> {
    let root = repo_root(cwd)?;
    let worktree = checked_copy(bots, copy)?;
    let changes = race::diff(&worktree, base)?;
    if changes.files.is_empty() {
        return Err("The bot's copy has no changes to apply.".into());
    }
    let patch = race::patch(&worktree, base)?;
    if patch_hash(&patch) != hash {
        return Err(FIX_CHANGED.into());
    }
    race::apply_patch(&root, &patch)?;
    Ok(changes)
}

/// Said when the copy no longer holds the fix the user reviewed.
const FIX_CHANGED: &str = "The fix changed since you looked.";

/// Remove the copy and its branch.
pub fn remove(cwd: &Path, bots: &Path, copy: &str, branch: &str) -> Result<(), String> {
    if !valid_branch(branch) {
        return Err("Invalid bot request".into());
    }
    let path = copy_path(bots, copy)?;
    // A deleted or moved project folder still has its copy removed, without
    // git, which would otherwise act on whatever repository is above it.
    let Ok(root) = repo_root(cwd) else {
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Could not remove the bot's copy: {e}"))?;
        }
        return Ok(());
    };
    race::remove_copies(
        &root,
        bots,
        BRANCH_PREFIX,
        &[RaceLane {
            path: copy.to_string(),
            branch: branch.to_string(),
        }],
    )
}

fn bots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bots"))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Whether a folder can have a bot: a git repository with a commit. Says
/// why not, in the same words turning a bot on would.
#[tauri::command]
pub async fn bot_project_ready(cwd: String) -> Result<(), String> {
    blocking(move || repo_root(&crate::fs::expand_home(&cwd)).map(|_| ())).await
}

#[tauri::command]
pub async fn bot_copy_prepare(
    app: AppHandle,
    cwd: String,
    key: String,
    branch: String,
) -> Result<BotCopy, String> {
    let bots = bots_dir(&app)?;
    blocking(move || ensure_copy(&crate::fs::expand_home(&cwd), &bots, &key, &branch)).await
}

#[tauri::command]
pub async fn bot_copy_sync(
    app: AppHandle,
    cwd: String,
    copy: String,
    branch: String,
) -> Result<BotSync, String> {
    let bots = bots_dir(&app)?;
    blocking(move || sync(&crate::fs::expand_home(&cwd), &bots, &copy, &branch)).await
}

#[tauri::command]
pub async fn bot_copy_diff(app: AppHandle, copy: String, base: String) -> Result<BotDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || diff(&bots, &copy, &base)).await
}

#[tauri::command]
pub async fn bot_copy_file_diff(
    app: AppHandle,
    copy: String,
    base: String,
    path: String,
) -> Result<RaceFileDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || file_diff(&bots, &copy, &base, &path)).await
}

#[tauri::command]
pub async fn bot_copy_apply(
    app: AppHandle,
    cwd: String,
    copy: String,
    base: String,
    hash: String,
) -> Result<RaceDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || apply(&crate::fs::expand_home(&cwd), &bots, &copy, &base, &hash)).await
}

#[tauri::command]
pub async fn bot_copy_discard(
    app: AppHandle,
    copy: String,
    base: String,
    branch: String,
) -> Result<(), String> {
    let bots = bots_dir(&app)?;
    blocking(move || discard(&bots, &copy, &base, &branch)).await
}

#[tauri::command]
pub async fn bot_copy_remove(
    app: AppHandle,
    cwd: String,
    copy: String,
    branch: String,
) -> Result<(), String> {
    let bots = bots_dir(&app)?;
    blocking(move || remove(&crate::fs::expand_home(&cwd), &bots, &copy, &branch)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("aven-bot-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // Canonical, so paths git reports compare equal on macOS (/private/var).
        std::fs::canonicalize(&dir).unwrap()
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn git_ok(dir: &Path, args: &[&str]) {
        race::run(dir, args).unwrap_or_else(|e| panic!("git {args:?}: {e}"));
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn repo() -> PathBuf {
        let root = temp_dir("repo");
        git_ok(&root, &["init", "-q", "-b", "main"]);
        git_ok(&root, &["config", "user.email", "test@example.com"]);
        git_ok(&root, &["config", "user.name", "Test"]);
        git_ok(&root, &["config", "core.autocrlf", "false"]);
        git_ok(&root, &["config", "commit.gpgsign", "false"]);
        std::fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("b.txt"), "keep\n").unwrap();
        git_ok(&root, &["add", "-A"]);
        git_ok(&root, &["commit", "-q", "-m", "init"]);
        root
    }

    const BRANCH: &str = "aven/bot/jelly";

    // Bots are not offered on Windows (Claude Code's sandbox does not run
    // there), and these drive real worktrees through canonical macOS paths.
    #[cfg(not(windows))]
    #[test]
    fn keeps_one_copy_synced_to_what_the_user_sees() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        assert!(copy_path.starts_with(&bots));
        assert_eq!(copy.branch, BRANCH);
        assert_eq!(PathBuf::from(&copy.git_dir), root.join(".git"));
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\n");

        // The bot installed dependencies and left a stray file and an edit.
        std::fs::create_dir_all(copy_path.join("node_modules/pkg")).unwrap();
        std::fs::write(copy_path.join("node_modules/pkg/index.js"), "x\n").unwrap();
        std::fs::write(copy_path.join("stray.txt"), "old job\n").unwrap();
        std::fs::write(copy_path.join("b.txt"), "bot edit\n").unwrap();
        // Asking again keeps the same copy, untouched.
        assert_eq!(ensure_copy(&root, &bots, &key, BRANCH).unwrap(), copy);
        assert_eq!(read(&copy_path.join("b.txt")), "bot edit\n");

        // The user has uncommitted work; the copy starts from it. Their own
        // git is busy meanwhile (its index is locked): the sync never needs
        // that lock, and leaves it alone.
        std::fs::write(root.join("a.txt"), "one\ntwo\nmine\n").unwrap();
        let lock = root.join(".git/index.lock");
        std::fs::write(&lock, "").unwrap();
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        assert!(lock.is_file());
        std::fs::remove_file(&lock).unwrap();
        assert!(synced.uncommitted);
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\nmine\n");
        assert_eq!(read(&copy_path.join("b.txt")), "keep\n");
        assert!(!copy_path.join("stray.txt").exists());
        // Installed dependencies survive the sync.
        assert!(copy_path.join("node_modules/pkg/index.js").is_file());
        assert!(diff(&bots, &copy.path, &synced.base)
            .unwrap()
            .changes
            .files
            .is_empty());
        // The user's folder never changed.
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\nmine\n");
        assert_eq!(read(&root.join("b.txt")), "keep\n");

        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        assert!(!copy_path.exists());
        let branches = race::text(race::run(&root, &["branch", "--list", "aven/bot/*"]).unwrap());
        assert!(branches.is_empty(), "{branches}");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    // Bots are not offered on Windows (Claude Code's sandbox does not run
    // there), and these drive real worktrees through canonical macOS paths.
    #[cfg(not(windows))]
    #[test]
    fn reads_applies_and_throws_away_a_fix() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        assert!(!synced.uncommitted);

        std::fs::write(copy_path.join("a.txt"), "one\ntwo\nfixed\n").unwrap();
        std::fs::write(copy_path.join("new.txt"), "fresh\n").unwrap();
        let reviewed = diff(&bots, &copy.path, &synced.base).unwrap();
        let changes = &reviewed.changes;
        let mut files: Vec<_> = changes
            .files
            .iter()
            .map(|file| (file.path.as_str(), file.status.as_str()))
            .collect();
        files.sort();
        assert_eq!(files, vec![("a.txt", "modified"), ("new.txt", "added")]);
        assert_eq!(changes.additions, 2);
        let shown = file_diff(&bots, &copy.path, &synced.base, "a.txt").unwrap();
        assert_eq!(shown.original.as_deref(), Some("one\ntwo\n"));
        assert_eq!(shown.current.as_deref(), Some("one\ntwo\nfixed\n"));
        // Nothing reached the user's folder before Apply.
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\n");
        assert!(!root.join("new.txt").exists());

        // A change after the user looked is never applied unseen, even one
        // with the same files and line counts.
        std::fs::write(copy_path.join("a.txt"), "one\ntwo\nFIXED\n").unwrap();
        let later = diff(&bots, &copy.path, &synced.base).unwrap();
        assert_eq!(later.changes.additions, reviewed.changes.additions);
        assert_ne!(later.hash, reviewed.hash);
        let error = apply(&root, &bots, &copy.path, &synced.base, &reviewed.hash).unwrap_err();
        assert_eq!(error, FIX_CHANGED);
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\n");
        std::fs::write(copy_path.join("a.txt"), "one\ntwo\nfixed\n").unwrap();

        let applied = apply(&root, &bots, &copy.path, &synced.base, &reviewed.hash).unwrap();
        assert_eq!(applied.files.len(), 2);
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\nfixed\n");
        assert_eq!(read(&root.join("new.txt")), "fresh\n");

        // Throw away: the copy goes back to the base.
        discard(&bots, &copy.path, &synced.base, BRANCH).unwrap();
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\n");
        assert!(!copy_path.join("new.txt").exists());
        assert!(diff(&bots, &copy.path, &synced.base)
            .unwrap()
            .changes
            .files
            .is_empty());

        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    // Bots are not offered on Windows (Claude Code's sandbox does not run
    // there), and these drive real worktrees through canonical macOS paths.
    #[cfg(not(windows))]
    #[test]
    fn a_conflicting_apply_changes_nothing_and_keeps_the_fix() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        std::fs::write(copy_path.join("a.txt"), "bot\n").unwrap();
        std::fs::write(copy_path.join("b.txt"), "bot b\n").unwrap();
        // The user edited a.txt after the bot's copy was synced.
        std::fs::write(root.join("a.txt"), "user\n").unwrap();
        let hash = diff(&bots, &copy.path, &synced.base).unwrap().hash;
        let error = apply(&root, &bots, &copy.path, &synced.base, &hash).unwrap_err();
        assert!(error.contains("conflict"), "{error}");
        assert_eq!(read(&root.join("a.txt")), "user\n");
        assert_eq!(read(&root.join("b.txt")), "keep\n");
        // The fix is still there to try again.
        assert_eq!(
            diff(&bots, &copy.path, &synced.base)
                .unwrap()
                .changes
                .files
                .len(),
            2
        );
        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    // Bots are not offered on Windows (Claude Code's sandbox does not run
    // there), and these drive real worktrees through canonical macOS paths.
    #[cfg(not(windows))]
    #[test]
    fn makes_a_forgotten_copy_again() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        // Something deleted the folder behind git's back.
        std::fs::remove_dir_all(&copy_path).unwrap();
        let again = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        assert_eq!(again, copy);
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\n");
        // A leftover folder git never knew is replaced too.
        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        std::fs::create_dir_all(&copy_path).unwrap();
        std::fs::write(copy_path.join("junk.txt"), "x").unwrap();
        ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        assert!(!copy_path.join("junk.txt").exists());
        assert!(copy_path.join("a.txt").is_file());
        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    #[test]
    fn refuses_folders_that_are_not_projects_and_bad_input() {
        let plain = temp_dir("plain");
        let bots = temp_dir("bots");
        let key = plain.to_string_lossy().to_string();
        let error = ensure_copy(&plain, &bots, &key, BRANCH).unwrap_err();
        assert!(error.contains("git repository"), "{error}");
        git_ok(&plain, &["init", "-q"]);
        let error = ensure_copy(&plain, &bots, &key, BRANCH).unwrap_err();
        assert!(error.contains("commit"), "{error}");

        assert!(ensure_copy(&plain, &bots, &key, "main").is_err());
        assert!(ensure_copy(&plain, &bots, &key, "aven/bot/../x").is_err());
        assert!(ensure_copy(&plain, &bots, &key, "aven/bot/Jelly").is_err());
        assert!(sync(&plain, &bots, "/etc", BRANCH).is_err());
        assert!(diff(&bots, &bots.to_string_lossy(), &"a".repeat(40)).is_err());
        assert!(diff(&bots, &format!("{}/../x", bots.display()), &"a".repeat(40)).is_err());
        assert!(discard(&bots, "/tmp/elsewhere", &"a".repeat(40), BRANCH).is_err());
        // Only a folder directly inside bots/, and only a checkout of its own.
        let nested = bots.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(diff(&bots, &nested.to_string_lossy(), &"a".repeat(40)).is_err());
        let loose = bots.join("loose");
        std::fs::create_dir_all(&loose).unwrap();
        let error = sync(&plain, &bots, &loose.to_string_lossy(), BRANCH).unwrap_err();
        assert!(error.contains("missing"), "{error}");
        let _ = std::fs::remove_dir_all(&plain);
        let _ = std::fs::remove_dir_all(&bots);
    }

    #[test]
    fn names_copies_by_project() {
        let a = copy_dir_name("/Users/me/Orbit");
        let b = copy_dir_name("/Users/someone/Orbit");
        assert!(a.starts_with("orbit-"), "{a}");
        assert_ne!(a, b);
        assert_eq!(a, copy_dir_name("/Users/me/Orbit/"));
        assert!(copy_dir_name("/").starts_with("project-"));
        assert!(copy_dir_name("/x/Héllo Wörld!").starts_with("h-llo-w-rld-"));
        assert!(valid_branch("aven/bot/jelly-2"));
        assert!(!valid_branch("aven/race/x"));
        assert!(!valid_branch("aven/bot/"));
    }
}
