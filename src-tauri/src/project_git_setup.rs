//! Set up Git for a project folder, so it can have a bot (a bot works in a
//! git worktree copy, which needs a repository with one commit).
//!
//! Everything stays on this computer: `git init` when the folder has no
//! repository, a small `.gitignore` when it has none, and one first commit of
//! the files as they are. Nothing is pushed. When Git has no name or email
//! configured, a stand-in is passed for that one commit and never saved.
//!
//! Secrets stay out of that commit even when an existing `.gitignore` misses
//! them. A folder too big to track sensibly is refused, and everything this
//! did is undone: only what it created, never the user's own files.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};

use serde::Serialize;

const FIRST_COMMIT: &str = "Start tracking with Git";

/// Who the first commit is by when Git has no name or email configured. The
/// user's own commits later keep their own identity.
const FALLBACK_NAME: &str = "user.name=Aven";
const FALLBACK_EMAIL: &str = "user.email=aven@aven.invalid";

const DEFAULT_GITIGNORE: &str = "\
# Files Git leaves out. Aven wrote this when it set up Git; change it freely.
node_modules/
.DS_Store
dist/
build/
.next/
out/
coverage/
target/
.venv/
venv/
__pycache__/
*.log
.env
.env.*
";

/// Never in the first commit, whatever a `.gitignore` says: these names at
/// the top and in any folder, in any letter case.
const SECRET_PATTERNS: [&str; 7] = [
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "id_rsa*",
    "id_ed25519*",
];

/// Variables that would point git at another repository than the folder's.
const REPOSITORY_ENV: [&str; 6] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
];

/// More files than this, or one file this big, is almost always a folder of
/// dependencies, builds or media a `.gitignore` should leave out.
#[derive(Clone, Copy)]
struct Limits {
    files: usize,
    file_bytes: u64,
}

const LIMITS: Limits = Limits {
    files: 20_000,
    file_bytes: 50 * 1024 * 1024,
};

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitSetup {
    /// Git was turned on for the folder (`git init`).
    pub started: bool,
    /// The folder had no `.gitignore`, so one was written.
    pub wrote_ignore: bool,
    /// Files in the first commit; 0 when the folder already had a commit.
    pub files: usize,
}

const WHOLE_DISK: &str = "That's your whole disk. Pick a project folder instead.";
const WHOLE_HOME: &str = "That's your whole home folder. Pick a project folder inside it instead.";
const MISSING: &str = "This project's folder is missing.";

fn no_git() -> String {
    if cfg!(target_os = "macos") {
        "Git isn't installed on this Mac. To install it, open Terminal and run xcode-select --install, then try again.".into()
    } else {
        "Git isn't installed. Install it from git-scm.com, then try again.".into()
    }
}

/// `git -C folder …` with Aven's usual hardening: no prompts, no optional
/// locks, paths printed verbatim (`git_cmd`), and never another repository
/// named by the environment.
fn git(folder: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = crate::git::git_cmd();
    cmd.arg("--no-pager")
        .arg("-C")
        .arg(folder)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    for name in REPOSITORY_ENV {
        cmd.env_remove(name);
    }
    let output = cmd.output().map_err(|e| format!("Couldn't run Git: {e}"))?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    Err(git_message(&output.stderr).unwrap_or_else(|| format!("git {} failed", args.join(" "))))
}

/// Git's first line, without its "fatal:" or "error:" prefix.
fn git_message(stderr: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stderr);
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let line = ["fatal: ", "error: "]
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))
        .unwrap_or(line);
    Some(line.to_string())
}

/// A git step that failed for a reason of its own, said with git's words.
fn failed(error: String) -> String {
    format!("Couldn't set up Git: {error}")
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// Paths from a `-z` listing, exactly as git printed them.
fn paths(bytes: &[u8]) -> Vec<PathBuf> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(path_from_bytes)
        .collect()
}

#[cfg(unix)]
fn path_from_bytes(bytes: &[u8]) -> PathBuf {
    use std::os::unix::ffi::OsStrExt;
    PathBuf::from(std::ffi::OsStr::from_bytes(bytes))
}

#[cfg(not(unix))]
fn path_from_bytes(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}

/// Whether the git command could run at all. On a Mac without Apple's
/// command line tools, `/usr/bin/git` is only a stub that fails.
fn git_missing(probe: &std::io::Result<Output>) -> bool {
    match probe {
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
        Ok(output) => !output.status.success(),
    }
}

fn require_git() -> Result<(), String> {
    let mut probe = crate::git::git_cmd();
    probe.arg("--version").stdin(Stdio::null());
    let probe = probe.output();
    if git_missing(&probe) {
        return Err(no_git());
    }
    probe
        .map(|_| ())
        .map_err(|error| format!("Couldn't run Git: {error}"))
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canonical = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.into());
    canonical(a) == canonical(b)
}

/// The project's folder, refusing what is not a project: something missing
/// or not a folder, the whole disk, and the home folder or one holding it.
fn checked_folder(folder: &Path, home: Option<&Path>) -> Result<PathBuf, String> {
    if !folder.is_absolute() {
        return Err(MISSING.into());
    }
    let metadata = std::fs::metadata(folder).map_err(|_| MISSING.to_string())?;
    if !metadata.is_dir() {
        return Err("This project isn't a folder.".into());
    }
    let folder = folder
        .canonicalize()
        .map_err(|error| format!("Couldn't open this project's folder: {error}"))?;
    if folder.parent().is_none() {
        return Err(WHOLE_DISK.into());
    }
    if let Some(home) = home.and_then(|home| home.canonicalize().ok()) {
        if home.starts_with(&folder) {
            return Err(WHOLE_HOME.into());
        }
    }
    Ok(folder)
}

/// The repository the folder is the top of: `None` when it has none, else
/// whether it has a commit. A folder inside another repository is refused.
fn repository(folder: &Path) -> Result<Option<bool>, String> {
    let Ok(top) = git(folder, &["rev-parse", "--show-toplevel"]) else {
        // Git's own data (a bare repository, or inside a .git folder) has
        // no project files to track.
        if git(folder, &["rev-parse", "--git-dir"]).is_ok() {
            return Err(
                "This folder holds Git's own data, not a project. Pick a project folder instead."
                    .into(),
            );
        }
        return Ok(None);
    };
    let top = PathBuf::from(text(top));
    if !same_path(&top, folder) {
        let name = top
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| top.to_string_lossy().into_owned());
        return Err(format!(
            "This folder is inside another Git project, “{name}”. Add that project to Aven and add the bot there instead."
        ));
    }
    Ok(Some(
        git(folder, &["rev-parse", "-q", "--verify", "HEAD"]).is_ok(),
    ))
}

fn secret_pathspecs(magic: &str) -> Vec<String> {
    SECRET_PATTERNS
        .iter()
        .flat_map(|pattern| {
            [
                format!(":({magic}){pattern}"),
                format!(":({magic})**/{pattern}"),
            ]
        })
        .collect()
}

/// The same names as `SECRET_PATTERNS`, checked again on what was staged.
fn is_secret(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    let name = name.to_string_lossy().to_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
}

/// 34120 → "34,120".
fn thousands(count: usize) -> String {
    let digits = count.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn file_size(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    let mb = bytes as f64 / MB;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{mb:.0} MB")
    }
}

/// Refuse more files than the limit, or a file over it, naming the largest.
fn check_size(folder: &Path, files: &[PathBuf], limits: Limits) -> Result<(), String> {
    if files.len() > limits.files {
        return Err(format!(
            "This folder is too big to start tracking automatically: {} files. Add a .gitignore for large folders, or set up Git yourself.",
            thousands(files.len())
        ));
    }
    let largest = files
        .iter()
        .filter_map(|path| {
            let metadata = std::fs::symlink_metadata(folder.join(path)).ok()?;
            metadata.is_file().then_some((metadata.len(), path))
        })
        .max_by_key(|(size, _)| *size);
    if let Some((size, path)) = largest.filter(|(size, _)| *size > limits.file_bytes) {
        return Err(format!(
            "This folder is too big to start tracking automatically: {} is {}. Add a .gitignore for large files, or set up Git yourself.",
            path.to_string_lossy(),
            file_size(size)
        ));
    }
    Ok(())
}

fn configured(folder: &Path, key: &str) -> bool {
    git(folder, &["config", "--get", key]).is_ok_and(|value| !text(value).is_empty())
}

/// What a setup that stops early takes back: only what it created.
#[derive(Default)]
struct Undo {
    /// The `.git` folder `git init` made.
    git_dir: Option<PathBuf>,
    /// The `.gitignore` it wrote.
    ignore: Option<PathBuf>,
    /// An existing repository's index, as it was (`None` when it had none).
    index: Option<(PathBuf, Option<Vec<u8>>)>,
}

impl Undo {
    fn run(self) {
        if let Some(git_dir) = self.git_dir {
            let _ = std::fs::remove_dir_all(git_dir);
        } else if let Some((index, saved)) = self.index {
            let _ = match saved {
                Some(bytes) => std::fs::write(&index, bytes),
                None => std::fs::remove_file(&index),
            };
        }
        if let Some(ignore) = self.ignore {
            let _ = std::fs::remove_file(ignore);
        }
    }
}

/// Set up Git for `folder` and make its first commit. A folder that already
/// has a commit is left exactly as it is.
pub fn setup(folder: &Path, home: Option<&Path>) -> Result<GitSetup, String> {
    setup_with(folder, home, LIMITS)
}

fn setup_with(folder: &Path, home: Option<&Path>, limits: Limits) -> Result<GitSetup, String> {
    let folder = checked_folder(folder, home)?;
    require_git()?;
    let init = match repository(&folder)? {
        // Already set up: nothing to do.
        Some(true) => return Ok(GitSetup::default()),
        Some(false) => false,
        None => true,
    };
    let mut undo = Undo::default();
    let result = start(&folder, init, limits, &mut undo);
    if result.is_err() {
        undo.run();
    }
    result
}

fn start(folder: &Path, init: bool, limits: Limits, undo: &mut Undo) -> Result<GitSetup, String> {
    if init {
        let dot_git = folder.join(".git");
        if std::fs::symlink_metadata(&dot_git).is_ok() {
            return Err(
                "This folder has a .git that Git can't open. Fix or remove it, then try again."
                    .into(),
            );
        }
        // `init.defaultBranch` rather than `-b`, which older Git lacks.
        git(folder, &["-c", "init.defaultBranch=main", "init", "-q"])
            .map_err(|error| format!("Couldn't turn on Git: {error}"))?;
        undo.git_dir = Some(dot_git);
    } else {
        // The user's index as it was, to put back if this stops early.
        let index = PathBuf::from(text(
            git(folder, &["rev-parse", "--git-path", "index"]).map_err(failed)?,
        ));
        let index = if index.is_absolute() {
            index
        } else {
            folder.join(index)
        };
        let saved = match std::fs::read(&index) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("Couldn't read Git's index: {error}")),
        };
        undo.index = Some((index, saved));
    }

    // An existing .gitignore (or anything by that name) is never changed.
    let ignore = folder.join(".gitignore");
    match std::fs::File::create_new(&ignore) {
        Ok(mut file) => {
            undo.ignore = Some(ignore);
            file.write_all(DEFAULT_GITIGNORE.as_bytes())
                .map_err(|error| format!("Couldn't write a .gitignore: {error}"))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("Couldn't write a .gitignore: {error}")),
    }

    let excluded = secret_pathspecs("exclude,icase");
    // What `git add -A` would stage, measured before anything is copied into
    // the repository.
    let mut listing = vec![
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ".",
    ];
    listing.extend(excluded.iter().map(String::as_str));
    check_size(
        folder,
        &paths(&git(folder, &listing).map_err(failed)?),
        limits,
    )?;

    let mut add = vec!["add", "-A", "--", "."];
    add.extend(excluded.iter().map(String::as_str));
    git(folder, &add).map_err(|error| format!("Couldn't add the project's files: {error}"))?;
    // A secret staged earlier, by hand, stays out too.
    let secrets = secret_pathspecs("icase");
    let mut unstage = vec!["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--"];
    unstage.extend(secrets.iter().map(String::as_str));
    git(folder, &unstage).map_err(|error| format!("Couldn't leave out secret files: {error}"))?;

    let staged = paths(&git(folder, &["ls-files", "-z", "--cached"]).map_err(failed)?);
    if let Some(secret) = staged.iter().find(|path| is_secret(path)) {
        return Err(format!(
            "Couldn't leave {} out of the first save. Set up Git yourself.",
            secret.to_string_lossy()
        ));
    }
    check_size(folder, &staged, limits)?;

    let mut commit = vec![
        "-c",
        "commit.gpgsign=false",
        // The project's own hooks are not run for this bookkeeping commit.
        "-c",
        "core.hooksPath=/dev/null",
    ];
    if !configured(folder, "user.name") {
        commit.extend(["-c", FALLBACK_NAME]);
    }
    if !configured(folder, "user.email") {
        commit.extend(["-c", FALLBACK_EMAIL]);
    }
    commit.extend([
        "commit",
        "-q",
        "--no-verify",
        "--allow-empty",
        "-m",
        FIRST_COMMIT,
    ]);
    git(folder, &commit).map_err(|error| format!("Couldn't make the first save: {error}"))?;
    Ok(GitSetup {
        started: init,
        wrote_ignore: undo.ignore.is_some(),
        files: staged.len(),
    })
}

#[tauri::command]
pub async fn project_git_setup(path: String) -> Result<GitSetup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::dirs_home().map(PathBuf::from);
        setup(&crate::fs::expand_home(&path), home.as_deref())
    })
    .await
    .map_err(|error| format!("Couldn't set up Git: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("aven-git-setup-{name}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            // Canonical, so paths git reports compare equal on macOS (/private/var).
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn run(folder: &Path, args: &[&str]) -> String {
        text(git(folder, args).unwrap_or_else(|error| panic!("git {args:?}: {error}")))
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn committed(folder: &Path) -> Vec<String> {
        let mut files: Vec<String> = run(folder, &["ls-tree", "-r", "--name-only", "-z", "HEAD"])
            .split('\0')
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();
        files.sort();
        files
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn write(folder: &Path, name: &str, content: &str) {
        let path = folder.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    // Bots are macOS-only (Claude Code's sandbox does not run on Windows);
    // these drive real git through canonical macOS paths.
    #[cfg(not(windows))]
    #[test]
    fn a_plain_folder_gets_a_repository_with_one_commit_and_a_gitignore() {
        let fixture = Fixture::new("plain");
        let folder = fixture.0.join("site");
        write(&folder, "index.html", "<h1>Hi</h1>\n");
        write(&folder, "src/app.js", "console.log(1)\n");
        write(&folder, "naïve résumé.txt", "verbatim\n");
        write(&folder, "node_modules/pkg/index.js", "x\n");
        write(&folder, "debug.log", "noise\n");

        let done = setup(&folder, None).unwrap();
        assert_eq!(
            done,
            GitSetup {
                started: true,
                wrote_ignore: true,
                files: 4,
            }
        );
        assert_eq!(
            std::fs::read_to_string(folder.join(".gitignore")).unwrap(),
            DEFAULT_GITIGNORE
        );
        assert_eq!(
            committed(&folder),
            vec![".gitignore", "index.html", "naïve résumé.txt", "src/app.js"]
        );
        assert_eq!(run(&folder, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(run(&folder, &["branch", "--show-current"]), "main");
        assert_eq!(run(&folder, &["log", "-1", "--format=%s"]), FIRST_COMMIT);
        assert_eq!(run(&folder, &["status", "--porcelain"]), "");
        // Asking again leaves the folder exactly as it is.
        assert_eq!(setup(&folder, None).unwrap(), GitSetup::default());
        assert_eq!(run(&folder, &["rev-list", "--count", "HEAD"]), "1");
    }

    #[cfg(not(windows))]
    #[test]
    fn an_existing_gitignore_is_never_changed() {
        let fixture = Fixture::new("ignore");
        let folder = &fixture.0;
        let mine = "# mine\nbig/\n";
        write(folder, ".gitignore", mine);
        write(folder, "keep.txt", "keep\n");
        write(folder, "big/blob.bin", "x\n");
        // Not in the user's .gitignore, and still committed: it isn't Aven's.
        write(folder, "node_modules/pkg/index.js", "x\n");

        let done = setup(folder, None).unwrap();
        assert!(done.started);
        assert!(!done.wrote_ignore);
        assert_eq!(
            std::fs::read_to_string(folder.join(".gitignore")).unwrap(),
            mine
        );
        assert_eq!(
            committed(folder),
            vec![".gitignore", "keep.txt", "node_modules/pkg/index.js"]
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn secrets_are_never_committed_even_when_the_gitignore_misses_them() {
        let fixture = Fixture::new("secrets");
        let folder = &fixture.0;
        // The user's .gitignore leaves out none of them.
        write(folder, ".gitignore", "dist/\n");
        for name in [
            ".env",
            ".env.local",
            ".ENV.Production",
            "api/.env",
            "api/config/.env.test",
            "server.pem",
            "certs/site.key",
            "certs/Store.P12",
            "id_rsa",
            "id_rsa.pub",
            "keys/id_ed25519",
            "keys/id_ed25519.pub",
        ] {
            write(folder, name, "secret\n");
        }
        write(folder, "README.md", "readme\n");
        write(folder, "api/server.js", "server\n");
        write(folder, ".envrc.md", "notes\n");

        setup(folder, None).unwrap();
        assert_eq!(
            committed(folder),
            vec![".envrc.md", ".gitignore", "README.md", "api/server.js"]
        );
        // They are still there, as untracked files.
        assert!(folder.join(".env").is_file());
        assert!(folder.join("keys/id_ed25519").is_file());
        // The .gitignore was left alone.
        assert_eq!(
            std::fs::read_to_string(folder.join(".gitignore")).unwrap(),
            "dist/\n"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn a_repository_without_a_commit_gets_only_its_first_commit() {
        let fixture = Fixture::new("no-commit");
        let folder = &fixture.0;
        run(folder, &["init", "-q", "-b", "trunk"]);
        run(folder, &["config", "user.name", "Pat Example"]);
        run(folder, &["config", "user.email", "pat@example.com"]);
        let config = std::fs::read_to_string(folder.join(".git/config")).unwrap();
        write(folder, ".gitignore", "tmp/\n");
        write(folder, "notes.md", "notes\n");
        write(folder, ".env", "TOKEN=1\n");
        // Staged by hand before: it still stays out.
        run(folder, &["add", "--", ".env", "notes.md"]);

        let done = setup(folder, None).unwrap();
        assert_eq!(
            done,
            GitSetup {
                started: false,
                wrote_ignore: false,
                files: 2,
            }
        );
        assert_eq!(committed(folder), vec![".gitignore", "notes.md"]);
        assert_eq!(run(folder, &["branch", "--show-current"]), "trunk");
        assert_eq!(
            run(folder, &["log", "-1", "--format=%an <%ae>"]),
            "Pat Example <pat@example.com>"
        );
        assert_eq!(
            std::fs::read_to_string(folder.join(".git/config")).unwrap(),
            config
        );
        assert_eq!(run(folder, &["status", "--porcelain"]), "?? .env");
    }

    #[cfg(not(windows))]
    #[test]
    fn a_missing_identity_is_used_for_the_first_commit_only() {
        let fixture = Fixture::new("identity");
        let folder = &fixture.0;
        run(folder, &["init", "-q"]);
        // As if Git had no name or email anywhere: empty values.
        run(folder, &["config", "user.name", ""]);
        run(folder, &["config", "user.email", ""]);
        write(folder, "a.txt", "a\n");

        setup(folder, None).unwrap();
        assert_eq!(
            run(folder, &["log", "-1", "--format=%an <%ae>|%cn <%ce>"]),
            "Aven <aven@aven.invalid>|Aven <aven@aven.invalid>"
        );
        let config = std::fs::read_to_string(folder.join(".git/config")).unwrap();
        assert!(!config.contains("Aven"), "{config}");
        assert!(!config.contains("aven.invalid"), "{config}");
    }

    #[cfg(not(windows))]
    #[test]
    fn a_configured_identity_is_kept() {
        let fixture = Fixture::new("own-identity");
        let folder = fixture.0.join("app");
        write(&folder, "a.txt", "a\n");
        setup(&folder, None).unwrap();
        let name = git(&folder, &["config", "--get", "user.name"])
            .map(text)
            .ok()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Aven".into());
        assert_eq!(run(&folder, &["log", "-1", "--format=%an"]), name);
    }

    #[cfg(not(windows))]
    #[test]
    fn a_folder_inside_another_repository_is_refused() {
        let fixture = Fixture::new("nested");
        let parent = fixture.0.join("Parent Project");
        let child = parent.join("packages/web");
        write(&child, "index.html", "<h1>web</h1>\n");
        run(&parent, &["init", "-q"]);

        let error = setup(&child, None).unwrap_err();
        assert!(
            error.contains("inside another Git project, “Parent Project”"),
            "{error}"
        );
        assert!(!child.join(".git").exists());
        assert!(!child.join(".gitignore").exists());
        assert!(!parent.join(".gitignore").exists());
        assert!(git(&parent, &["rev-parse", "-q", "--verify", "HEAD"]).is_err());
    }

    #[test]
    fn the_home_folder_the_disk_and_non_folders_are_refused() {
        let fixture = Fixture::new("refuse");
        let home = fixture.0.join("home");
        std::fs::create_dir_all(home.join("Projects")).unwrap();
        assert_eq!(setup(&home, Some(&home)).unwrap_err(), WHOLE_HOME);
        // A folder holding the home folder is no project either.
        assert_eq!(setup(&fixture.0, Some(&home)).unwrap_err(), WHOLE_HOME);
        #[cfg(unix)]
        assert_eq!(setup(Path::new("/"), Some(&home)).unwrap_err(), WHOLE_DISK);
        let file = home.join("notes.txt");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            setup(&file, Some(&home)).unwrap_err(),
            "This project isn't a folder."
        );
        assert_eq!(setup(&home.join("gone"), Some(&home)).unwrap_err(), MISSING);
        assert_eq!(
            setup(Path::new("relative"), Some(&home)).unwrap_err(),
            MISSING
        );
        assert!(!home.join(".git").exists());
        assert!(!fixture.0.join(".git").exists());
        assert!(!home.join(".gitignore").exists());
    }

    #[cfg(not(windows))]
    #[test]
    fn too_many_files_is_refused_and_everything_undone() {
        let fixture = Fixture::new("too-many");
        let folder = &fixture.0;
        for index in 0..6 {
            write(folder, &format!("file-{index}.txt"), "x\n");
        }
        let limits = Limits {
            files: 5,
            file_bytes: 1024,
        };
        let error = setup_with(folder, None, limits).unwrap_err();
        // Six files and the .gitignore it wrote.
        assert_eq!(
            error,
            "This folder is too big to start tracking automatically: 7 files. Add a .gitignore for large folders, or set up Git yourself."
        );
        assert!(!folder.join(".git").exists());
        assert!(!folder.join(".gitignore").exists());
        assert_eq!(std::fs::read_dir(folder).unwrap().count(), 6);

        // One file over the size limit, named.
        let fixture = Fixture::new("too-big");
        let folder = &fixture.0;
        write(folder, "small.txt", "x\n");
        write(folder, "media/demo.mov", &"x".repeat(4096));
        let error = setup_with(folder, None, limits).unwrap_err();
        assert!(
            error.starts_with(
                "This folder is too big to start tracking automatically: media/demo.mov is"
            ),
            "{error}"
        );
        assert!(error.ends_with("Add a .gitignore for large files, or set up Git yourself."));
        assert!(!folder.join(".git").exists());
        assert!(!folder.join(".gitignore").exists());
    }

    #[cfg(not(windows))]
    #[test]
    fn a_refused_repository_keeps_its_own_git_and_index() {
        let fixture = Fixture::new("undo-index");
        let folder = &fixture.0;
        run(folder, &["init", "-q"]);
        for index in 0..6 {
            write(folder, &format!("file-{index}.txt"), "x\n");
        }
        run(folder, &["add", "--", "file-0.txt"]);
        let index = std::fs::read(folder.join(".git/index")).unwrap();
        let limits = Limits {
            files: 5,
            file_bytes: 1024,
        };
        assert!(setup_with(folder, None, limits).is_err());
        assert!(folder.join(".git").is_dir());
        assert!(!folder.join(".gitignore").exists());
        assert_eq!(std::fs::read(folder.join(".git/index")).unwrap(), index);
        assert_eq!(run(folder, &["ls-files"]), "file-0.txt");
    }

    #[test]
    fn undo_takes_back_only_what_it_made() {
        let fixture = Fixture::new("undo");
        let folder = &fixture.0;
        std::fs::create_dir(folder.join(".git")).unwrap();
        std::fs::write(folder.join(".git/index"), "staged by the setup").unwrap();
        std::fs::write(folder.join(".gitignore"), "written by the setup").unwrap();
        std::fs::write(folder.join("mine.txt"), "mine").unwrap();
        // An existing repository: its index goes back as it was, and the
        // .git folder stays.
        Undo {
            git_dir: None,
            ignore: Some(folder.join(".gitignore")),
            index: Some((folder.join(".git/index"), Some(b"theirs".to_vec()))),
        }
        .run();
        assert_eq!(std::fs::read(folder.join(".git/index")).unwrap(), b"theirs");
        assert!(!folder.join(".gitignore").exists());
        // An index that wasn't there before is removed again.
        Undo {
            index: Some((folder.join(".git/index"), None)),
            ..Undo::default()
        }
        .run();
        assert!(!folder.join(".git/index").exists());
        assert!(folder.join(".git").is_dir());
        // A .git folder it made goes entirely.
        Undo {
            git_dir: Some(folder.join(".git")),
            ..Undo::default()
        }
        .run();
        assert!(!folder.join(".git").exists());
        assert_eq!(
            std::fs::read_to_string(folder.join("mine.txt")).unwrap(),
            "mine"
        );
    }

    #[test]
    fn says_when_git_is_missing() {
        let missing = Err(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert!(git_missing(&missing));
        let denied = Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert!(!git_missing(&denied));
        assert!(no_git().starts_with("Git isn't installed"));
    }

    #[test]
    fn counts_and_sizes_read_plainly() {
        assert_eq!(thousands(7), "7");
        assert_eq!(thousands(20_000), "20,000");
        assert_eq!(thousands(34_120), "34,120");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(file_size(60 * 1024 * 1024), "60 MB");
        assert_eq!(file_size(1536 * 1024 * 1024), "1.5 GB");
        assert_eq!(
            git_message(b"\nfatal: not a git repository\nmore"),
            Some("not a git repository".into())
        );
        assert!(is_secret(Path::new("a/.ENV.local")));
        assert!(is_secret(Path::new("id_ed25519.pub")));
        assert!(!is_secret(Path::new(".envrc")));
        assert!(!is_secret(Path::new("environment.ts")));
    }
}
