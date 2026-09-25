//! Race: one prompt, several agents, each in its own git worktree.
//!
//! A race starts from a base commit. When the project has uncommitted
//! changes to tracked files, `git stash create` records them as a commit
//! without touching the working tree, so every lane starts from exactly
//! what the user sees. Lanes live under the app data `races/` directory on
//! `aven/race/*` branches; nothing is written inside the project itself.
//! Keeping a result applies each lane's diff against that base to the
//! project's working tree; cleanup removes the worktrees and branches.

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

fn git(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    crate::hide_window_console(&mut cmd);
    cmd.arg("--no-pager")
        .arg("-C")
        .arg(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

fn run(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    run_with_input(dir, args, None)
}

fn run_with_input(dir: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut child = git(dir)
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

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn is_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_race_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Only paths inside the app's races directory are ever touched.
fn lane_path(races: &Path, value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let inside = path.is_absolute()
        && path.starts_with(races)
        && path
            .components()
            .all(|part| !matches!(part, std::path::Component::ParentDir));
    if inside {
        Ok(path)
    } else {
        Err("Not a race copy".into())
    }
}

fn clean_relative(value: &str) -> Result<String, String> {
    let value = value.replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("Invalid path: {value}"));
    }
    Ok(value)
}

pub fn prepare(cwd: &Path) -> Result<RaceBase, String> {
    let root = text(
        run(cwd, &["rev-parse", "--show-toplevel"])
            .map_err(|_| "Race needs a git repository.".to_string())?,
    );
    let root_path = PathBuf::from(&root);
    let head = text(
        run(&root_path, &["rev-parse", "--verify", "HEAD"])
            .map_err(|_| "Race needs at least one commit in this repository.".to_string())?,
    );
    let stash = text(run(&root_path, &["stash", "create"])?);
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

fn parse_numstat(raw: &str) -> Vec<(String, u32, u32, bool)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?.to_string();
            let binary = added == "-" || removed == "-";
            Some((
                path,
                added.parse().unwrap_or(0),
                removed.parse().unwrap_or(0),
                binary,
            ))
        })
        .collect()
}

fn parse_name_status(raw: &str) -> Vec<(String, String)> {
    raw.lines()
        .filter_map(|line| {
            let (code, path) = line.split_once('\t')?;
            let status = match code.chars().next()? {
                'A' => "added",
                'D' => "deleted",
                _ => "modified",
            };
            Some((path.to_string(), status.to_string()))
        })
        .collect()
}

pub fn diff(worktree: &Path, base: &str) -> Result<RaceDiff, String> {
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    // Stage everything in the lane's own index so new files count too; the
    // project's index is never touched.
    run(worktree, &["add", "-A"])?;
    let numstat = String::from_utf8_lossy(&run(
        worktree,
        &["diff", "--cached", "--no-renames", "--numstat", base],
    )?)
    .to_string();
    let names = String::from_utf8_lossy(&run(
        worktree,
        &["diff", "--cached", "--no-renames", "--name-status", base],
    )?)
    .to_string();
    let statuses = parse_name_status(&names);
    let files: Vec<RaceFile> = parse_numstat(&numstat)
        .into_iter()
        .map(|(path, additions, deletions, binary)| RaceFile {
            status: statuses
                .iter()
                .find(|(name, _)| *name == path)
                .map(|(_, status)| status.clone())
                .unwrap_or_else(|| "modified".into()),
            path,
            additions,
            deletions,
            binary,
        })
        .collect();
    Ok(RaceDiff {
        additions: files.iter().map(|file| file.additions).sum(),
        deletions: files.iter().map(|file| file.deletions).sum(),
        files,
    })
}

const MAX_DIFF_TEXT: usize = 2 * 1024 * 1024;

fn readable(bytes: Vec<u8>) -> Option<String> {
    if bytes.len() > MAX_DIFF_TEXT || bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn file_diff(worktree: &Path, base: &str, path: &str) -> Result<RaceFileDiff, String> {
    let path = clean_relative(path)?;
    if !is_sha(base) {
        return Err("Invalid race base".into());
    }
    let original = run(worktree, &["show", &format!("{base}:{path}")])
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
        run(&worktree, &["add", "-A"])?;
        let mut args = vec!["diff", "--cached", "--binary", "--no-renames", base, "--"];
        args.extend(paths.iter().map(String::as_str));
        let patch = run(&worktree, &args)?;
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
    let mut errors = Vec::new();
    for lane in lanes {
        let path = lane_path(races, &lane.path)?;
        if !lane.branch.starts_with(BRANCH_PREFIX) {
            return Err("Not a race branch".into());
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

    #[test]
    fn needs_a_repository_with_a_commit() {
        let plain = temp_dir("plain");
        assert!(prepare(&plain).unwrap_err().contains("git repository"));
        git_ok(&plain, &["init", "-q"]);
        assert!(prepare(&plain).unwrap_err().contains("commit"));
        let _ = std::fs::remove_dir_all(&plain);
    }
}
