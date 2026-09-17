//! Repository-local GitHub account routing. Never switch the shared CLI account.
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug)]
pub(crate) struct Route {
    username: String,
    credential_command: String,
    pub repository: String,
}

impl Route {
    /// Every operation uses the token belonging to the explicitly selected
    /// account, even when a different account is active in the terminal.
    pub fn command(&self, root: &Path) -> Result<Command, String> {
        let token = self.auth_token(root)?;
        let mut command = self.base_command(root, "gh")?;
        command.env("GH_TOKEN", token);
        Ok(command)
    }

    fn base_command(&self, root: &Path, name: &str) -> Result<Command, String> {
        let program = if Path::new(name).is_absolute() {
            let path = PathBuf::from(name);
            path.is_file().then_some(path)
        } else {
            crate::harness::resolve_gui_binary(name)
        }
        .ok_or_else(|| {
            "The configured GitHub CLI command is not installed. Install GitHub CLI (`gh`) and check this repository's aven.githubCommand setting.".to_string()
        })?;
        let mut command = Command::new(program);
        crate::harness::apply_gui_env(&mut command);
        configure_command(&mut command, root, &self.repository);
        Ok(command)
    }

    pub fn verify_identity(&self, root: &Path) -> Result<(), String> {
        self.auth_token(root).map(|_| ())
    }

    pub fn auth_token(&self, root: &Path) -> Result<String, String> {
        self.auth_token_using(root, "gh")
    }

    fn auth_token_using(&self, root: &Path, api_command: &str) -> Result<String, String> {
        // The optional wrapper selects a credential store, not an ambient
        // active account. Do not invoke a shell or print any command output.
        let output = self
            .base_command(root, &self.credential_command)?
            .args([
                "auth",
                "token",
                "--hostname",
                "github.com",
                "--user",
                &self.username,
            ])
            .output()
            .map_err(|_| "Could not read this project's GitHub account credentials.".to_string())?;
        if !output.status.success() {
            return Err(self.sign_in_error());
        }
        let token = String::from_utf8(output.stdout)
            .map_err(|_| self.sign_in_error())?
            .trim()
            .to_string();
        if token.is_empty()
            || token
                .chars()
                .any(|character| character.is_whitespace() || character.is_control())
        {
            return Err(self.sign_in_error());
        }

        // Verify and run API operations using stock gh with the same token.
        // A wrapper cannot substitute its active account during verification
        // or the operation, and no shared `gh auth switch` is required.
        let output = self
            .base_command(root, api_command)?
            .env("GH_TOKEN", &token)
            .args(["api", "user", "--hostname", "github.com", "--jq", ".login"])
            .output()
            .map_err(|_| "Could not verify the selected GitHub account.".to_string())?;
        if !output.status.success() {
            return Err(self.sign_in_error());
        }
        verify_login(&self.username, &String::from_utf8_lossy(&output.stdout))?;
        Ok(token)
    }

    fn sign_in_error(&self) -> String {
        format!(
            "GitHub account {} is not available. Sign in with `gh auth login --hostname github.com`, or the credential command in aven.githubCommand, then retry. See docs/GITHUB-ACCOUNTS.md.",
            self.username
        )
    }
}

fn configure_command(command: &mut Command, root: &Path, repository: &str) {
    command
        .current_dir(root)
        .env("GH_HOST", "github.com")
        .env("GH_REPO", repository)
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1");
    for key in [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
        "GH_DEBUG",
        "DEBUG",
    ] {
        command.env_remove(key);
    }
}

fn verify_login(expected: &str, actual: &str) -> Result<(), String> {
    if actual.trim().eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "GitHub account mismatch: this project requires {expected}. No repository operation was sent."
        ))
    }
}

pub(crate) fn route(root: &Path, remote: &str) -> Result<Route, String> {
    let (host, slug) = remote_parts(remote)?;
    let username = local_setting(root, "aven.githubAccount")?.ok_or(
        "Choose a GitHub account for this project: run `git config --local aven.githubAccount YOUR_GITHUB_USERNAME` in its repository, then retry. See docs/GITHUB-ACCOUNTS.md.",
    )?;
    if !valid_username(&username) {
        return Err(
            "aven.githubAccount must contain one GitHub username, not an email, token, or command."
                .into(),
        );
    }
    let credential_command =
        local_setting(root, "aven.githubCommand")?.unwrap_or_else(|| "gh".into());
    if !valid_command(&credential_command) {
        return Err("aven.githubCommand must be an executable name or absolute executable path, without arguments or shell syntax.".into());
    }
    // An SSH alias is accepted only when this repository explicitly maps that
    // exact alias to GitHub. Never evaluate SSH Match/ProxyCommand directives.
    let alias = local_setting(root, "aven.githubHost")?;
    if host != "github.com" && alias.as_deref() != Some(host.as_str()) {
        return Err("This remote does not identify github.com. For a GitHub SSH alias, set `git config --local aven.githubHost YOUR_SSH_ALIAS` in this repository. GitHub Enterprise is not currently supported.".into());
    }
    Ok(Route {
        username,
        credential_command,
        repository: slug,
    })
}

fn local_setting(root: &Path, key: &str) -> Result<Option<String>, String> {
    let mut command = Command::new("git");
    crate::harness::apply_gui_env(&mut command);
    command
        .current_dir(root)
        .args(["config", "--local", "--no-includes", "--get-all", key]);
    // Repository selection and routing must not be overridden by a parent
    // process's command-scoped Git configuration or another working copy.
    for (name, _) in std::env::vars_os() {
        let key = name.to_string_lossy();
        if key.starts_with("GIT_CONFIG_")
            || matches!(key.as_ref(), "GIT_DIR" | "GIT_COMMON_DIR" | "GIT_WORK_TREE")
        {
            command.env_remove(name);
        }
    }
    let output = command.output().map_err(|_| {
        "Could not read repository-local GitHub settings. Check that Git is installed.".to_string()
    })?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err("Could not read repository-local GitHub settings. Open a Git working copy and configure aven.githubAccount there.".into());
    }
    let output = String::from_utf8(output.stdout)
        .map_err(|_| format!("Invalid repository-local setting: {key}."))?;
    let values: Vec<_> = output.lines().collect();
    if values.len() != 1 || values[0].trim().is_empty() || values[0] != values[0].trim() {
        return Err(format!(
            "Set exactly one non-empty repository-local value for {key}."
        ));
    }
    Ok(Some(values[0].to_string()))
}

fn valid_username(username: &str) -> bool {
    !username.is_empty()
        && username.len() <= 39
        && !username.starts_with('-')
        && !username.ends_with('-')
        && !username.contains("--")
        && username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_command(command: &str) -> bool {
    if command.is_empty() || command.chars().any(char::is_control) {
        return false;
    }
    if Path::new(command).is_absolute() {
        return true;
    }
    !command.starts_with('-')
        && command
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn remote_parts(remote: &str) -> Result<(String, String), String> {
    let remote = remote.trim();
    let (host, slug) = if let Some(rest) = remote.strip_prefix("git@") {
        let (host, slug) = rest
            .split_once(':')
            .ok_or("This project needs a GitHub repository remote.")?;
        (host.to_string(), slug.to_string())
    } else {
        let url = tauri::Url::parse(remote)
            .map_err(|_| "This project needs a GitHub repository remote.")?;
        if !matches!(url.scheme(), "https" | "ssh")
            || url.password().is_some()
            || url.port().is_some()
            || (!url.username().is_empty() && !(url.scheme() == "ssh" && url.username() == "git"))
            || url.query().is_some()
            || url.fragment().is_some()
            // Aliases are specifically SSH configuration, not alternative API hosts.
            || (url.scheme() == "https" && url.host_str() != Some("github.com"))
        {
            return Err(
                "Use a GitHub repository remote without credentials, a port, or query parameters."
                    .into(),
            );
        }
        (
            url.host_str().unwrap_or("").to_string(),
            url.path().to_string(),
        )
    };
    if host.is_empty()
        || host.starts_with('-')
        || !host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err("This project has an invalid GitHub repository host.".into());
    }
    let slug = slug.trim_matches('/').trim_end_matches(".git");
    let parts: Vec<_> = slug.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        })
    {
        return Err("This project has an invalid GitHub repository remote.".into());
    }
    Ok((host, slug.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repository(PathBuf);
    impl Repository {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("aven-account-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            let repo = Self(root);
            repo.git(&["init", "--quiet"]);
            repo
        }
        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .current_dir(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(output.status.success());
        }
        fn select(&self, username: &str) {
            self.git(&["config", "--local", "aven.githubAccount", username]);
        }
    }
    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn routes_standard_remotes_using_only_explicit_repository_settings() {
        let repo = Repository::new();
        assert!(route(&repo.0, "https://github.com/owner/repo.git")
            .unwrap_err()
            .contains("aven.githubAccount"));
        repo.select("octocat");
        for remote in [
            "https://github.com/owner/repo.git",
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo",
        ] {
            let selected = route(&repo.0, remote).unwrap();
            assert_eq!(selected.username, "octocat");
            assert_eq!(selected.credential_command, "gh");
            assert_eq!(selected.repository, "owner/repo");
        }
    }

    #[test]
    fn supports_custom_accounts_wrappers_and_explicit_ssh_aliases() {
        let repo = Repository::new();
        repo.select("another-user");
        repo.git(&["config", "--local", "aven.githubCommand", "gh-team"]);
        assert!(route(&repo.0, "git@github-team:owner/repo.git").is_err());
        repo.git(&["config", "--local", "aven.githubHost", "github-team"]);
        let selected = route(&repo.0, "git@github-team:owner/repo.git").unwrap();
        assert_eq!(selected.username, "another-user");
        assert_eq!(selected.credential_command, "gh-team");
        assert!(route(&repo.0, "git@another-host:owner/repo.git").is_err());
        assert!(route(&repo.0, "https://github-team/owner/repo.git").is_err());
    }

    #[test]
    fn rejects_duplicate_or_injected_local_configuration() {
        let repo = Repository::new();
        repo.select("octocat");
        repo.git(&[
            "config",
            "--local",
            "--add",
            "aven.githubAccount",
            "another-user",
        ]);
        assert!(route(&repo.0, "git@github.com:owner/repo")
            .unwrap_err()
            .contains("exactly one"));
        repo.git(&["config", "--local", "--unset-all", "aven.githubAccount"]);
        let included = repo.0.join("included-config");
        std::fs::write(&included, "[aven]\n githubAccount = unexpected-user\n").unwrap();
        repo.git(&[
            "config",
            "--local",
            "include.path",
            included.to_str().unwrap(),
        ]);
        assert!(route(&repo.0, "git@github.com:owner/repo")
            .unwrap_err()
            .contains("Choose a GitHub account"));
    }

    #[test]
    fn rejects_invalid_accounts_and_command_strings() {
        for username in [
            "",
            "user@example.com",
            "user\nother",
            "-flag",
            "with space",
            "user--name",
        ] {
            assert!(!valid_username(username));
        }
        for command in [
            "",
            "gh --account=user",
            "gh;evil",
            "$(evil)",
            "../gh",
            "-flag",
        ] {
            assert!(!valid_command(command));
        }
        assert!(valid_command("gh-team"));
        assert!(valid_command("/some tools/gh-wrapper"));
    }

    #[test]
    fn rejects_credentials_and_invalid_remote_hosts_or_paths() {
        for remote in [
            "https://user:secret@github.com/owner/repo",
            "git@github.com:owner/../repo",
            "git@github.com:owner/repo --flag",
            "ssh://git@github.com:443/owner/repo",
            "https://github.com/owner/repo?token=x",
            "https://example.com/owner/repo",
            "git@-flag:owner/repo",
        ] {
            assert!(remote_parts(remote).is_err(), "{remote}");
        }
    }

    #[test]
    fn identity_check_accepts_username_casing_but_never_echoes_a_mismatch() {
        assert!(verify_login("octocat", "Octocat\n").is_ok());
        let error = verify_login("octocat", "private-response").unwrap_err();
        assert!(!error.contains("private-response"));
        assert!(error.contains("No repository operation was sent"));
    }

    #[cfg(unix)]
    #[test]
    fn authenticates_the_selected_user_and_verifies_that_exact_token() {
        use std::os::unix::fs::PermissionsExt;
        let repo = Repository::new();
        let script = repo.0.join("fake-gh");
        std::fs::write(
            &script,
            r#"#!/bin/sh
if [ "$1 $2" = "auth token" ]; then
    test "$3 $4 $5 $6" = "--hostname github.com --user octocat" || exit 1
    test -z "${GH_TOKEN}${GITHUB_TOKEN}${GH_DEBUG}" || exit 1
    printf 'fixture-token'
elif [ "$1 $2" = "api user" ]; then
    test "$GH_TOKEN" = "fixture-token" || exit 1
    printf 'octocat'
else
    exit 1
fi
"#,
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let selected = Route {
            username: "octocat".into(),
            credential_command: script.to_string_lossy().into_owned(),
            repository: "owner/repo".into(),
        };
        assert_eq!(
            selected
                .auth_token_using(&repo.0, script.to_str().unwrap())
                .unwrap(),
            "fixture-token"
        );
        let wrong_identity = repo.0.join("wrong-identity");
        std::fs::write(&wrong_identity, "#!/bin/sh\nprintf 'private-response'\n").unwrap();
        std::fs::set_permissions(&wrong_identity, std::fs::Permissions::from_mode(0o700)).unwrap();
        let error = selected
            .auth_token_using(&repo.0, wrong_identity.to_str().unwrap())
            .unwrap_err();
        assert!(error.contains("account mismatch"));
        assert!(!error.contains("private-response"));
        assert!(!error.contains("fixture-token"));
    }

    #[test]
    fn commands_remove_ambient_tokens_and_debugging_before_binding_an_account() {
        let mut command = Command::new("gh");
        configure_command(&mut command, Path::new("/project"), "owner/repo");
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        for key in [
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN",
            "GH_DEBUG",
            "DEBUG",
        ] {
            assert_eq!(env.get(std::ffi::OsStr::new(key)), Some(&None));
        }
        assert_eq!(
            env.get(std::ffi::OsStr::new("GH_HOST")).copied().flatten(),
            Some(std::ffi::OsStr::new("github.com"))
        );
        assert_eq!(
            env.get(std::ffi::OsStr::new("GH_REPO")).copied().flatten(),
            Some(std::ffi::OsStr::new("owner/repo"))
        );
    }
}
