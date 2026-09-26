//! Add, remove, and sign in to MCP servers through each provider's own CLI.
//!
//! Claude Code and Codex own their configuration files, so Aven never edits
//! them directly. The webview sends a structured request; this module checks
//! every field and builds the exact argument list, so no user text is ever
//! interpreted as a CLI option.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Deserialize;
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
        match self {
            Self::Login { .. } => LOGIN_TIMEOUT,
            _ => EDIT_TIMEOUT,
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
    let work = crate::window::begin_runtime_work(&app)?;
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
        let binary = match provider {
            McpProvider::Claude => harness::resolved_claude_binary(),
            McpProvider::Codex => harness::resolved_codex_binary(),
        }
        .ok_or_else(|| match provider {
            McpProvider::Claude => "Claude Code is not installed.".to_string(),
            McpProvider::Codex => "Codex is not installed.".to_string(),
        })?;
        harness::run_provider_cli(&binary, &args, cwd.as_deref(), timeout)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

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
