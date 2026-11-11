//! Files an agent makes for the user to keep: an export, a PDF, an image, a
//! spreadsheet, a zip. They stay in the project's hidden `.aven/files`
//! folder, which keeps itself out of Git, until the user clicks one in the
//! chat. Then a copy lands in Downloads the way a browser saves a download:
//! a name that is taken gets " (1)", " (2)"… and both files stay.
//!
//! Nothing is made up front: the agent makes the folder with its first
//! file, so a project (or a helper's copy) where no file was ever handed
//! over has no `.aven` folder at all.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::fs::expand_home;

const AVEN_DIR: &str = ".aven";
const FILES_DIR: &str = "files";
/// `*` in `.aven/.gitignore` keeps the folder, this file included, out of
/// Git without touching the project's own ignore rules.
const IGNORE_EVERYTHING: &str =
    "# Files Aven's agents made for you. Git leaves this folder alone.\n*\n";
const MAX_NAME_BYTES: usize = 180;

/// Programs, installers and scripts: opening one runs it, so a downloaded
/// one is only shown in Finder. Matches the in-app browser, which stops
/// and asks before saving one.
const RUNS_WHEN_OPENED: &[&str] = &[
    "app",
    "applescript",
    "bash",
    "bat",
    "cmd",
    "com",
    "command",
    "csh",
    "dmg",
    "exe",
    "fish",
    "hta",
    "jar",
    "js",
    "jse",
    "ksh",
    "lnk",
    "mpkg",
    "msi",
    "msix",
    "pif",
    "pkg",
    "ps1",
    "reg",
    "scpt",
    "scptd",
    "scr",
    "sh",
    "terminal",
    "tool",
    "vbe",
    "vbs",
    "workflow",
    "ws",
    "wsf",
    "wsh",
    "zsh",
];

/// Paths this run of Aven saved into Downloads: the only ones Open may hand
/// to the system, so the interface can't open an arbitrary file.
#[derive(Default)]
pub struct AgentDownloads(Mutex<HashSet<PathBuf>>);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDownload {
    /// Where the copy was saved.
    path: String,
    /// Its name in Downloads, which differs from the agent's when it was taken.
    name: String,
    /// False for a program or script, which Open would run.
    openable: bool,
}

/// The folder an agent saves files for the user in, as an absolute path.
/// It isn't made here; once it is there, its ignore file is kept.
#[tauri::command]
pub async fn agent_files_folder(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        files_folder(&expand_home(&cwd)).map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Save a copy of an agent's file into Downloads.
#[tauri::command]
pub async fn agent_file_download(
    app: AppHandle,
    downloads: State<'_, AgentDownloads>,
    path: String,
) -> Result<AgentDownload, String> {
    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "Aven can't find your Downloads folder.".to_string())?;
    let source = expand_home(&path);
    let saved = tauri::async_runtime::spawn_blocking(move || save_copy(&source, &directory))
        .await
        .map_err(|error| error.to_string())??;
    let download = describe(&saved);
    downloads
        .0
        .lock()
        .map_err(|_| "Downloads are unavailable.".to_string())?
        .insert(saved);
    Ok(download)
}

/// Open a file `agent_file_download` saved, in its usual app.
#[tauri::command]
pub fn agent_download_open(
    app: AppHandle,
    downloads: State<'_, AgentDownloads>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    let known = downloads
        .0
        .lock()
        .map_err(|_| "Downloads are unavailable.".to_string())?
        .contains(&path);
    if !known {
        return Err("Download the file again, then open it.".into());
    }
    if !path.is_file() {
        return Err(format!(
            "{} was moved or deleted from Downloads.",
            file_name(&path)
        ));
    }
    if runs_when_opened(&path) {
        return Err("This file is a program or script, so Aven only shows it in Finder.".into());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// Where `cwd`'s agent files go. Creates no folder: when the folder is
/// already there (an agent saved a file in it), the ignore file beside it is
/// made if missing, so Git leaves the folder alone.
fn files_folder(cwd: &Path) -> Result<PathBuf, String> {
    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err("The project folder isn't there.".into());
    }
    keep_out_of_git(cwd)?;
    Ok(cwd.join(AVEN_DIR).join(FILES_DIR))
}

/// Once `project` has an agent files folder, make the ignore file beside it
/// if it is missing, so Git (and Ship it with it) leaves the folder alone.
/// Makes no folder, and an ignore file the user changed is theirs to keep.
pub(crate) fn keep_out_of_git(project: &Path) -> Result<(), String> {
    let aven = project.join(AVEN_DIR);
    if !aven.join(FILES_DIR).is_dir() {
        return Ok(());
    }
    let ignore = aven.join(".gitignore");
    if std::fs::symlink_metadata(&ignore).is_err() {
        std::fs::write(&ignore, IGNORE_EVERYTHING)
            .map_err(|error| format!("{}: {error}", ignore.display()))?;
    }
    Ok(())
}

/// Where Aven's own folder starts in a path relative to a project (its
/// parts joined by `/`): the folders above it, `""` at the project's top.
/// `None` for a path outside one. Files there are Aven's (an agent's files
/// for you, an automation's records), never a change to the project.
pub(crate) fn aven_dir_parent(relative: &str) -> Option<&str> {
    let mut start = 0;
    for part in relative.split('/') {
        let end = start + part.len();
        // The last part is a file: one named `.aven` is the project's own.
        if part == AVEN_DIR && end < relative.len() {
            return Some(relative[..start].trim_end_matches('/'));
        }
        start = end + 1;
    }
    None
}

/// True for a file somewhere under a `.aven/files` folder, named plainly.
pub(crate) fn is_agent_file(path: &Path) -> bool {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return false;
    }
    path.parent().is_some_and(|parent| {
        parent.ancestors().any(|folder| {
            folder.file_name().is_some_and(|name| name == FILES_DIR)
                && folder
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name == AVEN_DIR)
        })
    })
}

fn save_copy(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    if !is_agent_file(source) {
        return Err("Only files an agent made for you can be downloaded from a chat.".into());
    }
    let gone = || {
        format!(
            "{} isn't there any more. Ask the agent to make it again.",
            file_name(source)
        )
    };
    // A link (the file, or a folder above it) that leads elsewhere could
    // copy any file into Downloads: what it really is must be an agent's too.
    let real = std::fs::canonicalize(source).map_err(|_| gone())?;
    if !is_agent_file(&real) {
        return Err("Only files an agent made for you can be downloaded from a chat.".into());
    }
    let metadata = std::fs::metadata(&real).map_err(|_| gone())?;
    if metadata.is_dir() {
        return Err("That's a folder. Ask the agent to zip it, then download the zip.".into());
    }
    if !metadata.is_file() {
        return Err(gone());
    }
    let mut input = File::open(&real).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let (saved, mut output) = create_unique(directory, &file_name(source))?;
    let copied = io::copy(&mut input, &mut output).and_then(|_| output.sync_all());
    if let Err(error) = copied {
        drop(output);
        let _ = std::fs::remove_file(&saved);
        return Err(format!("The download stopped: {error}"));
    }
    Ok(saved)
}

/// A new, empty file in `directory`: `name`, else `name (1)`, `name (2)`…
/// Created atomically, so two downloads at once never share a name.
fn create_unique(directory: &Path, name: &str) -> Result<(PathBuf, File), String> {
    let name = safe_name(name);
    let (stem, extension) = split_name(&name);
    for index in 0..10_000u32 {
        let candidate = directory.join(if index == 0 {
            name.clone()
        } else {
            format!("{stem} ({index}){extension}")
        });
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("{}: {error}", candidate.display())),
        }
    }
    Err("Downloads already has too many files with this name.".into())
}

/// `report.pdf` → (`report`, `.pdf`); a dotfile or a name with no
/// extension keeps its whole name as the stem.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    }
}

fn safe_name(value: &str) -> String {
    let mut name: String = value
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':') {
                '_'
            } else {
                c
            }
        })
        .collect();
    name = name
        .trim_matches(|c: char| c.is_whitespace() || c == '.')
        .to_string();
    while name.len() > MAX_NAME_BYTES {
        name.pop();
    }
    if name.is_empty() {
        "download".into()
    } else {
        name
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "The file".into())
}

fn runs_when_opened(path: &Path) -> bool {
    let by_name = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            RUNS_WHEN_OPENED.contains(&extension.to_ascii_lowercase().as_str())
        });
    by_name || is_executable(path)
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    false
}

fn describe(saved: &Path) -> AgentDownload {
    AgentDownload {
        path: saved.to_string_lossy().into_owned(),
        name: file_name(saved),
        openable: !runs_when_opened(saved),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "aven-agent-files-{label}-{}-{stamp}-{seq}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // macOS hands out /var/…, a link to /private/var/…: compare real paths.
        Tmp(dir.canonicalize().unwrap())
    }

    /// The folder as an agent makes it with its first file.
    fn made_files_folder(project: &Path) -> PathBuf {
        let folder = files_folder(project).unwrap();
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    fn agent_file(project: &Path, name: &str, body: &str) -> PathBuf {
        let path = made_files_folder(project).join(name);
        std::fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn files_folder_is_left_to_the_agent_and_then_kept_out_of_git() {
        let project = tmp("folder");
        let folder = files_folder(&project.0).unwrap();
        assert_eq!(folder, project.0.join(".aven").join("files"));
        // Asking where files go makes nothing: no `.aven` in a project (or
        // a helper's copy) that was never handed a file.
        assert!(!project.0.join(".aven").exists());

        std::fs::create_dir_all(&folder).unwrap();
        files_folder(&project.0).unwrap();
        let ignore = project.0.join(".aven").join(".gitignore");
        assert_eq!(std::fs::read_to_string(&ignore).unwrap(), IGNORE_EVERYTHING);
        assert!(IGNORE_EVERYTHING.lines().any(|line| line == "*"));

        std::fs::write(&ignore, "keep-mine\n").unwrap();
        files_folder(&project.0).unwrap();
        assert_eq!(std::fs::read_to_string(&ignore).unwrap(), "keep-mine\n");
        assert!(files_folder(&project.0.join("missing")).is_err());
        assert!(files_folder(Path::new("relative")).is_err());
    }

    #[test]
    fn finds_avens_own_folder_in_a_project_path() {
        assert_eq!(aven_dir_parent(".aven/files/Notes.md"), Some(""));
        assert_eq!(aven_dir_parent(".aven/.gitignore"), Some(""));
        assert_eq!(
            aven_dir_parent("apps/web/.aven/files/a.png"),
            Some("apps/web")
        );
        assert_eq!(aven_dir_parent("README.md"), None);
        assert_eq!(aven_dir_parent("docs/.aven"), None);
        assert_eq!(aven_dir_parent(".avenue/files/Notes.md"), None);
        assert_eq!(aven_dir_parent("src/aven/files/Notes.md"), None);
    }

    /// `<root>/p/<parts…>`, absolute on this platform (`/` or `C:\`).
    fn in_project(parts: &[&str]) -> PathBuf {
        let root = if cfg!(windows) { r"C:\" } else { "/" };
        parts
            .iter()
            .fold(Path::new(root).join("p"), |path, part| path.join(part))
    }

    #[test]
    fn only_files_under_an_aven_files_folder_count() {
        assert!(is_agent_file(&in_project(&[
            ".aven",
            "files",
            "Report.pdf"
        ])));
        assert!(is_agent_file(&in_project(&[
            ".aven", "files", "charts", "a.png"
        ])));
        assert!(!is_agent_file(&in_project(&[".aven", "files"])));
        assert!(!is_agent_file(&in_project(&["files", "Report.pdf"])));
        assert!(!is_agent_file(&in_project(&[".aven", "Report.pdf"])));
        assert!(!is_agent_file(&in_project(&["src", "Report.pdf"])));
        assert!(!is_agent_file(&in_project(&[
            ".aven", "files", "..", "..", "etc", "passwd"
        ])));
        assert!(!is_agent_file(
            &Path::new(".aven").join("files").join("Report.pdf")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_count_whichever_separators_they_use() {
        for path in [
            r"C:\Users\me\p\.aven\files\Report.pdf",
            "C:/Users/me/p/.aven/files/Report.pdf",
            r"\\?\C:\Users\me\p\.aven\files\Report.pdf",
            r"\\server\share\p\.aven\files\Report.pdf",
        ] {
            assert!(is_agent_file(Path::new(path)), "{path}");
        }
        assert!(!is_agent_file(Path::new(r"C:\Users\me\p\src\Report.pdf")));
        assert!(!is_agent_file(Path::new(r"\p\.aven\files\Report.pdf")));
    }

    #[test]
    fn downloading_twice_keeps_both_files_like_a_browser() {
        let project = tmp("twice");
        let downloads = tmp("twice-downloads");
        let source = agent_file(&project.0, "Sign-in and admin levels.pdf", "%PDF-1");

        let first = save_copy(&source, &downloads.0).unwrap();
        let second = save_copy(&source, &downloads.0).unwrap();
        let third = save_copy(&source, &downloads.0).unwrap();
        assert_eq!(first, downloads.0.join("Sign-in and admin levels.pdf"));
        assert_eq!(second, downloads.0.join("Sign-in and admin levels (1).pdf"));
        assert_eq!(third, downloads.0.join("Sign-in and admin levels (2).pdf"));
        for saved in [&first, &second, &third] {
            assert_eq!(std::fs::read_to_string(saved).unwrap(), "%PDF-1");
        }
        // The agent's file stays, so the link keeps working.
        assert!(source.is_file());
    }

    #[test]
    fn names_without_an_extension_number_whole_and_dotfiles_stay_visible() {
        let downloads = tmp("names");
        std::fs::write(downloads.0.join("Makefile"), "").unwrap();
        let (path, _) = create_unique(&downloads.0, "Makefile").unwrap();
        assert_eq!(path, downloads.0.join("Makefile (1)"));
        // A hidden name would save a file Finder doesn't show.
        let (path, _) = create_unique(&downloads.0, ".env").unwrap();
        assert_eq!(path, downloads.0.join("env"));
        let (path, _) = create_unique(&downloads.0, ".env").unwrap();
        assert_eq!(path, downloads.0.join("env (1)"));
        assert_eq!(safe_name("../a:b.csv"), "_a_b.csv");
        assert_eq!(safe_name("..."), "download");
    }

    #[test]
    fn refuses_folders_missing_files_links_and_files_elsewhere() {
        let project = tmp("refuse");
        let downloads = tmp("refuse-downloads");
        let folder = made_files_folder(&project.0);

        std::fs::create_dir(folder.join("site")).unwrap();
        let error = save_copy(&folder.join("site"), &downloads.0).unwrap_err();
        assert!(error.contains("zip it"), "{error}");

        let error = save_copy(&folder.join("gone.pdf"), &downloads.0).unwrap_err();
        assert!(error.contains("isn't there any more"), "{error}");

        let secret = project.0.join("secret.txt");
        std::fs::write(&secret, "key").unwrap();
        assert!(save_copy(&secret, &downloads.0).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&secret, folder.join("innocent.pdf")).unwrap();
            assert!(save_copy(&folder.join("innocent.pdf"), &downloads.0).is_err());
            // A files folder that is a link to another folder counts as that folder.
            let other = tmp("refuse-other");
            std::fs::write(other.0.join("id_rsa"), "key").unwrap();
            let linked = other.0.join("project").join(".aven");
            std::fs::create_dir_all(&linked).unwrap();
            std::os::unix::fs::symlink(&other.0, linked.join("files")).unwrap();
            assert!(save_copy(&linked.join("files").join("id_rsa"), &downloads.0).is_err());
        }
        assert_eq!(std::fs::read_dir(&downloads.0).unwrap().count(), 0);
    }

    #[test]
    fn programs_and_scripts_are_never_opened() {
        let downloads = tmp("open");
        for (name, openable) in [
            ("report.pdf", true),
            ("table.CSV", true),
            ("chart.png", true),
            ("bundle.zip", true),
            ("setup.command", false),
            ("install.PKG", false),
            ("run.sh", false),
            ("tool.exe", false),
        ] {
            let path = downloads.0.join(name);
            std::fs::write(&path, "").unwrap();
            assert_eq!(describe(&path).openable, openable, "{name}");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let plain = downloads.0.join("build");
            std::fs::write(&plain, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(!describe(&plain).openable);
        }
    }
}
