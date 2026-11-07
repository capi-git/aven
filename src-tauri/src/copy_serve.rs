//! Try it: Avos's copy of a project, running on its own port, so its
//! version can be used (and pictured) before it is applied.
//!
//! Aven runs it, never an agent, and only once `project_bots::reviewed_copy`
//! has checked the copy holds exactly the reviewed change and nothing that
//! Apply would refuse. It starts with a clean environment: no keys or tokens
//! from Aven's own, and the project's `.env` files stay in the user's folder
//! (a copy never has them). One server per copy, stopped when its change is
//! applied or sent, when Review asks, or when Aven quits.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopyServer {
    /// Where it answers: `http://127.0.0.1:<port>`.
    pub url: String,
}

struct Running {
    child: Child,
    url: String,
    /// The copy's commit it serves.
    at: String,
}

fn running() -> &'static Mutex<HashMap<PathBuf, Running>> {
    static RUNNING: OnceLock<Mutex<HashMap<PathBuf, Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
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
        .map_err(|e| format!("No free port for Avos's copy: {e}"))
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

/// Install the copy's packages when it has none, as the user would.
fn install(
    dir: &Path,
    script: &DevScript,
    env: &[(String, String)],
    log: &Path,
) -> Result<(), String> {
    if !dir.join("package.json").is_file() || dir.join("node_modules").is_dir() {
        return Ok(());
    }
    let args = vec![script.manager.to_string(), "install".to_string()];
    let mut child = command(dir, &args, env, log)?
        .spawn()
        .map_err(|e| format!("Couldn't run {}: {e}", script.manager))?;
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "Couldn't install the packages in Avos's copy:\n{}",
                    tail(log, 8)
                ))
            };
        }
        if Instant::now() > deadline {
            stop_child(&mut child);
            return Err("Installing the packages in Avos's copy took too long.".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

fn stop_child(child: &mut Child) {
    #[cfg(unix)]
    {
        let group = child.id() as i32;
        // SAFETY: signalling a process group this module started.
        unsafe {
            libc::kill(-group, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
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

/// Run the copy at `copy` (already checked to hold commit `at`), or give
/// the server already running it. Waits until it answers.
pub(crate) fn serve(
    copy: &Path,
    at: &str,
    log: &Path,
    path: Option<String>,
) -> Result<CopyServer, String> {
    {
        let mut all = running().lock().map_err(|_| "Try it is busy")?;
        if let Some(server) = all.get_mut(copy) {
            if server.at == at && matches!(server.child.try_wait(), Ok(None)) {
                return Ok(CopyServer {
                    url: server.url.clone(),
                });
            }
        }
        if let Some(mut old) = all.remove(copy) {
            stop_child(&mut old.child);
        }
    }
    let script = dev_script(copy).ok_or(
        "Avos's copy has nothing to run: its package.json has no dev, start or serve script.",
    )?;
    let port = free_port()?;
    let env = serve_env(port, path);
    let _ = log_file(log, false)?;
    install(copy, &script, &env, log)?;
    let mut child = command(copy, &serve_args(&script, port), &env, log)?
        .spawn()
        .map_err(|e| format!("Couldn't run {}: {e}", script.manager))?;
    let deadline = Instant::now() + Duration::from_secs(120);
    let url = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "Avos's copy stopped before it was ready ({status}):\n{}",
                tail(log, 8)
            ));
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
            stop_child(&mut child);
            return Err(format!(
                "Avos's copy didn't answer within two minutes:\n{}",
                tail(log, 8)
            ));
        }
        std::thread::sleep(Duration::from_millis(300));
    };
    running().lock().map_err(|_| "Try it is busy")?.insert(
        copy.to_path_buf(),
        Running {
            child,
            url: url.clone(),
            at: at.to_string(),
        },
    );
    Ok(CopyServer { url })
}

/// Stop the copy's server, if one runs.
pub(crate) fn stop(copy: &Path) {
    let server = running().lock().ok().and_then(|mut all| all.remove(copy));
    if let Some(mut server) = server {
        stop_child(&mut server.child);
    }
}

/// Stop every copy's server: Aven is quitting.
pub(crate) fn stop_all() {
    let servers: Vec<Running> = running()
        .lock()
        .map(|mut all| all.drain().map(|(_, server)| server).collect())
        .unwrap_or_default();
    for mut server in servers {
        stop_child(&mut server.child);
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

    #[cfg(unix)]
    #[test]
    fn serves_a_copy_until_stopped() {
        let node = std::process::Command::new("sh")
            .args(["-c", "command -v node && command -v npm"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !node {
            return;
        }
        let dir = std::env::temp_dir().join(format!("aven-serve-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"dev":"node -e \"require('http').createServer((q,s)=>s.end('copy')).listen(+process.env.PORT,'127.0.0.1')\""}}"#,
        )
        .unwrap();
        let log = dir.join("serve.log");
        let first = serve(&dir, "c1", &log, None).unwrap();
        let port: u16 = first.url.rsplit(':').next().unwrap().parse().unwrap();
        assert!(answers(port));
        // The same commit: the same server.
        assert_eq!(serve(&dir, "c1", &log, None).unwrap(), first);
        stop(&dir);
        std::thread::sleep(Duration::from_millis(300));
        assert!(!answers(port));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
