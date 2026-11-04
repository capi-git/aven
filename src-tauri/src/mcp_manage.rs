//! Add, remove, and sign in to MCP servers through each provider's own CLI.
//!
//! Claude Code, Codex and Pi own their configuration files, so Aven never edits
//! them directly. The webview sends a structured request; this module checks
//! every field and builds the exact argument list, so no user text is ever
//! interpreted as a CLI option.
//!
//! It also reads, and never writes, the personal servers Claude Code and Codex
//! have, so a chat on a provider that takes servers at session start can have
//! them too (see `shared_servers`). Only what is safe to pass on leaves here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::harness;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpProvider {
    Claude,
    Codex,
    Pi,
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
    /// Pi only: what `pi mcp list` says. Claude and Codex answer over their own
    /// protocols (see providerConnections.ts).
    List {
        provider: McpProvider,
    },
}

const EDIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Sign-in waits for the user to finish in their browser.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// `pi mcp list` connects to every server before it answers.
const LIST_TIMEOUT: Duration = Duration::from_secs(45);

impl McpRequest {
    fn provider(&self) -> McpProvider {
        match self {
            Self::Add { provider, .. }
            | Self::Remove { provider, .. }
            | Self::Login { provider, .. }
            | Self::Logout { provider, .. }
            | Self::List { provider } => *provider,
        }
    }

    fn timeout(&self) -> Duration {
        if matches!(self, Self::Login { .. }) || self.may_sign_in_while_adding() {
            LOGIN_TIMEOUT
        } else if matches!(self, Self::List { .. }) {
            LIST_TIMEOUT
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
            Self::List { .. } => "checking your MCP servers",
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
    if provider == McpProvider::Pi && has_secret_fields(server) {
        return Err("Pi only takes servers with no keys from Aven.".into());
    }
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
                // Refused above: Pi never gets a header or a token variable here.
                McpProvider::Pi => {}
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

/// Fields that hold a key, or name where one is. They stay with the providers
/// they were typed for: every further CLI would see them in its arguments.
fn has_secret_fields(server: &McpServerSpec) -> bool {
    match server {
        McpServerSpec::Stdio { env, args, .. } => {
            !env.is_empty() || args.iter().any(|arg| secret_like_argument(arg))
        }
        McpServerSpec::Http {
            url,
            headers,
            bearer_token_env_var,
        } => !headers.is_empty() || bearer_token_env_var.is_some() || secret_like_url(url),
    }
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

/// Codex's config file for this person: read here, only ever written by Codex.
fn codex_config_path() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::fs::expand_home("~/.codex"))
        .join("config.toml")
}

fn read_toml(path: &Path) -> Option<toml::Table> {
    std::fs::read_to_string(path).ok()?.parse().ok()
}

/// The settings `codex mcp add` can set, from what the request asks for.
fn wanted_codex_server(server: &McpServerSpec) -> Value {
    match server {
        McpServerSpec::Stdio { command, args, env } => serde_json::json!({
            "command": command,
            "args": args,
            "env": env,
            "url": Value::Null,
            "bearer_token_env_var": Value::Null,
        }),
        McpServerSpec::Http {
            url,
            bearer_token_env_var,
            ..
        } => serde_json::json!({
            "command": Value::Null,
            "args": [],
            "env": {},
            "url": url,
            "bearer_token_env_var": bearer_token_env_var,
        }),
    }
}

/// The same settings from a saved entry, whose absent fields read as defaults.
fn saved_codex_server(entry: &toml::Value) -> Value {
    let saved = serde_json::to_value(entry).unwrap_or(Value::Null);
    let field = |name: &str, default: Value| saved.get(name).cloned().unwrap_or(default);
    serde_json::json!({
        "command": field("command", Value::Null),
        "args": field("args", serde_json::json!([])),
        "env": field("env", serde_json::json!({})),
        "url": field("url", Value::Null),
        "bearer_token_env_var": field("bearer_token_env_var", Value::Null),
    })
}

/// `codex mcp add` replaces a same-named entry without a word, along with
/// anything else that entry had set (`run_add` in Codex's `mcp_cmd.rs`). So the
/// check Codex doesn't make happens here. The same settings give `Ok(true)` and
/// skip the CLI, so a retry leaves the entry alone. Different settings are never
/// replaced. A file that can't be read gives `Ok(false)`; Codex can't load it
/// either, so it refuses by itself rather than overwrite anything.
fn codex_already_has(path: &Path, name: &str, server: &McpServerSpec) -> Result<bool, String> {
    let Some(config) = read_toml(path) else {
        return Ok(false);
    };
    let Some(saved) = config.get("mcp_servers").and_then(|all| all.get(name)) else {
        return Ok(false);
    };
    if saved_codex_server(saved) == wanted_codex_server(server) {
        return Ok(true);
    }
    Err(format!(
        "Codex already has a server called {name} with different settings. Remove it or use another name."
    ))
}

/// Pi's folder for this person: read here, only ever written by Pi.
fn pi_agent_dir() -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::fs::expand_home("~/.pi/agent"))
}

/// `pi mcp add` is documented to "add or replace", so this stands in the way of
/// it as `codex_already_has` does for Codex.
fn pi_already_has(path: &Path, name: &str, server: &McpServerSpec) -> Result<bool, String> {
    let Some(saved) = read_json(path)
        .as_ref()
        .and_then(|config| config.get("mcpServers")?.get(name).cloned())
    else {
        return Ok(false);
    };
    let field = |name: &str, default: Value| saved.get(name).cloned().unwrap_or(default);
    let same = field("headers", serde_json::json!({})) == serde_json::json!({})
        && field("env", serde_json::json!({})) == serde_json::json!({})
        && field("oauth", Value::Null).is_null()
        && match server {
            McpServerSpec::Stdio { command, args, .. } => {
                field("command", Value::Null) == command.as_str()
                    && field("args", serde_json::json!([])) == serde_json::json!(args)
            }
            McpServerSpec::Http { url, .. } => field("url", Value::Null) == url.as_str(),
        };
    if same {
        return Ok(true);
    }
    Err(format!(
        "Pi already has a server called {name} with different settings. Remove it or use another name."
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
                McpProvider::Pi => {
                    if name.contains('.') {
                        return Err("Pi’s server names can’t have dots.".into());
                    }
                    if scope.as_deref().is_some_and(|scope| scope != "user") {
                        return Err("Aven only adds personal servers to Pi.".into());
                    }
                    let mut args = vec![s("mcp"), s("add"), name.clone()];
                    match server {
                        McpServerSpec::Stdio {
                            command,
                            args: rest,
                            ..
                        } => {
                            args.push(s("--"));
                            args.push(command.clone());
                            args.extend(rest.iter().cloned());
                        }
                        McpServerSpec::Http { url, .. } => {
                            args.extend([s("--url"), url.clone()]);
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
                McpProvider::Codex | McpProvider::Pi => {}
            }
            args.extend([s("--"), name.clone()]);
            Ok(args)
        }
        McpRequest::List { provider } => {
            if *provider != McpProvider::Pi {
                return Err("Only Pi is listed this way.".into());
            }
            Ok(vec![s("mcp"), s("list"), s("--json")])
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

/// Runs one MCP management command for Claude Code, Codex or Pi.
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
            provider,
            name,
            scope,
            server,
        } = &request
        {
            let already = match provider {
                McpProvider::Claude => claude_already_has(
                    &claude_settings_path(),
                    project_folder.as_deref(),
                    scope.as_deref(),
                    name,
                    server,
                ),
                McpProvider::Codex => codex_already_has(&codex_config_path(), name, server),
                McpProvider::Pi => pi_already_has(&pi_agent_dir().join("mcp.json"), name, server),
            }?;
            if already {
                return Ok(String::new());
            }
        }
        let binary = match provider {
            McpProvider::Claude => harness::resolved_claude_binary(),
            McpProvider::Codex => harness::resolved_codex_binary(),
            McpProvider::Pi => harness::resolved_setup_binary("pi"),
        }
        .ok_or_else(|| match provider {
            McpProvider::Claude => "Claude Code is not installed.".to_string(),
            McpProvider::Codex => "Codex is not installed.".to_string(),
            McpProvider::Pi => "Pi is not installed.".to_string(),
        })?;
        // `pi mcp list` exits 1 when a server isn't connected, with the answer
        // still on stdout.
        if matches!(request, McpRequest::List { .. }) {
            return harness::run_provider_cli_stdout(&binary, &args, cwd.as_deref(), timeout);
        }
        harness::run_provider_cli(&binary, &args, cwd.as_deref(), timeout)
            .map_err(|message| request.explain_failure(message))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One personal server, as Aven may pass it to a chat on another provider. A
/// `withheld` one carries only its name: nothing else about it leaves here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedServer {
    name: String,
    from: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    /// "secret": it holds a key, which stays with the provider it was given to.
    /// "kind": a connection other providers don't take.
    #[serde(skip_serializing_if = "Option::is_none")]
    withheld: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedServers {
    servers: Vec<SharedServer>,
    /// Names each provider has set up for itself, which Aven must not shadow.
    own: BTreeMap<&'static str, Vec<String>>,
}

impl SharedServer {
    fn withheld(name: &str, from: &'static str, why: &'static str) -> Self {
        Self {
            name: name.to_string(),
            from,
            kind: None,
            command: None,
            args: Vec::new(),
            url: None,
            withheld: Some(why),
        }
    }
}

/// An argument that may carry a key: named like one, or long and random-looking.
/// `--token abc` is caught by the flag, so its value never goes on its own.
fn secret_like_argument(arg: &str) -> bool {
    let lower = arg.to_ascii_lowercase();
    if [
        "token",
        "secret",
        "password",
        "passwd",
        "api-key",
        "api_key",
        "apikey",
        "credential",
        "bearer",
        "authorization",
    ]
    .iter()
    .any(|word| lower.contains(word))
    {
        return true;
    }
    looks_random(arg)
}

/// 32 or more letters and digits in a row, mixed: a key rather than a word.
fn looks_random(text: &str) -> bool {
    text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
        .any(|run| {
            run.len() >= 32
                && run.chars().any(|c| c.is_ascii_digit())
                && run.chars().any(|c| c.is_ascii_alphabetic())
        })
}

/// A URL that may carry a key: a query, a password, or a random-looking path.
fn secret_like_url(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return true;
    };
    parsed.query().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || looks_random(parsed.path())
}

fn shared_stdio(name: &str, from: &'static str, command: &str, args: Vec<String>) -> SharedServer {
    if secret_like_argument(command) || args.iter().any(|arg| secret_like_argument(arg)) {
        return SharedServer::withheld(name, from, "secret");
    }
    SharedServer {
        name: name.to_string(),
        from,
        kind: Some("stdio"),
        command: Some(command.to_string()),
        args,
        url: None,
        withheld: None,
    }
}

fn shared_http(name: &str, from: &'static str, url: &str) -> SharedServer {
    if secret_like_url(url) {
        return SharedServer::withheld(name, from, "secret");
    }
    SharedServer {
        name: name.to_string(),
        from,
        kind: Some("http"),
        command: None,
        args: Vec::new(),
        url: Some(url.to_string()),
        withheld: None,
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// A field is empty when it is absent, or an empty list, table or string.
fn filled(entry: &Value, field: &str) -> bool {
    match entry.get(field) {
        None | Some(Value::Null) => false,
        Some(Value::Object(items)) => !items.is_empty(),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// One entry from either provider. Any field that holds or names a key
/// withholds the whole server; nothing of it is read further.
fn shared_entry(
    name: &str,
    from: &'static str,
    entry: &Value,
    secret_fields: &[&str],
) -> SharedServer {
    if secret_fields.iter().any(|field| filled(entry, field)) {
        return SharedServer::withheld(name, from, "secret");
    }
    let kind = entry.get("type").and_then(Value::as_str);
    if let Some(command) = entry.get("command").and_then(Value::as_str) {
        if matches!(kind, None | Some("stdio")) {
            return shared_stdio(name, from, command, string_list(entry.get("args")));
        }
    }
    if let Some(url) = entry.get("url").and_then(Value::as_str) {
        if matches!(
            kind,
            None | Some("http" | "streamable_http" | "streamable-http")
        ) {
            return shared_http(name, from, url);
        }
    }
    SharedServer::withheld(name, from, "kind")
}

const CLAUDE_SECRET_FIELDS: &[&str] = &["env", "headers", "headersHelper", "oauth"];
const CODEX_SECRET_FIELDS: &[&str] = &[
    "env",
    "env_vars",
    "http_headers",
    "env_http_headers",
    "bearer_token",
    "bearer_token_env_var",
    "oauth",
    "oauth_resource",
];

/// Claude's personal servers, without any it has turned off for this project.
fn claude_personal_servers(settings_path: &Path, folder: Option<&Path>) -> Vec<SharedServer> {
    let Some(settings) = read_json(settings_path) else {
        return Vec::new();
    };
    let turned_off: Vec<String> = folder
        .map(claude_project_keys)
        .unwrap_or_default()
        .iter()
        .flat_map(|key| {
            string_list(
                settings
                    .get("projects")
                    .and_then(|projects| projects.get(key))
                    .and_then(|project| project.get("disabledMcpServers")),
            )
        })
        .collect();
    settings
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| {
            servers
                .iter()
                .filter(|(name, _)| !turned_off.contains(name))
                .map(|(name, entry)| shared_entry(name, "claude", entry, CLAUDE_SECRET_FIELDS))
                .collect()
        })
        .unwrap_or_default()
}

/// Codex's personal servers, without any turned off in its config file.
fn codex_personal_servers(config_path: &Path) -> Vec<SharedServer> {
    let Some(config) = read_toml(config_path) else {
        return Vec::new();
    };
    config
        .get("mcp_servers")
        .and_then(toml::Value::as_table)
        .map(|servers| {
            servers
                .iter()
                .filter_map(|(name, entry)| {
                    let entry = serde_json::to_value(entry).ok()?;
                    (entry.get("enabled") != Some(&Value::Bool(false)))
                        .then(|| shared_entry(name, "codex", &entry, CODEX_SECRET_FIELDS))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The names under one key of a JSON config. Comments or a bad file read as
/// none: this only stops Aven shadowing a server, and each provider reads its
/// own file again anyway.
fn json_names(path: &Path, keys: &[&str]) -> Vec<String> {
    let Some(mut value) = read_json(path) else {
        return Vec::new();
    };
    for key in keys {
        let Some(next) = value.get(*key).cloned() else {
            return Vec::new();
        };
        value = next;
    }
    value
        .as_object()
        .map(|items| items.keys().cloned().collect())
        .unwrap_or_default()
}

fn toml_names(path: &Path) -> Vec<String> {
    read_toml(path)
        .and_then(|config| {
            config
                .get("mcp_servers")?
                .as_table()
                .map(|servers| servers.keys().cloned().collect())
        })
        .unwrap_or_default()
}

/// What each session-start provider has set up for itself, by name. A server
/// Aven passes can win over one of these, so a same-named one isn't passed.
fn own_server_names(home: &Path, folder: Option<&Path>) -> BTreeMap<&'static str, Vec<String>> {
    let cursor_files = |dir: &Path| json_names(&dir.join(".cursor/mcp.json"), &["mcpServers"]);
    let mut cursor = cursor_files(home);
    let mut grok = toml_names(&home.join(".grok/config.toml"));
    grok.extend(cursor.iter().cloned());
    let mut fx = Vec::new();
    let opencode_home = home.join(".config/opencode");
    let mut opencode = Vec::new();
    let opencode_files = |dir: &Path| {
        ["opencode.json", ".opencode/opencode.json"]
            .iter()
            .flat_map(|file| {
                let path = dir.join(file);
                let mut names = json_names(&path, &["mcp"]);
                names.extend(json_names(&path, &["mcp", "servers"]));
                names
            })
            .collect::<Vec<_>>()
    };
    opencode.extend(opencode_files(&opencode_home));
    if let Some(folder) = folder {
        cursor.extend(cursor_files(folder));
        let project = json_names(&folder.join(".mcp.json"), &["mcpServers"]);
        grok.extend(toml_names(&folder.join(".grok/config.toml")));
        grok.extend(cursor_files(folder));
        grok.extend(project.iter().cloned());
        fx.extend(project);
        opencode.extend(opencode_files(folder));
    }
    BTreeMap::from([
        ("cursor", cursor),
        ("grok", grok),
        ("fx", fx),
        ("opencode", opencode),
    ])
}

/// What a chat on a provider that takes servers at session start may be given:
/// the personal servers Claude Code and Codex already have, without their keys.
#[tauri::command]
pub async fn mcp_shared_servers(cwd: Option<String>) -> Result<SharedServers, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = cwd
            .as_deref()
            .filter(|dir| !dir.is_empty())
            .map(crate::fs::expand_home)
            .filter(|dir| dir.is_dir());
        let mut servers = claude_personal_servers(&claude_settings_path(), folder.as_deref());
        servers.extend(codex_personal_servers(&codex_config_path()));
        SharedServers {
            servers,
            own: own_server_names(&crate::fs::expand_home("~"), folder.as_deref()),
        }
    })
    .await
    .map_err(|e| e.to_string())
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
    fn codex_is_never_allowed_to_replace_different_settings() {
        let fixture = Fixture::new("codex-same");
        let path = fixture.0.join("config.toml");
        std::fs::write(
            &path,
            "[mcp_servers.acme]\nurl = \"https://mcp.example.com/mcp\"\nstartup_timeout_sec = 30\n\n[mcp_servers.local]\ncommand = \"npx\"\n",
        )
        .unwrap();
        let url = |url: &str| McpServerSpec::Http {
            url: url.into(),
            headers: BTreeMap::new(),
            bearer_token_env_var: None,
        };
        let check = |name: &str, spec: &McpServerSpec| codex_already_has(&path, name, spec);
        assert_eq!(check("acme", &url("https://mcp.example.com/mcp")), Ok(true));
        assert_eq!(
            check("other", &url("https://mcp.example.com/mcp")),
            Ok(false)
        );
        assert!(check("acme", &url("https://elsewhere.example.com/mcp"))
            .unwrap_err()
            .contains("different settings"));
        // A token variable changes how it signs in, so it's different too.
        let with_token = McpServerSpec::Http {
            url: "https://mcp.example.com/mcp".into(),
            headers: BTreeMap::new(),
            bearer_token_env_var: Some("ACME_TOKEN".into()),
        };
        assert!(check("acme", &with_token).is_err());
        let local = McpServerSpec::Stdio {
            command: "npx".into(),
            args: vec![],
            env: BTreeMap::new(),
        };
        assert_eq!(check("local", &local), Ok(true));
        // A secret in the differing setting isn't quoted back.
        let with_secret = McpServerSpec::Stdio {
            command: "npx".into(),
            args: vec![],
            env: BTreeMap::from([("KEY".into(), "fixture-secret".into())]),
        };
        assert!(!check("local", &with_secret)
            .unwrap_err()
            .contains("fixture-secret"));
    }

    #[test]
    fn an_unreadable_codex_config_leaves_the_decision_to_codex() {
        let fixture = Fixture::new("codex-unreadable");
        let path = fixture.0.join("config.toml");
        let server = remote("https://mcp.example.com/mcp", "fixture");
        assert_eq!(codex_already_has(&path, "acme", &server), Ok(false));
        std::fs::write(&path, "not [ toml").unwrap();
        assert_eq!(codex_already_has(&path, "acme", &server), Ok(false));
    }

    #[test]
    fn pi_is_never_allowed_to_replace_different_settings() {
        let fixture = Fixture::new("pi-same");
        let path = fixture.0.join("mcp.json");
        std::fs::write(
            &path,
            r#"{"mcpServers":{"acme":{"url":"https://mcp.example.com/mcp"},"keyed":{"url":"https://k.example.com/mcp","headers":{"X":"y"}}}}"#,
        )
        .unwrap();
        let url = |url: &str| McpServerSpec::Http {
            url: url.into(),
            headers: BTreeMap::new(),
            bearer_token_env_var: None,
        };
        assert_eq!(
            pi_already_has(&path, "acme", &url("https://mcp.example.com/mcp")),
            Ok(true)
        );
        assert_eq!(
            pi_already_has(&path, "new", &url("https://mcp.example.com/mcp")),
            Ok(false)
        );
        assert!(pi_already_has(&path, "acme", &url("https://other.example.com/mcp")).is_err());
        assert!(pi_already_has(&path, "keyed", &url("https://k.example.com/mcp")).is_err());
    }

    #[test]
    fn pi_commands_never_carry_a_key() {
        let add = |server| {
            mcp_args(&McpRequest::Add {
                provider: McpProvider::Pi,
                name: "acme".into(),
                scope: None,
                server,
            })
        };
        assert_eq!(
            add(McpServerSpec::Http {
                url: "https://mcp.example.com/mcp".into(),
                headers: BTreeMap::new(),
                bearer_token_env_var: None,
            })
            .unwrap(),
            ["mcp", "add", "acme", "--url", "https://mcp.example.com/mcp"]
        );
        assert_eq!(
            add(McpServerSpec::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "@acme/mcp".into()],
                env: BTreeMap::new(),
            })
            .unwrap(),
            ["mcp", "add", "acme", "--", "npx", "-y", "@acme/mcp"]
        );
        assert!(add(stdio()).is_err());
        assert!(add(remote("https://mcp.example.com/mcp", "fixture")).is_err());
        assert_eq!(
            mcp_args(&McpRequest::List {
                provider: McpProvider::Pi
            })
            .unwrap(),
            ["mcp", "list", "--json"]
        );
        assert!(mcp_args(&McpRequest::List {
            provider: McpProvider::Codex
        })
        .is_err());
    }

    fn shared_names(servers: &[SharedServer]) -> Vec<(&str, Option<&str>)> {
        servers
            .iter()
            .map(|server| (server.name.as_str(), server.withheld))
            .collect()
    }

    #[test]
    fn only_servers_with_no_keys_are_shared_from_claude() {
        let fixture = Fixture::new("share-claude");
        let repo = fixture.repo();
        std::fs::write(
            fixture.settings(),
            serde_json::json!({
                "mcpServers": {
                    "plain": { "type": "http", "url": "https://mcp.example.com/mcp" },
                    "local": { "command": "npx", "args": ["-y", "@acme/mcp"] },
                    "headers": { "type": "http", "url": "https://h.example.com", "headers": { "X-Key": "fixture-secret" } },
                    "env": { "command": "npx", "env": { "KEY": "fixture-secret" } },
                    "query": { "type": "http", "url": "https://q.example.com/mcp?key=fixture-secret" },
                    "flag": { "command": "acme", "args": ["--api-key", "fixture-secret"] },
                    "long": { "command": "acme", "args": ["abcdef0123456789abcdef0123456789"] },
                    "sse": { "type": "sse", "url": "https://s.example.com/sse" },
                    "off": { "command": "npx" },
                },
                "projects": { repo.to_string_lossy(): {
                    "disabledMcpServers": ["off"],
                    "mcpServers": { "private": { "command": "npx" } },
                } },
            })
            .to_string(),
        )
        .unwrap();
        let servers = claude_personal_servers(&fixture.settings(), Some(&repo));
        assert_eq!(
            shared_names(&servers),
            [
                ("env", Some("secret")),
                ("flag", Some("secret")),
                ("headers", Some("secret")),
                ("local", None),
                ("long", Some("secret")),
                ("plain", None),
                ("query", Some("secret")),
                ("sse", Some("kind")),
            ]
        );
        // A withheld entry carries nothing but its name.
        let text = serde_json::to_string(&servers).unwrap();
        assert!(!text.contains("fixture-secret"));
        assert!(!text.contains("X-Key"));
        assert!(!text.contains("KEY"));
        assert!(!text.contains("q.example.com"));
        let plain = servers.iter().find(|s| s.name == "plain").unwrap();
        assert_eq!(plain.url.as_deref(), Some("https://mcp.example.com/mcp"));
        let local = servers.iter().find(|s| s.name == "local").unwrap();
        assert_eq!(local.command.as_deref(), Some("npx"));
        assert_eq!(local.args, ["-y", "@acme/mcp"]);
    }

    #[test]
    fn only_servers_with_no_keys_are_shared_from_codex() {
        let fixture = Fixture::new("share-codex");
        let path = fixture.0.join("config.toml");
        std::fs::write(
            &path,
            r#"
[mcp_servers.plain]
url = "https://mcp.example.com/mcp"
[mcp_servers.local]
command = "npx"
args = ["-y", "@acme/mcp"]
[mcp_servers.token]
url = "https://t.example.com/mcp"
bearer_token_env_var = "FIXTURE_VAR"
[mcp_servers.env]
command = "npx"
[mcp_servers.env.env]
KEY = "fixture-secret"
[mcp_servers.off]
command = "npx"
enabled = false
"#,
        )
        .unwrap();
        let servers = codex_personal_servers(&path);
        assert_eq!(
            shared_names(&servers),
            [
                ("env", Some("secret")),
                ("local", None),
                ("plain", None),
                ("token", Some("secret")),
            ]
        );
        let text = serde_json::to_string(&servers).unwrap();
        assert!(!text.contains("fixture-secret"));
        assert!(!text.contains("FIXTURE_VAR"));
    }

    #[test]
    fn unreadable_configs_share_nothing() {
        let fixture = Fixture::new("share-none");
        assert!(claude_personal_servers(&fixture.settings(), None).is_empty());
        assert!(codex_personal_servers(&fixture.0.join("config.toml")).is_empty());
        std::fs::write(fixture.settings(), "not json").unwrap();
        assert!(claude_personal_servers(&fixture.settings(), None).is_empty());
    }

    #[test]
    fn each_providers_own_names_are_read_from_its_own_files() {
        let fixture = Fixture::new("own");
        let home = fixture.0.join("home");
        let repo = fixture.repo();
        for dir in [".cursor", ".grok", ".config/opencode"] {
            std::fs::create_dir_all(home.join(dir)).unwrap();
        }
        std::fs::create_dir_all(repo.join(".cursor")).unwrap();
        std::fs::write(
            home.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"cursor-home":{}}}"#,
        )
        .unwrap();
        std::fs::write(
            repo.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"cursor-repo":{}}}"#,
        )
        .unwrap();
        std::fs::write(
            home.join(".grok/config.toml"),
            "[mcp_servers.grok-home]\ncommand = \"x\"\n",
        )
        .unwrap();
        std::fs::write(
            home.join(".config/opencode/opencode.json"),
            r#"{"mcp":{"oc-home":{"type":"remote"}}}"#,
        )
        .unwrap();
        std::fs::write(repo.join(".mcp.json"), r#"{"mcpServers":{"shared":{}}}"#).unwrap();
        let own = own_server_names(&home, Some(&repo));
        assert_eq!(own["cursor"], ["cursor-home", "cursor-repo"]);
        // Grok reads Cursor's files and project .mcp.json too.
        assert_eq!(
            own["grok"],
            ["grok-home", "cursor-home", "cursor-repo", "shared"]
        );
        assert_eq!(own["fx"], ["shared"]);
        assert!(own["opencode"].contains(&"oc-home".to_string()));
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
