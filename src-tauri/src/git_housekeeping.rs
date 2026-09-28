//! Keep a repository tidy from the Changes panel: merged branch clean-up,
//! squash-merging the current pull request, and the project's release status.
//! GitHub calls go through the project's routed account; nothing here changes a
//! shared CLI login.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

use crate::fs::{expand_home, git_checked, github_route};

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergedBranches {
    /// Branch everything is compared with, e.g. `main`.
    pub base: String,
    pub remote: Option<String>,
    /// Local branches whose work is already in the base branch.
    pub local: Vec<String>,
    /// Branches on the remote whose work is already in the base branch.
    pub remote_branches: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchCleanup {
    pub deleted_local: Vec<String>,
    pub deleted_remote: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag: String,
    pub name: String,
    pub url: String,
    pub published_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRun {
    pub status: String,
    pub conclusion: String,
    pub url: String,
    pub created_at: String,
    pub head_sha: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    pub base: String,
    pub latest: Option<ReleaseInfo>,
    /// Commits on the remote base branch since the latest release.
    pub unreleased: Option<u32>,
    /// Version declared at the remote default branch revision.
    pub version: Option<String>,
    /// Exact remote revision the version and workflow were read from.
    pub source_sha: Option<String>,
    /// True when that version has no release tag yet.
    pub version_unreleased: bool,
    /// Workflow file that can publish, e.g. `release.yml`.
    pub workflow: Option<String>,
    pub workflow_has_publish: bool,
    pub run: Option<ReleaseRun>,
}

#[tauri::command]
pub async fn git_merged_branches(cwd: String) -> Result<MergedBranches, String> {
    tauri::async_runtime::spawn_blocking(move || merged_branches_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_delete_merged_branches(
    cwd: String,
    local: Vec<String>,
    remote: Vec<String>,
) -> Result<BranchCleanup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_merged_branches_for(&expand_home(&cwd), &local, &remote)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_pr_squash_merge(cwd: String, number: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || squash_merge_for(&expand_home(&cwd), number))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_release_status(cwd: String) -> Result<ReleaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || release_status_for(&expand_home(&cwd)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_release_start(
    cwd: String,
    version: String,
    source_sha: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        release_start_for(&expand_home(&cwd), &version, &source_sha)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn git() -> Command {
    let mut command = Command::new("git");
    crate::hide_window_console(&mut command);
    command
}

fn git_text(root: &Path, args: &[&str]) -> Option<String> {
    let output = git()
        .arg("--no-pager")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn lines(text: Option<String>) -> Vec<String> {
    text.unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn remote_name(root: &Path) -> Option<String> {
    let remotes = lines(git_text(root, &["remote"]));
    if remotes.iter().any(|remote| remote == "origin") {
        return Some("origin".into());
    }
    remotes.into_iter().next()
}

/// The remote's default branch, falling back to a local `main` or `master`.
fn base_branch(root: &Path, remote: Option<&str>) -> Option<String> {
    if let Some(remote) = remote {
        if let Some(head) = git_text(
            root,
            &[
                "symbolic-ref",
                "--short",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        ) {
            if let Some(name) = head.strip_prefix(&format!("{remote}/")) {
                return Some(name.to_string());
            }
        }
    }
    ["main", "master"]
        .into_iter()
        .find(|name| {
            git_text(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{name}"),
                ],
            )
            .is_some()
        })
        .map(str::to_string)
}

/// Branches checked out anywhere cannot be deleted and belong to live work.
fn checked_out_branches(root: &Path) -> Result<HashSet<String>, String> {
    let text = git_text(root, &["worktree", "list", "--porcelain"])
        .ok_or("Could not verify which branches are checked out.")?;
    Ok(lines(Some(text))
        .into_iter()
        .filter_map(|line| line.strip_prefix("branch refs/heads/").map(str::to_string))
        .collect())
}

/// A squash merge leaves no shared commit. Prove that merging the branch
/// adds no content to the base, including whitespace (which git cherry ignores).
/// Conflicts, unsupported Git versions, and later divergent edits fail closed.
fn squash_merged(root: &Path, base_ref: &str, branch: &str) -> bool {
    let Some(merge_base) = git_text(root, &["merge-base", base_ref, branch]) else {
        return false;
    };
    let Some(tree) = git_text(root, &["rev-parse", &format!("{branch}^{{tree}}")]) else {
        return false;
    };
    let Some(merge_tree) = git_text(root, &["rev-parse", &format!("{merge_base}^{{tree}}")]) else {
        return false;
    };
    if tree == merge_tree {
        return false;
    }
    let Some(base_tree) = git_text(root, &["rev-parse", &format!("{base_ref}^{{tree}}")]) else {
        return false;
    };
    git_text(root, &["merge-tree", "--write-tree", base_ref, branch])
        .is_some_and(|output| output.lines().next() == Some(base_tree.as_str()))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BranchCandidate {
    name: String,
    oid: String,
}

struct BranchSnapshot {
    base: String,
    remote: Option<String>,
    local: Vec<BranchCandidate>,
    remote_branches: Vec<BranchCandidate>,
}

fn valid_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn branch_refs(root: &Path, prefix: &str) -> Result<Vec<BranchCandidate>, String> {
    let text = git_text(
        root,
        &[
            "for-each-ref",
            "--format=%(objectname) %(refname) %(symref)",
            prefix,
        ],
    )
    .ok_or("Could not read branch revisions.")?;
    let mut branches = Vec::new();
    for line in text.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        // Symbolic remote HEAD is not a deletable branch.
        if fields.len() != 2 {
            continue;
        }
        let Some(name) = fields[1].strip_prefix(prefix) else {
            continue;
        };
        if !valid_oid(fields[0]) || name.is_empty() {
            return Err("Could not verify a branch revision.".into());
        }
        branches.push(BranchCandidate {
            name: name.into(),
            oid: fields[0].into(),
        });
    }
    Ok(branches)
}

fn merged_branch_snapshot(root: &Path) -> Result<BranchSnapshot, String> {
    let remote = remote_name(root);
    let base = base_branch(root, remote.as_deref()).ok_or("This project has no main branch.")?;
    let base_oid = remote
        .as_ref()
        .and_then(|remote| {
            git_text(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    &format!("refs/remotes/{remote}/{base}^{{commit}}"),
                ],
            )
        })
        .or_else(|| {
            git_text(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    &format!("refs/heads/{base}^{{commit}}"),
                ],
            )
        })
        .filter(|oid| valid_oid(oid))
        .ok_or("Could not verify the main branch revision.")?;
    let busy = checked_out_branches(root)?;
    let is_ancestor =
        |oid: &str| git_text(root, &["merge-base", "--is-ancestor", oid, &base_oid]).is_some();
    let local = branch_refs(root, "refs/heads/")?
        .into_iter()
        .filter(|branch| {
            branch.name != base
                && !busy.contains(&branch.name)
                && (is_ancestor(&branch.oid) || squash_merged(root, &base_oid, &branch.oid))
        })
        .collect();
    let remote_branches = match &remote {
        Some(remote) => branch_refs(root, &format!("refs/remotes/{remote}/"))?
            .into_iter()
            .filter(|branch| {
                branch.name != base
                    && branch.name != "HEAD"
                    && !busy.contains(&branch.name)
                    && is_ancestor(&branch.oid)
            })
            .collect(),
        None => Vec::new(),
    };
    Ok(BranchSnapshot {
        base,
        remote,
        local,
        remote_branches,
    })
}

fn merged_branches_for(root: &Path) -> Result<MergedBranches, String> {
    let snapshot = merged_branch_snapshot(root)?;
    Ok(MergedBranches {
        base: snapshot.base,
        remote: snapshot.remote,
        local: snapshot
            .local
            .into_iter()
            .map(|branch| branch.name)
            .collect(),
        remote_branches: snapshot
            .remote_branches
            .into_iter()
            .map(|branch| branch.name)
            .collect(),
    })
}

fn delete_local_branch(root: &Path, branch: &BranchCandidate) -> Result<(), String> {
    // update-ref supplies the atomic old-OID comparison that branch -D lacks.
    // Retain branch's worktree guard and only remove its metadata after success.
    if checked_out_branches(root)?.contains(&branch.name) {
        return Err("This branch is checked out in a working copy.".into());
    }
    let reference = format!("refs/heads/{}", branch.name);
    git_checked(
        root,
        &["update-ref", "--no-deref", "-d", &reference, &branch.oid],
    )?;
    // update-ref removes the reflog. Do not disturb configuration if another
    // writer has already recreated the branch after the conditional deletion.
    if git_text(root, &["rev-parse", "--verify", "--quiet", &reference]).is_none() {
        let _ = git_checked(
            root,
            &[
                "config",
                "--local",
                "--remove-section",
                &format!("branch.{}", branch.name),
            ],
        );
    }
    Ok(())
}

fn remote_delete_args(target: &str, branches: &[BranchCandidate]) -> Vec<String> {
    let mut args = vec!["push".into(), "--atomic".into()];
    for branch in branches {
        args.push(format!(
            "--force-with-lease=refs/heads/{}:{}",
            branch.name, branch.oid
        ));
    }
    args.push("--".into());
    args.push(target.into());
    args.extend(
        branches
            .iter()
            .map(|branch| format!(":refs/heads/{}", branch.name)),
    );
    args
}

fn delete_remote_branches(
    root: &Path,
    remote: &str,
    branches: &[BranchCandidate],
) -> Result<(), String> {
    // Resolve the selected remote again immediately before the write. Use its
    // verified account token for Git too, rather than ambient SSH credentials.
    let url = git_text(root, &["remote", "get-url", remote])
        .ok_or("Could not read the selected remote.")?;
    let route = crate::github_account::route(root, &url)?;
    let credentials = route.command(root)?; // verifies identity with this exact token
    let gh_path = credentials
        .get_program()
        .to_string_lossy()
        .replace('\'', "'\"'\"'");
    let token = credentials
        .get_envs()
        .find_map(|(key, value)| (key == "GH_TOKEN").then_some(value).flatten())
        .ok_or("Could not verify this project's GitHub account.")?;
    let target = format!("https://github.com/{}.git", route.repository);
    if git_text(root, &["ls-remote", "--get-url", &target]).as_deref() != Some(target.as_str()) {
        return Err("Git URL rewriting would change the verified GitHub destination.".into());
    }
    let args = remote_delete_args(&target, branches);
    let mut command = git();
    command
        .arg("-C")
        .arg(root)
        .args([
            "-c",
            "credential.helper=",
            "-c",
            &format!("credential.helper=!'{}' auth git-credential", gh_path),
            "-c",
            "http.extraHeader=",
        ])
        .args(args)
        .env("GH_TOKEN", token)
        .env("GH_HOST", "github.com")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never");
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("GIT_TRACE")
            || name.starts_with("GIT_CONFIG_")
            || matches!(
                name.as_ref(),
                "GIT_CURL_VERBOSE"
                    | "GH_DEBUG"
                    | "DEBUG"
                    | "GIT_DIR"
                    | "GIT_COMMON_DIR"
                    | "GIT_WORK_TREE"
            )
        {
            command.env_remove(key);
        }
    }
    let output = command
        .output()
        .map_err(|_| "Could not delete the selected remote branches.")?;
    // Never return credential-helper diagnostics to the UI.
    if output.status.success() {
        Ok(())
    } else {
        Err("Remote branches changed or GitHub refused deletion. Refresh before retrying.".into())
    }
}

fn delete_from_snapshot(
    root: &Path,
    current: BranchSnapshot,
    local: &[String],
    remote: &[String],
    mut push: impl FnMut(&str, &[BranchCandidate]) -> Result<(), String>,
) -> Result<BranchCleanup, String> {
    let mut result = BranchCleanup::default();
    for name in local {
        let Some(branch) = current.local.iter().find(|branch| &branch.name == name) else {
            result.failed.push(name.clone());
            continue;
        };
        match delete_local_branch(root, branch) {
            Ok(()) => result.deleted_local.push(name.clone()),
            Err(_) => result.failed.push(name.clone()),
        }
    }
    let busy = checked_out_branches(root)?;
    let mut requested = Vec::new();
    for name in remote {
        match current
            .remote_branches
            .iter()
            .find(|branch| &branch.name == name && !busy.contains(name))
        {
            Some(branch) => requested.push(branch.clone()),
            None => result.failed.push(format!(
                "{}/{name}",
                current.remote.as_deref().unwrap_or("remote")
            )),
        }
    }
    if let Some(name) = current.remote.as_deref().filter(|_| !requested.is_empty()) {
        match push(name, &requested) {
            Ok(()) => {
                for branch in requested {
                    // Retire only the exact cached revision we deleted. A fetch
                    // that observed a recreated/advanced branch must win.
                    let reference = format!("refs/remotes/{name}/{}", branch.name);
                    let _ = git_checked(
                        root,
                        &["update-ref", "--no-deref", "-d", &reference, &branch.oid],
                    );
                    result.deleted_remote.push(branch.name);
                }
            }
            Err(_) => result.failed.extend(
                requested
                    .into_iter()
                    .map(|branch| format!("{name}/{}", branch.name)),
            ),
        }
    }
    Ok(result)
}

fn delete_merged_branches_for(
    root: &Path,
    local: &[String],
    remote: &[String],
) -> Result<BranchCleanup, String> {
    delete_from_snapshot(
        root,
        merged_branch_snapshot(root)?,
        local,
        remote,
        |name, branches| delete_remote_branches(root, name, branches),
    )
}

fn gh(root: &Path, args: &[&str], write: bool) -> Result<String, String> {
    let route = github_route(root)?;
    if write {
        route.verify_identity(root)?;
    }
    let output = route
        .command(root)?
        .args(args)
        .output()
        .map_err(|_| "The routed GitHub account command is not installed.".to_string())?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        "GitHub did not accept the request.".into()
    } else {
        stderr
    })
}

fn squash_merge_for(root: &Path, number: i64) -> Result<(), String> {
    if number <= 0 {
        return Err("Choose an open pull request.".into());
    }
    // Leave the local checkout alone: another worktree may own the base branch.
    // The repository deletes the remote branch; the local one then shows up in
    // merged branch clean-up.
    gh(
        root,
        &["pr", "merge", &number.to_string(), "--squash"],
        true,
    )
    .map(|_| ())
}

/// Only offer publication for workflows that accept both approval guards.
/// Unknown/generic workflows remain read-only rather than dropping the guard.
fn workflow_has_publish_input(text: &str) -> bool {
    let mut dispatch_indent = None;
    let mut inputs_indent = None;
    let mut input_indent = None;
    let mut names = HashSet::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if let Some(dispatch) = dispatch_indent {
            if indent <= dispatch {
                break;
            }
            if let Some(inputs) = inputs_indent {
                if indent <= inputs {
                    break;
                }
                let level = *input_indent.get_or_insert(indent);
                if indent == level {
                    if let Some(name) = trimmed.strip_suffix(':') {
                        names.insert(name);
                    }
                }
            } else if trimmed == "inputs:" {
                inputs_indent = Some(indent);
            }
        } else if trimmed == "workflow_dispatch:" {
            dispatch_indent = Some(indent);
        }
    }
    ["publish", "expected_version", "expected_source_sha"]
        .into_iter()
        .all(|name| names.contains(name))
}

fn package_version(text: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Package {
        version: Option<String>,
    }
    serde_json::from_str::<Package>(text)
        .ok()?
        .version
        .filter(|version| valid_version(version))
}

fn api_component(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn tag_is_absent(json: &str, version: &str) -> Result<bool, String> {
    #[derive(Deserialize)]
    struct Reference {
        #[serde(rename = "ref")]
        name: String,
    }
    let refs: Vec<Reference> = serde_json::from_str(json)
        .map_err(|_| "Could not verify whether the release tag exists.")?;
    let expected = format!("refs/tags/v{version}");
    Ok(!refs.iter().any(|reference| reference.name == expected))
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 40
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

fn parse_latest_release(json: &str) -> Option<ReleaseInfo> {
    #[derive(Deserialize)]
    struct Release {
        #[serde(rename = "tagName")]
        tag_name: String,
        name: Option<String>,
        url: String,
        #[serde(rename = "publishedAt")]
        published_at: Option<String>,
    }
    let release: Release = serde_json::from_str(json).ok()?;
    Some(ReleaseInfo {
        name: release
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| release.tag_name.clone()),
        tag: release.tag_name,
        url: release.url,
        published_at: release.published_at.unwrap_or_default(),
    })
}

fn parse_latest_run(json: &str) -> Option<ReleaseRun> {
    #[derive(Deserialize)]
    struct Run {
        status: String,
        conclusion: Option<String>,
        url: String,
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "headSha")]
        head_sha: String,
    }
    let runs: Vec<Run> = serde_json::from_str(json).ok()?;
    runs.into_iter().next().map(|run| ReleaseRun {
        status: run.status,
        conclusion: run.conclusion.unwrap_or_default(),
        url: run.url,
        created_at: run.created_at,
        head_sha: run.head_sha,
    })
}

fn release_status_using(
    mut call: impl FnMut(&[&str], bool) -> Result<String, String>,
) -> Result<ReleaseStatus, String> {
    let base = call(
        &["api", "repos/{owner}/{repo}", "--jq", ".default_branch"],
        false,
    )?;
    if base.is_empty() || base == "null" {
        return Err("Could not verify the remote default branch.".into());
    }
    let source_sha = call(
        &[
            "api",
            &format!(
                "repos/{{owner}}/{{repo}}/git/ref/heads/{}",
                api_component(&base)
            ),
            "--jq",
            ".object.sha",
        ],
        false,
    )?;
    if source_sha.len() != 40 || !valid_oid(&source_sha) {
        return Err("Could not verify the remote release revision.".into());
    }
    let contents =
        |path: &str| format!("repos/{{owner}}/{{repo}}/contents/{path}?ref={source_sha}");
    let version = package_version(&call(
        &[
            "api",
            &contents("package.json"),
            "--header",
            "Accept: application/vnd.github.raw+json",
        ],
        false,
    )?);
    let workflow_names = call(
        &["api", &contents(".github/workflows"), "--jq", ".[].name"],
        false,
    )?;
    let workflow = ["release.yml", "release.yaml"]
        .into_iter()
        .find(|name| workflow_names.lines().any(|candidate| candidate == *name));
    let workflow_has_publish = if let Some(name) = workflow {
        let text = call(
            &[
                "api",
                &contents(&format!(".github/workflows/{name}")),
                "--header",
                "Accept: application/vnd.github.raw+json",
            ],
            false,
        )?;
        workflow_has_publish_input(&text)
    } else {
        false
    };
    let latest = call(
        &["release", "view", "--json", "tagName,name,url,publishedAt"],
        false,
    )
    .ok()
    .and_then(|json| parse_latest_release(&json));
    let unreleased = latest.as_ref().and_then(|release| {
        call(
            &[
                "api",
                &format!(
                    "repos/{{owner}}/{{repo}}/compare/{}...{source_sha}",
                    api_component(&release.tag)
                ),
                "--jq",
                ".ahead_by",
            ],
            false,
        )
        .ok()
        .and_then(|count| count.trim().parse().ok())
    });
    // A successful matching-refs response distinguishes a missing exact tag
    // from authentication/network errors. Never turn arbitrary errors into ready.
    let version_unreleased = if let Some(version) = &version {
        let refs = call(
            &[
                "api",
                &format!(
                    "repos/{{owner}}/{{repo}}/git/matching-refs/tags/v{}",
                    api_component(version)
                ),
            ],
            false,
        )?;
        tag_is_absent(&refs, version)?
    } else {
        false
    };
    let run = if let Some(workflow) = workflow {
        let json = call(
            &[
                "run",
                "list",
                "--workflow",
                workflow,
                "--branch",
                &base,
                "--limit",
                "1",
                "--json",
                "status,conclusion,url,createdAt,headSha",
            ],
            false,
        )?;
        let value: serde_json::Value =
            serde_json::from_str(&json).map_err(|_| "Could not verify release workflow status.")?;
        if !value.is_array() {
            return Err("Could not verify release workflow status.".into());
        }
        let parsed = parse_latest_run(&json);
        if value.as_array().is_some_and(|runs| !runs.is_empty()) && parsed.is_none() {
            return Err("Could not verify release workflow status.".into());
        }
        parsed
    } else {
        None
    };
    Ok(ReleaseStatus {
        base,
        latest,
        unreleased,
        version,
        source_sha: Some(source_sha),
        version_unreleased,
        workflow_has_publish,
        workflow: workflow.map(str::to_owned),
        run,
    })
}

fn release_status_for(root: &Path) -> Result<ReleaseStatus, String> {
    release_status_using(|args, write| gh(root, args, write))
}

fn release_start_using(
    version: &str,
    source_sha: &str,
    mut call: impl FnMut(&[&str], bool) -> Result<String, String>,
) -> Result<(), String> {
    if source_sha.len() != 40 || !valid_oid(source_sha) || !valid_version(version) {
        return Err("Refresh the release before publishing.".into());
    }
    let status = release_status_using(&mut call)?;
    if status.version.as_deref() != Some(version)
        || status.source_sha.as_deref() != Some(source_sha)
        || !status.version_unreleased
    {
        return Err(format!(
            "Version {version} or its source revision changed. Refresh before publishing."
        ));
    }
    if !status.workflow_has_publish {
        return Err(
            "This remote release workflow does not accept version and source revision guards."
                .into(),
        );
    }
    if status
        .run
        .as_ref()
        .is_some_and(|run| run.status != "completed")
    {
        return Err("A release is already running.".into());
    }
    let workflow = status
        .workflow
        .ok_or("This project has no release workflow to run.")?;
    // GitHub dispatch only accepts a branch/tag ref. The workflow must compare
    // its checkout with these inputs before doing any build or publication.
    call(
        &[
            "workflow",
            "run",
            &workflow,
            "--ref",
            &status.base,
            "-f",
            "publish=true",
            "-f",
            &format!("expected_version={version}"),
            "-f",
            &format!("expected_source_sha={source_sha}"),
        ],
        true,
    )
    .map(|_| ())
}

fn release_start_for(root: &Path, version: &str, source_sha: &str) -> Result<(), String> {
    release_start_using(version, source_sha, |args, write| gh(root, args, write))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    /// Removed on drop so failed assertions do not leave repositories behind.
    struct Temp(PathBuf);
    impl Temp {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("aven-housekeeping-{name}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }

    fn repo(name: &str) -> Temp {
        let dir = Temp::new(name);
        let root = dir.path();
        run(root, &["init", "-q", "-b", "main"]);
        run(root, &["config", "user.name", "Test"]);
        run(root, &["config", "user.email", "test@example.com"]);
        write(root, "a.txt", "one\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "start"]);
        dir
    }

    #[test]
    fn finds_ordinary_and_squash_merged_branches_but_not_live_work() {
        let dir = repo("branches");
        let root = dir.path();
        // Merged normally.
        run(root, &["branch", "merged"]);
        // Squash merged: same change lands on main as a different commit.
        run(root, &["checkout", "-qb", "squashed"]);
        write(root, "b.txt", "feature\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "feature part 1"]);
        write(root, "b.txt", "feature done\n");
        run(root, &["commit", "-qam", "feature part 2"]);
        run(root, &["checkout", "-q", "main"]);
        run(root, &["merge", "-q", "--squash", "squashed"]);
        run(root, &["commit", "-qm", "Feature (#1)"]);
        // Unmerged work stays.
        run(root, &["checkout", "-qb", "wip"]);
        write(root, "c.txt", "not yet\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "wip"]);
        run(root, &["checkout", "-q", "main"]);
        // Checked out in another worktree stays even though merged.
        let other = Temp::new("busy");
        let other_path = other.path().join("busy");
        run(
            root,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "busy",
                other_path.to_str().unwrap(),
            ],
        );

        let merged = merged_branches_for(root).unwrap();
        assert_eq!(merged.base, "main");
        assert_eq!(
            merged.local,
            vec!["merged".to_string(), "squashed".to_string()]
        );

        let cleanup =
            delete_merged_branches_for(root, &["squashed".into(), "wip".into()], &[]).unwrap();
        assert_eq!(cleanup.deleted_local, vec!["squashed".to_string()]);
        assert_eq!(cleanup.failed, vec!["wip".to_string()]);
        assert!(git_text(
            root,
            &["rev-parse", "--verify", "--quiet", "refs/heads/wip"]
        )
        .is_some());
    }

    #[test]
    fn squash_cleanup_preserves_behavior_changing_indentation() {
        let dir = repo("indentation");
        let root = dir.path();
        write(
            root,
            "example.py",
            "def f():\n    if ready:\n        pass\n",
        );
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "base code"]);
        run(root, &["checkout", "-qb", "feature"]);
        write(
            root,
            "example.py",
            "def f():\n    if ready:\n        pass\n    return 1\n",
        );
        run(root, &["commit", "-qam", "return outside conditional"]);
        run(root, &["checkout", "-q", "main"]);
        write(
            root,
            "example.py",
            "def f():\n    if ready:\n        pass\n        return 1\n",
        );
        run(root, &["commit", "-qam", "return inside conditional"]);
        // The old patch-ID proof drops indentation and incorrectly calls these
        // changes equivalent. Exact tree equality must preserve this branch.
        assert!(git_text(root, &["cherry", "main", "feature"])
            .unwrap()
            .starts_with('-'));
        assert!(!squash_merged(root, "main", "feature"));
        let result = delete_merged_branches_for(root, &["feature".into()], &[]).unwrap();
        assert_eq!(result.failed, vec!["feature"]);
        assert!(git_text(root, &["rev-parse", "refs/heads/feature"]).is_some());
    }

    #[test]
    fn parses_release_and_run_json() {
        let release = parse_latest_release(
            r#"{"tagName":"v0.1.107","name":"Aven 0.1.107","url":"https://example.com/r","publishedAt":"2026-09-28T19:00:31Z"}"#,
        )
        .unwrap();
        assert_eq!(release.tag, "v0.1.107");
        assert_eq!(release.name, "Aven 0.1.107");
        assert!(parse_latest_release("not json").is_none());

        let run = parse_latest_run(
            r#"[{"status":"in_progress","conclusion":"","url":"https://example.com/run","createdAt":"2026-09-28T19:00:00Z","headSha":"abc"}]"#,
        )
        .unwrap();
        assert_eq!(run.status, "in_progress");
        assert!(parse_latest_run("[]").is_none());
    }

    const SOURCE_SHA: &str = "1111111111111111111111111111111111111111";
    const GUARDED_WORKFLOW: &str = "on:\n  workflow_dispatch:\n    inputs:\n      publish:\n        type: boolean\n      expected_version:\n        type: string\n      expected_source_sha:\n        type: string\n";

    struct MockGh {
        sha: String,
        version: String,
        workflow: String,
        tags: Result<String, String>,
        writes: Vec<Vec<String>>,
        content_paths: Vec<String>,
    }

    impl MockGh {
        fn new() -> Self {
            Self {
                sha: SOURCE_SHA.into(),
                version: "0.1.108".into(),
                workflow: GUARDED_WORKFLOW.into(),
                tags: Ok("[]".into()),
                writes: Vec::new(),
                content_paths: Vec::new(),
            }
        }
        fn call(&mut self, args: &[&str], write: bool) -> Result<String, String> {
            if write {
                self.writes
                    .push(args.iter().map(|arg| arg.to_string()).collect());
                return Ok(String::new());
            }
            match args[0] {
                "release" => return Err("No release".into()),
                "run" => return Ok("[]".into()),
                "api" => {}
                _ => panic!("Unexpected command: {args:?}"),
            }
            let path = args[1];
            if path == "repos/{owner}/{repo}" {
                return Ok("main".into());
            }
            if path.contains("/git/ref/heads/") {
                return Ok(self.sha.clone());
            }
            if path.contains("/git/matching-refs/") {
                return self.tags.clone();
            }
            if path.contains("/contents/") {
                self.content_paths.push(path.into());
                if path.contains("package.json?") {
                    return Ok(format!(r#"{{"version":"{}"}}"#, self.version));
                }
                if path.contains("workflows?") {
                    return Ok("release.yml".into());
                }
                if path.contains("release.yml?") {
                    return Ok(self.workflow.clone());
                }
            }
            panic!("Unexpected API path: {path}")
        }
    }

    #[test]
    fn advanced_local_branch_and_metadata_survive_conditional_deletion() {
        let dir = repo("advanced-local");
        let root = dir.path();
        run(root, &["branch", "feature"]);
        run(
            root,
            &["config", "branch.feature.description", "keep this metadata"],
        );
        let snapshot = merged_branch_snapshot(root).unwrap();
        run(root, &["checkout", "-q", "feature"]);
        write(root, "new.txt", "unmerged work\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "new work"]);
        let advanced = git_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(root, &["checkout", "-q", "main"]);
        let result = delete_from_snapshot(root, snapshot, &["feature".into()], &[], |_, _| {
            panic!("no remote write")
        })
        .unwrap();
        assert_eq!(result.failed, vec!["feature"]);
        assert_eq!(
            git_text(root, &["rev-parse", "refs/heads/feature"]).as_deref(),
            Some(advanced.as_str())
        );
        assert_eq!(
            git_text(root, &["config", "branch.feature.description"]).as_deref(),
            Some("keep this metadata")
        );
    }

    #[test]
    fn successful_local_deletion_removes_branch_metadata() {
        let dir = repo("metadata");
        let root = dir.path();
        run(root, &["branch", "feature"]);
        run(
            root,
            &["config", "branch.feature.description", "old branch"],
        );
        let result = delete_merged_branches_for(root, &["feature".into()], &[]).unwrap();
        assert_eq!(result.deleted_local, vec!["feature"]);
        assert!(git_text(root, &["config", "branch.feature.description"]).is_none());
    }

    #[test]
    fn branch_checked_out_after_snapshot_is_preserved() {
        let dir = repo("new-worktree");
        let root = dir.path();
        run(root, &["branch", "feature"]);
        let snapshot = merged_branch_snapshot(root).unwrap();
        let other = Temp::new("new-owner");
        run(
            root,
            &[
                "worktree",
                "add",
                "-q",
                other.path().join("copy").to_str().unwrap(),
                "feature",
            ],
        );
        let result = delete_from_snapshot(root, snapshot, &["feature".into()], &[], |_, _| {
            panic!("no remote write")
        })
        .unwrap();
        assert_eq!(result.failed, vec!["feature"]);
        assert!(git_text(root, &["rev-parse", "refs/heads/feature"]).is_some());
        assert!(checked_out_branches(Temp::new("not-a-repo").path()).is_err());
    }

    #[test]
    fn remote_lease_preserves_commits_added_after_last_fetch() {
        let remote = repo("remote-advanced");
        run(remote.path(), &["branch", "feature"]);
        let local = Temp::new("local-clone");
        run(
            local.path(),
            &["clone", "-q", remote.path().to_str().unwrap(), "copy"],
        );
        let root = local.path().join("copy");
        let snapshot = merged_branch_snapshot(&root).unwrap();
        assert!(snapshot
            .remote_branches
            .iter()
            .any(|branch| branch.name == "feature"));
        run(remote.path(), &["checkout", "-q", "feature"]);
        write(remote.path(), "new.txt", "remote-only work\n");
        run(remote.path(), &["add", "."]);
        run(remote.path(), &["commit", "-qm", "new remote work"]);
        let advanced = git_text(remote.path(), &["rev-parse", "HEAD"]).unwrap();
        run(remote.path(), &["checkout", "-q", "main"]);
        let result =
            delete_from_snapshot(&root, snapshot, &[], &["feature".into()], |_, branches| {
                let args = remote_delete_args(remote.path().to_str().unwrap(), branches);
                git_checked(&root, &args.iter().map(String::as_str).collect::<Vec<_>>())
            })
            .unwrap();
        assert_eq!(result.failed, vec!["origin/feature"]);
        assert_eq!(
            git_text(remote.path(), &["rev-parse", "refs/heads/feature"]).as_deref(),
            Some(advanced.as_str())
        );
    }

    #[test]
    fn remote_lease_deletes_only_unchanged_merged_branch() {
        let remote = repo("remote-unchanged");
        run(remote.path(), &["branch", "feature"]);
        let local = Temp::new("local-unchanged");
        run(
            local.path(),
            &["clone", "-q", remote.path().to_str().unwrap(), "copy"],
        );
        let root = local.path().join("copy");
        let result = delete_from_snapshot(
            &root,
            merged_branch_snapshot(&root).unwrap(),
            &[],
            &["feature".into()],
            |_, branches| {
                let args = remote_delete_args(remote.path().to_str().unwrap(), branches);
                git_checked(&root, &args.iter().map(String::as_str).collect::<Vec<_>>())
            },
        )
        .unwrap();
        assert_eq!(result.deleted_remote, vec!["feature"]);
        assert!(git_text(
            remote.path(),
            &["rev-parse", "--verify", "refs/heads/feature"]
        )
        .is_none());
        assert!(git_text(
            &root,
            &["rev-parse", "--verify", "refs/remotes/origin/feature"]
        )
        .is_none());
    }

    #[test]
    fn successful_remote_cleanup_preserves_a_concurrently_refreshed_tracking_ref() {
        let dir = repo("tracking-refresh");
        let root = dir.path();
        let original = git_text(root, &["rev-parse", "HEAD"]).unwrap();
        run(
            root,
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/repo.git",
            ],
        );
        run(root, &["update-ref", "refs/remotes/origin/main", &original]);
        run(
            root,
            &["update-ref", "refs/remotes/origin/feature", &original],
        );
        let snapshot = merged_branch_snapshot(root).unwrap();
        write(root, "new.txt", "recreated branch\n");
        run(root, &["add", "."]);
        run(root, &["commit", "-qm", "new revision"]);
        let recreated = git_text(root, &["rev-parse", "HEAD"]).unwrap();
        let result = delete_from_snapshot(root, snapshot, &[], &["feature".into()], |_, _| {
            // Model a fetch observing branch recreation after the server has
            // accepted deletion, before local tracking-ref retirement.
            git_checked(
                root,
                &["update-ref", "refs/remotes/origin/feature", &recreated],
            )
        })
        .unwrap();
        assert_eq!(result.deleted_remote, vec!["feature"]);
        assert_eq!(
            git_text(root, &["rev-parse", "refs/remotes/origin/feature"]).as_deref(),
            Some(recreated.as_str())
        );
    }

    #[test]
    fn release_reads_version_and_workflow_at_same_remote_revision() {
        let mut mock = MockGh::new();
        let status = release_status_using(|args, write| mock.call(args, write)).unwrap();
        assert_eq!(status.version.as_deref(), Some("0.1.108"));
        assert_eq!(status.source_sha.as_deref(), Some(SOURCE_SHA));
        assert!(mock
            .content_paths
            .iter()
            .all(|path| path.ends_with(&format!("?ref={SOURCE_SHA}"))));
        release_start_using("0.1.108", SOURCE_SHA, |args, write| mock.call(args, write)).unwrap();
        assert_eq!(
            mock.writes,
            vec![vec![
                "workflow",
                "run",
                "release.yml",
                "--ref",
                "main",
                "-f",
                "publish=true",
                "-f",
                "expected_version=0.1.108",
                "-f",
                &format!("expected_source_sha={SOURCE_SHA}")
            ]]
        );
    }

    #[test]
    fn release_refuses_changed_source_version_and_unguarded_workflows() {
        for condition in ["source", "version", "workflow"] {
            let mut mock = MockGh::new();
            match condition {
                "source" => mock.sha = "2222222222222222222222222222222222222222".into(),
                "version" => mock.version = "0.1.109".into(),
                _ => mock.workflow = "on:\n  workflow_dispatch:\n    inputs:\n      publish:\n        type: boolean\n".into(),
            }
            assert!(
                release_start_using("0.1.108", SOURCE_SHA, |args, write| mock.call(args, write))
                    .is_err()
            );
            assert!(mock.writes.is_empty());
        }
    }

    #[test]
    fn tag_lookup_errors_and_existing_exact_tag_never_allow_publication() {
        for response in [
            Err("HTTP 401".into()),
            Err("HTTP 500".into()),
            Ok("not json".into()),
            Ok(r#"[{"ref":"refs/tags/v0.1.108"}]"#.into()),
        ] {
            let mut mock = MockGh::new();
            mock.tags = response;
            assert!(
                release_start_using("0.1.108", SOURCE_SHA, |args, write| mock.call(args, write))
                    .is_err()
            );
            assert!(mock.writes.is_empty());
        }
        assert!(tag_is_absent(r#"[{"ref":"refs/tags/v0.1.108-test"}]"#, "0.1.108").unwrap());
    }

    #[test]
    fn detects_guarded_publish_workflows_and_versions() {
        assert!(workflow_has_publish_input(GUARDED_WORKFLOW));
        assert!(!workflow_has_publish_input(
            "on:\n  workflow_dispatch:\n    inputs:\n      publish:\n        type: boolean\n"
        ));
        assert!(!workflow_has_publish_input("on:\n  workflow_dispatch:\njobs:\n  publish:\n  expected_version:\n  expected_source_sha:\n"));
        assert_eq!(
            package_version(r#"{"version":"0.1.108"}"#).as_deref(),
            Some("0.1.108")
        );
        assert_eq!(package_version(r#"{"version":"1.0; rm -rf"}"#), None);
    }
}
