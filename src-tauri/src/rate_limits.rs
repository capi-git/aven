use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::dirs_home;

const OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const USER_AGENT: &str = "claude-code/2.1.0";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
/// A good answer serves every window for this long.
const FRESH_FOR: Duration = Duration::from_secs(60);
/// How long to wait after Anthropic throttles usage checks without saying.
const THROTTLED_DEFAULT: Duration = Duration::from_secs(10 * 60);
const THROTTLED_MIN: Duration = Duration::from_secs(60);
const THROTTLED_MAX: Duration = Duration::from_secs(60 * 60);

#[cfg(target_os = "macos")]
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(target_os = "macos")]
const LEGACY_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";
#[cfg(target_os = "macos")]
const KEYCHAIN_FALLBACK_USER: &str = "claude-code-user";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageFetch {
    pub status: String,
    pub http_status: Option<u16>,
    pub body: Option<String>,
    pub error: Option<String>,
}

struct ClaudeCredentials {
    access_token: String,
    expires_at_ms: Option<i64>,
}

fn usage_result(
    status: &str,
    http_status: Option<u16>,
    body: Option<String>,
    error: Option<String>,
) -> ClaudeUsageFetch {
    ClaudeUsageFetch {
        status: status.into(),
        http_status,
        body,
        error,
    }
}

/// Fetch Claude Code 5-hour / weekly usage via the local OAuth token.
/// The token never leaves the host process.
#[tauri::command]
pub async fn fetch_claude_usage() -> Result<ClaudeUsageFetch, String> {
    tauri::async_runtime::spawn_blocking(fetch_claude_usage_sync)
        .await
        .map_err(|e| e.to_string())?
}

/// Usage checks share one account-wide limit at Anthropic. Every window and
/// the usage panel ask through this gate, so one answer serves them all for
/// a minute, and a throttled answer pauses every window until Anthropic's
/// `Retry-After` instead of each one asking again.
struct UsageGate {
    fresh: Option<(Instant, ClaudeUsageFetch)>,
    retry_at: Option<Instant>,
}

impl UsageGate {
    const fn new() -> Self {
        Self {
            fresh: None,
            retry_at: None,
        }
    }

    /// An answer that needs no request, if there is one.
    fn answer(&self, now: Instant) -> Option<ClaudeUsageFetch> {
        if let Some(retry_at) = self.retry_at {
            if now < retry_at {
                return Some(throttled(retry_at - now));
            }
        }
        self.fresh
            .as_ref()
            .filter(|(at, _)| now.duration_since(*at) < FRESH_FOR)
            .map(|(_, answer)| answer.clone())
    }

    /// Remember what Anthropic said and return what the window should show.
    fn record(
        &mut self,
        now: Instant,
        answer: ClaudeUsageFetch,
        retry_after: Option<Duration>,
    ) -> ClaudeUsageFetch {
        if answer.status == "ok" {
            self.fresh = Some((now, answer.clone()));
            self.retry_at = None;
            return answer;
        }
        if answer.http_status == Some(429) {
            let wait = retry_after
                .unwrap_or(THROTTLED_DEFAULT)
                .clamp(THROTTLED_MIN, THROTTLED_MAX);
            self.retry_at = Some(now + wait);
            return throttled(wait);
        }
        answer
    }
}

static GATE: Mutex<UsageGate> = Mutex::new(UsageGate::new());
/// One request at a time; a window that waited reuses the answer it got.
static ASKING: Mutex<()> = Mutex::new(());

fn gate_answer() -> Option<ClaudeUsageFetch> {
    GATE.lock()
        .unwrap_or_else(|error| error.into_inner())
        .answer(Instant::now())
}

fn throttled(wait: Duration) -> ClaudeUsageFetch {
    let minutes = wait.as_secs().div_ceil(60).max(1);
    usage_result(
        "error",
        Some(429),
        None,
        Some(format!(
            "Claude is limiting usage checks right now. Aven will try again in about {minutes} min."
        )),
    )
}

/// Anthropic sends `Retry-After` in seconds.
fn retry_after(header: Option<&str>) -> Option<Duration> {
    header?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

fn fetch_claude_usage_sync() -> Result<ClaudeUsageFetch, String> {
    if let Some(answer) = gate_answer() {
        return Ok(answer);
    }
    let _asking = ASKING.lock().unwrap_or_else(|error| error.into_inner());
    // Another window may have asked while this one waited.
    if let Some(answer) = gate_answer() {
        return Ok(answer);
    }
    let Some(creds) = read_claude_credentials() else {
        return Ok(usage_result(
            "unavailable",
            None,
            None,
            Some("Sign in with Claude Code, then refresh usage.".into()),
        ));
    };

    // Claude Code owns this credential and rotates its refresh token. The
    // usage footer must remain read-only: independently refreshing here can
    // race a live CLI (or another Aven window) and leave one process with
    // a spent refresh token, which forces the user through sign-in again.
    if token_expired(creds.expires_at_ms, now_ms()) {
        return Ok(usage_error(401));
    }

    let (answer, wait) = fetch_usage_with_token(&creds.access_token);
    Ok(GATE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .record(Instant::now(), answer, wait))
}

fn fetch_usage_with_token(token: &str) -> (ClaudeUsageFetch, Option<Duration>) {
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let result = agent
        .get(OAUTH_USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA)
        .set("User-Agent", USER_AGENT)
        .call();

    match result {
        Ok(response) => {
            let http_status = response.status();
            let body = response.into_string().unwrap_or_default();
            if (200..300).contains(&http_status) {
                (
                    usage_result("ok", Some(http_status), Some(body), None),
                    None,
                )
            } else {
                (usage_error(http_status), None)
            }
        }
        Err(ureq::Error::Status(status, response)) => {
            let wait = retry_after(response.header("retry-after"));
            let _ = response.into_string();
            (usage_error(status), wait)
        }
        Err(error) => (
            usage_result(
                "error",
                None,
                None,
                Some(format!("Claude usage request failed: {error}")),
            ),
            None,
        ),
    }
}

fn usage_error(status: u16) -> ClaudeUsageFetch {
    let message = if status == 401 {
        "Claude sign-in expired. Sign in again with Claude Code, then refresh usage.".into()
    } else if status == 403 {
        "Claude usage is unavailable for this account".into()
    } else {
        format!("Claude usage request failed ({status})")
    };
    usage_result("error", Some(status), None, Some(message))
}

fn read_claude_credentials() -> Option<ClaudeCredentials> {
    #[cfg(target_os = "macos")]
    {
        if let Some(creds) = read_macos_keychain_credentials() {
            return Some(creds);
        }
    }
    read_credentials_file()
}

fn read_credentials_file() -> Option<ClaudeCredentials> {
    let path = claude_credentials_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    credentials_from_blob(&raw)
}

fn claude_credentials_path() -> Option<PathBuf> {
    let home = dirs_home().or_else(|| {
        std::env::var_os("USERPROFILE").map(|value| value.to_string_lossy().into_owned())
    })?;
    Some(PathBuf::from(home).join(".claude/.credentials.json"))
}

fn credentials_from_blob(raw: &str) -> Option<ClaudeCredentials> {
    let blob: Value = serde_json::from_str(raw.trim()).ok()?;
    let access_token = extract_access_token(raw)?;
    Some(ClaudeCredentials {
        access_token,
        expires_at_ms: oauth_expires_at_ms(&blob),
    })
}

pub(crate) fn extract_access_token(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw.trim()).ok()?;
    let token = value
        .get("claudeAiOauth")
        .and_then(|oauth| oauth.get("accessToken"))
        .or_else(|| value.get("accessToken"))
        .and_then(Value::as_str)?
        .trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn oauth_expires_at_ms(blob: &Value) -> Option<i64> {
    let value = blob
        .get("claudeAiOauth")
        .and_then(|oauth| oauth.get("expiresAt"))
        .or_else(|| blob.get("expiresAt"))?;
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number.as_f64().and_then(|float| {
                if float.is_finite() {
                    Some(float as i64)
                } else {
                    None
                }
            })
        }),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// An unknown expiry is treated as usable: the usage request itself will 401
/// if it is not, which produces the same user-facing result without mutating
/// credentials owned by another process.
pub(crate) fn token_expired(expires_at_ms: Option<i64>, now_ms: i64) -> bool {
    expires_at_ms.is_some_and(|expires| now_ms >= expires)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
fn read_macos_keychain_credentials() -> Option<ClaudeCredentials> {
    let candidates = [
        {
            let mut args = keychain_find_args();
            args.push("-w".into());
            args
        },
        {
            let mut args = keychain_find_args();
            args.extend(["-a".into(), keychain_user(), "-w".into()]);
            args
        },
        {
            let mut args = keychain_find_args();
            args.extend(["-a".into(), KEYCHAIN_FALLBACK_USER.into(), "-w".into()]);
            args
        },
    ];
    for args in candidates {
        if let Some(secret) = security_output(&args) {
            if let Some(creds) = credentials_from_blob(&secret) {
                return Some(creds);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn keychain_find_args() -> Vec<String> {
    vec![
        "find-generic-password".into(),
        "-s".into(),
        LEGACY_KEYCHAIN_SERVICE.into(),
    ]
}

#[cfg(target_os = "macos")]
fn keychain_user() -> String {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default();
    if user
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        && !user.is_empty()
    {
        user
    } else {
        KEYCHAIN_FALLBACK_USER.into()
    }
}

#[cfg(target_os = "macos")]
fn security_output(args: &[String]) -> Option<String> {
    security_run(args)
}

#[cfg(target_os = "macos")]
fn security_run(args: &[String]) -> Option<String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new("security");
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    run_with_timeout(&mut cmd, KEYCHAIN_TIMEOUT)
}

#[cfg(target_os = "macos")]
fn run_with_timeout(cmd: &mut std::process::Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::time::Instant;
    let mut child = cmd.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut stdout = child.stdout.take()?;
                let mut out = String::new();
                stdout.read_to_string(&mut out).ok()?;
                let trimmed = out.trim();
                if trimmed.is_empty() {
                    return None;
                }
                return Some(trimmed.to_string());
            }
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_access_token_from_claude_credentials() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-abc","refreshToken":"r"}}"#;
        assert_eq!(extract_access_token(raw).as_deref(), Some("sk-ant-oat-abc"));
    }

    #[test]
    fn extract_access_token_from_flat_object() {
        assert_eq!(
            extract_access_token(r#"{"accessToken":"token-1"}"#).as_deref(),
            Some("token-1")
        );
    }

    #[test]
    fn extract_access_token_rejects_empty() {
        assert_eq!(
            extract_access_token(r#"{"claudeAiOauth":{"accessToken":"  "}}"#),
            None
        );
        assert_eq!(extract_access_token("not json"), None);
    }

    #[test]
    fn token_expired_uses_actual_expiry() {
        let now = 1_000_000;
        assert!(!token_expired(Some(now + 1), now));
        assert!(token_expired(Some(now), now));
        assert!(token_expired(Some(now - 1), now));
        assert!(!token_expired(None, now));
    }

    #[test]
    fn credentials_do_not_require_a_refresh_token() {
        let creds = credentials_from_blob(
            r#"{"claudeAiOauth":{"accessToken":"access-only","expiresAt":1000}}"#,
        )
        .expect("usage only needs the current access token");
        assert_eq!(creds.access_token, "access-only");
        assert_eq!(creds.expires_at_ms, Some(1000));
    }

    fn ok() -> ClaudeUsageFetch {
        usage_result("ok", Some(200), Some("{}".into()), None)
    }

    #[test]
    fn one_good_answer_serves_every_window_for_a_minute() {
        let start = Instant::now();
        let mut gate = UsageGate::new();
        assert!(gate.answer(start).is_none());
        gate.record(start, ok(), None);
        let reused = gate.answer(start + Duration::from_secs(59)).unwrap();
        assert_eq!(reused.status, "ok");
        assert_eq!(reused.body.as_deref(), Some("{}"));
        assert!(gate.answer(start + FRESH_FOR).is_none());
    }

    #[test]
    fn throttling_pauses_every_window_until_retry_after() {
        let start = Instant::now();
        let mut gate = UsageGate::new();
        let shown = gate.record(start, usage_error(429), Some(Duration::from_secs(150)));
        assert_eq!(shown.http_status, Some(429));
        let message = shown.error.unwrap();
        assert!(message.contains("limiting usage checks"), "{message}");
        assert!(message.contains("about 3 min"), "{message}");

        let waiting = gate.answer(start + Duration::from_secs(100)).unwrap();
        assert!(waiting.error.unwrap().contains("about 1 min"));
        assert!(gate.answer(start + Duration::from_secs(150)).is_none());

        // A good answer ends the pause.
        gate.record(start + Duration::from_secs(150), ok(), None);
        assert_eq!(
            gate.answer(start + Duration::from_secs(151))
                .unwrap()
                .status,
            "ok"
        );
    }

    #[test]
    fn throttling_without_retry_after_waits_a_bounded_time() {
        let start = Instant::now();
        let mut gate = UsageGate::new();
        gate.record(start, usage_error(429), None);
        assert!(gate
            .answer(start + THROTTLED_DEFAULT - Duration::from_secs(1))
            .is_some());
        assert!(gate.answer(start + THROTTLED_DEFAULT).is_none());

        gate.record(start, usage_error(429), Some(Duration::from_secs(5)));
        assert!(gate.answer(start + Duration::from_secs(30)).is_some());
        gate.record(start, usage_error(429), Some(Duration::from_secs(86_400)));
        assert!(gate.answer(start + THROTTLED_MAX).is_none());
    }

    #[test]
    fn other_failures_are_not_remembered() {
        let start = Instant::now();
        let mut gate = UsageGate::new();
        let shown = gate.record(start, usage_error(500), None);
        assert_eq!(shown.http_status, Some(500));
        assert!(gate.answer(start).is_none());
    }

    #[test]
    fn retry_after_reads_seconds() {
        assert_eq!(retry_after(Some(" 120 ")), Some(Duration::from_secs(120)));
        assert_eq!(retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
        assert_eq!(retry_after(None), None);
    }

    #[test]
    fn expired_usage_explains_how_to_reauthenticate() {
        let result = usage_error(401);
        assert_eq!(result.status, "error");
        assert_eq!(result.http_status, Some(401));
        assert!(result.body.is_none());
        let message = result.error.expect("expired usage stays actionable");
        assert!(message.contains("Sign in again with Claude Code"));
        assert!(message.contains("refresh usage"));
    }
}
