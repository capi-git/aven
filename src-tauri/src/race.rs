//! Race: one prompt, several agents, each in its own git worktree.
//!
//! A race starts from a base commit. When the project has uncommitted
//! changes to tracked files, `git stash create` records them as a commit
//! without touching the working tree, so every lane starts from exactly
//! what the user sees. Lanes live under the app data `races/` directory on
//! `aven/race/*` branches; nothing is written inside the project itself.
//! Keeping a result applies each lane's diff against that base to the
//! project's working tree; cleanup removes the worktrees and branches.
//!
//! Reading a lane never stages anything in it. New files only show up in a
//! diff once they are in an index, so each read stages into a scratch copy
//! of the lane's index (`GIT_INDEX_FILE`); the agent's own index stays as it
//! left it, and its `git diff` and `git add` see exactly what they would
//! without Aven.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const BRANCH_PREFIX: &str = "aven/race/";
const MAX_LANES: u8 = 4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceBase {
    pub root: String,
    pub base: String,
    /// The base includes uncommitted changes to tracked files.
    pub uncommitted: bool,
    /// Untracked files exist in the project; lanes will not see them.
    pub untracked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RaceLane {
    pub path: String,
    pub branch: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaceFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    /// Its git mode before and after ("100644", "100755", "120000" for a
    /// link), "000000" where it didn't exist.
    pub old_mode: String,
    pub new_mode: String,
    /// What a link points at, when it is one after the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_target: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceDiff {
    pub files: Vec<RaceFile>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceFileDiff {
    pub original: Option<String>,
    pub current: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceChoice {
    pub worktree: String,
    pub paths: Vec<String>,
}

/// Settings that keep Aven's own git commands from running anything a
/// checkout's configuration names: no file-system monitor, no hooks and no
/// fetching through any transport (diffs also pass `--no-ext-diff` and
/// `--no-textconv`). A bot's
/// copy is written by an agent, so its configuration is never trusted.
pub(crate) const SAFE_GIT: &[&str] = &[
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "protocol.allow=never",
];

pub(crate) fn git(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    crate::hide_window_console(&mut cmd);
    cmd.arg("--no-pager")
        .args(SAFE_GIT)
        .arg("-C")
        .arg(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

pub(crate) fn run(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    run_with_input(dir, args, None)
}

fn run_with_input(dir: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    run_git(git(dir), args, input)
}

/// Like `run`, staging into `index` instead of the checkout's own index.
fn run_staged(dir: &Path, index: &ScratchIndex, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = git(dir);
    cmd.env("GIT_INDEX_FILE", &index.0);
    run_git(cmd, args, None)
}

fn run_git(mut cmd: Command, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut child = cmd
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run git: {e}"))?;
    if let (Some(bytes), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(bytes).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git {} failed", args.join(" "))
    } else {
        stderr
    })
}

pub(crate) fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// A throwaway copy of a lane's index, removed when dropped. Seeding it from
/// the lane's own index keeps what the agent staged (a `git rm`, say) and
/// lets `git add -A` reuse its cached file stats.
struct ScratchIndex(PathBuf);

impl ScratchIndex {
    /// A scratch index with nothing in it yet.
    fn empty() -> Self {
        Self(std::env::temp_dir().join(format!("aven-race-index-{}", uuid::Uuid::new_v4())))
    }

    fn seeded_from(worktree: &Path) -> Result<Self, String> {
        let reported = text(run(worktree, &["rev-parse", "--git-path", "index"])?);
        let own = if Path::new(&reported).is_absolute() {
            PathBuf::from(&reported)
        } else {
            worktree.join(&reported)
        };
        // Owned before the copy, so a copy that fails part-way is removed too.
        let scratch =
            Self(std::env::temp_dir().join(format!("aven-race-index-{}", uuid::Uuid::new_v4())));
        // Git replaces an index by renaming a finished file over it, so this
        // copy is never half-written even while the agent runs git.
        if own.is_file() {
            std::fs::copy(&own, &scratch.0)
                .map_err(|e| format!("Could not read the race copy's changes: {e}"))?;
        }
        Ok(scratch)
    }
}

impl Drop for ScratchIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        let mut lock = self.0.clone().into_os_string();
        lock.push(".lock");
        let _ = std::fs::remove_file(PathBuf::from(lock));
    }
}

pub(crate) fn is_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_race_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Only paths inside one of the app's copy directories (`races/`, `bots/`)
/// are ever touched.
pub(crate) fn lane_path(races: &Path, value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let inside = path.is_absolute()
        && path.starts_with(races)
        && path != races
        && path
            .components()
            .all(|part| !matches!(part, std::path::Component::ParentDir));
    if inside {
        Ok(path)
    } else {
        Err("Not one of Aven's copies".into())
    }
}

fn clean_relative(value: &str) -> Result<String, String> {
    let value = value.replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || Path::new(&value).components().any(|part| {
            matches!(
                part,
                std::path::Component::Prefix(_) | std::path::Component::RootDir
            )
        })
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("Invalid path: {value}"));
    }
    Ok(value)
}

pub fn prepare(cwd: &Path) -> Result<RaceBase, String> {
    prepare_for(cwd, "Race")
}

/// The commit a copy starts from: the project's HEAD, or with uncommitted
/// changes to tracked files, a commit of exactly what the user sees.
/// `who` names the feature in the errors ("Race", "A bot").
pub(crate) fn prepare_for(cwd: &Path, who: &str) -> Result<RaceBase, String> {
    let root = text(
        run(cwd, &["rev-parse", "--show-toplevel"])
            .map_err(|_| format!("{who} needs a git repository."))?,
    );
    let root_path = PathBuf::from(&root);
    let head = text(
        run(&root_path, &["rev-parse", "--verify", "HEAD"])
            .map_err(|_| format!("{who} needs at least one commit in this repository."))?,
    );
    // `git stash create` refreshes and writes the index it reads, taking its
    // lock: it reads a copy, so the user's own git never finds it locked.
    let index = ScratchIndex::seeded_from(&root_path)?;
    let stash = text(run_staged(&root_path, &index, &["stash", "create"])?);
    let untracked = !run(
        &root_path,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--directory",
            "--no-empty-directory",
        ],
    )?
    .is_empty();
    let uncommitted = is_sha(&stash);
    Ok(RaceBase {
        root,
        base: if uncommitted { stash } else { head },
        uncommitted,
        untracked,
    })
}

pub fn create_lane(
    root: &Path,
    races: &Path,
    race_id: &str,
    slot: u8,
    base: &str,
) -> Result<RaceLane, String> {
    if !valid_race_id(race_id) || slot >= MAX_LANES || !is_sha(base) {
        return Err("Invalid race request".into());
    }
    let dir = races.join(race_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create race copy: {e}"))?;
    let path = dir.join(slot.to_string());
    let short: String = race_id.chars().filter(|c| *c != '-').take(10).collect();
    let branch = format!("{BRANCH_PREFIX}{short}-{slot}");
    let path_text = path.to_string_lossy().to_string();
    run(
        root,
        &[
            "worktree", "add", "--quiet", "-b", &branch, &path_text, base,
        ],
    )?;
    Ok(RaceLane {
        path: path_text,
        branch,
    })
}

/// A tree with nothing in it, which every git knows without storing it.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Git for reading a diff the copy can't steer: no attributes from the
/// user's config, and (on a git that reads `GIT_ATTR_SOURCE`) none from the
/// checkout or its commits either. Counts come from `--text`, and whether a
/// file is binary from what it holds, so an attributes file never hides a
/// change from Review.
fn diff_git(dir: &Path, index: Option<&ScratchIndex>) -> Command {
    let mut cmd = git(dir);
    cmd.args(["-c", "core.attributesFile=/dev/null"])
        .env("GIT_ATTR_SOURCE", EMPTY_TREE);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", &index.0);
    }
    cmd
}

/// Said when a changed file's name can't be read exactly as git stores it.
pub(crate) const UNREADABLE_PATH: &str =
    "A changed file's name has characters Aven can't read safely, so Aven won't use this change";

/// A changed file's name exactly as git stored it (read with `-z`, so never
/// quoted). One that isn't plain text, or holds a control character, is
/// refused rather than guessed at.
fn changed_path(bytes: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| UNREADABLE_PATH.to_string())?;
    if text.is_empty() || text.starts_with('"') || text.chars().any(char::is_control) {
        return Err(format!("{UNREADABLE_PATH}: {}", text.escape_debug()));
    }
    Ok(text.to_string())
}

/// One changed file as `git diff --raw -z --no-abbrev` lists it.
struct RawEntry {
    path: String,
    status: char,
    old_mode: String,
    new_mode: String,
    old_sha: String,
    new_sha: String,
}

fn parse_raw(bytes: &[u8]) -> Result<Vec<RawEntry>, String> {
    let mut parts = bytes.split(|byte| *byte == 0);
    let mut entries = Vec::new();
    while let Some(meta) = parts.next() {
        if meta.is_empty() {
            continue;
        }
        let meta = std::str::from_utf8(meta)
            .ok()
            .and_then(|meta| meta.strip_prefix(':'))
            .ok_or_else(|| UNREADABLE_PATH.to_string())?;
        let fields: Vec<&str> = meta.split(' ').collect();
        let [old_mode, new_mode, old_sha, new_sha, status] = fields.as_slice() else {
            return Err(UNREADABLE_PATH.into());
        };
        let path = changed_path(parts.next().ok_or_else(|| UNREADABLE_PATH.to_string())?)?;
        entries.push(RawEntry {
            path,
            status: status.chars().next().unwrap_or('M'),
            old_mode: (*old_mode).to_string(),
            new_mode: (*new_mode).to_string(),
            old_sha: (*old_sha).to_string(),
            new_sha: (*new_sha).to_string(),
        });
    }
    Ok(entries)
}

fn parse_numstat_z(bytes: &[u8]) -> Result<Vec<(String, u32, u32)>, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let mut parts = record.splitn(3, |byte| *byte == b'\t');
            let added = parts.next().unwrap_or_default();
            let removed = parts.next().unwrap_or_default();
            let path = changed_path(parts.next().ok_or_else(|| UNREADABLE_PATH.to_string())?)?;
            let count = |raw: &[u8]| {
                std::str::from_utf8(raw)
                    .ok()
                    .and_then(|text| text.parse().ok())
                    .unwrap_or(0)
            };
            Ok((path, count(added), count(removed)))
        })
        .collect()
}

/// The first bytes of each blob (enough to tell binary from text, and a
/// link's target), read in one `git cat-file --batch`.
fn blob_heads(
    dir: &Path,
    shas: &[String],
) -> Result<std::collections::HashMap<String, Vec<u8>>, String> {
    use std::io::{BufRead, BufReader, Read};
    const HEAD: usize = 8192;
    let mut heads = std::collections::HashMap::new();
    let wanted: Vec<&String> = shas
        .iter()
        .filter(|sha| is_sha(sha) && sha.bytes().any(|b| b != b'0'))
        .collect();
    if wanted.is_empty() {
        return Ok(heads);
    }
    let mut child = git(dir)
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Could not run git")?;
    let input: Vec<u8> = wanted
        .iter()
        .flat_map(|sha| format!("{sha}\n").into_bytes())
        .collect();
    // Written from its own thread, so a full output pipe never stalls it.
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&input);
    });
    let mut out = BufReader::new(child.stdout.take().ok_or("Could not run git")?);
    for sha in &wanted {
        let mut header = String::new();
        if out.read_line(&mut header).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let fields: Vec<&str> = header.split_whitespace().collect();
        let Some(size) = fields.get(2).and_then(|size| size.parse::<usize>().ok()) else {
            continue;
        };
        let mut head = vec![0; size.min(HEAD)];
        out.read_exact(&mut head).map_err(|e| e.to_string())?;
        std::io::copy(
            &mut (&mut out).take((size - head.len()) as u64 + 1),
            &mut std::io::sink(),
        )
        .map_err(|e| e.to_string())?;
        heads.insert((*sha).clone(), head);
    }
    let _ = writer.join();
    let _ = child.wait();
    Ok(heads)
}

/// What changed in a diff (`spec`: a range, or `--cached <base>` with a
/// scratch index), every file with its modes, and each one text or binary
/// by what it holds.
fn read_changes(
    dir: &Path,
    index: Option<&ScratchIndex>,
    spec: &[&str],
) -> Result<RaceDiff, String> {
    let read = |extra: &[&str]| {
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "-z",
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(spec);
        run_git(diff_git(dir, index), &args, None)
    };
    let entries = parse_raw(&read(&["--raw", "--no-abbrev"])?)?;
    let counts = parse_numstat_z(&read(&["--numstat", "--text"])?)?;
    let shas: Vec<String> = entries
        .iter()
        .flat_map(|entry| [entry.old_sha.clone(), entry.new_sha.clone()])
        .collect();
    let heads = blob_heads(dir, &shas)?;
    let files: Vec<RaceFile> = entries
        .into_iter()
        .map(|entry| {
            let binary = [&entry.old_sha, &entry.new_sha]
                .iter()
                .any(|sha| heads.get(*sha).is_some_and(|head| head.contains(&0)));
            let (additions, deletions) = if binary {
                (0, 0)
            } else {
                counts
                    .iter()
                    .find(|(path, _, _)| *path == entry.path)
                    .map(|(_, added, removed)| (*added, *removed))
                    .unwrap_or((0, 0))
            };
            let link_target = (entry.new_mode == "120000")
                .then(|| heads.get(&entry.new_sha))
                .flatten()
                .map(|head| String::from_utf8_lossy(head).to_string());
            RaceFile {
                status: match entry.status {
                    'A' => "added",
                    'D' => "deleted",
                    _ => "modified",
                }
                .into(),
                path: entry.path,
                additions,
                deletions,
                binary,
                old_mode: entry.old_mode,
                new_mode: entry.new_mode,
                link_target,
            }
        })
        .collect();
    Ok(RaceDiff {
        additions: files.iter().map(|file| file.additions).sum(),
        deletions: files.iter().map(|file| file.deletions).sum(),
        files,
    })
}

pub fn diff(worktree: &Path, base: &str) -> Result<RaceDiff, String> {
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    // New files count too once staged, into a scratch index: neither the
    // lane's index nor the project's is touched.
    let index = ScratchIndex::seeded_from(worktree)?;
    run_staged(worktree, &index, &["add", "-A"])?;
    read_changes(worktree, Some(&index), &["--cached", base])
}

/// Everything that changed between two commits (`from` an ancestor of
/// `to`), read from the repository alone: no checkout or index is touched.
pub(crate) fn range_diff(dir: &Path, from: &str, to: &str) -> Result<RaceDiff, String> {
    if !is_sha(from) || !is_sha(to) {
        return Err("Invalid race range".into());
    }
    read_changes(dir, None, &[from, to])
}

/// The binary patch between two commits, as `patch` makes for a checkout.
pub(crate) fn range_patch(dir: &Path, from: &str, to: &str) -> Result<Vec<u8>, String> {
    if !is_sha(from) || !is_sha(to) {
        return Err("Invalid race range".into());
    }
    run_git(
        diff_git(dir, None),
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--no-renames",
            from,
            to,
        ],
        None,
    )
}

/// A file as it was at `from` and as it is at `to`.
pub(crate) fn range_file_diff(
    dir: &Path,
    from: &str,
    to: &str,
    path: &str,
) -> Result<RaceFileDiff, String> {
    let path = clean_relative(path)?;
    if !is_sha(from) || !is_sha(to) {
        return Err("Invalid race range".into());
    }
    let show = |at: &str| {
        run(dir, &["show", "--no-textconv", &format!("{at}:{path}")])
            .ok()
            .and_then(readable)
    };
    Ok(RaceFileDiff {
        original: show(from),
        current: show(to),
    })
}

/// The tree of everything in `worktree` now (new files too, ignored ones
/// not), from a scratch index so the checkout's own index is untouched.
pub(crate) fn snapshot_tree(worktree: &Path) -> Result<String, String> {
    let index = ScratchIndex::seeded_from(worktree)?;
    run_staged(worktree, &index, &["add", "-A"])?;
    let tree = text(run_staged(worktree, &index, &["write-tree"])?);
    if !is_sha(&tree) {
        return Err("Could not record the crew's work".into());
    }
    Ok(tree)
}

/// A commit of `tree` on top of `parent`. Its author is Aven, so it never
/// needs (or borrows) the user's git identity, and no hook runs.
pub(crate) fn commit_tree(
    dir: &Path,
    tree: &str,
    parent: &str,
    message: &str,
) -> Result<String, String> {
    if !is_sha(tree) || !is_sha(parent) {
        return Err("Invalid race base".into());
    }
    let mut cmd = git(dir);
    for (key, value) in [
        ("GIT_AUTHOR_NAME", "Aven crew"),
        ("GIT_AUTHOR_EMAIL", "crew@aven.invalid"),
        ("GIT_COMMITTER_NAME", "Aven crew"),
        ("GIT_COMMITTER_EMAIL", "crew@aven.invalid"),
    ] {
        cmd.env(key, value);
    }
    let sha = text(run_git(
        cmd,
        &["commit-tree", tree, "-p", parent, "-F", "-"],
        Some(message.as_bytes()),
    )?);
    if !is_sha(&sha) {
        return Err("Could not record the crew's work".into());
    }
    Ok(sha)
}

/// A commit of everything in `worktree` now on top of `parent` (see
/// `snapshot_tree` and `commit_tree`).
pub(crate) fn snapshot(worktree: &Path, parent: &str, message: &str) -> Result<String, String> {
    if !is_sha(parent) {
        return Err("Invalid race base".into());
    }
    let tree = snapshot_tree(worktree)?;
    commit_tree(worktree, &tree, parent, message)
}

/// `patch` applied to `parent`'s files in a scratch index, as a commit on
/// top of it. Neither the checkout's files nor its ignore rules take part,
/// so a file the user's `.gitignore` covers comes along like any other.
pub(crate) fn replay(
    dir: &Path,
    parent: &str,
    patch: &[u8],
    message: &str,
) -> Result<String, String> {
    if !is_sha(parent) {
        return Err("Invalid race base".into());
    }
    let index = ScratchIndex::empty();
    run_staged(dir, &index, &["read-tree", parent])?;
    if !patch.is_empty() {
        let mut cmd = git(dir);
        cmd.env("GIT_INDEX_FILE", &index.0);
        run_git(
            cmd,
            &["apply", "--cached", "--whitespace=nowarn"],
            Some(patch),
        )?;
    }
    let tree = text(run_staged(dir, &index, &["write-tree"])?);
    commit_tree(dir, &tree, parent, message)
}

const MAX_DIFF_TEXT: usize = 2 * 1024 * 1024;

fn readable(bytes: Vec<u8>) -> Option<String> {
    if bytes.len() > MAX_DIFF_TEXT || bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Everything changed in `worktree` since `base`, new files included, as
/// one binary patch. The checkout's own index is not touched.
pub(crate) fn patch(worktree: &Path, base: &str) -> Result<Vec<u8>, String> {
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    let index = ScratchIndex::seeded_from(worktree)?;
    run_staged(worktree, &index, &["add", "-A"])?;
    run_git(
        diff_git(worktree, Some(&index)),
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--no-renames",
            base,
        ],
        None,
    )
}

/// Apply `patch` to the checkout at `root`, checking it first so a conflict
/// changes nothing.
pub(crate) fn apply_patch(root: &Path, patch: &[u8]) -> Result<(), String> {
    run_with_input(
        root,
        &["apply", "--check", "--whitespace=nowarn"],
        Some(patch),
    )
    .map_err(|error| format!("These changes conflict with edits in your project: {error}"))?;
    run_with_input(root, &["apply", "--whitespace=nowarn"], Some(patch))?;
    Ok(())
}

pub fn file_diff(worktree: &Path, base: &str, path: &str) -> Result<RaceFileDiff, String> {
    let path = clean_relative(path)?;
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    let original = run(
        worktree,
        &["show", "--no-textconv", &format!("{base}:{path}")],
    )
    .ok()
    .and_then(readable);
    let current = std::fs::read(worktree.join(&path)).ok().and_then(readable);
    Ok(RaceFileDiff { original, current })
}

pub fn apply(root: &Path, races: &Path, base: &str, choices: &[RaceChoice]) -> Result<(), String> {
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    let mut patches = Vec::new();
    for choice in choices {
        if choice.paths.is_empty() {
            continue;
        }
        let worktree = lane_path(races, &choice.worktree)?;
        let paths = choice
            .paths
            .iter()
            .map(|path| clean_relative(path))
            .collect::<Result<Vec<_>, _>>()?;
        let index = ScratchIndex::seeded_from(&worktree)?;
        run_staged(&worktree, &index, &["add", "-A"])?;
        let mut args = vec!["diff", "--cached", "--binary", "--no-renames", base, "--"];
        args.extend(paths.iter().map(String::as_str));
        let patch = run_staged(&worktree, &index, &args)?;
        if !patch.is_empty() {
            patches.push(patch);
        }
    }
    // Check every patch before applying any, so a conflict changes nothing.
    for patch in &patches {
        run_with_input(
            root,
            &["apply", "--check", "--whitespace=nowarn"],
            Some(patch),
        )
        .map_err(|error| format!("These changes conflict with edits in your project: {error}"))?;
    }
    for patch in &patches {
        run_with_input(root, &["apply", "--whitespace=nowarn"], Some(patch))?;
    }
    Ok(())
}

pub fn cleanup(root: &Path, races: &Path, lanes: &[RaceLane]) -> Result<(), String> {
    remove_copies(root, races, BRANCH_PREFIX, lanes)
}

/// Remove copies inside `dir` and their branches, which must start with
/// `prefix`. A copy git no longer tracks is deleted directly.
pub(crate) fn remove_copies(
    root: &Path,
    dir: &Path,
    prefix: &str,
    lanes: &[RaceLane],
) -> Result<(), String> {
    let mut errors = Vec::new();
    for lane in lanes {
        let path = lane_path(dir, &lane.path)?;
        if !lane.branch.starts_with(prefix) {
            return Err("Not one of Aven's branches".into());
        }
        let path_text = path.to_string_lossy().to_string();
        if path.exists() {
            if let Err(error) = run(root, &["worktree", "remove", "--force", &path_text]) {
                // A copy that git no longer tracks is removed directly.
                if std::fs::remove_dir_all(&path).is_err() {
                    errors.push(error);
                }
            }
        }
        let _ = run(root, &["branch", "-D", &lane.branch]);
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
    let _ = run(root, &["worktree", "prune"]);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn races_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("races"))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn race_prepare(cwd: String) -> Result<RaceBase, String> {
    blocking(move || prepare(&crate::fs::expand_home(&cwd))).await
}

#[tauri::command]
pub async fn race_worktree_create(
    app: AppHandle,
    root: String,
    race_id: String,
    slot: u8,
    base: String,
) -> Result<RaceLane, String> {
    let races = races_dir(&app)?;
    blocking(move || create_lane(Path::new(&root), &races, &race_id, slot, &base)).await
}

#[tauri::command]
pub async fn race_diff(app: AppHandle, worktree: String, base: String) -> Result<RaceDiff, String> {
    let races = races_dir(&app)?;
    blocking(move || diff(&lane_path(&races, &worktree)?, &base)).await
}

#[tauri::command]
pub async fn race_file_diff(
    app: AppHandle,
    worktree: String,
    base: String,
    path: String,
) -> Result<RaceFileDiff, String> {
    let races = races_dir(&app)?;
    blocking(move || file_diff(&lane_path(&races, &worktree)?, &base, &path)).await
}

#[tauri::command]
pub async fn race_apply(
    app: AppHandle,
    root: String,
    base: String,
    choices: Vec<RaceChoice>,
) -> Result<(), String> {
    let races = races_dir(&app)?;
    blocking(move || apply(Path::new(&root), &races, &base, &choices)).await
}

#[tauri::command]
pub async fn race_cleanup(
    app: AppHandle,
    root: String,
    lanes: Vec<RaceLane>,
) -> Result<(), String> {
    let races = races_dir(&app)?;
    blocking(move || cleanup(Path::new(&root), &races, &lanes)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("aven-race-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git_ok(dir: &Path, args: &[&str]) {
        run(dir, args).unwrap_or_else(|e| panic!("git {args:?}: {e}"));
    }

    fn repo() -> PathBuf {
        let root = temp_dir("repo");
        git_ok(&root, &["init", "-q", "-b", "main"]);
        git_ok(&root, &["config", "user.email", "test@example.com"]);
        git_ok(&root, &["config", "user.name", "Test"]);
        git_ok(&root, &["config", "core.autocrlf", "false"]);
        git_ok(&root, &["config", "commit.gpgsign", "false"]);
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("b.txt"), "keep\n").unwrap();
        git_ok(&root, &["add", "-A"]);
        git_ok(&root, &["commit", "-q", "-m", "init"]);
        root
    }

    #[test]
    fn races_from_the_visible_state_and_applies_chosen_files_back() {
        let root = repo();
        let races = temp_dir("races");
        // Uncommitted work in the project is part of every lane's start.
        std::fs::write(root.join("a.txt"), "one\ntwo\nmine\n").unwrap();
        let base = prepare(&root).unwrap();
        assert!(base.uncommitted);
        let root = PathBuf::from(&base.root);

        let first = create_lane(&root, &races, "race-1", 0, &base.base).unwrap();
        let second = create_lane(&root, &races, "race-1", 1, &base.base).unwrap();
        let first_path = PathBuf::from(&first.path);
        assert_eq!(
            std::fs::read_to_string(first_path.join("a.txt")).unwrap(),
            "one\ntwo\nmine\n"
        );

        std::fs::write(first_path.join("a.txt"), "one\ntwo\nmine\nlane\n").unwrap();
        std::fs::write(first_path.join("new.txt"), "fresh\n").unwrap();
        std::fs::write(PathBuf::from(&second.path).join("b.txt"), "other\n").unwrap();

        let changes = diff(&first_path, &base.base).unwrap();
        let mut files: Vec<_> = changes
            .files
            .iter()
            .map(|file| (file.path.as_str(), file.status.as_str(), file.additions))
            .collect();
        files.sort();
        assert_eq!(
            files,
            vec![("a.txt", "modified", 1), ("new.txt", "added", 1)]
        );
        let shown = file_diff(&first_path, &base.base, "a.txt").unwrap();
        assert_eq!(shown.original.as_deref(), Some("one\ntwo\nmine\n"));

        apply(
            &root,
            &races,
            &base.base,
            &[
                RaceChoice {
                    worktree: first.path.clone(),
                    paths: vec!["a.txt".into(), "new.txt".into()],
                },
                RaceChoice {
                    worktree: second.path.clone(),
                    paths: vec!["b.txt".into()],
                },
            ],
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("a.txt")).unwrap(),
            "one\ntwo\nmine\nlane\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("new.txt")).unwrap(),
            "fresh\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("b.txt")).unwrap(),
            "other\n"
        );

        cleanup(&root, &races, &[first.clone(), second.clone()]).unwrap();
        assert!(!PathBuf::from(&first.path).exists());
        let branches = text(run(&root, &["branch", "--list", "aven/race/*"]).unwrap());
        assert!(branches.is_empty());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&races);
    }

    #[test]
    fn a_conflicting_keep_changes_nothing() {
        let root = repo();
        let races = temp_dir("races");
        let base = prepare(&root).unwrap();
        assert!(!base.uncommitted);
        let root = PathBuf::from(&base.root);
        let lane = create_lane(&root, &races, "race-2", 0, &base.base).unwrap();
        std::fs::write(PathBuf::from(&lane.path).join("a.txt"), "lane\n").unwrap();
        std::fs::write(PathBuf::from(&lane.path).join("b.txt"), "lane b\n").unwrap();
        // The user edited a.txt in the project after the race started.
        std::fs::write(root.join("a.txt"), "user\n").unwrap();
        let error = apply(
            &root,
            &races,
            &base.base,
            &[RaceChoice {
                worktree: lane.path.clone(),
                paths: vec!["b.txt".into(), "a.txt".into()],
            }],
        )
        .unwrap_err();
        assert!(error.contains("conflict"), "{error}");
        assert_eq!(
            std::fs::read_to_string(root.join("b.txt")).unwrap(),
            "keep\n"
        );
        cleanup(&root, &races, &[lane]).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&races);
    }

    #[test]
    fn reading_and_keeping_a_lane_never_stage_its_work() {
        let root = repo();
        let races = temp_dir("races");
        let base = prepare(&root).unwrap();
        let root = PathBuf::from(&base.root);
        let lane = create_lane(&root, &races, "race-3", 0, &base.base).unwrap();
        let lane_path = PathBuf::from(&lane.path);
        std::fs::write(lane_path.join("a.txt"), "one\ntwo\nlane\n").unwrap();
        std::fs::write(lane_path.join("new.txt"), "fresh\n").unwrap();
        // The agent staged a deletion itself; Aven must see it and keep it staged.
        git_ok(&lane_path, &["rm", "-q", "b.txt"]);
        let index = {
            let reported = text(run(&lane_path, &["rev-parse", "--git-path", "index"]).unwrap());
            let path = PathBuf::from(&reported);
            if path.is_absolute() {
                path
            } else {
                lane_path.join(path)
            }
        };
        let index_before = std::fs::read(&index).unwrap();
        let status = || text(run(&lane_path, &["status", "--porcelain"]).unwrap());
        let status_before = status();
        assert!(status_before.lines().any(|line| line == "?? new.txt"));

        let changes = diff(&lane_path, &base.base).unwrap();
        let mut files: Vec<_> = changes
            .files
            .iter()
            .map(|file| (file.path.as_str(), file.status.as_str()))
            .collect();
        files.sort();
        assert_eq!(
            files,
            vec![
                ("a.txt", "modified"),
                ("b.txt", "deleted"),
                ("new.txt", "added")
            ]
        );
        // The agent's own view is exactly as it left it.
        assert_eq!(status(), status_before);
        assert_eq!(std::fs::read(&index).unwrap(), index_before);

        apply(
            &root,
            &races,
            &base.base,
            &[RaceChoice {
                worktree: lane.path.clone(),
                paths: vec!["new.txt".into(), "b.txt".into()],
            }],
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("new.txt")).unwrap(),
            "fresh\n"
        );
        assert!(!root.join("b.txt").exists());
        assert_eq!(status(), status_before);
        assert_eq!(std::fs::read(&index).unwrap(), index_before);

        cleanup(&root, &races, &[lane]).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&races);
    }

    #[test]
    fn rejects_paths_outside_the_race_directory_and_bad_input() {
        let races = temp_dir("races");
        assert!(lane_path(&races, "/etc").is_err());
        assert!(lane_path(&races, &format!("{}/../x", races.display())).is_err());
        assert!(clean_relative("../secret").is_err());
        assert!(clean_relative("/abs").is_err());
        assert!(clean_relative("ok/file.txt").is_ok());
        assert!(!valid_race_id("../x"));
        assert!(create_lane(&races, &races, "ok", MAX_LANES, &"a".repeat(40)).is_err());
        let _ = std::fs::remove_dir_all(&races);
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_paths_that_replace_the_race_worktree() {
        for path in [
            r"C:\outside.txt",
            "C:/outside.txt",
            "C:outside.txt",
            r"\outside.txt",
            r"\\server\share\outside.txt",
            r"\\?\C:\outside.txt",
        ] {
            assert!(clean_relative(path).is_err(), "{path}");
        }
        assert_eq!(clean_relative(r"src\main.rs").unwrap(), "src/main.rs");
    }

    #[test]
    fn needs_a_repository_with_a_commit() {
        let plain = temp_dir("plain");
        assert!(prepare(&plain).unwrap_err().contains("git repository"));
        git_ok(&plain, &["init", "-q"]);
        assert!(prepare(&plain).unwrap_err().contains("commit"));
        let _ = std::fs::remove_dir_all(&plain);
    }
}
