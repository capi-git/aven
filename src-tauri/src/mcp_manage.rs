//! Add, remove, and sign in to MCP servers through each provider's own CLI.
//!
//! Claude Code and Codex own their configuration files, so Aven never edits
//! them directly. The webview sends a structured request; this module checks
//! every field and builds the exact argument list, so no user text is ever
//! interpreted as a CLI option.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::harness;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpServerSpec {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    Http {
        url: String,
        /// Claude only: sent with every request, e.g. an API key header.
        #[serde(default)]
        headers: BTreeMap<String, String>,
        /// Codex only: the environment variable that holds a bearer token.
        #[serde(default, rename = "bearerTokenEnvVar")]
        bearer_token_env_var: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum McpRequest {
    Add {
        provider: McpProvider,
        name: String,
        /// Claude: user, project, or local. Codex has one personal scope.
        #[serde(default)]
        scope: Option<String>,
        server: McpServerSpec,
    },
    Remove {
        provider: McpProvider,
        name: String,
        #[serde(default)]
        scope: Option<String>,
    },
    Login {
        provider: McpProvider,
        name: String,
    },
    Logout {
        provider: McpProvider,
        name: String,
    },
}

const EDIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Sign-in waits for the user to finish in their browser.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

impl McpRequest {
    fn provider(&self) -> McpProvider {
        match self {
            Self::Add { provider, .. }
            | Self::Remove { provider, .. }
            | Self::Login { provider, .. }
            | Self::Logout { provider, .. } => *provider,
        }
    }

    fn timeout(&self) -> Duration {
        if matches!(self, Self::Login { .. }) || self.may_sign_in_while_adding() {
            LOGIN_TIMEOUT
        } else {
            EDIT_TIMEOUT
        }
    }

    /// Codex offers OAuth during `mcp add` ("the immediate login"), so adding a
    /// remote server can wait on the user's browser just as `mcp login` does.
    fn may_sign_in_while_adding(&self) -> bool {
        matches!(
            self,
            Self::Add {
                provider: McpProvider::Codex,
                server: McpServerSpec::Http { .. },
                ..
            }
        )
    }

    /// A failure in plain words, when Aven knows more than the CLI's message.
    fn explain_failure(&self, message: String) -> String {
        if self.may_sign_in_while_adding() && message.ends_with("took too long and was stopped.") {
            return "Sign-in didn’t finish in time. Add it again, or use Sign in on its row."
                .to_string();
        }
        message
    }

    /// Finishes "Aven is still …" if an update restart has to wait for it.
    fn work_label(&self) -> &'static str {
        match self {
            Self::Login { .. } => "signing in to an MCP server",
            Self::Logout { .. } => "signing out of an MCP server",
            _ => "changing your MCP servers",
        }
    }

    /// Project scopes are written relative to the project folder.
    fn needs_project(&self) -> bool {
        match self {
            // Claude's default scope is private to the current project.
            Self::Add {
                provider: McpProvider::Claude,
                scope,
                ..
            } => scope.as_deref() != Some("user"),
            Self::Remove {
                provider: McpProvider::Claude,
                scope: Some(scope),
                ..
            } => scope != "user",
            _ => false,
        }
    }
}

/// New server names: what both CLIs accept and what fits in a config key.
fn valid_new_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Existing names can come from a provider (e.g. "claude.ai Gmail").
fn valid_existing_name(name: &str) -> bool {
    (1..=128).contains(&name.len()) && !name.starts_with('-') && !name.chars().any(char::is_control)
}

fn valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && key.len() <= 128
}

fn valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c))
}

fn plain_value(value: &str) -> bool {
    !value.chars().any(|c| c == '\0' || c == '\n' || c == '\r')
}

fn claude_scope(scope: &Option<String>) -> Result<Option<&str>, String> {
    match scope.as_deref() {
        None => Ok(None),
        Some(s @ ("user" | "project" | "local")) => Ok(Some(s)),
        Some(_) => Err("Choose a personal, shared project, or private project scope.".into()),
    }
}

fn check_url(url: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "Enter a full server URL.".to_string())?;
    if matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some() {
        Ok(())
    } else {
        Err("Server URLs must start with http:// or https://.".into())
    }
}

fn check_spec(provider: McpProvider, server: &McpServerSpec) -> Result<(), String> {
    match server {
        McpServerSpec::Stdio { command, args, env } => {
            if command.trim().is_empty() || command.starts_with('-') || !plain_value(command) {
                return Err("Enter the command that starts the server.".into());
            }
            if args.iter().any(|arg| arg.contains('\0')) {
                return Err("Arguments cannot contain null characters.".into());
            }
            for (key, value) in env {
                if !valid_env_key(key) || !plain_value(value) {
                    return Err(format!("“{key}” is not a valid environment variable."));
                }
            }
        }
        McpServerSpec::Http {
            url,
            headers,
            bearer_token_env_var,
        } => {
            check_url(url)?;
            match provider {
                McpProvider::Claude => {
                    if bearer_token_env_var.is_some() {
                        return Err("For Claude, send a token as an Authorization header.".into());
                    }
                    for (name, value) in headers {
                        if !valid_header_name(name) || !plain_value(value) {
                            return Err(format!("“{name}” is not a valid header."));
                        }
                    }
                }
                McpProvider::Codex => {
                    if !headers.is_empty() {
                        return Err(
                            "Codex reads a token from an environment variable instead of headers."
                                .into(),
                        );
                    }
                    if let Some(var) = bearer_token_env_var {
                        if !valid_env_key(var) {
                            return Err(
                                "Enter a valid environment variable name for the token.".into()
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn claude_json(server: &McpServerSpec) -> String {
    let value = match server {
        McpServerSpec::Stdio { command, args, env } => serde_json::json!({
            "type": "stdio",
            "command": command,
            "args": args,
            "env": env,
        }),
        McpServerSpec::Http { url, headers, .. } => serde_json::json!({
            "type": "http",
            "url": url,
            "headers": headers,
        }),
    };
    value.to_string()
}

/// The settings that decide whether a saved Claude server is the one asked for.
/// Absent fields read as their defaults, so a hand-written entry still matches.
fn comparable_claude_server(server: &Value) -> Value {
    let field = |name: &str, default: Value| server.get(name).cloned().unwrap_or(default);
    serde_json::json!({
        "type": field("type", Value::from("stdio")),
        "command": field("command", Value::Null),
        "args": field("args", serde_json::json!([])),
        "env": field("env", serde_json::json!({})),
        "url": field("url", Value::Null),
        "headers": field("headers", serde_json::json!({})),
    })
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Claude's settings file for this person: read here, only ever written by Claude.
fn claude_settings_path() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::fs::expand_home("~"))
        .join(".claude.json")
}

/// The folders Claude may have filed a private project server under: this one,
/// and the Git root above it.
fn claude_project_keys(folder: &Path) -> Vec<String> {
    let start = folder
        .canonicalize()
        .unwrap_or_else(|_| folder.to_path_buf());
    let mut keys = vec![start.to_string_lossy().into_owned()];
    if let Some(root) = start.ancestors().find(|dir| dir.join(".git").exists()) {
        let root = root.to_string_lossy().into_owned();
        if !keys.contains(&root) {
            keys.push(root);
        }
    }
    keys
}

/// The entry Claude already has under this name in the chosen scope, if any.
fn saved_claude_server(
    settings_path: &Path,
    folder: Option<&Path>,
    scope: Option<&str>,
    name: &str,
) -> Option<Value> {
    match scope.unwrap_or("local") {
        "user" => read_json(settings_path)?
            .get("mcpServers")?
            .get(name)
            .cloned(),
        "project" => read_json(&folder?.join(".mcp.json"))?
            .get("mcpServers")?
            .get(name)
            .cloned(),
        _ => {
            let settings = read_json(settings_path)?;
            let projects = settings.get("projects")?;
            claude_project_keys(folder?)
                .iter()
                .find_map(|key| projects.get(key)?.get("mcpServers")?.get(name).cloned())
        }
    }
}

/// Claude refuses to add a name it already has. When that entry has the same
/// settings, an earlier try already did this part: `Ok(true)` skips the CLI, so
/// a retry can carry on to the provider that missed out. Different settings are
/// never replaced. Unreadable settings give `Ok(false)` and the CLI decides.
fn claude_already_has(
    settings_path: &Path,
    folder: Option<&Path>,
    scope: Option<&str>,
    name: &str,
    server: &McpServerSpec,
) -> Result<bool, String> {
    let Some(saved) = saved_claude_server(settings_path, folder, scope, name) else {
        return Ok(false);
    };
    let wanted: Value = serde_json::from_str(&claude_json(server)).map_err(|e| e.to_string())?;
    if comparable_claude_server(&saved) == comparable_claude_server(&wanted) {
        return Ok(true);
    }
    Err(format!(
        "Claude already has a server called {name} with different settings. Remove it or use another name."
    ))
}

/// The exact arguments for the provider CLI, after validating every field.
pub fn mcp_args(request: &McpRequest) -> Result<Vec<String>, String> {
    let s = |v: &str| v.to_string();
    match request {
        McpRequest::Add {
            provider,
            name,
            scope,
            server,
        } => {
            if !valid_new_name(name) {
                return Err(
                    "Use letters, numbers, dots, dashes, or underscores for the name.".into(),
                );
            }
            check_spec(*provider, server)?;
            match provider {
                McpProvider::Claude => {
                    let mut args = vec![s("mcp"), s("add-json")];
                    if let Some(scope) = claude_scope(scope)? {
                        args.extend([s("--scope"), s(scope)]);
                    }
                    args.extend([s("--"), name.clone(), claude_json(server)]);
                    Ok(args)
                }
                McpProvider::Codex => {
                    if scope.as_deref().is_some_and(|scope| scope != "user") {
                        return Err("Codex servers are always personal.".into());
                    }
                    let mut args = vec![s("mcp"), s("add"), name.clone()];
                    match server {
                        McpServerSpec::Stdio {
                            command,
                            args: rest,
                            env,
                        } => {
                            for (key, value) in env {
                                args.extend([s("--env"), format!("{key}={value}")]);
                            }
                            args.push(s("--"));
                            args.push(command.clone());
                            args.extend(rest.iter().cloned());
                        }
                        McpServerSpec::Http {
                            url,
                            bearer_token_env_var,
                            ..
                        } => {
                            args.extend([s("--url"), url.clone()]);
                            if let Some(var) = bearer_token_env_var {
                                args.extend([s("--bearer-token-env-var"), var.clone()]);
                            }
                        }
                    }
                    Ok(args)
                }
            }
        }
        McpRequest::Remove {
            provider,
            name,
            scope,
        } => {
            if !valid_existing_name(name) {
                return Err("That server name is not valid.".into());
            }
            let mut args = vec![s("mcp"), s("remove")];
            match provider {
                McpProvider::Claude => {
                    if let Some(scope) = claude_scope(scope)? {
                        args.extend([s("--scope"), s(scope)]);
                    }
                }
                McpProvider::Codex => {}
            }
            args.extend([s("--"), name.clone()]);
            Ok(args)
        }
        McpRequest::Login { name, .. } | McpRequest::Logout { name, .. } => {
            if !valid_existing_name(name) {
                return Err("That server name is not valid.".into());
            }
            let verb = if matches!(request, McpRequest::Login { .. }) {
                "login"
            } else {
                "logout"
            };
            Ok(vec![s("mcp"), s(verb), s("--"), name.clone()])
        }
    }
}

/// Runs one MCP management command for Claude Code or Codex.
#[tauri::command]
pub async fn provider_mcp(
    app: AppHandle,
    request: McpRequest,
    cwd: Option<String>,
) -> Result<String, String> {
    let work = crate::update_restart::begin_runtime_work(&app, request.work_label())?;
    let args = mcp_args(&request)?;
    // A missing folder would silently write the project's config elsewhere.
    let project_folder = cwd
        .as_deref()
        .filter(|dir| !dir.is_empty())
        .map(crate::fs::expand_home)
        .filter(|dir| dir.is_dir());
    if request.needs_project() && project_folder.is_none() {
        return Err("Open a project that still exists to change its servers.".into());
    }
    let timeout = request.timeout();
    let provider = request.provider();
    tauri::async_runtime::spawn_blocking(move || {
        let _work = work;
        if let McpRequest::Add {
            provider: McpProvider::Claude,
            name,
            scope,
            server,
        } = &request
        {
            let already = claude_already_has(
                &claude_settings_path(),
                project_folder.as_deref(),
                scope.as_deref(),
                name,
                server,
            )?;
            if already {
                return Ok(String::new());
            }
        }
        let binary = match provider {
            McpProvider::Claude => harness::resolved_claude_binary(),
            McpProvider::Codex => harness::resolved_codex_binary(),
        }
        .ok_or_else(|| match provider {
            McpProvider::Claude => "Claude Code is not installed.".to_string(),
            McpProvider::Codex => "Codex is not installed.".to_string(),
        })?;
        harness::run_provider_cli(&binary, &args, cwd.as_deref(), timeout)
            .map_err(|message| request.explain_failure(message))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own for each test: never the real home or settings.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("aven-mcp-manage-{label}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("repo/.git")).unwrap();
            std::fs::create_dir_all(dir.join("repo/app")).unwrap();
            Self(dir.canonicalize().unwrap())
        }
        fn settings(&self) -> PathBuf {
            self.0.join(".claude.json")
        }
        fn repo(&self) -> PathBuf {
            self.0.join("repo")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn remote(url: &str, token: &str) -> McpServerSpec {
        McpServerSpec::Http {
            url: url.into(),
            headers: BTreeMap::from([("Authorization".into(), format!("Bearer {token}"))]),
            bearer_token_env_var: None,
        }
    }

    #[test]
    fn a_retry_skips_claude_only_when_its_entry_has_the_same_settings() {
        let fixture = Fixture::new("same");
        let server = remote("https://mcp.example.com/mcp", "fixture");
        std::fs::write(
            fixture.settings(),
            serde_json::json!({
                "mcpServers": { "acme": serde_json::from_str::<Value>(&claude_json(&server)).unwrap() }
            })
            .to_string(),
        )
        .unwrap();
        let check = |name: &str, spec: &McpServerSpec| {
            claude_already_has(&fixture.settings(), None, Some("user"), name, spec)
        };
        assert_eq!(check("acme", &server), Ok(true));
        assert_eq!(check("other", &server), Ok(false));
        let different = check(
            "acme",
            &remote("https://elsewhere.example.com/mcp", "fixture"),
        );
        assert!(different.unwrap_err().contains("different settings"));
        // Only the token differs: still a different server, and it isn't quoted.
        let error = check("acme", &remote("https://mcp.example.com/mcp", "changed")).unwrap_err();
        assert!(!error.contains("changed"));
    }

    #[test]
    fn a_saved_stdio_entry_matches_without_its_empty_fields() {
        let fixture = Fixture::new("defaults");
        std::fs::write(
            fixture.settings(),
            r#"{"mcpServers":{"acme":{"command":"npx"}}}"#,
        )
        .unwrap();
        let server = McpServerSpec::Stdio {
            command: "npx".into(),
            args: vec![],
            env: BTreeMap::new(),
        };
        assert_eq!(
            claude_already_has(&fixture.settings(), None, Some("user"), "acme", &server),
            Ok(true)
        );
    }

    #[test]
    fn each_claude_scope_is_read_from_its_own_place() {
        let fixture = Fixture::new("scopes");
        let repo = fixture.repo();
        let entry = |command: &str| serde_json::json!({ "type": "stdio", "command": command });
        std::fs::write(
            fixture.settings(),
            serde_json::json!({
                "mcpServers": { "acme": entry("personal") },
                "projects": { repo.to_string_lossy(): { "mcpServers": { "acme": entry("private") } } },
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            repo.join(".mcp.json"),
            serde_json::json!({ "mcpServers": { "acme": entry("shared") } }).to_string(),
        )
        .unwrap();
        let command = |folder: &Path, scope: Option<&str>| {
            saved_claude_server(&fixture.settings(), Some(folder), scope, "acme")
                .map(|saved| saved["command"].as_str().unwrap().to_string())
        };
        assert_eq!(command(&repo, Some("user")).as_deref(), Some("personal"));
        assert_eq!(command(&repo, Some("project")).as_deref(), Some("shared"));
        assert_eq!(command(&repo, Some("local")).as_deref(), Some("private"));
        // No scope is Claude's default, and a subfolder finds its Git root.
        assert_eq!(command(&repo, None).as_deref(), Some("private"));
        assert_eq!(
            command(&repo.join("app"), Some("local")).as_deref(),
            Some("private")
        );
        // A missing project entry is simply not there.
        assert_eq!(command(&fixture.0, Some("project")), None);
    }

    #[test]
    fn unreadable_settings_leave_the_decision_to_the_cli() {
        let fixture = Fixture::new("unreadable");
        let server = remote("https://mcp.example.com/mcp", "fixture");
        let check = || claude_already_has(&fixture.settings(), None, Some("user"), "acme", &server);
        assert_eq!(check(), Ok(false));
        std::fs::write(fixture.settings(), "not json").unwrap();
        assert_eq!(check(), Ok(false));
    }

    #[test]
    fn only_a_remote_codex_add_waits_for_a_browser() {
        let add = |provider, server| McpRequest::Add {
            provider,
            name: "acme".into(),
            scope: None,
            server,
        };
        let url = || remote("https://mcp.example.com/mcp", "fixture");
        assert_eq!(add(McpProvider::Codex, url()).timeout(), LOGIN_TIMEOUT);
        assert_eq!(add(McpProvider::Claude, url()).timeout(), EDIT_TIMEOUT);
        assert_eq!(add(McpProvider::Codex, stdio()).timeout(), EDIT_TIMEOUT);
        assert_eq!(
            McpRequest::Login {
                provider: McpProvider::Codex,
                name: "acme".into()
            }
            .timeout(),
            LOGIN_TIMEOUT
        );
    }

    #[test]
    fn a_timed_out_codex_add_says_what_to_do_next() {
        let request = McpRequest::Add {
            provider: McpProvider::Codex,
            name: "acme".into(),
            scope: None,
            server: remote("https://mcp.example.com/mcp", "fixture"),
        };
        let timed_out = "codex took too long and was stopped.".to_string();
        assert!(request
            .explain_failure(timed_out.clone())
            .contains("Sign in"));
        assert_eq!(request.explain_failure("other".into()), "other");
        let remove = McpRequest::Remove {
            provider: McpProvider::Codex,
            name: "acme".into(),
            scope: None,
        };
        assert_eq!(remove.explain_failure(timed_out.clone()), timed_out);
    }

    fn stdio() -> McpServerSpec {
        McpServerSpec::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "@acme/mcp".into()],
            env: BTreeMap::from([("API_KEY".into(), "secret value".into())]),
        }
    }

    #[test]
    fn claude_add_uses_json_after_an_option_terminator() {
        let args = mcp_args(&McpRequest::Add {
            provider: McpProvider::Claude,
            name: "acme".into(),
            scope: Some("user".into()),
            server: stdio(),
        })
        .unwrap();
        assert_eq!(&args[..5], ["mcp", "add-json", "--scope", "user", "--"]);
        assert_eq!(args[5], "acme");
        let json: serde_json::Value = serde_json::from_str(&args[6]).unwrap();
        assert_eq!(json["command"], "npx");
        assert_eq!(json["args"][0], "-y");
        assert_eq!(json["env"]["API_KEY"], "secret value");
    }

    #[test]
    fn codex_add_keeps_server_flags_after_the_terminator() {
        let args = mcp_args(&McpRequest::Add {
            provider: McpProvider::Codex,
            name: "acme".into(),
            scope: None,
            server: stdio(),
        })
        .unwrap();
        assert_eq!(
            args,
            [
                "mcp",
                "add",
                "acme",
                "--env",
                "API_KEY=secret value",
                "--",
                "npx",
                "-y",
                "@acme/mcp"
            ]
        );
    }

    #[test]
    fn remote_servers_follow_each_providers_auth_style() {
        let claude = mcp_args(&McpRequest::Add {
            provider: McpProvider::Claude,
            name: "sentry".into(),
            scope: None,
            server: McpServerSpec::Http {
                url: "https://mcp.sentry.dev/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), "Bearer x".into())]),
                bearer_token_env_var: None,
            },
        })
        .unwrap();
        let json: serde_json::Value = serde_json::from_str(claude.last().unwrap()).unwrap();
        assert_eq!(json["type"], "http");
        assert_eq!(json["headers"]["Authorization"], "Bearer x");

        let codex = mcp_args(&McpRequest::Add {
            provider: McpProvider::Codex,
            name: "sentry".into(),
            scope: None,
            server: McpServerSpec::Http {
                url: "https://mcp.sentry.dev/mcp".into(),
                headers: BTreeMap::new(),
                bearer_token_env_var: Some("SENTRY_TOKEN".into()),
            },
        })
        .unwrap();
        assert_eq!(
            codex,
            [
                "mcp",
                "add",
                "sentry",
                "--url",
                "https://mcp.sentry.dev/mcp",
                "--bearer-token-env-var",
                "SENTRY_TOKEN"
            ]
        );
    }

    #[test]
    fn rejects_names_urls_and_values_that_could_change_the_command() {
        let add = |provider, name: &str, server| {
            mcp_args(&McpRequest::Add {
                provider,
                name: name.into(),
                scope: None,
                server,
            })
        };
        assert!(add(McpProvider::Claude, "--scope", stdio()).is_err());
        assert!(add(McpProvider::Claude, "has space", stdio()).is_err());
        assert!(add(
            McpProvider::Codex,
            "x",
            McpServerSpec::Stdio {
                command: "--help".into(),
                args: vec![],
                env: BTreeMap::new()
            }
        )
        .is_err());
        assert!(add(
            McpProvider::Codex,
            "x",
            McpServerSpec::Stdio {
                command: "node".into(),
                args: vec![],
                env: BTreeMap::from([("BAD KEY".into(), "v".into())]),
            }
        )
        .is_err());
        assert!(add(
            McpProvider::Claude,
            "x",
            McpServerSpec::Http {
                url: "file:///etc/passwd".into(),
                headers: BTreeMap::new(),
                bearer_token_env_var: None,
            }
        )
        .is_err());
        assert!(add(
            McpProvider::Claude,
            "x",
            McpServerSpec::Http {
                url: "https://example.com".into(),
                headers: BTreeMap::from([("X-Key".into(), "a\nb".into())]),
                bearer_token_env_var: None,
            }
        )
        .is_err());
        assert!(mcp_args(&McpRequest::Add {
            provider: McpProvider::Claude,
            name: "x".into(),
            scope: Some("everyone".into()),
            server: stdio(),
        })
        .is_err());
    }

    #[test]
    fn existing_provider_names_are_passed_as_one_argument() {
        let args = mcp_args(&McpRequest::Login {
            provider: McpProvider::Claude,
            name: "claude.ai Gmail".into(),
        })
        .unwrap();
        assert_eq!(args, ["mcp", "login", "--", "claude.ai Gmail"]);
        let remove = mcp_args(&McpRequest::Remove {
            provider: McpProvider::Claude,
            name: "acme".into(),
            scope: Some("project".into()),
        })
        .unwrap();
        assert_eq!(
            remove,
            ["mcp", "remove", "--scope", "project", "--", "acme"]
        );
        assert!(mcp_args(&McpRequest::Logout {
            provider: McpProvider::Codex,
            name: "-x".into(),
        })
        .is_err());
    }

    #[test]
    fn project_scopes_need_a_project_folder() {
        let request = |scope: &str| McpRequest::Add {
            provider: McpProvider::Claude,
            name: "acme".into(),
            scope: Some(scope.into()),
            server: stdio(),
        };
        assert!(request("project").needs_project());
        assert!(request("local").needs_project());
        assert!(!request("user").needs_project());
        assert!(McpRequest::Add {
            provider: McpProvider::Claude,
            name: "acme".into(),
            scope: None,
            server: stdio(),
        }
        .needs_project());
    }
}
