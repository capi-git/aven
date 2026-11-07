//! Try it: Avos's version of a project, running on its own port, so it can
//! be used (and pictured) before it is applied.
//!
//! Aven runs it, never an agent, only when the user asks, and only once
//! `project_bots::reviewed_copy` has checked the copy holds exactly the
//! reviewed change. It never runs in the copy itself: Aven writes the
//! reviewed commit's tracked files, straight from git, into a folder of its
//! own and installs the packages there afresh. Nothing git ignores in the
//! copy comes along (an agent's `node_modules`, build output, `.npmrc` or
//! `.env.local`), and the project's own ignored `.env` files stay in the
//! user's folder. It starts with a clean environment: no keys or tokens
//! from Aven's own. One server per copy, stopped (and its folder removed)
//! when its change is applied or sent, when Review asks, or when Aven quits.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopyServer {
    /// Where it answers: `http://127.0.0.1:<port>`.
    pub url: String,
}

/// Said when a start is stopped before it answers.
const STOPPED: &str = "Avos's version was stopped before it was ready.";

/// A process group this module started: dropping it stops the whole group,
/// so no server or install outlives the one who started it.
struct Group(Child);

impl Group {
    fn alive(&mut self) -> bool {
        matches!(self.0.try_wait(), Ok(None))
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        stop_child(&mut self.0);
    }
}

/// A folder of Aven's own a server runs from: removed when dropped.
struct Checkout(PathBuf);

impl Drop for Checkout {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Running {
    // Declared first: the server stops before its folder is removed.
    group: Group,
    _checkout: Checkout,
    url: String,
    /// The commit it serves.
    at: String,
}

/// A start in flight: a second request for the same commit waits for its
/// result, and Stop marks it cancelled (it then stops what it started).
struct Start {
    at: String,
    cancelled: AtomicBool,
    result: Mutex<Option<Result<CopyServer, String>>>,
    done: Condvar,
}

impl Start {
    fn new(at: &str) -> Self {
        Start {
            at: at.to_string(),
            cancelled: AtomicBool::new(false),
            result: Mutex::new(None),
            done: Condvar::new(),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn finish(&self, result: Result<CopyServer, String>) {
        let mut slot = self.result.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = Some(result);
        }
        self.done.notify_all();
    }

    /// Its result, once it has one (or None after `limit`).
    fn wait(&self, limit: Option<Duration>) -> Option<Result<CopyServer, String>> {
        let deadline = limit.map(|limit| Instant::now() + limit);
        let mut slot = self.result.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(result) = slot.as_ref() {
                return Some(result.clone());
            }
            slot = match deadline {
                None => self.done.wait(slot).unwrap_or_else(|e| e.into_inner()),
                Some(deadline) => {
                    let left = deadline.checked_duration_since(Instant::now())?;
                    self.done
                        .wait_timeout(slot, left)
                        .unwrap_or_else(|e| e.into_inner())
                        .0
                }
            };
        }
    }
}

enum Entry {
    Starting(Arc<Start>),
    Running(Running),
}

fn running() -> MutexGuard<'static, HashMap<PathBuf, Entry>> {
    static RUNNING: OnceLock<Mutex<HashMap<PathBuf, Entry>>> = OnceLock::new();
    RUNNING
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// A package script that starts a dev server, and the package manager the
/// project's lockfile names.
#[derive(Debug, PartialEq, Eq, Clone)]
pub(crate) struct DevScript {
    pub manager: &'static str,
    pub name: String,
    pub script: String,
}

/// The project's dev script (`dev`, else `start`, else `serve`), or none.
pub(crate) fn dev_script(dir: &Path) -> Option<DevScript> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let scripts = json.get("scripts")?.as_object()?;
    let (name, script) = ["dev", "start", "serve"].into_iter().find_map(|name| {
        let script = scripts.get(name)?.as_str()?.trim();
        (!script.is_empty()).then(|| (name.to_string(), script.to_string()))
    })?;
    Some(DevScript {
        manager: manager_for(dir),
        name,
        script,
    })
}

fn manager_for(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if dir.join("yarn.lock").is_file() {
        "yarn"
    } else if dir.join("bun.lock").is_file() || dir.join("bun.lockb").is_file() {
        "bun"
    } else {
        "npm"
    }
}

/// The command that runs `script` on `port` at 127.0.0.1. A single, known
/// dev server (Vite, Astro, Next, Nuxt) is told its port and host; anything
/// else gets them as `PORT` and `HOST` (see `serve_env`).
pub(crate) fn serve_args(script: &DevScript, port: u16) -> Vec<String> {
    let mut args = vec![
        script.manager.to_string(),
        "run".to_string(),
        script.name.clone(),
    ];
    let port = port.to_string();
    let single = !script.script.contains(['&', ';', '|', '\n']);
    let tool = script.script.split_whitespace().next().unwrap_or("");
    let extra: Vec<&str> = if !single {
        vec![]
    } else {
        match tool {
            "vite" | "astro" | "nuxt" | "nuxi" => vec!["--port", &port, "--host", "127.0.0.1"],
            "next" => vec!["-p", &port, "-H", "127.0.0.1"],
            _ => vec![],
        }
    };
    if !extra.is_empty() {
        if script.manager == "npm" {
            args.push("--".into());
        }
        args.extend(extra.into_iter().map(String::from));
        if tool == "vite" {
            args.push("--strictPort".into());
        }
    }
    args
}

/// The environment it runs with: the user's tools on PATH and the basics a
/// dev server needs, and nothing else from Aven's own (no keys, no tokens).
fn serve_env(port: u16, path: Option<String>) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = ["HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR"]
        .into_iter()
        .filter_map(|key| Some((key.to_string(), std::env::var(key).ok()?)))
        .collect();
    env.push((
        "PATH".into(),
        path.or_else(|| std::env::var("PATH").ok())
            .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin".into()),
    ));
    for (key, value) in [
        ("PORT", port.to_string()),
        ("HOST", "127.0.0.1".into()),
        ("HOSTNAME", "127.0.0.1".into()),
        ("BROWSER", "none".into()),
        ("FORCE_COLOR", "0".into()),
        ("TERM", "dumb".into()),
    ] {
        env.push((key.into(), value));
    }
    env
}

/// A port nothing listens on now.
fn free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|e| format!("No free port for Avos's version: {e}"))
}

fn answers(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// The local address a dev server printed (`http://localhost:5174/`), as a
/// port: for a server that picked its own instead of the one it was given.
pub(crate) fn printed_port(log: &str) -> Option<u16> {
    for word in log.split(|c: char| c.is_whitespace() || c == '\u{1b}') {
        let rest = word
            .strip_prefix("http://")
            .or_else(|| word.strip_prefix("https://"));
        let Some(rest) = rest else { continue };
        let host_port = rest.split('/').next().unwrap_or("");
        let Some((host, port)) = host_port.rsplit_once(':') else {
            continue;
        };
        if !matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]") {
            continue;
        }
        let digits: String = port.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(port) = digits.parse::<u16>() {
            if port > 0 {
                return Some(port);
            }
        }
    }
    None
}

/// The last lines of what it printed, for a problem it ran into.
fn tail(log: &Path, lines: usize) -> String {
    let mut text = String::new();
    if let Ok(mut file) = std::fs::File::open(log) {
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = file.seek(SeekFrom::Start(len.saturating_sub(16 * 1024)));
        let _ = file.read_to_string(&mut text);
    }
    let kept: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    kept[kept.len().saturating_sub(lines)..].join("\n")
}

fn log_file(log: &Path, append: bool) -> Result<std::fs::File, String> {
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(log)
        .map_err(|e| e.to_string())
}

fn command(
    dir: &Path,
    args: &[String],
    env: &[(String, String)],
    log: &Path,
) -> Result<Command, String> {
    let (program, rest) = args.split_first().ok_or("Nothing to run")?;
    let out = log_file(log, true)?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(program);
    cmd.args(rest)
        .current_dir(dir)
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so stopping it stops what it started.
        cmd.process_group(0);
    }
    Ok(cmd)
}

/// A path from a git tree, as a relative path that stays inside the folder
/// it is written to: no empty, `.` or `..` part, and nothing under `.git`.
fn tree_path(raw: &[u8]) -> Option<PathBuf> {
    if raw.is_empty() || raw.contains(&b'\\') || raw.contains(&0) {
        return None;
    }
    let mut path = PathBuf::new();
    for part in raw.split(|b| *b == b'/') {
        if part.is_empty() || part == b"." || part == b".." || part.eq_ignore_ascii_case(b".git") {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            path.push(std::ffi::OsStr::from_bytes(part));
        }
        #[cfg(not(unix))]
        path.push(std::str::from_utf8(part).ok()?);
    }
    Some(path)
}

/// Make `rel`'s folders under `dir`, never through a link: a tree can't
/// write outside the folder by naming a file under one of its own links.
fn make_parents(dir: &Path, rel: &Path) -> Result<(), String> {
    let mut at = dir.to_path_buf();
    let Some(parent) = rel.parent() else {
        return Ok(());
    };
    for part in parent.components() {
        at.push(part);
        match std::fs::symlink_metadata(&at) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err(format!(
                    "Avos's change has a path that can't be written: {}",
                    rel.display()
                ));
            }
            Ok(_) => {}
            Err(_) => std::fs::create_dir(&at).map_err(|e| e.to_string())?,
        }
    }
    Ok(())
}

/// Write commit `at` of the repository at `copy` into `dir` (which must not
/// exist yet): exactly its tracked files, read from git's own store, so
/// nothing in the copy's folder (ignored or not) comes along. Skips
/// submodules. Stops early when `cancelled` says so.
pub(crate) fn check_out(
    copy: &Path,
    at: &str,
    dir: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), String> {
    if !crate::race::is_sha(at) {
        return Err("Invalid commit".into());
    }
    let listing = crate::race::run(copy, &["ls-tree", "-r", "-z", "--full-tree", at])
        .map_err(|e| format!("Couldn't read Avos's change: {e}"))?;
    let mut files: Vec<(PathBuf, String, &str)> = Vec::new();
    for entry in listing.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let tab = entry.iter().position(|b| *b == b'\t').ok_or("Bad tree")?;
        let meta = std::str::from_utf8(&entry[..tab]).map_err(|_| "Bad tree")?;
        let mut parts = meta.split(' ');
        let (Some(mode), Some(kind), Some(oid)) = (parts.next(), parts.next(), parts.next()) else {
            return Err("Bad tree".into());
        };
        let mode = match (kind, mode) {
            ("blob", "100644") => "file",
            ("blob", "100755") => "program",
            ("blob", "120000") => "link",
            // A submodule isn't part of this repository's own files.
            ("commit", _) => continue,
            _ => return Err("Bad tree".into()),
        };
        if !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Bad tree".into());
        }
        let path = tree_path(&entry[tab + 1..]).ok_or_else(|| {
            format!(
                "Avos's change has a path that can't be written: {}",
                String::from_utf8_lossy(&entry[tab + 1..])
            )
        })?;
        files.push((path, oid.to_string(), mode));
    }
    // Links last, so no file is ever written through one.
    files.sort_by_key(|(_, _, mode)| *mode == "link");
    std::fs::create_dir_all(dir.parent().unwrap_or(dir)).map_err(|e| e.to_string())?;
    std::fs::create_dir(dir).map_err(|e| e.to_string())?;

    let mut cat = crate::race::git(copy);
    let mut child = cat
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Could not run git")?;
    let wanted: Vec<String> = files.iter().map(|(_, oid, _)| oid.clone()).collect();
    let writer = std::thread::spawn(move || {
        for oid in wanted {
            if writeln!(stdin, "{oid}").is_err() {
                break;
            }
        }
    });
    let mut out = BufReader::new(child.stdout.take().ok_or("Could not run git")?);
    let written = (|| -> Result<(), String> {
        for (rel, oid, mode) in &files {
            if cancelled() {
                return Err(STOPPED.into());
            }
            let mut header = String::new();
            out.read_line(&mut header).map_err(|e| e.to_string())?;
            let mut words = header.split_whitespace();
            let (Some(got), Some("blob"), Some(size)) = (words.next(), words.next(), words.next())
            else {
                return Err(format!("Couldn't read {} from git", rel.display()));
            };
            let size: u64 = size.parse().map_err(|_| "Bad object size")?;
            if got != oid {
                return Err(format!("Couldn't read {} from git", rel.display()));
            }
            make_parents(dir, rel)?;
            let target = dir.join(rel);
            if *mode == "link" {
                let mut to = Vec::new();
                (&mut out)
                    .take(size)
                    .read_to_end(&mut to)
                    .map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::ffi::OsStrExt;
                    std::os::unix::fs::symlink(std::ffi::OsStr::from_bytes(&to), &target)
                        .map_err(|e| format!("Couldn't write {}: {e}", rel.display()))?;
                }
                #[cfg(not(unix))]
                std::fs::write(&target, &to).map_err(|e| e.to_string())?;
            } else {
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(|e| format!("Couldn't write {}: {e}", rel.display()))?;
                let copied = std::io::copy(&mut (&mut out).take(size), &mut file)
                    .map_err(|e| e.to_string())?;
                if copied != size {
                    return Err(format!("Couldn't read {} from git", rel.display()));
                }
                #[cfg(unix)]
                if *mode == "program" {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
                        .map_err(|e| e.to_string())?;
                }
            }
            // Each object ends with a newline.
            let mut end = [0u8; 1];
            out.read_exact(&mut end).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    drop(out);
    let _ = child.kill();
    let _ = child.wait();
    let _ = writer.join();
    written
}

/// Install the packages afresh, as the user would, in Aven's own folder.
fn install(
    dir: &Path,
    script: &DevScript,
    env: &[(String, String)],
    log: &Path,
    start: &Start,
) -> Result<(), String> {
    if !dir.join("package.json").is_file() {
        return Ok(());
    }
    let args = vec![script.manager.to_string(), "install".to_string()];
    let mut child = Group(
        command(dir, &args, env, log)?
            .spawn()
            .map_err(|e| format!("Couldn't run {}: {e}", script.manager))?,
    );
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if let Some(status) = child.0.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "Couldn't install the packages for Avos's version:\n{}",
                    tail(log, 8)
                ))
            };
        }
        if start.cancelled() {
            return Err(STOPPED.into());
        }
        if Instant::now() > deadline {
            return Err("Installing the packages for Avos's version took too long.".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn stop_child(child: &mut Child) {
    #[cfg(unix)]
    {
        let group = child.id() as i32;
        // SAFETY: signalling a process group this module started. The group
        // is signalled even when its first process has ended, for what it
        // started.
        unsafe {
            libc::kill(-group, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Check out commit `at` into `work`, install and run it, and wait until it
/// answers. Whatever it started is stopped and removed when it fails or
/// `start` is cancelled.
fn start_server(
    copy: &Path,
    at: &str,
    work: &Path,
    log: &Path,
    path: Option<String>,
    start: &Start,
) -> Result<Running, String> {
    // Only one start or server per copy at a time: what's here is left over.
    let _ = std::fs::remove_dir_all(work);
    let checkout = Checkout(work.join(at));
    let _ = log_file(log, false)?;
    check_out(copy, at, &checkout.0, &|| start.cancelled())?;
    let script = dev_script(&checkout.0).ok_or(
        "Avos's version has nothing to run: its package.json has no dev, start or serve script.",
    )?;
    let port = free_port()?;
    let env = serve_env(port, path);
    install(&checkout.0, &script, &env, log, start)?;
    let mut group = Group(
        command(&checkout.0, &serve_args(&script, port), &env, log)?
            .spawn()
            .map_err(|e| format!("Couldn't run {}: {e}", script.manager))?,
    );
    let deadline = Instant::now() + Duration::from_secs(120);
    let url = loop {
        if let Some(status) = group.0.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "Avos's version stopped before it was ready ({status}):\n{}",
                tail(log, 8)
            ));
        }
        if start.cancelled() {
            return Err(STOPPED.into());
        }
        if answers(port) {
            break format!("http://127.0.0.1:{port}");
        }
        if let Some(printed) = printed_port(&tail(log, 40)).filter(|p| *p != port) {
            if answers(printed) {
                break format!("http://127.0.0.1:{printed}");
            }
        }
        if Instant::now() > deadline {
            return Err(format!(
                "Avos's version didn't answer within two minutes:\n{}",
                tail(log, 8)
            ));
        }
        std::thread::sleep(Duration::from_millis(300));
    };
    Ok(Running {
        group,
        _checkout: checkout,
        url,
        at: at.to_string(),
    })
}

/// Settles a start: its entry leaves the list unless it became the running
/// server, then its result goes to whoever waits for it. Also when the
/// start panics.
struct Settle<'a> {
    copy: &'a Path,
    start: Arc<Start>,
    result: Option<Result<CopyServer, String>>,
}

impl Drop for Settle<'_> {
    fn drop(&mut self) {
        let mut all = running();
        if matches!(all.get(self.copy), Some(Entry::Starting(s)) if Arc::ptr_eq(s, &self.start)) {
            all.remove(self.copy);
        }
        drop(all);
        let result = self.result.take().unwrap_or_else(|| Err(STOPPED.into()));
        self.start.finish(result);
    }
}

/// Run commit `at` of the copy at `copy` (already checked to hold it), or
/// give the server already running it. Runs from `work`, a folder of
/// Aven's own for this copy, never from the copy itself. Waits until it
/// answers. A second request while one starts waits for that start rather
/// than starting another.
pub(crate) fn serve(
    copy: &Path,
    at: &str,
    work: &Path,
    log: &Path,
    path: Option<String>,
) -> Result<CopyServer, String> {
    let start = loop {
        let mut all = running();
        match all.get_mut(copy) {
            Some(Entry::Running(server)) if server.at == at => {
                if server.group.alive() {
                    return Ok(CopyServer {
                        url: server.url.clone(),
                    });
                }
            }
            Some(Entry::Starting(start)) => {
                let start = start.clone();
                let join = start.at == at && !start.cancelled();
                if !join {
                    // Another commit, or a stopped start: let it end first.
                    start.cancel();
                }
                drop(all);
                let result = start.wait(None);
                if join {
                    return result.unwrap_or_else(|| Err(STOPPED.into()));
                }
                continue;
            }
            _ => {}
        }
        let old = all.remove(copy);
        let start = Arc::new(Start::new(at));
        all.insert(copy.to_path_buf(), Entry::Starting(start.clone()));
        drop(all);
        // A server for another commit, or one that ended: stopped and its
        // folder removed before this one starts.
        drop(old);
        break start;
    };
    let mut settle = Settle {
        copy,
        start: start.clone(),
        result: None,
    };
    let result = start_server(copy, at, work, log, path, &start).and_then(|server| {
        let url = server.url.clone();
        let mut all = running();
        // Checked under the same lock Stop marks it with, so a stopped
        // start never becomes the running server.
        let ours = !start.cancelled()
            && matches!(all.get(copy), Some(Entry::Starting(s)) if Arc::ptr_eq(s, &start));
        if !ours {
            drop(all);
            drop(server);
            return Err(STOPPED.to_string());
        }
        all.insert(copy.to_path_buf(), Entry::Running(server));
        Ok(CopyServer { url })
    });
    settle.result = Some(result.clone());
    drop(settle);
    result
}

/// Stop the copy's server, or the start in flight for it, if any.
pub(crate) fn stop(copy: &Path) {
    let server = {
        let mut all = running();
        match all.get(copy) {
            Some(Entry::Starting(start)) => {
                // It stops what it started, and leaves the list, itself.
                start.cancel();
                None
            }
            Some(Entry::Running(_)) => all.remove(copy),
            None => None,
        }
    };
    drop(server);
}

/// Stop every copy's server and start: Aven is quitting. Waits a little for
/// starts in flight to stop what they started.
pub(crate) fn stop_all() {
    let (servers, starts): (Vec<Entry>, Vec<Arc<Start>>) = {
        let mut all = running();
        let mut starts = Vec::new();
        for entry in all.values() {
            if let Entry::Starting(start) = entry {
                start.cancel();
                starts.push(start.clone());
            }
        }
        let servers = all
            .extract_if(|_, entry| matches!(entry, Entry::Running(_)))
            .map(|(_, entry)| entry)
            .collect();
        (servers, starts)
    };
    drop(servers);
    let deadline = Instant::now() + Duration::from_secs(5);
    for start in starts {
        let left = deadline.saturating_duration_since(Instant::now());
        let _ = start.wait(Some(left));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script(manager: &'static str, script: &str) -> DevScript {
        DevScript {
            manager,
            name: "dev".into(),
            script: script.into(),
        }
    }

    #[test]
    fn tells_known_dev_servers_their_port_and_host() {
        assert_eq!(
            serve_args(&script("npm", "vite"), 5190),
            [
                "npm",
                "run",
                "dev",
                "--",
                "--port",
                "5190",
                "--host",
                "127.0.0.1",
                "--strictPort"
            ]
        );
        assert_eq!(
            serve_args(&script("pnpm", "next dev"), 5190),
            ["pnpm", "run", "dev", "-p", "5190", "-H", "127.0.0.1"]
        );
        // Anything else, or more than one command, gets PORT and HOST only.
        assert_eq!(
            serve_args(&script("yarn", "react-scripts start"), 5190),
            ["yarn", "run", "dev"]
        );
        assert_eq!(
            serve_args(&script("npm", "vite & tsc -w"), 5190),
            ["npm", "run", "dev"]
        );
    }

    #[test]
    fn finds_the_port_a_server_printed() {
        assert_eq!(
            printed_port("  ➜  Local:   http://localhost:5174/\n  ➜  Network: use --host"),
            Some(5174)
        );
        assert_eq!(printed_port("ready on http://127.0.0.1:3001"), Some(3001));
        assert_eq!(printed_port("see https://vitejs.dev:443/guide"), None);
        assert_eq!(printed_port("nothing yet"), None);
    }

    #[test]
    fn runs_without_aven_s_own_keys() {
        std::env::set_var("AVEN_TEST_SECRET_TOKEN", "x");
        let env = serve_env(4000, Some("/opt/bin".into()));
        assert!(env.iter().all(|(key, _)| key != "AVEN_TEST_SECRET_TOKEN"));
        assert!(env.contains(&("PATH".into(), "/opt/bin".into())));
        assert!(env.contains(&("PORT".into(), "4000".into())));
        std::env::remove_var("AVEN_TEST_SECRET_TOKEN");
    }

    #[test]
    fn reads_the_dev_script_and_its_package_manager() {
        let dir = std::env::temp_dir().join(format!("aven-serve-script-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"build":"vite build","start":"node server.js"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(
            dev_script(&dir),
            Some(DevScript {
                manager: "pnpm",
                name: "start".into(),
                script: "node server.js".into()
            })
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_tree_paths_inside_the_folder() {
        assert_eq!(tree_path(b"src/app.ts"), Some(PathBuf::from("src/app.ts")));
        for bad in [
            &b""[..],
            b"..",
            b"a/../b",
            b"./a",
            b"/etc/passwd",
            b"a//b",
            b".git/config",
            b"sub/.GIT/hooks/x",
            b"a\\b",
        ] {
            assert_eq!(tree_path(bad), None, "{}", String::from_utf8_lossy(bad));
        }
    }

    #[cfg(unix)]
    fn has(tools: &str) -> bool {
        std::process::Command::new("sh")
            .args([
                "-c",
                &format!("for t in {tools}; do command -v $t || exit 1; done"),
            ])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }

    #[cfg(unix)]
    fn git(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "user.name=Aven",
                "-c",
                "user.email=aven@example.com",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {out:?}");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// A repository standing in for Avos's copy: `files` committed, and
    /// what an agent might leave beside them that git ignores.
    #[cfg(unix)]
    fn copy_with(name: &str, files: &[(&str, &str)]) -> (PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("aven-serve-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q"]);
        std::fs::write(dir.join(".gitignore"), "node_modules\n.env.local\n").unwrap();
        for (path, text) in files {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "reviewed"]);
        std::fs::create_dir_all(dir.join("node_modules/.bin")).unwrap();
        std::fs::write(dir.join("node_modules/.bin/planted"), "agent-made").unwrap();
        std::fs::write(dir.join(".env.local"), "SECRET=1").unwrap();
        let at = git(&dir, &["rev-parse", "HEAD"]);
        (dir, at)
    }

    #[cfg(unix)]
    fn package(dev: &str) -> String {
        serde_json::json!({ "name": "copy", "private": true, "scripts": { "dev": dev } })
            .to_string()
    }

    #[cfg(unix)]
    #[test]
    fn checks_out_only_the_commit_s_tracked_files() {
        use std::os::unix::fs::PermissionsExt;
        if !has("git") {
            return;
        }
        let (copy, _) = copy_with(
            "checkout",
            &[("package.json", "{}"), ("bin/run.sh", "echo")],
        );
        std::fs::set_permissions(
            copy.join("bin/run.sh"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::os::unix::fs::symlink("package.json", copy.join("link")).unwrap();
        git(&copy, &["add", "-A"]);
        git(&copy, &["commit", "-q", "-m", "more"]);
        let at = git(&copy, &["rev-parse", "HEAD"]);
        // Changed after the commit: the commit's version is what runs.
        std::fs::write(copy.join("package.json"), "{\"changed\":1}").unwrap();
        let out = copy.with_extension("out");
        let _ = std::fs::remove_dir_all(&out);
        check_out(&copy, &at, &out, &|| false).unwrap();
        assert_eq!(
            std::fs::read_to_string(out.join("package.json")).unwrap(),
            "{}"
        );
        let mode = std::fs::metadata(out.join("bin/run.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111);
        assert_eq!(
            std::fs::read_link(out.join("link")).unwrap(),
            PathBuf::from("package.json")
        );
        assert!(!out.join(".env.local").exists());
        assert!(!out.join("node_modules").exists());
        assert!(!out.join(".git").exists());
        // Stopped part way: an error, not a partial success.
        let _ = std::fs::remove_dir_all(&out);
        assert_eq!(check_out(&copy, &at, &out, &|| true), Err(STOPPED.into()));
        std::fs::remove_dir_all(&out).unwrap();
        std::fs::remove_dir_all(&copy).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn serves_the_reviewed_commit_until_stopped() {
        if !has("git node npm") {
            return;
        }
        let (copy, at) = copy_with(
            "serve",
            &[(
                "package.json",
                &package(
                    "node -e \"require('http').createServer((q,s)=>s.end('copy')).listen(+process.env.PORT,'127.0.0.1')\"",
                ),
            )],
        );
        let work = copy.with_extension("work");
        let log = copy.with_extension("log");
        let first = serve(&copy, &at, &work, &log, None).unwrap();
        let port: u16 = first.url.rsplit(':').next().unwrap().parse().unwrap();
        assert!(answers(port));
        // It runs from Aven's own folder, without what git ignores.
        let checkout = work.join(&at);
        assert!(checkout.join("package.json").is_file());
        assert!(!checkout.join(".env.local").exists());
        assert!(!checkout.join("node_modules/.bin/planted").exists());
        // The same commit: the same server.
        assert_eq!(serve(&copy, &at, &work, &log, None).unwrap(), first);
        stop(&copy);
        assert!(!answers(port));
        assert!(!checkout.exists());
        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(&log);
        std::fs::remove_dir_all(&copy).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_second_request_joins_the_start_in_flight() {
        if !has("git node npm") {
            return;
        }
        let counter = std::env::temp_dir().join(format!("aven-serve-count-{}", std::process::id()));
        let _ = std::fs::remove_file(&counter);
        let dev = format!(
            "node -e \"require('fs').appendFileSync('{}','x');require('http').createServer((q,s)=>s.end('copy')).listen(+process.env.PORT,'127.0.0.1')\"",
            counter.display()
        );
        let (copy, at) = copy_with("join", &[("package.json", &package(&dev))]);
        let work = copy.with_extension("work");
        let log = copy.with_extension("log");
        let runs: Vec<_> = (0..3)
            .map(|_| {
                let (copy, at, work, log) = (copy.clone(), at.clone(), work.clone(), log.clone());
                std::thread::spawn(move || serve(&copy, &at, &work, &log, None))
            })
            .collect();
        let urls: Vec<_> = runs
            .into_iter()
            .map(|run| run.join().unwrap().unwrap())
            .collect();
        assert!(urls.iter().all(|url| *url == urls[0]));
        // One install and one server, not one each.
        assert_eq!(std::fs::read_to_string(&counter).unwrap(), "x");
        stop(&copy);
        let _ = std::fs::remove_file(&counter);
        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(&log);
        std::fs::remove_dir_all(&copy).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn stopping_a_start_stops_what_it_started() {
        if !has("git node npm") {
            return;
        }
        let pid_file = std::env::temp_dir().join(format!("aven-serve-pid-{}", std::process::id()));
        let _ = std::fs::remove_file(&pid_file);
        // A server that never answers: the start is still in flight.
        let dev = format!(
            "node -e \"require('fs').writeFileSync('{}',String(process.pid));setInterval(()=>{{}},1000)\"",
            pid_file.display()
        );
        let (copy, at) = copy_with("cancel", &[("package.json", &package(&dev))]);
        let work = copy.with_extension("work");
        let log = copy.with_extension("log");
        let run = {
            let (copy, at, work, log) = (copy.clone(), at.clone(), work.clone(), log.clone());
            std::thread::spawn(move || serve(&copy, &at, &work, &log, None))
        };
        let deadline = Instant::now() + Duration::from_secs(90);
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_file)
                .ok()
                .and_then(|text| text.trim().parse::<i32>().ok())
            {
                break pid;
            }
            assert!(Instant::now() < deadline, "the server never started");
            std::thread::sleep(Duration::from_millis(100));
        };
        stop(&copy);
        assert_eq!(run.join().unwrap(), Err(STOPPED.into()));
        let gone = Instant::now() + Duration::from_secs(5);
        // SAFETY: signal 0 only asks whether the process exists.
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(Instant::now() < gone, "the server outlived its stop");
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(!work.join(&at).exists());
        assert!(running().get(&copy).is_none());
        let _ = std::fs::remove_file(&pid_file);
        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(&log);
        std::fs::remove_dir_all(&copy).unwrap();
    }
}
