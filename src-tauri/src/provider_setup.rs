//! Provider setup never installs, signs in, or contacts a model on launch.
//! Checks are read-only, selected-provider probes. Plans are allowlisted
//! terminal commands, executed by the frontend only after an explicit click.
//! Raw CLI output remains here: status output can contain an email or API key.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const VERIFY_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_CAPTURE_BYTES: usize = 64 * 1024;
const TEST_REPLY: &str = "AVEN_CONNECTION_OK";
const TEST_PROMPT: &str = "This is an Aven connection test. Reply with exactly AVEN_CONNECTION_OK. Do not inspect files or use any tools.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupStatus {
    Missing,
    Installed,
    SignInRequired,
    Ready,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

impl Platform {
    fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else {
            Self::Linux
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetupCheck {
    pub harness: String,
    pub platform: Platform,
    pub status: SetupStatus,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupAction {
    Install,
    SignIn,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetupPlan {
    pub harness: String,
    pub platform: Platform,
    pub action: SetupAction,
    pub command: Option<String>,
    /// Human-readable command, useful when the Windows executable path requires
    /// encoded transport to preserve literal dollar signs through either shell.
    pub display_command: Option<String>,
    pub docs_url: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Claude,
    Codex,
    Cursor,
    OpenCode,
    Grok,
    Pi,
    Omp,
    Fx,
}

impl Provider {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            "cursor" => Ok(Self::Cursor),
            "opencode" => Ok(Self::OpenCode),
            "grok" => Ok(Self::Grok),
            "pi" => Ok(Self::Pi),
            "omp" => Ok(Self::Omp),
            "fx" => Ok(Self::Fx),
            _ => Err("Choose a supported provider.".into()),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
            Self::Pi => "pi",
            Self::Omp => "omp",
            Self::Fx => "fx",
        }
    }

    fn docs(self) -> &'static str {
        match self {
            Self::Claude => "https://code.claude.com/docs/en/setup",
            Self::Codex => "https://developers.openai.com/codex/cli",
            Self::Cursor => "https://cursor.com/docs/cli/overview",
            Self::OpenCode => "https://opencode.ai/docs/",
            Self::Grok => "https://x.ai/cli",
            Self::Pi => "https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent",
            Self::Omp => "https://github.com/can1357/oh-my-pi",
            Self::Fx => "https://fx.sh",
        }
    }
}

fn result(
    provider: Provider,
    status: SetupStatus,
    version: Option<String>,
    message: &str,
) -> ProviderSetupCheck {
    ProviderSetupCheck {
        harness: provider.id().into(),
        platform: Platform::current(),
        status,
        version,
        message: message.into(),
    }
}

/// Binary existence, authentication, and a successful model response are
/// separate checks. `Ready` here means the provider's local auth status passed;
/// expired credentials or missing subscriptions can still fail a first task.
#[tauri::command(async)]
pub fn provider_setup_check(app: AppHandle, harness: String) -> Result<ProviderSetupCheck, String> {
    let _work = crate::window::begin_runtime_work(&app)?;
    let provider = Provider::parse(&harness)?;
    Ok(check_provider(provider))
}

fn check_provider(provider: Provider) -> ProviderSetupCheck {
    let Some(binary) = crate::harness::resolved_setup_binary(provider.id()) else {
        return result(provider, SetupStatus::Missing, None, "This CLI was not found. Install the provider you chose, then check again. If it was just installed to a custom PATH, restart Aven.");
    };
    let version = match capture(&binary, &["--version".into()], None, PROBE_TIMEOUT) {
        Ok(output) if output.success && !output.truncated => numeric_version(&output.stdout),
        _ => return result(provider, SetupStatus::Error, None, "The CLI was found but its version check failed or timed out. Check its installation, then try again."),
    };
    let args = match provider {
        Provider::Claude => vec!["auth".into(), "status".into()],
        Provider::Codex => vec!["login".into(), "status".into()],
        _ => return result(provider, SetupStatus::Installed, version, "The CLI is installed. Sign-in cannot be checked automatically for this provider. Follow its setup instructions, then start a task in Aven to check the connection."),
    };
    match capture(&binary, &args, None, PROBE_TIMEOUT) {
        Ok(output) => interpret_auth(provider, version, &output),
        Err(CaptureFailure::Timeout) => result(provider, SetupStatus::Error, version, "The sign-in check timed out and was stopped. Check the provider in a terminal, then try again."),
        Err(_) => result(provider, SetupStatus::Error, version, "The CLI could not check sign-in. Check its installation or update it, then try again."),
    }
}

fn interpret_auth(
    provider: Provider,
    version: Option<String>,
    output: &Captured,
) -> ProviderSetupCheck {
    if output.truncated {
        return result(
            provider,
            SetupStatus::Error,
            version,
            "The CLI returned too much status output. Update the provider and check again.",
        );
    }
    let status = match provider {
        Provider::Claude => {
            let logged_in = serde_json::from_slice::<serde_json::Value>(&output.stdout)
                .ok()
                .and_then(|value| value.get("loggedIn").and_then(|field| field.as_bool()));
            match (output.success, output.code, logged_in) {
                (true, _, Some(true)) => SetupStatus::Ready,
                (false, Some(1), Some(false)) | (true, _, Some(false)) => {
                    SetupStatus::SignInRequired
                }
                _ => SetupStatus::Error,
            }
        }
        Provider::Codex => {
            // Codex intentionally prints auth mode to stderr, including a
            // partial API key in some versions. Never forward those strings.
            let text = format!(
                "{} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .to_ascii_lowercase();
            if !output.success && output.code == Some(1) && text.contains("not logged in") {
                SetupStatus::SignInRequired
            } else if output.success
                && text.contains("logged in")
                && !text.contains("not logged in")
            {
                SetupStatus::Ready
            } else {
                SetupStatus::Error
            }
        }
        _ => SetupStatus::Installed,
    };
    let message = match status {
        SetupStatus::Ready => "Sign-in was confirmed. Start a task to check that this account can send a message.",
        SetupStatus::SignInRequired => "The CLI is installed and needs sign-in. Connect your account, then check again.",
        _ => "The CLI is installed, but its sign-in status could not be confirmed. Update the CLI or check it in a terminal, then try again.",
    };
    result(provider, status, version, message)
}

/// The docs below are official install sources. This command only creates a
/// plan; it does not download or execute anything. The user runs that plan in
/// a fresh Aven terminal with an explicit Install or Sign in button.
#[tauri::command(async)]
pub fn provider_setup_plan(
    harness: String,
    action: SetupAction,
) -> Result<ProviderSetupPlan, String> {
    let provider = Provider::parse(&harness)?;
    let binary = if action == SetupAction::SignIn {
        crate::harness::resolved_setup_binary(provider.id())
    } else {
        None
    };
    Ok(plan_for(
        provider,
        action,
        Platform::current(),
        binary.as_deref(),
    ))
}

fn plan_for(
    provider: Provider,
    action: SetupAction,
    platform: Platform,
    binary: Option<&Path>,
) -> ProviderSetupPlan {
    let mut plan = ProviderSetupPlan { harness: provider.id().into(), platform, action, command: None, display_command: None, docs_url: provider.docs().into(), message: "Follow this provider's official instructions for your operating system. Aven will only install or connect providers you choose.".into() };
    let script = match (provider, action, platform) {
        (Provider::Claude, SetupAction::Install, Platform::Windows) => {
            Some("irm https://claude.ai/install.ps1 | iex".to_string())
        }
        (Provider::Claude, SetupAction::Install, _) => {
            Some("curl -fsSL https://claude.ai/install.sh | bash".to_string())
        }
        (Provider::Codex, SetupAction::Install, Platform::Windows) => {
            Some("irm https://chatgpt.com/codex/install.ps1 | iex".to_string())
        }
        (Provider::Codex, SetupAction::Install, _) => {
            Some("curl -fsSL https://chatgpt.com/codex/install.sh | sh".to_string())
        }
        (Provider::Claude | Provider::Codex, SetupAction::SignIn, _) => binary.map(|binary| {
            let args = if provider == Provider::Claude {
                "auth login"
            } else {
                "login"
            };
            if platform == Platform::Windows {
                format!("& {} {args}", quote_powershell(&binary.to_string_lossy()))
            } else {
                format!("{} {args}", quote_posix(&binary.to_string_lossy()))
            }
        }),
        _ => None,
    };
    if let Some(script) = script {
        plan.display_command = Some(script.clone());
        plan.command = Some(if platform == Platform::Windows {
            if action == SetupAction::Install {
                // Official remote installer script, with a process-only policy
                // override for Codex. No shared/global execution policy changes.
                let policy = if provider == Provider::Codex {
                    " -ExecutionPolicy ByPass"
                } else {
                    ""
                };
                format!("powershell.exe -NoProfile{policy} -Command \"{script}\"")
            } else {
                // PTY may be CMD or PowerShell. Encoding prevents either outer
                // shell from expanding `$` in a user-controlled literal path.
                let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
                format!(
                    "powershell.exe -NoProfile -EncodedCommand {}",
                    base64::engine::general_purpose::STANDARD.encode(utf16)
                )
            }
        } else {
            format!("/bin/sh -c {}", quote_posix(&script))
        });
        plan.message = if action == SetupAction::Install {
            "Run this provider's official installer in the setup terminal. It downloads software and may update your user PATH. When it finishes, check again; a custom PATH may require restarting Aven."
        } else {
            "Sign in with this provider in the setup terminal. Complete its browser or terminal prompts, then check again. Sign-in is handled by the provider CLI."
        }.into();
    } else if action == SetupAction::SignIn
        && matches!(provider, Provider::Claude | Provider::Codex)
    {
        plan.message = "Install this CLI before signing in, then check again. If it was just installed to a custom PATH, restart Aven.".into();
    }
    plan
}

fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// A paid/subscription request is sent only by the explicit test button.
/// Claude exposes a supported zero-tools mode. Codex's readonly sandbox still
/// exposes tools, so a synthetic no-tools test is not offered for it yet.
#[tauri::command(async)]
pub fn provider_setup_verify(
    app: AppHandle,
    harness: String,
) -> Result<ProviderSetupCheck, String> {
    let _work = crate::window::begin_runtime_work(&app)?;
    let provider = Provider::parse(&harness)?;
    if provider != Provider::Claude {
        return Ok(result(provider, SetupStatus::Installed, None, "A setup test message is not available for this provider. Start a task in Aven to test your connection."));
    }
    let check = check_provider(provider);
    if check.status != SetupStatus::Ready {
        return Ok(check);
    }
    let Some(binary) = crate::harness::resolved_setup_binary(provider.id()) else {
        return Ok(check_provider(provider));
    };
    let directory = match VerifyDirectory::new() {
        Ok(directory) => directory,
        Err(_) => {
            return Ok(result(
                provider,
                SetupStatus::Error,
                check.version,
                "The temporary connection test could not be prepared. Try again.",
            ))
        }
    };
    let output = capture(
        &binary,
        &claude_verify_args(),
        Some(&directory.0),
        VERIFY_TIMEOUT,
    );
    let success = output.as_ref().is_ok_and(claude_test_succeeded);
    Ok(result(
        provider,
        if success {
            SetupStatus::Ready
        } else {
            SetupStatus::Error
        },
        check.version,
        if success {
            "Connection tested. Claude returned a response successfully."
        } else if matches!(output, Err(CaptureFailure::Timeout)) {
            "The test message timed out and was stopped. Check the provider's connection, then try again."
        } else {
            "The test message did not complete. Check your provider account, subscription and CLI version, then try again. No provider output or account details were saved."
        },
    ))
}

fn claude_verify_args() -> Vec<String> {
    [
        "-p",
        "--output-format",
        "json",
        "--tools",
        "",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        "--setting-sources",
        "",
        "--settings",
        "{\"disableAllHooks\":true}",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--max-turns",
        "1",
        TEST_PROMPT,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn claude_test_succeeded(output: &Captured) -> bool {
    if !output.success || output.truncated {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(&output.stdout).is_ok_and(|value| {
        value.get("type").and_then(|field| field.as_str()) == Some("result")
            && value.get("subtype").and_then(|field| field.as_str()) == Some("success")
            && value.get("is_error").and_then(|field| field.as_bool()) != Some(true)
            && value
                .get("result")
                .and_then(|field| field.as_str())
                .is_some_and(|reply| reply.trim() == TEST_REPLY)
    })
}

struct VerifyDirectory(PathBuf);
impl VerifyDirectory {
    fn new() -> std::io::Result<Self> {
        let path =
            std::env::temp_dir().join(format!("aven-provider-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path)?;
        let directory = Self(path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory.0, std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(directory)
    }
}
impl Drop for VerifyDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Debug)]
struct Captured {
    success: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}
#[derive(Debug, PartialEq, Eq)]
enum CaptureFailure {
    Spawn,
    Io,
    Timeout,
}

/// Drain both pipes while retaining only a fixed budget. A runaway CLI cannot
/// allocate unlimited memory, block on a full stderr pipe, or outlive timeout.
/// The process supervisor removes scoped agent capabilities and handles npm
/// shims, process groups, and Windows jobs exactly as normal task launches do.
fn capture(
    binary: &Path,
    args: &[String],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<Captured, CaptureFailure> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::harness::prepare_child(&mut command, &binary.to_string_lossy());
    // Status/test checks must not trigger an automatic provider update.
    command
        .env("DISABLE_AUTOUPDATER", "1")
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .env("NO_COLOR", "1");
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child =
        crate::harness::spawn_managed(&mut command).map_err(|_| CaptureFailure::Spawn)?;
    let pid = child.id();
    let stdout = child.stdout.take().ok_or(CaptureFailure::Io)?;
    let stderr = child.stderr.take().ok_or(CaptureFailure::Io)?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let out_reader = thread::spawn(move || read_bounded(stdout));
        let err_reader = thread::spawn(move || read_bounded(stderr));
        let status = child.wait();
        let output = match (status, out_reader.join(), err_reader.join()) {
            (Ok(status), Ok(Ok((stdout, out_truncated))), Ok(Ok((stderr, err_truncated)))) => {
                Ok(Captured {
                    success: status.success(),
                    code: status.code(),
                    stdout,
                    stderr,
                    truncated: out_truncated || err_truncated,
                })
            }
            _ => Err(CaptureFailure::Io),
        };
        let _ = tx.send(output);
    });
    match rx.recv_timeout(timeout) {
        Ok(output) => output,
        Err(_) => {
            crate::harness::terminate_all(&[pid]);
            Err(CaptureFailure::Timeout)
        }
    }
}

fn read_bounded(mut reader: impl Read) -> std::io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0; 4096];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let retain = count.min(MAX_CAPTURE_BYTES.saturating_sub(output.len()));
        output.extend_from_slice(&buffer[..retain]);
        truncated |= retain < count;
    }
    Ok((output, truncated))
}

/// Only numeric major.minor.patch is returned; arbitrary CLI prose (which may
/// contain credentials) is never reused as the displayed version or error.
fn numeric_version(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .find(|token| {
            let parts: Vec<_> = token.split('.').collect();
            parts.len() == 3
                && parts.iter().all(|part| {
                    !part.is_empty()
                        && part.len() <= 6
                        && part.chars().all(|character| character.is_ascii_digit())
                })
        })
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(success: bool, code: i32, stdout: &str, stderr: &str) -> Captured {
        Captured {
            success,
            code: Some(code),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
            truncated: false,
        }
    }

    #[test]
    fn chosen_provider_and_action_are_allowlisted() {
        for name in [
            "claude", "codex", "cursor", "opencode", "grok", "pi", "omp", "fx",
        ] {
            assert!(Provider::parse(name).is_ok());
        }
        for name in ["", "Claude", "codex; rm -rf /", "npm", "../claude"] {
            assert!(Provider::parse(name).is_err());
        }
        assert!(serde_json::from_str::<SetupAction>("\"signIn\"").is_ok());
        assert!(serde_json::from_str::<SetupAction>("\"logout\"").is_err());
    }

    #[test]
    fn authentication_is_distinct_from_existence_and_never_leaks_output() {
        let claude = output(
            true,
            0,
            r#"{"loggedIn":true,"email":"secret@example.test","apiKey":"secret"}"#,
            "",
        );
        let check = interpret_auth(Provider::Claude, Some("2.1.0".into()), &claude);
        assert_eq!(check.status, SetupStatus::Ready);
        assert!(!serde_json::to_string(&check).unwrap().contains("secret"));
        let codex = output(true, 0, "", "Logged in using an API key - sk-secret-key");
        let check = interpret_auth(Provider::Codex, None, &codex);
        assert_eq!(check.status, SetupStatus::Ready);
        assert!(!check.message.contains("sk-"));
        assert_eq!(
            interpret_auth(
                Provider::Claude,
                None,
                &output(false, 1, r#"{"loggedIn":false}"#, "")
            )
            .status,
            SetupStatus::SignInRequired
        );
        assert_eq!(
            interpret_auth(
                Provider::Codex,
                None,
                &output(false, 1, "", "Not logged in")
            )
            .status,
            SetupStatus::SignInRequired
        );
        assert_eq!(
            interpret_auth(
                Provider::Claude,
                None,
                &output(true, 0, "unexpected version output", "")
            )
            .status,
            SetupStatus::Error
        );
        assert_eq!(
            interpret_auth(
                Provider::Codex,
                None,
                &output(false, 2, "", "unknown subcommand")
            )
            .status,
            SetupStatus::Error
        );
        assert_eq!(
            interpret_auth(Provider::Pi, None, &output(true, 0, "anything", "")).status,
            SetupStatus::Installed
        );
    }

    #[test]
    fn plans_use_official_installers_for_the_selected_platform_only() {
        let mac = plan_for(
            Provider::Claude,
            SetupAction::Install,
            Platform::Macos,
            None,
        );
        assert!(mac
            .command
            .unwrap()
            .contains("https://claude.ai/install.sh | bash"));
        let win = plan_for(
            Provider::Claude,
            SetupAction::Install,
            Platform::Windows,
            None,
        );
        assert_eq!(
            win.command.unwrap(),
            "powershell.exe -NoProfile -Command \"irm https://claude.ai/install.ps1 | iex\""
        );
        let win = plan_for(
            Provider::Codex,
            SetupAction::Install,
            Platform::Windows,
            None,
        );
        assert!(win
            .command
            .unwrap()
            .contains("https://chatgpt.com/codex/install.ps1"));
        let mac = plan_for(Provider::Codex, SetupAction::Install, Platform::Macos, None);
        assert!(mac
            .command
            .unwrap()
            .contains("https://chatgpt.com/codex/install.sh"));
        for provider in [
            Provider::Cursor,
            Provider::OpenCode,
            Provider::Grok,
            Provider::Pi,
            Provider::Omp,
            Provider::Fx,
        ] {
            for platform in [Platform::Macos, Platform::Windows] {
                assert!(plan_for(provider, SetupAction::Install, platform, None)
                    .command
                    .is_none());
                assert!(plan_for(
                    provider,
                    SetupAction::SignIn,
                    platform,
                    Some(Path::new("a"))
                )
                .command
                .is_none());
            }
        }
        assert!(plan_for(
            Provider::Claude,
            SetupAction::SignIn,
            Platform::Windows,
            None
        )
        .command
        .is_none());
    }

    #[test]
    fn signin_literal_paths_cannot_become_shell_commands() {
        let path = Path::new("/users/a'b/$HOME/claude; echo secret");
        let unix = plan_for(
            Provider::Claude,
            SetupAction::SignIn,
            Platform::Macos,
            Some(path),
        );
        assert_eq!(
            unix.display_command.unwrap(),
            "'/users/a'\\''b/$HOME/claude; echo secret' auth login"
        );
        let windows = plan_for(
            Provider::Codex,
            SetupAction::SignIn,
            Platform::Windows,
            Some(path),
        );
        let encoded = windows.command.unwrap();
        let encoded = encoded
            .strip_prefix("powershell.exe -NoProfile -EncodedCommand ")
            .unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let words: Vec<_> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|word| u16::from_le_bytes([word[0], word[1]]))
            .collect();
        assert_eq!(
            String::from_utf16(&words).unwrap(),
            "& '/users/a''b/$HOME/claude; echo secret' login"
        );
    }

    #[test]
    fn version_and_capture_are_bounded_and_redacted() {
        assert_eq!(
            numeric_version(b"secret@example.test\n2.1.123 (Claude Code)\nsk-secret"),
            Some("2.1.123".into())
        );
        assert_eq!(numeric_version(b"api-key-super-secret"), None);
        let (bytes, truncated) =
            read_bounded(std::io::Cursor::new(vec![b'a'; MAX_CAPTURE_BYTES + 100])).unwrap();
        assert_eq!(bytes.len(), MAX_CAPTURE_BYTES);
        assert!(truncated);
    }

    #[test]
    fn connection_test_requires_an_actual_successful_response() {
        assert!(claude_test_succeeded(&output(
            true,
            0,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"AVEN_CONNECTION_OK"}"#,
            ""
        )));
        for raw in [
            r#"{"type":"result","subtype":"success","is_error":true,"result":"AVEN_CONNECTION_OK"}"#,
            r#"{"type":"result","subtype":"success","result":"not connected"}"#,
            r#"{"loggedIn":true}"#,
            "AVEN_CONNECTION_OK",
        ] {
            assert!(!claude_test_succeeded(&output(true, 0, raw, "")));
        }
        let args = claude_verify_args();
        assert!(args.windows(2).any(|pair| pair == ["--tools", ""]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--settings", "{\"disableAllHooks\":true}"]));
        assert!(args.contains(&"--strict-mcp-config".into()));
        assert!(args.contains(&"--no-session-persistence".into()));
        assert!(!args.iter().any(|arg| arg.contains("skip-permissions")));
    }

    #[cfg(unix)]
    #[test]
    fn capture_times_out_and_kills_a_real_fixture_process() {
        let started = std::time::Instant::now();
        let args = vec!["-c".into(), "sleep 20".into()];
        assert_eq!(
            capture(Path::new("/bin/sh"), &args, None, Duration::from_millis(40)).unwrap_err(),
            CaptureFailure::Timeout
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
