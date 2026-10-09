use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::fs::expand_home;

const DATA_EVENT: &str = "pty-data";
const EXIT_EVENT: &str = "pty-exit";
const READ_CHUNK: usize = 32 * 1024;
/// Cap how often a busy PTY hops the webview. Each `emit` is a JS eval; a
/// flood of small reads was thousands per second and froze input.
const PTY_COALESCE: Duration = Duration::from_millis(8);
#[cfg(unix)]
const KILL_ESCALATE: Duration = Duration::from_secs(1);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
    code: Option<i32>,
}

struct LivePty {
    writer: Mutex<Box<dyn Write + Send>>,
    #[cfg(unix)]
    master_fd: OwnedFd,
    #[cfg(windows)]
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    pid: u32,
}

enum PtySlot {
    Starting(u64),
    Running(Arc<LivePty>),
}

pub struct PtyHost {
    sessions: Mutex<HashMap<String, PtySlot>>,
    next_spawn: AtomicU64,
}

impl PtyHost {
    /// Inspect without closing terminals. A shell alone is not proof of
    /// idleness: builtins and background jobs may still be doing useful work.
    pub(crate) fn ensure_update_idle(&self, close_terminals: bool) -> Result<usize, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal activity could not be checked")?;
        if !sessions.is_empty() && !close_terminals {
            return Err("Confirm closing open terminals before restarting to update. The update will stay downloaded and ready.".into());
        }
        Ok(sessions.len())
    }

    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_spawn: AtomicU64::new(1),
        }
    }

    #[cfg(test)]
    fn insert(&self, id: String, live: Arc<LivePty>) {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, PtySlot::Running(live));
    }

    fn begin_spawn(&self, id: &str) -> (u64, Option<Arc<LivePty>>) {
        let ticket = self.next_spawn.fetch_add(1, Ordering::Relaxed);
        let previous = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), PtySlot::Starting(ticket));
        let running = match previous {
            Some(PtySlot::Running(live)) => Some(live),
            _ => None,
        };
        (ticket, running)
    }

    fn install_spawn(&self, id: &str, ticket: u64, live: Arc<LivePty>) -> bool {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(sessions.get(id), Some(PtySlot::Starting(current)) if *current == ticket) {
            return false;
        }
        sessions.insert(id.to_string(), PtySlot::Running(live));
        true
    }

    fn cancel_spawn(&self, id: &str, ticket: u64) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(sessions.get(id), Some(PtySlot::Starting(current)) if *current == ticket) {
            sessions.remove(id);
        }
    }

    fn get(&self, id: &str) -> Option<Arc<LivePty>> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .and_then(|slot| match slot {
                PtySlot::Running(live) => Some(live.clone()),
                PtySlot::Starting(_) => None,
            })
    }

    fn remove(&self, id: &str) -> Option<Arc<LivePty>> {
        match self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id)
        {
            Some(PtySlot::Running(live)) => Some(live),
            _ => None,
        }
    }

    fn remove_if_pid(&self, id: &str, pid: u32) -> Option<Arc<LivePty>> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(sessions.get(id), Some(PtySlot::Running(live)) if live.pid == pid) {
            return None;
        }
        match sessions.remove(id) {
            Some(PtySlot::Running(live)) => Some(live),
            _ => None,
        }
    }

    pub(crate) fn kill_all(&self) {
        let kids: Vec<Arc<LivePty>> = {
            let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.drain()
                .filter_map(|(_, slot)| match slot {
                    PtySlot::Running(live) => Some(live),
                    PtySlot::Starting(_) => None,
                })
                .collect()
        };
        let pids: Vec<u32> = kids.iter().map(|live| live.pid).collect();
        for live in kids {
            #[cfg(unix)]
            {
                hangup(live.pid);
            }
            #[cfg(not(unix))]
            drop(live);
        }
        // Quit and `Drop` both exit the process, so the SIGKILL has to land
        // before this returns. `terminate`'s detached escalate thread never gets
        // to run, and every shell is its own `setsid` session that outlives us.
        crate::harness::terminate_all(&pids);
    }
}

impl Drop for PtyHost {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    reuse_existing: Option<bool>,
) -> Result<(), String> {
    let work = crate::window::begin_runtime_work(&app)?;
    let host = app.state::<PtyHost>();
    if reuse_existing == Some(true) && host.get(&id).is_some() {
        return pty_resize(host, id, cols, rows);
    }
    // Reserve before waiting for a blocking worker, so Close can cancel a
    // startup that has not reached fork/exec yet.
    let (ticket, previous) = host.begin_spawn(&id);
    tauri::async_runtime::spawn_blocking(move || {
        let _work = work;
        let host = app.state::<PtyHost>();
        if let Some(prev) = previous {
            terminate(prev.pid);
        }

        #[cfg(unix)]
        let result = spawn_unix(
            app.clone(),
            &host,
            id.clone(),
            cwd,
            cols.max(2),
            rows.max(2),
            ticket,
        );

        #[cfg(windows)]
        let result = spawn_windows(
            app.clone(),
            &host,
            id.clone(),
            cwd,
            cols.max(2),
            rows.max(2),
            ticket,
        );

        #[cfg(not(any(unix, windows)))]
        let result = {
            let _ = (cwd, cols, rows);
            Err("Terminals are not supported on this platform.".into())
        };
        if result.is_err() {
            host.cancel_spawn(&id, ticket);
        }
        result
    })
    .await
    .map_err(|error| format!("Terminal startup was interrupted: {error}"))?
}

#[tauri::command]
pub async fn pty_write(
    app: AppHandle,
    host: State<'_, PtyHost>,
    id: String,
    data: String,
) -> Result<(), String> {
    let work = crate::window::begin_runtime_work(&app)?;
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    // The frontend chains writes per terminal. Keep the OS pipe wait off the
    // GUI and async executor threads without changing completion/error signals.
    tauri::async_runtime::spawn_blocking(move || {
        let _work = work;
        let mut writer = live.writer.lock().unwrap_or_else(|e| e.into_inner());
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| format!("Failed to write to terminal: {e}"))
    })
    .await
    .map_err(|error| format!("Terminal input was interrupted: {error}"))?
}

#[tauri::command]
pub fn pty_resize(host: State<PtyHost>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    #[cfg(unix)]
    {
        resize_fd(live.master_fd.as_raw_fd(), cols.max(2), rows.max(2))
    }
    #[cfg(windows)]
    {
        let master = live.master.lock().unwrap_or_else(|e| e.into_inner());
        master
            .resize(portable_pty::PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("Failed to resize terminal: {err}"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (live, cols, rows);
        Err("Terminals are not supported on this platform.".into())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyStatus {
    foreground: Option<String>,
}

/// Off the main thread: inspect the foreground job without spawning a helper
/// on macOS/Linux. Other Unix targets retain the portable `ps` fallback.
#[tauri::command(async)]
pub fn pty_status(host: State<'_, PtyHost>, id: String) -> Result<PtyStatus, String> {
    let live = host
        .get(&id)
        .ok_or_else(|| "Terminal is not running".to_string())?;
    #[cfg(unix)]
    {
        let foreground = foreground_label(live.master_fd.as_raw_fd(), live.pid);
        Ok(PtyStatus { foreground })
    }
    #[cfg(not(unix))]
    {
        let _ = live;
        Ok(PtyStatus { foreground: None })
    }
}

#[tauri::command]
pub fn pty_kill(host: State<PtyHost>, id: String) -> Result<(), String> {
    if let Some(live) = host.remove(&id) {
        terminate(live.pid);
    }
    Ok(())
}

/// Off the main thread: `kill_all` waits for the shells to die before it
/// returns, and a window close calls this while the app keeps running.
#[tauri::command(async)]
pub fn pty_kill_all(host: State<'_, PtyHost>) -> Result<(), String> {
    host.kill_all();
    Ok(())
}

#[cfg(unix)]
fn spawn_unix(
    app: AppHandle,
    host: &PtyHost,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    ticket: u64,
) -> Result<(), String> {
    use std::fs::File;
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    let workdir = working_dir(&cwd);
    let (shell, args) = default_shell();
    let (master, slave) = open_pty(cols, rows)?;
    // Allocate everything before forking. Any setup failure drops all the FDs
    // without leaving an unregistered shell behind.
    let reader = File::from(dup_fd(master.as_raw_fd())?);
    let writer = File::from(dup_fd(master.as_raw_fd())?);

    let mut cmd = Command::new(&shell);
    cmd.args(&args)
        .current_dir(&workdir)
        .stdin(dup_stdio(slave.as_raw_fd())?)
        .stdout(dup_stdio(slave.as_raw_fd())?)
        .stderr(dup_stdio(slave.as_raw_fd())?)
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("COLORFGBG", "15;0")
        .env("TERM_PROGRAM", "Aven")
        .env("PATH", crate::harness::gui_search_path());
    if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
    }
    cmd.env("PWD", &workdir);
    crate::harness::clear_scoped_capabilities(&mut cmd);

    // setsid() already creates a new session and process group. Calling
    // process_group(0) first makes the child a group leader, so setsid()
    // fails with EPERM ("Operation not permitted").
    let slave_fd = slave.as_raw_fd();
    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // Controlling tty is best-effort; the shell still runs without it.
            let _ = libc::ioctl(0, libc::TIOCSCTTY as _, 0);
            if slave_fd > 2 {
                libc::close(slave_fd);
            }
            Ok(())
        });
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {shell}: {e}"))?;
    drop(slave);
    let pid = child.id();

    let live = Arc::new(LivePty {
        writer: Mutex::new(Box::new(writer)),
        master_fd: master,
        pid,
    });
    if !host.install_spawn(&id, ticket, live) {
        terminate(pid);
        thread::spawn(move || {
            let _ = child.wait();
        });
        return Err("Terminal startup was cancelled".into());
    }

    let data_app = app.clone();
    let data_id = id.clone();
    thread::spawn(move || {
        let mut file = reader;
        let fd = file.as_raw_fd();
        let mut buf = vec![0_u8; READ_CHUNK];
        let mut acc = Vec::with_capacity(READ_CHUNK);
        let mut last_emit = Instant::now();
        loop {
            if acc.is_empty() {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        last_emit = Instant::now();
                    }
                    Err(_) => break,
                }
            } else if pty_should_flush(acc.len(), last_emit.elapsed())
                || !wait_readable(fd, PTY_COALESCE.saturating_sub(last_emit.elapsed()))
            {
                emit_pty_data(&data_app, &data_id, &acc);
                acc.clear();
                last_emit = Instant::now();
            } else {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => acc.extend_from_slice(&buf[..n]),
                    Err(_) => break,
                }
            }
        }
        emit_pty_data(&data_app, &data_id, &acc);
    });

    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        // Only announce this child. A remount/respawn reuses the id, and the
        // previous wait thread must not paint "[process exited]" on the new PTY
        // or yank the replacement out of the host map.
        let emit = if let Some(host) = wait_app.try_state::<PtyHost>() {
            host.remove_if_pid(&wait_id, pid).is_some()
        } else {
            false
        };
        if emit {
            let _ = wait_app.emit(EXIT_EVENT, PtyExit { id: wait_id, code });
        }
    });

    Ok(())
}

#[cfg(windows)]
fn spawn_windows(
    app: AppHandle,
    host: &PtyHost,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    ticket: u64,
) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let workdir = working_dir(&cwd);
    let (shell, args) = default_shell();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("Failed to open terminal: {err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&args);
    cmd.cwd(&workdir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("COLORFGBG", "15;0");
    cmd.env("TERM_PROGRAM", "Aven");
    cmd.env("PATH", crate::harness::gui_search_path());
    if let Some(home) = dirs_home() {
        cmd.env("HOME", &home);
        cmd.env("USERPROFILE", &home);
    }
    cmd.env("PWD", workdir.to_string_lossy().as_ref());
    // A user's terminal is not an agent's scoped browser or control session.
    for key in crate::browser_agent::ENV_KEYS
        .into_iter()
        .chain(crate::control::ENV_KEYS)
    {
        cmd.env_remove(key);
    }

    let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), cmd)
        .map_err(|err| format!("Failed to start {shell}: {err}"))?;
    let pid = child.process_id().unwrap_or(0);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("Failed to read terminal: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("Failed to write to terminal: {err}"))?;

    let live = Arc::new(LivePty {
        writer: Mutex::new(Box::new(writer)),
        master: Mutex::new(pair.master),
        pid,
    });
    if !host.install_spawn(&id, ticket, live) {
        terminate(pid);
        thread::spawn(move || {
            let _ = child.wait();
        });
        return Err("Terminal startup was cancelled".into());
    }

    let data_app = app.clone();
    let data_id = id.clone();
    thread::spawn(move || {
        let mut buf = vec![0_u8; READ_CHUNK];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // ponytail: caps bridge traffic at 125 emits/s; use a timed
                    // drain only if sustained PTY throughput becomes limiting.
                    thread::sleep(PTY_COALESCE);
                    emit_pty_data(&data_app, &data_id, &buf[..n]);
                }
                Err(_) => break,
            }
        }
    });

    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        let emit = if let Some(host) = wait_app.try_state::<PtyHost>() {
            host.remove_if_pid(&wait_id, pid).is_some()
        } else {
            false
        };
        if emit {
            let _ = wait_app.emit(EXIT_EVENT, PtyExit { id: wait_id, code });
        }
    });

    Ok(())
}

fn working_dir(cwd: &str) -> std::path::PathBuf {
    let path = expand_home(cwd);
    if path.is_dir() {
        return path;
    }
    dirs_home().map(std::path::PathBuf::from).unwrap_or(path)
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return (comspec, Vec::new());
            }
        }
        ("powershell.exe".into(), vec!["-NoLogo".into()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            });
        let args = login_args(&shell)
            .iter()
            .map(|arg| (*arg).to_string())
            .collect();
        (shell, args)
    }
}

#[cfg(not(windows))]
fn login_args(shell: &str) -> &'static [&'static str] {
    match std::path::Path::new(shell)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
    {
        "zsh" | "bash" | "sh" | "fish" => &["-l"],
        _ => &[],
    }
}

/// The hangup a closing shell expects, without `terminate`'s escalation.
#[cfg(unix)]
fn hangup(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    let ipid = pid as i32;
    unsafe {
        libc::kill(ipid, libc::SIGHUP);
        libc::kill(-ipid, libc::SIGHUP);
    }
}

fn terminate(pid: u32) {
    if pid == 0 || pid == 1 {
        return;
    }
    #[cfg(unix)]
    {
        let ipid = pid as i32;
        unsafe {
            libc::kill(ipid, libc::SIGHUP);
            libc::kill(-ipid, libc::SIGHUP);
            libc::kill(ipid, libc::SIGTERM);
            libc::kill(-ipid, libc::SIGTERM);
        }
        thread::spawn(move || {
            thread::sleep(KILL_ESCALATE);
            unsafe {
                libc::kill(ipid, libc::SIGKILL);
                libc::kill(-ipid, libc::SIGKILL);
            }
        });
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        crate::hide_window_console(&mut cmd);
        let _ = cmd
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

#[cfg(unix)]
fn open_pty(cols: u16, rows: u16) -> Result<(OwnedFd, OwnedFd), String> {
    let master = unsafe { libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC) };
    if master < 0 {
        return Err(os_err("Failed to open terminal"));
    }
    let master = unsafe { OwnedFd::from_raw_fd(master) };
    if unsafe { libc::grantpt(master.as_raw_fd()) } != 0
        || unsafe { libc::unlockpt(master.as_raw_fd()) } != 0
    {
        return Err(os_err("Failed to unlock terminal"));
    }
    let name = slave_name(master.as_raw_fd())?;
    let slave = unsafe {
        libc::open(
            name.as_ptr(),
            libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC,
        )
    };
    if slave < 0 {
        return Err(os_err("Failed to open terminal slave"));
    }
    let slave = unsafe { OwnedFd::from_raw_fd(slave) };
    resize_fd(master.as_raw_fd(), cols, rows)?;
    Ok((master, slave))
}

#[cfg(unix)]
fn slave_name(master: i32) -> Result<std::ffi::CString, String> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut buf = vec![0_i8; 64];
        let ret = unsafe { libc::ptsname_r(master, buf.as_mut_ptr(), buf.len()) };
        if ret != 0 {
            return Err(os_err("Failed to resolve terminal name"));
        }
        let last = buf.len() - 1;
        buf[last] = 0;
        Ok(unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_owned())
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let ptr = unsafe { libc::ptsname(master) };
        if ptr.is_null() {
            return Err(os_err("Failed to resolve terminal name"));
        }
        Ok(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_owned())
    }
}

#[cfg(unix)]
fn resize_fd(fd: i32, cols: u16, rows: u16) -> Result<(), String> {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } != 0 {
        return Err(os_err("Failed to resize terminal"));
    }
    Ok(())
}

#[cfg(unix)]
fn dup_fd(fd: i32) -> Result<OwnedFd, String> {
    // dup() clears FD_CLOEXEC. Set it atomically on every copy so unrelated
    // terminals and agent children cannot inherit another terminal's handles.
    let next = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
    if next < 0 {
        return Err(os_err("Failed to duplicate terminal"));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(next) })
}

#[cfg(unix)]
fn dup_stdio(fd: i32) -> Result<std::process::Stdio, String> {
    Ok(std::process::Stdio::from(dup_fd(fd)?))
}

#[cfg(unix)]
fn os_err(ctx: &str) -> String {
    format!("{ctx}: {}", std::io::Error::last_os_error())
}

fn emit_pty_data(app: &AppHandle, id: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    let _ = app.emit(
        DATA_EVENT,
        PtyData {
            id: id.to_string(),
            data,
        },
    );
}

#[cfg(unix)]
fn pty_should_flush(buffered: usize, since: Duration) -> bool {
    buffered >= READ_CHUNK || since >= PTY_COALESCE
}

#[cfg(unix)]
fn wait_readable(fd: i32, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    unsafe { libc::poll(&mut pollfd, 1, ms) > 0 }
}

#[cfg(unix)]
fn foreground_label(master_fd: i32, shell_pid: u32) -> Option<String> {
    let mut pgrp: libc::pid_t = 0;
    if unsafe { libc::ioctl(master_fd, libc::TIOCGPGRP, &mut pgrp) } != 0 {
        return None;
    }
    let pid = pgrp;
    if pid <= 0 {
        return None;
    }
    let label = process_label(pid)?;
    if pid == shell_pid as i32 || is_shell_name(&label) {
        return None;
    }
    Some(label)
}

#[cfg(target_os = "macos")]
fn process_label(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    // KERN_PROCARGS2 preserves interpreter/script names, unlike proc_name.
    // Read a bounded buffer and parse only argc arguments, never the trailing
    // environment. Neither command arguments nor environment are published.
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut bytes = vec![0u8; 256 * 1024];
    let mut length = bytes.len();
    let result = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            bytes.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if result == 0 {
        bytes.truncate(length);
        if let Some(args) = darwin_process_args(&bytes) {
            if let Some(label) = command_label_parts(&args) {
                return Some(label);
            }
        }
    }
    // The process may disallow argv inspection or exceed the bound. Its
    // executable still gives a useful label without forking or retrying.
    let mut path = [0u8; 4096];
    let length = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if length <= 0 {
        return None;
    }
    let path = std::str::from_utf8(path.split(|byte| *byte == 0).next()?).ok()?;
    command_label_parts(&[path])
}

#[cfg(target_os = "macos")]
fn darwin_process_args(bytes: &[u8]) -> Option<Vec<&str>> {
    let argc = i32::from_ne_bytes(bytes.get(..4)?.try_into().ok()?);
    if argc <= 0 || argc as usize > bytes.len() {
        return None;
    }
    let mut remaining = bytes.get(4..)?;
    // The executable path precedes NUL padding and argv[0].
    remaining = remaining.get(remaining.iter().position(|byte| *byte == 0)? + 1..)?;
    while remaining.first() == Some(&0) {
        remaining = &remaining[1..];
    }
    let mut args = Vec::new();
    for _ in 0..argc {
        let end = remaining.iter().position(|byte| *byte == 0)?;
        args.push(std::str::from_utf8(&remaining[..end]).ok()?);
        remaining = &remaining[end + 1..];
    }
    Some(args)
}

#[cfg(target_os = "linux")]
fn process_label(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(format!("/proc/{pid}/cmdline"))
        .ok()?
        .take(256 * 1024)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.last() != Some(&0) {
        return None;
    }
    let args = bytes[..bytes.len() - 1]
        .split(|byte| *byte == 0)
        .map(std::str::from_utf8)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    command_label_parts(&args)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn process_label(pid: i32) -> Option<String> {
    use std::process::Command;
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let args = raw.trim();
    if args.is_empty() {
        return None;
    }
    command_label(args)
}

#[cfg(all(unix, any(test, not(any(target_os = "macos", target_os = "linux")))))]
fn command_label(args: &str) -> Option<String> {
    let parts: Vec<&str> = args.split_whitespace().collect();
    command_label_parts(&parts)
}

#[cfg(unix)]
fn command_label_parts(parts: &[&str]) -> Option<String> {
    if parts.is_empty() {
        return None;
    }
    let exe = parts[0];
    let base = std::path::Path::new(exe)
        .file_name()
        .and_then(|name| name.to_str())?;
    if is_interpreter(base) {
        for part in parts.iter().skip(1) {
            if part.starts_with('-') {
                continue;
            }
            let name = std::path::Path::new(part)
                .file_name()
                .and_then(|name| name.to_str())?;
            if !name.starts_with('-') {
                return Some(name.to_string());
            }
        }
    }
    Some(base.to_string())
}

#[cfg(unix)]
fn is_interpreter(name: &str) -> bool {
    matches!(
        name,
        "node" | "nodejs" | "python" | "python3" | "ruby" | "deno" | "bun"
    )
}

#[cfg(unix)]
fn is_shell_name(name: &str) -> bool {
    matches!(
        name,
        "zsh" | "bash" | "sh" | "fish" | "nu" | "dash" | "ksh" | "tcsh" | "zsh5"
    )
}

#[cfg(all(test, unix))]
mod label_tests {
    use super::*;

    #[test]
    fn command_label_prefers_cli_over_interpreter() {
        assert_eq!(
            command_label("node /usr/local/bin/npm run build"),
            Some("npm".into())
        );
        assert_eq!(command_label("cargo build"), Some("cargo".into()));
    }

    #[test]
    fn shell_names_are_ignored() {
        assert!(is_shell_name("zsh"));
        assert!(!is_shell_name("npm"));
    }

    #[test]
    fn argument_boundaries_preserve_script_paths_with_spaces() {
        assert_eq!(
            command_label_parts(&[
                "/usr/bin/node",
                "--no-warnings",
                "/my tools/my cli.js",
                "run"
            ]),
            Some("my cli.js".into())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn darwin_arguments_exclude_environment_and_reject_truncation() {
        let mut bytes = 3i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(
            b"/usr/bin/node\0\0\0node\0--no-warnings\0/my tools/cli.js\0PRIVATE=value\0",
        );
        let args = darwin_process_args(&bytes).unwrap();
        assert_eq!(args, ["node", "--no-warnings", "/my tools/cli.js"]);
        assert_eq!(command_label_parts(&args), Some("cli.js".into()));
        assert!(darwin_process_args(&bytes[..10]).is_none());
        assert!(darwin_process_args(&0i32.to_ne_bytes()).is_none());
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn native_process_lookup_finds_the_test_process_without_a_helper() {
        assert!(process_label(std::process::id() as i32).is_some());
        assert!(process_label(-1).is_none());
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn login_args_for_common_shells() {
        assert_eq!(login_args("/bin/zsh"), &["-l"]);
        assert_eq!(login_args("/bin/bash"), &["-l"]);
        assert_eq!(login_args("/usr/bin/fish"), &["-l"]);
        assert_eq!(login_args("/usr/local/bin/nu"), &[] as &[&str]);
    }

    #[test]
    fn pty_flush_waits_for_a_full_chunk_or_the_coalesce_window() {
        assert!(!pty_should_flush(1, Duration::from_millis(1)));
        assert!(pty_should_flush(READ_CHUNK, Duration::from_millis(1)));
        assert!(pty_should_flush(1, PTY_COALESCE));
    }

    #[test]
    fn pty_handles_are_close_on_exec() {
        let (master, slave) = open_pty(80, 24).unwrap();
        let reader = dup_fd(master.as_raw_fd()).unwrap();
        let writer = dup_fd(master.as_raw_fd()).unwrap();
        for fd in [&master, &slave, &reader, &writer] {
            let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFD) };
            assert!(flags >= 0);
            assert_ne!(
                flags & libc::FD_CLOEXEC,
                0,
                "terminal FD can leak into children"
            );
        }
    }

    #[test]
    fn pty_stdio_remains_connected_after_exec() {
        let (master, slave) = open_pty(80, 24).unwrap();
        let mut reader = std::fs::File::from(dup_fd(master.as_raw_fd()).unwrap());
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", "printf pty-output"])
            .stdin(std::process::Stdio::null())
            .stdout(dup_stdio(slave.as_raw_fd()).unwrap())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        // Keep a slave handle until the read finishes: macOS can discard the
        // output queue when the final slave closes after this short-lived child.
        let mut bytes = [0; 10];
        reader.read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes, b"pty-output");
        drop(slave);
    }

    fn fixture_pty() -> Arc<LivePty> {
        Arc::new(LivePty {
            writer: Mutex::new(Box::new(std::io::sink())),
            master_fd: std::fs::File::open("/dev/null").unwrap().into(),
            pid: 0,
        })
    }

    #[test]
    fn closing_a_pending_spawn_prevents_installation() {
        let host = PtyHost::new();
        let (ticket, _) = host.begin_spawn("term");
        assert!(host.ensure_update_idle(false).is_err());
        host.remove("term");
        assert!(!host.install_spawn("term", ticket, fixture_pty()));
        assert_eq!(host.ensure_update_idle(false).unwrap(), 0);
    }

    #[test]
    fn an_obsolete_spawn_cannot_replace_or_cancel_a_newer_one() {
        let host = PtyHost::new();
        let (old, _) = host.begin_spawn("term");
        let (new, _) = host.begin_spawn("term");
        host.cancel_spawn("term", old);
        assert!(!host.install_spawn("term", old, fixture_pty()));
        assert!(host.install_spawn("term", new, fixture_pty()));
        assert!(host.get("term").is_some());
        host.remove("term");
    }

    #[test]
    fn kill_all_also_cancels_pending_startups() {
        let host = PtyHost::new();
        let (ticket, _) = host.begin_spawn("term");
        host.kill_all();
        assert!(!host.install_spawn("term", ticket, fixture_pty()));
        assert_eq!(host.ensure_update_idle(false).unwrap(), 0);
    }

    #[test]
    fn remove_if_pid_ignores_a_replaced_session() {
        let host = PtyHost::new();
        assert_eq!(host.ensure_update_idle(false).unwrap(), 0);
        host.insert(
            "term".into(),
            Arc::new(LivePty {
                writer: Mutex::new(Box::new(std::io::sink())),
                master_fd: std::fs::File::open("/dev/null").unwrap().into(),
                pid: 42,
            }),
        );
        assert!(host.ensure_update_idle(false).is_err());
        assert!(host.remove_if_pid("term", 7).is_none());
        assert!(host.get("term").is_some());
        assert!(host.remove_if_pid("term", 42).is_some());
        assert!(host.get("term").is_none());
        assert_eq!(host.ensure_update_idle(false).unwrap(), 0);
    }

    #[test]
    fn terminal_update_checks_require_consent_without_stopping_a_shell_builtin() {
        let (master, slave) = open_pty(80, 24).unwrap();
        let mut shell = std::process::Command::new("/bin/sh")
            .args(["-c", "read -r ignored"])
            .stdin(dup_stdio(slave.as_raw_fd()).unwrap())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let host = PtyHost::new();
        let live = Arc::new(LivePty {
            writer: Mutex::new(Box::new(std::fs::File::from(
                dup_fd(master.as_raw_fd()).unwrap(),
            ))),
            master_fd: master,
            pid: shell.id(),
        });
        host.insert("term".into(), live.clone());

        // A builtin waiting for input looks like an idle shell to foreground
        // process checks. Neither refusal nor consent may terminate it early.
        assert!(host.ensure_update_idle(false).is_err());
        assert!(Arc::ptr_eq(&host.get("term").unwrap(), &live));
        assert!(shell.try_wait().unwrap().is_none());
        assert_eq!(host.ensure_update_idle(true).unwrap(), 1);
        assert!(Arc::ptr_eq(&host.get("term").unwrap(), &live));
        assert!(shell.try_wait().unwrap().is_none());
        // Consent is per check, not remembered by the terminal host itself.
        assert!(host.ensure_update_idle(false).is_err());

        host.remove("term");
        shell.kill().unwrap();
        shell.wait().unwrap();
    }
}
