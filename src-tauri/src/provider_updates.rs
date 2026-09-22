//! Keep native provider installations current through their own updater.
//! Never changes npm/Homebrew installs, app-bundled CLIs, or running sessions.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

static MAINTENANCE: Mutex<()> = Mutex::new(());
const DAY: u64 = 24 * 60 * 60;
const RETRY: u64 = 30 * 60;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRefresh {
    updated: bool,
    status: &'static str,
}

#[derive(Default, Deserialize, Serialize)]
struct Receipt {
    checked_at: u64,
    succeeded: bool,
}

fn due(receipt: Option<&Receipt>, now: u64) -> bool {
    receipt.is_none_or(|r| {
        now < r.checked_at || now - r.checked_at >= if r.succeeded { DAY } else { RETRY }
    })
}

fn native_install(provider: &str, path: &Path, home: &Path) -> bool {
    let base = match provider {
        "codex" => home.join(".codex/packages/standalone/releases"),
        "claude" => home.join(".local/share/claude/versions"),
        _ => return false,
    };
    let Ok(relative) = path.strip_prefix(base) else {
        return false;
    };
    let parts: Vec<_> = relative.components().collect();
    match provider {
        "codex" => {
            parts.len() == 3 && parts[1].as_os_str() == "bin" && parts[2].as_os_str() == "codex"
        }
        "claude" => parts.len() == 1,
        _ => false,
    }
}

fn run_bounded(
    path: &Path,
    argument: &str,
    timeout: Duration,
    capture: bool,
) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .arg(argument)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    command.env("CODEX_NON_INTERACTIVE", "1").env("CI", "1");
    command.stdout(if capture {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Provider updater could not start".to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err("Provider updater did not complete".into());
                }
                let mut text = String::new();
                if let Some(stdout) = child.stdout.take() {
                    use std::io::Read;
                    stdout
                        .take(4096)
                        .read_to_string(&mut text)
                        .map_err(|_| "Could not read provider version".to_string())?;
                }
                return Ok(text.trim().to_string());
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(100))
            }
            _ => {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                return Err("Provider updater timed out".into());
            }
        }
    }
}

#[tauri::command]
pub async fn provider_refresh_cli(
    app: tauri::AppHandle,
    provider: String,
) -> Result<ProviderRefresh, String> {
    if provider != "codex" && provider != "claude" {
        return Ok(ProviderRefresh {
            updated: false,
            status: "managedExternally",
        });
    }
    let permit = crate::window::begin_runtime_work(&app)?;
    let receipt_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("provider-maintenance.json");
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        // Serialize providers and re-read the receipt after acquiring the lock.
        // A try_lock would repeatedly skip the second provider on every tick.
        let _lock = MAINTENANCE
            .lock()
            .map_err(|_| "Provider maintenance unavailable")?;
        let mut receipts: BTreeMap<String, Receipt> = std::fs::read(&receipt_path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        if !due(receipts.get(&provider), now) {
            return Ok(ProviderRefresh {
                updated: false,
                status: "current",
            });
        }
        let binary = match provider.as_str() {
            "codex" => crate::harness::harness_resolve_codex()?,
            "claude" => crate::harness::harness_resolve_claude()?,
            _ => unreachable!(),
        };
        let home = PathBuf::from(crate::dirs_home().ok_or("Home directory unavailable")?);
        let path = PathBuf::from(binary.path);
        let resolved = path
            .canonicalize()
            .map_err(|_| "Provider executable unavailable")?;
        if !native_install(&provider, &resolved, &home) {
            return Ok(ProviderRefresh {
                updated: false,
                status: "managedExternally",
            });
        }
        let before = run_bounded(&path, "--version", Duration::from_secs(5), true)?;
        let result = run_bounded(&path, "update", Duration::from_secs(90), false);
        let succeeded = result.is_ok();
        receipts.insert(
            provider,
            Receipt {
                checked_at: now,
                succeeded,
            },
        );
        if let Some(parent) = receipt_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Only timestamps; never persist updater stdout, accounts, or credentials.
        let pending = receipt_path.with_extension("json.tmp");
        std::fs::write(
            &pending,
            serde_json::to_vec(&receipts).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(pending, receipt_path).map_err(|e| e.to_string())?;
        result?;
        let after = run_bounded(&path, "--version", Duration::from_secs(5), true)?;
        Ok(ProviderRefresh {
            updated: before != after,
            status: "checked",
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_recognizes_native_self_updating_installations() {
        let home = Path::new("/Users/test");
        assert!(native_install("codex", Path::new("/Users/test/.codex/packages/standalone/releases/0.155.1-aarch64-apple-darwin/bin/codex"), home));
        assert!(native_install(
            "claude",
            Path::new("/Users/test/.local/share/claude/versions/2.1.280"),
            home
        ));
        for path in [
            "/opt/homebrew/bin/codex",
            "/Applications/Codex.app/Contents/Resources/codex",
            "/Users/test/.codex/packages/standalone/releases-evil/version/bin/codex",
            "/Users/test/.codex/packages/standalone/releases/version/bin/other",
        ] {
            assert!(!native_install("codex", Path::new(path), home));
        }
        assert!(!native_install(
            "other",
            Path::new("/Users/test/.local/share/claude/versions/2.1.280"),
            home
        ));
    }
    #[test]
    fn throttles_success_and_retries_failure_without_waiting_a_day() {
        assert!(due(None, 100));
        assert!(!due(
            Some(&Receipt {
                checked_at: 100,
                succeeded: true
            }),
            100 + DAY - 1
        ));
        assert!(due(
            Some(&Receipt {
                checked_at: 100,
                succeeded: true
            }),
            100 + DAY
        ));
        assert!(!due(
            Some(&Receipt {
                checked_at: 100,
                succeeded: false
            }),
            100 + RETRY - 1
        ));
        assert!(due(
            Some(&Receipt {
                checked_at: 100,
                succeeded: false
            }),
            100 + RETRY
        ));
        assert!(due(
            Some(&Receipt {
                checked_at: 100,
                succeeded: true
            }),
            50
        ));
    }

    #[test]
    #[cfg(unix)]
    fn maintenance_timeout_reaps_only_its_own_process() {
        let started = Instant::now();
        assert!(run_bounded(
            Path::new("/bin/sleep"),
            "5",
            Duration::from_millis(20),
            false
        )
        .is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
