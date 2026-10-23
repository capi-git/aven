//! Adds skills with the `skills` CLI (`npx skills add`). Only an explicit
//! click in the Add a skill dialog runs it. The frontend sends a structured
//! request; this module validates every value again and builds the argument
//! list itself, so no shell ever sees the source or a skill name. Every line
//! the CLI prints is forwarded to the dialog while it runs.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::fs::expand_home;

const OUTPUT_EVENT: &str = "skills-cli-output";
/// The major version whose `--list` text and `--json` result Aven reads.
const CLI_PACKAGE: &str = "skills@1";
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(120);
const ADD_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_SOURCE: usize = 200;
const MAX_SKILLS: usize = 200;
const MAX_STDOUT: usize = 512 * 1024;
const MAX_STDERR: usize = 64 * 1024;
const MAX_LINE: usize = 2_000;
const MAX_LINES_SHOWN: usize = 4_000;
/// Readers can outlive a killed process when a grandchild still holds a pipe.
const READER_GRACE: Duration = Duration::from_secs(2);
/// File times can be coarse; a copy made during the run is never this old.
const MTIME_SLACK: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillsCliAction {
    /// `skills find <name>`: look a bare name up on skills.sh.
    Find,
    /// `skills add <source> --list`: what a source contains, without installing.
    List,
    /// `skills add <source> --yes --json`: install.
    Add,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsCliRequest {
    run_id: String,
    action: SkillsCliAction,
    source: String,
    #[serde(default)]
    global: bool,
    /// Skills to install (and to check on disk afterwards).
    #[serde(default)]
    skills: Vec<String>,
    /// Every skill in the source is wanted: no `--skill` filter is passed.
    #[serde(default)]
    all_skills: bool,
    /// The project folder for a project install.
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillsCliStatus {
    Finished,
    MissingNode,
    TimedOut,
    Cancelled,
    FailedToStart,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsCliOutcome {
    status: SkillsCliStatus,
    code: Option<i32>,
    stdout: String,
    stderr: String,
    /// Requested skills whose SKILL.md this run wrote. The CLI can report a
    /// failure for one unsupported agent after the shared copy succeeded.
    installed: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputLine {
    run_id: String,
    line: String,
}

#[derive(Default)]
struct RunHandle {
    pid: Mutex<Option<u32>>,
    cancelled: AtomicBool,
}

impl RunHandle {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let pid = *self.pid.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(pid) = pid {
            crate::harness::terminate_all(&[pid]);
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Runs in flight, so the dialog can stop one and quitting stops them all.
#[derive(Default)]
pub struct SkillsCliHost {
    runs: Mutex<HashMap<String, Arc<RunHandle>>>,
}

impl SkillsCliHost {
    fn register(&self, run_id: &str) -> Result<Arc<RunHandle>, String> {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if runs.contains_key(run_id) {
            return Err("This skill run has already started.".into());
        }
        let handle = Arc::new(RunHandle::default());
        runs.insert(run_id.to_string(), handle.clone());
        Ok(handle)
    }

    fn remove(&self, run_id: &str) {
        self.runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(run_id);
    }

    fn get(&self, run_id: &str) -> Option<Arc<RunHandle>> {
        self.runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(run_id)
            .cloned()
    }
}

impl Drop for SkillsCliHost {
    fn drop(&mut self) {
        let runs = self.runs.get_mut().unwrap_or_else(|e| e.into_inner());
        let pids: Vec<u32> = runs
            .values()
            .filter_map(|run| *run.pid.lock().unwrap_or_else(|e| e.into_inner()))
            .collect();
        crate::harness::terminate_all(&pids);
    }
}

struct Registration<'a> {
    host: &'a SkillsCliHost,
    run_id: &'a str,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.host.remove(self.run_id);
    }
}

/// What one request runs, after validation.
#[derive(Debug, PartialEq, Eq)]
struct RunPlan {
    args: Vec<String>,
    cwd: PathBuf,
    timeout: Duration,
    /// Where `.agents/skills` is checked after an install.
    root: Option<PathBuf>,
    stream_stdout: bool,
}

fn plan_run(request: &SkillsCliRequest, home: Option<&Path>) -> Result<RunPlan, String> {
    validate_run_id(&request.run_id)?;
    let home = home.ok_or("Aven couldn't find your home folder.")?;
    match request.action {
        SkillsCliAction::Find => validate_query(&request.source)?,
        SkillsCliAction::List | SkillsCliAction::Add => validate_cli_source(&request.source)?,
    }
    if request.skills.len() > MAX_SKILLS {
        return Err("Choose fewer skills at once.".into());
    }
    let passed_as_arguments = request.action == SkillsCliAction::Add && !request.all_skills;
    for name in &request.skills {
        if passed_as_arguments {
            validate_skill_name(name)?;
        } else {
            validate_listed_name(name)?;
        }
    }
    let project = if request.action == SkillsCliAction::Add && !request.global {
        let cwd = request
            .cwd
            .as_deref()
            .filter(|cwd| !cwd.trim().is_empty())
            .ok_or("Open a project folder to add a skill to it.")?;
        let dir = expand_home(cwd);
        if !dir.is_dir() {
            return Err("This project's folder couldn't be found.".into());
        }
        Some(dir)
    } else {
        None
    };
    if request.action == SkillsCliAction::Add && request.skills.is_empty() {
        return Err("Choose at least one skill to add.".into());
    }
    let args = cli_args(
        request.action,
        &request.source,
        request.global,
        &request.skills,
        request.all_skills,
    );
    let root = (request.action == SkillsCliAction::Add)
        .then(|| project.clone().unwrap_or_else(|| home.to_path_buf()));
    Ok(RunPlan {
        args,
        cwd: project.unwrap_or_else(|| home.to_path_buf()),
        timeout: if request.action == SkillsCliAction::Add {
            ADD_TIMEOUT
        } else {
            LOOKUP_TIMEOUT
        },
        root,
        // `--json` keeps stdout for the result; progress goes to stderr.
        stream_stdout: request.action != SkillsCliAction::Add,
    })
}

fn cli_args(
    action: SkillsCliAction,
    source: &str,
    global: bool,
    skills: &[String],
    all_skills: bool,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["--yes".into(), CLI_PACKAGE.into()];
    match action {
        SkillsCliAction::Find => {
            args.extend(["find".into(), source.into()]);
        }
        SkillsCliAction::List => {
            args.extend(["add".into(), source.into(), "--list".into()]);
        }
        SkillsCliAction::Add => {
            args.extend(["add".into(), source.into(), "--yes".into(), "--json".into()]);
            if global {
                args.push("--global".into());
            }
            if !all_skills {
                for name in skills {
                    args.push("--skill".into());
                    args.push(name.clone());
                }
            }
        }
    }
    args
}

/// The command as a person would type it, for the dialog's output.
fn display_command(args: &[String]) -> String {
    let mut words = vec!["npx".to_string()];
    words.extend(args.iter().map(|arg| {
        if arg.contains(' ') {
            format!("\"{arg}\"")
        } else {
            arg.clone()
        }
    }));
    words.join(" ")
}

fn validate_run_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        Ok(())
    } else {
        Err("This skill run couldn't be started.".into())
    }
}

fn is_owner(part: &str) -> bool {
    let mut chars = part.chars();
    part.len() <= 39
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_segment(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 100
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `owner/repo`, `owner/repo/path`, or `https://github.com/owner/repo/...`.
/// Nothing else reaches the CLI: no other hosts, local paths, or flags.
fn validate_cli_source(source: &str) -> Result<(), String> {
    const INVALID: &str = "Use owner/repo or a GitHub link.";
    if source.is_empty() || source.len() > MAX_SOURCE {
        return Err(INVALID.into());
    }
    let path = source.strip_prefix("https://github.com/").unwrap_or(source);
    let path = path.strip_suffix('/').unwrap_or(path);
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 2
        || parts.len() > 12
        || !is_owner(parts[0])
        || !parts[1..].iter().all(|part| is_segment(part))
    {
        return Err(INVALID.into());
    }
    Ok(())
}

/// A bare skill name to look up, such as `hallmark`.
fn validate_query(query: &str) -> Result<(), String> {
    let mut chars = query.chars();
    if query.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        Ok(())
    } else {
        Err("Use a skill name with letters, numbers, and hyphens.".into())
    }
}

/// Skill names come from the source's own files. They are passed as single
/// arguments, but never one that starts like a flag or holds odd characters.
fn validate_skill_name(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    if name.len() <= 128
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && !name.ends_with(' ')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | ':'))
    {
        Ok(())
    } else {
        Err(format!(
            "Aven can't choose the skill \"{name}\" on its own."
        ))
    }
}

/// With every skill wanted, names are only checked on disk, by folder name.
fn validate_listed_name(name: &str) -> Result<(), String> {
    if !name.trim().is_empty() && name.len() <= 256 && !name.chars().any(char::is_control) {
        Ok(())
    } else {
        Err("This source lists a skill Aven can't read.".into())
    }
}

/// The folder name the CLI gives a skill (its `sanitizeName`).
fn skill_folder_name(name: &str) -> String {
    let mut folder = String::new();
    let mut dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' {
            folder.push(c);
            dash = false;
        } else if !dash {
            folder.push('-');
            dash = true;
        }
    }
    let trimmed: String = folder
        .trim_matches(|c| c == '.' || c == '-')
        .chars()
        .take(255)
        .collect();
    if trimmed.is_empty() {
        "unnamed-skill".into()
    } else {
        trimmed
    }
}

/// Requested skills whose SKILL.md in `root/.agents/skills` was written at
/// or after `since`, so an older copy never counts as this install.
fn verify_installed(root: &Path, names: &[String], since: SystemTime) -> Vec<String> {
    let since = since.checked_sub(MTIME_SLACK).unwrap_or(since);
    names
        .iter()
        .filter(|name| {
            let dir = root
                .join(".agents")
                .join("skills")
                .join(skill_folder_name(name));
            let Ok(entries) = std::fs::read_dir(dir) else {
                return false;
            };
            entries.flatten().any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("SKILL.md")
                    && entry
                        .metadata()
                        .and_then(|meta| meta.modified())
                        .is_ok_and(|modified| modified >= since)
            })
        })
        .cloned()
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
enum RunEnd {
    Exited(Option<i32>),
    TimedOut,
    Cancelled,
    FailedToStart,
}

#[derive(Debug)]
struct StreamedRun {
    end: RunEnd,
    stdout: String,
    stderr: String,
}

#[derive(Default)]
struct Captured {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    lines: usize,
}

/// One line for the dialog: no carriage-return redraws, never huge.
fn tidy_line(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let text = text.trim_end_matches(['\n', '\r']);
    // A spinner redraws with `\r`; only the last frame matters.
    let text = text.rsplit('\r').next().unwrap_or_default();
    text.chars().take(MAX_LINE).collect()
}

fn read_lines(
    reader: impl Read,
    stdout: bool,
    stream: bool,
    captured: &Mutex<Captured>,
    on_line: &(dyn Fn(String) + Send + Sync),
) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let show = {
            let mut captured = captured.lock().unwrap_or_else(|e| e.into_inner());
            if stdout {
                let room = MAX_STDOUT.saturating_sub(captured.stdout.len());
                captured
                    .stdout
                    .extend_from_slice(&line[..line.len().min(room)]);
            } else {
                captured.stderr.extend_from_slice(&line);
                let excess = captured.stderr.len().saturating_sub(MAX_STDERR);
                if excess > 0 {
                    captured.stderr.drain(..excess);
                }
            }
            let show = stream && captured.lines < MAX_LINES_SHOWN;
            if show {
                captured.lines += 1;
            }
            show
        };
        if show {
            on_line(tidy_line(&line));
        }
    }
}

/// Run `binary args` with no shell, forwarding output lines as they arrive.
/// stderr is always shown; stdout only when `stream_stdout` (a `--json`
/// result is read whole instead).
fn run_streaming(
    binary: &Path,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
    stream_stdout: bool,
    handle: &RunHandle,
    on_line: Arc<dyn Fn(String) + Send + Sync>,
) -> StreamedRun {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::harness::prepare_child(&mut command, &binary.to_string_lossy());
    command
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("npm_config_update_notifier", "false");
    let failed = |message: String| StreamedRun {
        end: RunEnd::FailedToStart,
        stdout: String::new(),
        stderr: message,
    };
    if handle.is_cancelled() {
        return StreamedRun {
            end: RunEnd::Cancelled,
            stdout: String::new(),
            stderr: String::new(),
        };
    }
    let mut child = match crate::harness::spawn_managed(&mut command) {
        Ok(child) => child,
        Err(error) => return failed(error.to_string()),
    };
    let pid = child.id();
    *handle.pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(pid);
    // A Stop that landed between the check above and recording the pid.
    if handle.is_cancelled() {
        crate::harness::terminate_all(&[pid]);
    }
    let captured = Arc::new(Mutex::new(Captured::default()));
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let mut readers = 0;
    if let Some(out) = child.stdout.take() {
        let (captured, on_line, done) = (captured.clone(), on_line.clone(), done_tx.clone());
        thread::spawn(move || {
            read_lines(out, true, stream_stdout, &captured, &*on_line);
            let _ = done.send(());
        });
        readers += 1;
    }
    if let Some(err) = child.stderr.take() {
        let (captured, on_line, done) = (captured.clone(), on_line.clone(), done_tx.clone());
        thread::spawn(move || {
            read_lines(err, false, true, &captured, &*on_line);
            let _ = done.send(());
        });
        readers += 1;
    }
    drop(done_tx);
    let (exit_tx, exit_rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = exit_tx.send(child.wait().ok().and_then(|status| status.code()));
    });
    let end = match exit_rx.recv_timeout(timeout) {
        Ok(_) if handle.is_cancelled() => RunEnd::Cancelled,
        Ok(code) => RunEnd::Exited(code),
        Err(_) => {
            crate::harness::terminate_all(&[pid]);
            let _ = exit_rx.recv_timeout(READER_GRACE);
            if handle.is_cancelled() {
                RunEnd::Cancelled
            } else {
                RunEnd::TimedOut
            }
        }
    };
    for _ in 0..readers {
        if done_rx.recv_timeout(READER_GRACE).is_err() {
            break;
        }
    }
    let captured = captured.lock().unwrap_or_else(|e| e.into_inner());
    StreamedRun {
        end,
        stdout: String::from_utf8_lossy(&captured.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&captured.stderr).into_owned(),
    }
}

/// `npx` and the `node` it runs, found the way a terminal would find them.
fn resolve_npx() -> Option<PathBuf> {
    crate::harness::resolve_gui_binary("node")?;
    crate::harness::resolve_gui_binary("npx")
}

fn outcome(status: SkillsCliStatus) -> SkillsCliOutcome {
    SkillsCliOutcome {
        status,
        code: None,
        stdout: String::new(),
        stderr: String::new(),
        installed: Vec::new(),
    }
}

/// Run one `skills` CLI step for the Add a skill dialog. Output lines arrive
/// as `skills-cli-output` events tagged with the request's run id.
#[tauri::command(async)]
pub fn skills_cli_run(
    app: AppHandle,
    request: SkillsCliRequest,
) -> Result<SkillsCliOutcome, String> {
    let home = dirs_home().map(PathBuf::from);
    let plan = plan_run(&request, home.as_deref())?;
    let _work = crate::update_restart::begin_runtime_work(&app, "adding a skill")?;
    let host = app.state::<SkillsCliHost>();
    let handle = host.register(&request.run_id)?;
    let _registration = Registration {
        host: &host,
        run_id: &request.run_id,
    };
    let Some(npx) = resolve_npx() else {
        return Ok(outcome(SkillsCliStatus::MissingNode));
    };
    let emitter = app.clone();
    let run_id = request.run_id.clone();
    let on_line: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |line| {
        let _ = emitter.emit(
            OUTPUT_EVENT,
            OutputLine {
                run_id: run_id.clone(),
                line,
            },
        );
    });
    on_line(format!("$ {}", display_command(&plan.args)));
    let started = SystemTime::now();
    let run = run_streaming(
        &npx,
        &plan.args,
        &plan.cwd,
        plan.timeout,
        plan.stream_stdout,
        &handle,
        on_line,
    );
    let (status, code) = match run.end {
        RunEnd::Exited(code) => (SkillsCliStatus::Finished, code),
        RunEnd::TimedOut => (SkillsCliStatus::TimedOut, None),
        RunEnd::Cancelled => (SkillsCliStatus::Cancelled, None),
        RunEnd::FailedToStart => (SkillsCliStatus::FailedToStart, None),
    };
    let installed = match (&plan.root, status) {
        (Some(root), SkillsCliStatus::Finished) => verify_installed(root, &request.skills, started),
        _ => Vec::new(),
    };
    Ok(SkillsCliOutcome {
        status,
        code,
        stdout: run.stdout,
        stderr: run.stderr,
        installed,
    })
}

/// Stop a run the dialog started. Unknown or finished runs are left alone.
#[tauri::command(async)]
pub fn skills_cli_cancel(host: State<'_, SkillsCliHost>, run_id: String) -> Result<(), String> {
    if let Some(handle) = host.get(&run_id) {
        handle.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(action: SkillsCliAction, source: &str) -> SkillsCliRequest {
        SkillsCliRequest {
            run_id: "run-1".into(),
            action,
            source: source.into(),
            global: true,
            skills: Vec::new(),
            all_skills: true,
            cwd: None,
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aven-skill-install-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sources_are_github_shorthand_or_links_only() {
        for source in [
            "nutlope/hallmark",
            "vercel-labs/agent-skills",
            "owner/repo.name/skills/web-design",
            "https://github.com/nutlope/hallmark",
            "https://github.com/nutlope/hallmark/",
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo/tree/main/skills/x",
        ] {
            assert!(validate_cli_source(source).is_ok(), "{source}");
        }
        for source in [
            "",
            "hallmark",
            "-g/repo",
            "--list",
            "owner/repo; rm -rf ~",
            "owner/repo && echo",
            "owner/$(whoami)",
            "owner/`id`",
            "owner/repo|cat",
            "owner/repo name",
            "owner/../etc",
            "owner/./repo",
            "./local/skills",
            "/etc/passwd",
            "~/skills",
            "C:/skills/x",
            "git@github.com:owner/repo.git",
            "http://github.com/owner/repo",
            "https://gitlab.com/owner/repo",
            "https://github.com.evil.test/owner/repo",
            "https://github.com/owner",
            "owner//repo",
            "owner/repo\nnext",
            "owner/repo#main",
            "owner/repo@skill",
        ] {
            assert!(validate_cli_source(source).is_err(), "{source:?}");
        }
        assert!(validate_cli_source(&format!("o/{}", "a".repeat(MAX_SOURCE))).is_err());
    }

    #[test]
    fn names_and_skill_choices_are_plain_words() {
        for query in ["hallmark", "web-design", "a1", "skill_v2.1"] {
            assert!(validate_query(query).is_ok(), "{query}");
        }
        for query in ["", "-g", ".hidden", "two words", "a/b", "x;y", "$HOME"] {
            assert!(validate_query(query).is_err(), "{query:?}");
        }
        for name in [
            "hallmark",
            "Convex Best Practices",
            "web.design_2",
            "ns:skill",
        ] {
            assert!(validate_skill_name(name).is_ok(), "{name}");
        }
        for name in [
            "",
            "-g",
            "--global",
            " leading",
            "trailing ",
            "a;b",
            "a\"b",
            "$(x)",
            "a\nb",
        ] {
            assert!(validate_skill_name(name).is_err(), "{name:?}");
        }
        assert!(validate_run_id("a1b2-c3").is_ok());
        assert!(validate_run_id("../x").is_err());
        assert!(validate_run_id("").is_err());
    }

    #[test]
    fn arguments_never_pass_through_a_shell_and_follow_scope_and_choice() {
        let home = temp_dir("plan");
        let project = home.join("site");
        std::fs::create_dir_all(&project).unwrap();

        let find = plan_run(&request(SkillsCliAction::Find, "hallmark"), Some(&home)).unwrap();
        assert_eq!(find.args, ["--yes", "skills@1", "find", "hallmark"]);
        assert!(find.stream_stdout);
        assert_eq!(find.root, None);

        let list = plan_run(
            &request(SkillsCliAction::List, "nutlope/hallmark"),
            Some(&home),
        )
        .unwrap();
        assert_eq!(
            list.args,
            ["--yes", "skills@1", "add", "nutlope/hallmark", "--list"]
        );
        assert_eq!(list.cwd, home);
        assert_eq!(list.timeout, LOOKUP_TIMEOUT);

        let mut global = request(SkillsCliAction::Add, "nutlope/hallmark");
        global.skills = vec!["hallmark".into()];
        let plan = plan_run(&global, Some(&home)).unwrap();
        assert_eq!(
            plan.args,
            [
                "--yes",
                "skills@1",
                "add",
                "nutlope/hallmark",
                "--yes",
                "--json",
                "--global"
            ]
        );
        assert_eq!(plan.root.as_deref(), Some(home.as_path()));
        assert!(!plan.stream_stdout);
        assert_eq!(plan.timeout, ADD_TIMEOUT);

        let mut chosen = request(SkillsCliAction::Add, "owner/repo");
        chosen.global = false;
        chosen.all_skills = false;
        chosen.cwd = Some(project.to_string_lossy().into_owned());
        chosen.skills = vec!["alpha".into(), "Convex Best Practices".into()];
        let plan = plan_run(&chosen, Some(&home)).unwrap();
        assert_eq!(
            plan.args,
            [
                "--yes",
                "skills@1",
                "add",
                "owner/repo",
                "--yes",
                "--json",
                "--skill",
                "alpha",
                "--skill",
                "Convex Best Practices"
            ]
        );
        assert_eq!(plan.cwd, project);
        assert_eq!(plan.root.as_deref(), Some(project.as_path()));
        assert_eq!(
            display_command(&plan.args),
            "npx --yes skills@1 add owner/repo --yes --json --skill alpha --skill \"Convex Best Practices\""
        );

        let mut no_project = chosen;
        no_project.cwd = None;
        assert!(plan_run(&no_project, Some(&home)).is_err());
        no_project.cwd = Some(home.join("missing").to_string_lossy().into_owned());
        assert!(plan_run(&no_project, Some(&home)).is_err());

        let mut nothing = request(SkillsCliAction::Add, "owner/repo");
        nothing.skills.clear();
        assert!(plan_run(&nothing, Some(&home)).is_err());
        let mut flag = request(SkillsCliAction::Add, "owner/repo");
        flag.all_skills = false;
        flag.skills = vec!["--global".into()];
        assert!(plan_run(&flag, Some(&home)).is_err());
        // Taking every skill passes no names to the CLI; they are only
        // looked up on disk afterwards, by folder name.
        let mut every = request(SkillsCliAction::Add, "owner/repo");
        every.skills = vec!["C++ tips".into(), "--odd".into()];
        let plan = plan_run(&every, Some(&home)).unwrap();
        assert!(!plan
            .args
            .iter()
            .any(|arg| arg == "--skill" || arg == "--odd"));
        every.skills = vec!["bad\nname".into()];
        assert!(plan_run(&every, Some(&home)).is_err());
        assert!(plan_run(&request(SkillsCliAction::List, "hallmark"), Some(&home)).is_err());
        assert!(plan_run(&request(SkillsCliAction::Find, "a/b"), Some(&home)).is_err());
        assert!(plan_run(&request(SkillsCliAction::List, "a/b"), None).is_err());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn requests_parse_from_the_dialog_and_unknown_actions_are_refused() {
        let parsed: SkillsCliRequest = serde_json::from_str(
            r#"{"runId":"r1","action":"add","source":"owner/repo","global":false,"skills":["a"],"allSkills":false,"cwd":"/p"}"#,
        )
        .unwrap();
        assert_eq!(parsed.action, SkillsCliAction::Add);
        assert!(!parsed.global && !parsed.all_skills);
        assert!(serde_json::from_str::<SkillsCliAction>("\"remove\"").is_err());
        assert!(serde_json::from_str::<SkillsCliAction>("\"exec\"").is_err());
    }

    #[test]
    fn folder_names_match_the_cli() {
        assert_eq!(skill_folder_name("hallmark"), "hallmark");
        assert_eq!(
            skill_folder_name("Convex Best Practices"),
            "convex-best-practices"
        );
        assert_eq!(skill_folder_name("..weird//name.."), "weird-name");
        assert_eq!(skill_folder_name("v1.2_x"), "v1.2_x");
        assert_eq!(skill_folder_name("---"), "unnamed-skill");
    }

    #[test]
    fn only_skill_files_written_by_this_run_count_as_installed() {
        let root = temp_dir("verify");
        let fresh = root.join(".agents/skills/hallmark");
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::write(fresh.join("SKILL.md"), "---\nname: hallmark\n---\n").unwrap();
        let spaced = root.join(".agents/skills/convex-best-practices");
        std::fs::create_dir_all(&spaced).unwrap();
        std::fs::write(spaced.join("skill.md"), "x").unwrap();
        let names = vec![
            "hallmark".to_string(),
            "Convex Best Practices".to_string(),
            "missing".to_string(),
        ];
        let before = SystemTime::now() - Duration::from_secs(60);
        assert_eq!(
            verify_installed(&root, &names, before),
            ["hallmark", "Convex Best Practices"]
        );
        // A copy left from an earlier install is not this run's work.
        let later = SystemTime::now() + Duration::from_secs(60);
        assert!(verify_installed(&root, &names, later).is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn output_lines_are_tidy_and_bounded() {
        assert_eq!(tidy_line(b"plain\n"), "plain");
        assert_eq!(tidy_line(b"frame 1\rframe 2\r\n"), "frame 2");
        assert_eq!(tidy_line(&vec![b'x'; MAX_LINE * 2]).len(), MAX_LINE);
        let captured = Mutex::new(Captured::default());
        let seen = Mutex::new(Vec::new());
        let big = format!("{}\n", "y".repeat(MAX_STDERR)).repeat(3);
        read_lines(
            std::io::Cursor::new(big.into_bytes()),
            false,
            true,
            &captured,
            &|line| seen.lock().unwrap().push(line),
        );
        let captured = captured.into_inner().unwrap();
        assert!(captured.stderr.len() <= MAX_STDERR);
        assert_eq!(seen.into_inner().unwrap().len(), 3);
    }

    #[cfg(unix)]
    fn fixture(handle: &RunHandle, script: &str, timeout: Duration) -> (StreamedRun, Vec<String>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let run = run_streaming(
            Path::new("/bin/sh"),
            &["-c".into(), script.into()],
            &std::env::temp_dir(),
            timeout,
            false,
            handle,
            Arc::new(move |line| sink.lock().unwrap().push(line)),
        );
        let lines = lines.lock().unwrap().clone();
        (run, lines)
    }

    #[cfg(unix)]
    #[test]
    fn a_real_process_streams_progress_and_keeps_its_result_apart() {
        let handle = RunHandle::default();
        let (run, lines) = fixture(
            &handle,
            "echo 'Cloning repository' >&2; echo '[{\"name\":\"a\"}]'; echo 'Done' >&2; exit 3",
            Duration::from_secs(10),
        );
        assert_eq!(run.end, RunEnd::Exited(Some(3)));
        assert_eq!(lines, ["Cloning repository", "Done"]);
        assert_eq!(run.stdout.trim(), "[{\"name\":\"a\"}]");
        assert!(run.stderr.contains("Cloning repository"));
    }

    #[cfg(unix)]
    #[test]
    fn a_slow_process_times_out_and_a_stopped_one_is_cancelled() {
        let started = std::time::Instant::now();
        let (run, _) = fixture(
            &RunHandle::default(),
            "sleep 20",
            Duration::from_millis(100),
        );
        assert_eq!(run.end, RunEnd::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5));

        let handle = Arc::new(RunHandle::default());
        let stopper = handle.clone();
        thread::spawn(move || {
            for _ in 0..200 {
                if stopper.pid.lock().unwrap().is_some() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            stopper.cancel();
        });
        let started = std::time::Instant::now();
        let (run, _) = fixture(&handle, "sleep 20", Duration::from_secs(30));
        assert_eq!(run.end, RunEnd::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(5));

        let early = RunHandle::default();
        early.cancelled.store(true, Ordering::SeqCst);
        let (run, lines) = fixture(&early, "echo never >&2", Duration::from_secs(5));
        assert_eq!(run.end, RunEnd::Cancelled);
        assert!(lines.is_empty());
    }

    #[test]
    fn a_run_id_runs_once_at_a_time() {
        let host = SkillsCliHost::default();
        let handle = host.register("r1").unwrap();
        assert!(host.register("r1").is_err());
        assert!(Arc::ptr_eq(&host.get("r1").unwrap(), &handle));
        host.remove("r1");
        assert!(host.get("r1").is_none());
        assert!(host.register("r1").is_ok());
    }
}
