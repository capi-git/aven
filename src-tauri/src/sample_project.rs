//! The first-run walkthrough's sample: a tiny static website inside Aven's
//! own data folder, with one first commit so Changes and Ship it work.
//! Nothing outside that folder is read or written.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SAMPLES_DIR: &str = "sample-projects";
const SAMPLE_NAME: &str = "sample-site";

/// Who the first commit is by. The user's own commits later keep their own
/// identity: this is passed for that one commit, never saved in the repo.
const SAMPLE_AUTHOR: [&str; 4] = [
    "-c",
    "user.name=Aven",
    "-c",
    "user.email=sample@aven.invalid",
];

const SAMPLE_FILES: [(&str, &str); 3] = [
    (
        "index.html",
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sample site</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Hello from Aven</h1>
      <p>
        A tiny website to try things on. Ask an agent to change anything you
        like, then review the change and ship it.
      </p>
      <button type="button" onclick="this.textContent = 'Clicked!'">
        Click me
      </button>
    </main>
  </body>
</html>
"#,
    ),
    (
        "style.css",
        r#"body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #f6f7f9;
  color: #1d2125;
}

main {
  max-width: 32rem;
  padding: 2rem;
}

h1 {
  font-size: 2rem;
  margin: 0 0 0.5rem;
}

button {
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: #3b6cf6;
  color: white;
  font: inherit;
  cursor: pointer;
}
"#,
    ),
    (
        "README.md",
        r#"# Sample site

A tiny website Aven made for you to try things on: `index.html`, `style.css`
and this file. It lives in Aven's own folder, so nothing else on your computer
is touched.

Try asking an agent to "Make the heading bigger", look at the change in the
side panel's Changes, then press **Ship it** to commit it.

To preview it, ask the agent to open a preview, or run
`python3 -m http.server` in this folder and open the address it prints.
"#,
    ),
];

#[tauri::command]
pub async fn create_sample_project(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        ensure_sample(&data_dir).map(|path| crate::fs::path_to_js(&path))
    })
    .await
    .map_err(|error| format!("Could not create the sample: {error}"))?
}

/// Create the sample, or finish and reuse the one already there. Files
/// someone changed are kept; only missing ones are written, and only a
/// folder with no commit yet gets the first one.
fn ensure_sample(data_dir: &Path) -> Result<PathBuf, String> {
    if !data_dir.is_absolute() {
        return Err("The application data folder must be an absolute path.".into());
    }
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("Could not prepare the application data folder: {error}"))?;
    let data_dir = data_dir
        .canonicalize()
        .map_err(|error| format!("Could not resolve the application data folder: {error}"))?;
    let root = data_dir.join(SAMPLES_DIR);
    create_managed_directory(&root)?;
    let folder = root.join(SAMPLE_NAME);
    create_managed_directory(&folder)?;
    for (name, content) in SAMPLE_FILES {
        let path = folder.join(name);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() => continue,
            Ok(_) => return Err(format!("The sample's {name} is not a file.")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not inspect the sample: {error}")),
        }
        std::fs::write(&path, content)
            .map_err(|error| format!("Could not write the sample's {name}: {error}"))?;
    }
    if !folder.join(".git").exists() {
        // `init.defaultBranch` rather than `-b`, which older Git lacks.
        crate::git::git_checked(&folder, &["-c", "init.defaultBranch=main", "init", "-q"])
            .map_err(|error| format!("Could not start Git in the sample: {error}"))?;
    }
    if !has_commit(&folder) {
        let names: Vec<&str> = SAMPLE_FILES.iter().map(|(name, _)| *name).collect();
        let mut add = vec!["add", "--"];
        add.extend(names.iter().copied());
        crate::git::git_checked(&folder, &add)
            .map_err(|error| format!("Could not add the sample's files: {error}"))?;
        let mut commit: Vec<&str> = SAMPLE_AUTHOR.to_vec();
        commit.extend([
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--no-verify",
            "-m",
            "Start the sample site",
        ]);
        crate::git::git_checked(&folder, &commit)
            .map_err(|error| format!("Could not make the sample's first commit: {error}"))?;
    }
    Ok(folder)
}

fn has_commit(folder: &Path) -> bool {
    crate::git::git_checked(folder, &["rev-parse", "-q", "--verify", "HEAD"]).is_ok()
}

/// Existing content is retained. Never follow a replacement symlink out of
/// Aven's data folder.
fn create_managed_directory(path: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("Could not prepare the sample folder: {error}")),
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect the sample folder: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The sample folder must be a directory, not a file or symbolic link.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("aven-sample-test-{name}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn git(folder: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(folder)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {args:?}");
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn creates_a_small_site_with_one_first_commit() {
        if !git_available() {
            return;
        }
        let fixture = Fixture::new("create");
        let data = fixture.0.join("Application Support");
        let folder = ensure_sample(&data).unwrap();
        assert_eq!(folder, data.join(SAMPLES_DIR).join(SAMPLE_NAME));
        for (name, content) in SAMPLE_FILES {
            assert_eq!(std::fs::read_to_string(folder.join(name)).unwrap(), content);
        }
        let index = std::fs::read_to_string(folder.join("index.html")).unwrap();
        assert!(index.contains("<h1>"));
        assert!(index.contains("<p>"));
        assert!(index.contains("<button"));
        assert!(index.contains("style.css"));
        assert_eq!(git(&folder, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(git(&folder, &["status", "--porcelain"]), "");
        assert_eq!(git(&folder, &["branch", "--show-current"]), "main");
        assert_eq!(
            git(&folder, &["log", "-1", "--format=%an|%s"]),
            "Aven|Start the sample site"
        );
        // The identity was for that commit only.
        assert!(!std::fs::read_to_string(folder.join(".git").join("config"))
            .unwrap()
            .contains("Aven"));
    }

    #[test]
    fn reuses_the_sample_and_keeps_changes() {
        if !git_available() {
            return;
        }
        let fixture = Fixture::new("reuse");
        let data = fixture.0.join("data");
        let folder = ensure_sample(&data).unwrap();
        std::fs::write(folder.join("index.html"), "<h1>Bigger</h1>\n").unwrap();
        assert_eq!(ensure_sample(&data).unwrap(), folder);
        assert_eq!(
            std::fs::read_to_string(folder.join("index.html")).unwrap(),
            "<h1>Bigger</h1>\n"
        );
        assert_eq!(git(&folder, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(git(&folder, &["status", "--porcelain"]), "M index.html");
    }

    #[test]
    fn finishes_a_sample_left_half_made() {
        if !git_available() {
            return;
        }
        let fixture = Fixture::new("resume");
        let data = fixture.0.join("data");
        let folder = data.join(SAMPLES_DIR).join(SAMPLE_NAME);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("style.css"), "h1 { color: red; }\n").unwrap();
        git(&folder, &["init", "-q", "-b", "main"]);
        let made = ensure_sample(&data).unwrap();
        assert_eq!(made, folder.canonicalize().unwrap());
        assert_eq!(
            std::fs::read_to_string(made.join("style.css")).unwrap(),
            "h1 { color: red; }\n"
        );
        assert!(made.join("index.html").is_file());
        assert!(made.join("README.md").is_file());
        assert_eq!(git(&made, &["rev-list", "--count", "HEAD"]), "1");
        assert_eq!(git(&made, &["status", "--porcelain"]), "");
    }

    #[test]
    fn refuses_a_relative_data_folder() {
        assert!(ensure_sample(Path::new("relative")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_a_symlink_out_of_the_data_folder() {
        use std::os::unix::fs::symlink;
        for replace_root in [true, false] {
            let fixture = Fixture::new("symlink");
            let outside = fixture.0.join("outside");
            std::fs::create_dir(&outside).unwrap();
            let data = fixture.0.join("data");
            std::fs::create_dir(&data).unwrap();
            let root = data.join(SAMPLES_DIR);
            if replace_root {
                symlink(&outside, &root).unwrap();
            } else {
                std::fs::create_dir(&root).unwrap();
                symlink(&outside, root.join(SAMPLE_NAME)).unwrap();
            }
            assert!(ensure_sample(&data).is_err());
            assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
        }
    }

    #[test]
    fn refuses_a_sample_file_that_is_a_folder() {
        let fixture = Fixture::new("not-file");
        let data = fixture.0.join("data");
        let folder = data.join(SAMPLES_DIR).join(SAMPLE_NAME);
        std::fs::create_dir_all(folder.join("index.html")).unwrap();
        assert!(ensure_sample(&data).is_err());
        assert!(!folder.join(".git").exists());
    }
}
