# GitHub accounts

Aven's Inbox and pull-request actions use [GitHub CLI](https://cli.github.com/). Aven does not ship a developer's login or automatically use whichever account was most recently active in a terminal.

## Set up a project

Install GitHub CLI, then sign in with your own account:

```sh
gh auth login --hostname github.com
```

In each repository you want Aven to access, select your GitHub username:

```sh
git config --local aven.githubAccount YOUR_GITHUB_USERNAME
```

Replace `YOUR_GITHUB_USERNAME` with your GitHub login, not your email address. This setting is stored in the repository's local `.git/config`; it is not committed or shared with other users. Aven reports an actionable error when it is missing instead of guessing an account. Ordinary `https://github.com/owner/repository.git` and `git@github.com:owner/repository.git` remotes work.

Aven asks GitHub CLI for the selected user's credential, verifies the username with GitHub, and binds each operation to that credential. It never changes the CLI's global active account. Tokens stay in process memory and are passed directly to the GitHub CLI child process; Aven does not print them, save them to Git configuration, or forward ambient `GH_TOKEN`/`GITHUB_TOKEN` variables. Read and write operations use the same identity checks.

## Separate credential stores or SSH aliases

If you already use an executable GitHub CLI wrapper with its own credential store, select it for this project:

```sh
git config --local aven.githubCommand gh-team
```

The value must be an executable name on your PATH or an absolute executable path. Shell functions, arguments, and command strings are not supported. The wrapper must support `auth token --hostname github.com --user USERNAME`. It is used only to read the selected account's token; stock `gh` runs verification and repository operations with that token. `gh` must therefore also be installed.

For a remote such as `git@github-team:owner/repository.git`, explicitly identify that SSH alias as GitHub:

```sh
git config --local aven.githubHost github-team
```

Only set this for an SSH alias that you know points to `github.com`. Aven does not execute SSH configuration to discover hosts. This setting does not modify Git's SSH authentication or authorize a push; it maps the repository name for Aven's GitHub API operations. GitHub Enterprise hosts are not currently supported.

## Change or remove an account

Run the same `git config --local aven.githubAccount NEW_USERNAME` command to change a project's account. Sign the new user into GitHub CLI first. To remove Aven's routing settings:

```sh
git config --local --unset-all aven.githubAccount
git config --local --unset-all aven.githubCommand
git config --local --unset-all aven.githubHost
```

Git reports a nonzero status when a setting was already absent. Removing the settings does not sign out of GitHub CLI, delete credentials, or affect other repositories.
