//! Agent uploads: which local files may be offered to a website, the private
//! copies the user approves, and what Aven's bar shows about them.
//!
//! The user approves the exact bytes they are shown: each file is copied into
//! a private folder before the prompt, the bar names every copy, and only those
//! copies reach the page's file chooser. Files in hidden folders of the home
//! folder, the Keychains folder, and files that look like secrets are never
//! offered.
#![cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// At most this many files per upload, each at most `MAX_FILE_BYTES`.
pub(crate) const MAX_FILES: usize = 10;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
/// Copies the page received stay this long (a site may read a chosen file
/// only when it sends the form), or until the chat ends or Aven quits.
const KEEP_COPIES: Duration = Duration::from_secs(60 * 60);

/// Bounds checked before anything is read: 1 to 10 absolute paths.
pub(crate) fn validate_request(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(format!("Upload between 1 and {MAX_FILES} files."));
    }
    for path in paths {
        if path.len() > 4096 || path.contains('\0') || !Path::new(path).is_absolute() {
            return Err("Use an absolute local file path (maximum 4096 bytes)".into());
        }
    }
    Ok(())
}

/// One local file the user is asked to send.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UploadFile {
    pub path: String,
    pub name: String,
    /// Where it comes from, with the home folder shown as "~".
    pub folder: String,
    pub bytes: u64,
}

const SECRET_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx", "ppk", "keychain", "keychain-db"];
const PRIVATE_KEYS: &[&str] = &["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];

/// Why a file is never offered to a website, if it is not: inside a hidden
/// folder of the home folder (~/.ssh, ~/.aws, ~/.config…), in the Keychains
/// folder, or named like a secret (a private key, certificate, key store,
/// hidden file or environment file).
fn refusal(path: &Path, home: Option<&Path>) -> Option<String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ask = "Aven does not upload it. Ask the user to upload it themselves if they mean to.";
    if let Some(inside) = home.and_then(|home| path.strip_prefix(home).ok()) {
        if inside.starts_with("Library/Keychains") {
            return Some(format!("{name} is in the Keychains folder, so {ask}"));
        }
        let parents: Vec<_> = inside.components().collect();
        if parents
            .iter()
            .take(parents.len().saturating_sub(1))
            .any(|part| matches!(part, Component::Normal(part) if part.to_string_lossy().starts_with('.')))
        {
            return Some(format!("{name} is in a hidden folder, so {ask}"));
        }
    }
    let lower = name.to_lowercase();
    let extension = Path::new(&lower)
        .extension()
        .map(|extension| extension.to_string_lossy().into_owned())
        .unwrap_or_default();
    let private_key = PRIVATE_KEYS.iter().any(|key| {
        lower == *key
            || (lower.starts_with(key)
                && lower[key.len()..].starts_with(['_', '-', '.'])
                && !lower.ends_with(".pub"))
    });
    if lower.starts_with('.') || private_key || SECRET_EXTENSIONS.contains(&extension.as_str()) {
        return Some(format!(
            "{name} looks like a secret (a private key, certificate, hidden or environment file), so {ask}"
        ));
    }
    None
}

fn home_folder() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
        .map(|home| std::fs::canonicalize(&home).unwrap_or(home))
}

fn shown_folder(path: &Path, home: Option<&Path>) -> String {
    let parent = path.parent().unwrap_or(path);
    match home.and_then(|home| parent.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".into(),
        Some(rest) => format!("~/{}", rest.display()),
        None => parent.display().to_string(),
    }
}

/// Checks the files before anything is copied or the user is asked: absolute
/// paths to existing, readable regular files (never folders, devices, pipes
/// or sockets), no secrets or hidden folders, within the count and size
/// bounds. Symbolic links resolve to their target, which is checked as well.
pub(crate) fn check_files(paths: &[String]) -> Result<Vec<UploadFile>, String> {
    check_files_in(paths, home_folder().as_deref())
}

fn check_files_in(paths: &[String], home: Option<&Path>) -> Result<Vec<UploadFile>, String> {
    validate_request(paths)?;
    let mut files: Vec<UploadFile> = Vec::new();
    let mut total = 0_u64;
    for path in paths {
        let given = Path::new(path);
        if let Some(reason) = refusal(given, home) {
            return Err(reason);
        }
        let shown = given
            .file_name()
            .map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned());
        let canonical = std::fs::canonicalize(path)
            .map_err(|error| format!("Could not find {shown}: {error}"))?;
        if let Some(reason) = refusal(&canonical, home) {
            return Err(reason);
        }
        let metadata = std::fs::metadata(&canonical)
            .and_then(|metadata| {
                if metadata.is_file() {
                    open_regular(&canonical)?.metadata()
                } else {
                    Ok(metadata)
                }
            })
            .map_err(|error| format!("Could not read {shown}: {error}"))?;
        if !metadata.is_file() {
            return Err(format!(
                "{shown} is not a regular file. Upload files only, not folders or devices."
            ));
        }
        if metadata.len() > MAX_FILE_BYTES {
            return Err(format!("{shown} is larger than 256 MB."));
        }
        total += metadata.len();
        if total > MAX_TOTAL_BYTES {
            return Err("These files are larger than 512 MB together.".into());
        }
        let path = canonical
            .to_str()
            .ok_or_else(|| format!("The path of {shown} is not valid UTF-8."))?
            .to_owned();
        if files.iter().any(|file| file.path == path) {
            continue;
        }
        let name = canonical
            .file_name()
            .map_or_else(|| shown.clone(), |name| name.to_string_lossy().into_owned());
        files.push(UploadFile {
            folder: shown_folder(&canonical, home),
            path,
            name,
            bytes: metadata.len(),
        });
    }
    Ok(files)
}

fn open_regular(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A pipe swapped in after the check must not block a worker, and a
        // link swapped in is not followed.
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// Suffixes under which each name is its own site. A small built-in set of
/// the common multi-part public suffixes and hosting domains; any other host
/// keeps its last two labels.
const SHARED_SUFFIXES: &[&str] = &[
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "me.uk",
    "ltd.uk",
    "plc.uk",
    "net.uk",
    "sch.uk",
    "nhs.uk",
    "com.au",
    "net.au",
    "org.au",
    "edu.au",
    "gov.au",
    "asn.au",
    "id.au",
    "co.nz",
    "org.nz",
    "net.nz",
    "govt.nz",
    "ac.nz",
    "co.jp",
    "ne.jp",
    "or.jp",
    "ac.jp",
    "go.jp",
    "gr.jp",
    "co.kr",
    "or.kr",
    "com.br",
    "net.br",
    "org.br",
    "gov.br",
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "com.hk",
    "org.hk",
    "com.tw",
    "org.tw",
    "com.sg",
    "org.sg",
    "edu.sg",
    "com.my",
    "co.id",
    "co.in",
    "net.in",
    "org.in",
    "gov.in",
    "ac.in",
    "co.za",
    "org.za",
    "gov.za",
    "com.mx",
    "org.mx",
    "gob.mx",
    "com.ar",
    "com.co",
    "com.pe",
    "com.tr",
    "com.ua",
    "co.il",
    "org.il",
    "ac.il",
    "com.ph",
    "com.vn",
    "com.pk",
    "com.eg",
    "com.sa",
    "com.ng",
    "co.ke",
    "github.io",
    "gitlab.io",
    "pages.dev",
    "workers.dev",
    "vercel.app",
    "netlify.app",
    "herokuapp.com",
    "web.app",
    "firebaseapp.com",
    "framer.app",
    "framer.website",
    "webflow.io",
    "wixsite.com",
    "blogspot.com",
    "appspot.com",
    "azurewebsites.net",
    "cloudfront.net",
    "glitch.me",
    "fly.dev",
    "onrender.com",
    "replit.app",
    "ngrok.io",
    "ngrok-free.app",
    "trycloudflare.com",
    "surge.sh",
    "myshopify.com",
    "notion.site",
    "carrd.co",
];

/// The site a host belongs to (its registrable domain): "framer.com" for
/// "app.framer.com", "bbc.co.uk" for "www.bbc.co.uk", "me.github.io" for
/// "me.github.io". Addresses and single names (localhost) are themselves.
pub(crate) fn registrable_domain(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<std::net::Ipv4Addr>().is_ok() || host.contains(':') || host.starts_with('[') {
        return host;
    }
    let labels: Vec<&str> = host.split('.').filter(|label| !label.is_empty()).collect();
    if labels.len() < 2 {
        return host;
    }
    let suffix = SHARED_SUFFIXES
        .iter()
        .filter(|suffix| host == **suffix || host.ends_with(&format!(".{suffix}")))
        .map(|suffix| suffix.split('.').count())
        .max()
        .unwrap_or(1);
    let keep = (suffix + 1).min(labels.len());
    labels[labels.len() - keep..].join(".")
}

/// A long host shortened from the left, so its site stays readable:
/// "…very.long.name.framer.com".
pub(crate) fn shorten_host(host: &str, limit: usize) -> String {
    let count = host.chars().count();
    if count <= limit || limit < 2 {
        return host.to_owned();
    }
    let tail: String = host.chars().skip(count - (limit - 1)).collect();
    let tail = match tail.find('.') {
        Some(dot) if dot + 1 < tail.len() && tail.len() - dot > limit / 2 => &tail[dot..],
        _ => tail.as_str(),
    };
    format!("\u{2026}{tail}")
}

pub(crate) fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let value = bytes as f64;
    if value < KB {
        format!("{bytes} bytes")
    } else if value < KB * KB {
        format!("{:.0} KB", (value / KB).max(1.0))
    } else {
        format!("{:.1} MB", value / KB / KB)
    }
}

/// What the presence bar shows about one upload: the site, every file with
/// its folder, and the total size.
pub(crate) fn prompt(files: &[UploadFile], host: &str) -> crate::desktop_presence::UploadPrompt {
    crate::desktop_presence::UploadPrompt::new(
        &registrable_domain(host),
        host,
        files
            .iter()
            .map(|file| (file.name.clone(), file.folder.clone()))
            .collect(),
        &human_size(files.iter().map(|file| file.bytes).sum()),
    )
}

/// Upload copies Aven made, by folder: in progress until the page side ends,
/// then kept briefly for the page to read.
struct Registered {
    dir: PathBuf,
    scope: Option<String>,
    kept_at: Option<Instant>,
}

fn registry() -> &'static Mutex<Vec<Registered>> {
    static REGISTRY: OnceLock<Mutex<Vec<Registered>>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

fn private_dir(path: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Private copies of the files the user is asked about, in a folder only this
/// user can read. Dropped copies are deleted; `keep` hands them to the page.
pub(crate) struct UploadCopies {
    dir: PathBuf,
    files: Vec<UploadFile>,
    kept: bool,
}

impl UploadCopies {
    /// Copies each file into `root/<random>/<n>/<name>`, keeping its name
    /// (the site sees it) and refusing a file that changes while copied.
    pub(crate) fn create(root: &Path, files: &[UploadFile]) -> Result<Self, String> {
        use std::io::Read;
        private_dir(root).map_err(|error| format!("Could not prepare the upload: {error}"))?;
        let dir = root.join(uuid::Uuid::new_v4().simple().to_string());
        private_dir(&dir).map_err(|error| format!("Could not prepare the upload: {error}"))?;
        registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(Registered {
                dir: dir.clone(),
                scope: None,
                kept_at: None,
            });
        let mut copies = Self {
            dir,
            files: Vec::new(),
            kept: false,
        };
        for (index, file) in files.iter().enumerate() {
            let folder = copies.dir.join(index.to_string());
            private_dir(&folder)
                .map_err(|error| format!("Could not prepare the upload: {error}"))?;
            let target = folder.join(&file.name);
            let mut source = open_regular(Path::new(&file.path))
                .map_err(|error| format!("Could not read {}: {error}", file.name))?;
            let metadata = source
                .metadata()
                .map_err(|error| format!("Could not read {}: {error}", file.name))?;
            if !metadata.is_file() || metadata.len() != file.bytes {
                return Err(format!(
                    "{} changed after it was checked; nothing was uploaded.",
                    file.name
                ));
            }
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut output = options
                .open(&target)
                .map_err(|error| format!("Could not prepare {}: {error}", file.name))?;
            let copied = std::io::copy(&mut (&mut source).take(MAX_FILE_BYTES + 1), &mut output)
                .map_err(|error| format!("Could not copy {}: {error}", file.name))?;
            if copied != file.bytes {
                return Err(format!(
                    "{} changed while Aven copied it; nothing was uploaded.",
                    file.name
                ));
            }
            copies.files.push(UploadFile {
                path: target
                    .to_str()
                    .ok_or("The upload folder is not a valid UTF-8 path.")?
                    .to_owned(),
                bytes: copied,
                ..file.clone()
            });
        }
        Ok(copies)
    }

    /// The copies, named and sized as the user is shown them; `folder` is
    /// where each original lives.
    pub(crate) fn files(&self) -> &[UploadFile] {
        &self.files
    }

    /// The page may have received them: keep them until `scope`'s chat ends,
    /// Aven quits, or `KEEP_COPIES` passes.
    pub(crate) fn keep(mut self, scope: &str) {
        self.kept = true;
        let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
        if let Some(entry) = registry.iter_mut().find(|entry| entry.dir == self.dir) {
            entry.scope = Some(scope.into());
            entry.kept_at = Some(Instant::now());
        }
    }
}

impl Drop for UploadCopies {
    fn drop(&mut self) {
        if self.kept {
            return;
        }
        let _ = std::fs::remove_dir_all(&self.dir);
        registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|entry| entry.dir != self.dir);
    }
}

/// Removes kept copies older than an hour, and any folder under `root` this
/// run does not know (left by a run that quit unexpectedly).
pub(crate) fn sweep(root: &Path) {
    sweep_older(root, KEEP_COPIES);
}

fn sweep_older(root: &Path, age: Duration) {
    let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
    registry.retain(|entry| {
        let expired = entry.kept_at.is_some_and(|kept| kept.elapsed() >= age);
        if expired {
            let _ = std::fs::remove_dir_all(&entry.dir);
        }
        !expired
    });
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !registry.iter().any(|known| known.dir == path) {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
}

/// A chat's browser access ended (or, with None, Aven is quitting): delete
/// the copies it uploaded.
pub(crate) fn forget(scope: Option<&str>) {
    registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .retain(|entry| {
            let ends = entry.kept_at.is_some()
                && scope.is_none_or(|scope| entry.scope.as_deref() == Some(scope));
            if ends {
                let _ = std::fs::remove_dir_all(&entry.dir);
            }
            !ends
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Folder(PathBuf);
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn folder(name: &str) -> Folder {
        let path =
            std::env::temp_dir().join(format!("aven-upload-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Folder(std::fs::canonicalize(&path).unwrap())
    }
    fn text(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    #[test]
    fn upload_files_are_existing_readable_regular_files_within_bounds() {
        let directory = folder("bounds");
        let path = |name: &str| text(&directory.0.join(name));
        std::fs::write(path("llms.txt"), "# Site\n").unwrap();
        std::fs::write(path("logo.svg"), "<svg/>").unwrap();
        let files = check_files_in(&[path("llms.txt"), path("logo.svg")], None).unwrap();
        assert_eq!(
            files,
            vec![
                UploadFile {
                    path: path("llms.txt"),
                    name: "llms.txt".into(),
                    folder: text(&directory.0),
                    bytes: 7
                },
                UploadFile {
                    path: path("logo.svg"),
                    name: "logo.svg".into(),
                    folder: text(&directory.0),
                    bytes: 6
                },
            ]
        );
        // The same file twice is sent once.
        assert_eq!(
            check_files_in(&[path("llms.txt"), path("llms.txt")], None)
                .unwrap()
                .len(),
            1
        );
        #[cfg(unix)]
        {
            // A link is shown and sent as its target.
            std::os::unix::fs::symlink(path("llms.txt"), path("link.txt")).unwrap();
            let linked = check_files_in(&[path("link.txt")], None).unwrap();
            assert_eq!(linked[0].path, path("llms.txt"));
            assert_eq!(linked[0].name, "llms.txt");
            // Pipes and other special files are refused without blocking.
            let fifo = std::ffi::CString::new(path("pipe")).unwrap();
            assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
            assert!(check_files_in(&[path("pipe")], None)
                .unwrap_err()
                .contains("not a regular file"));
            assert!(check_files_in(&["/dev/null".into()], None)
                .unwrap_err()
                .contains("not a regular file"));
        }
        assert!(check_files_in(&[text(&directory.0)], None)
            .unwrap_err()
            .contains("not a regular file"));
        assert!(check_files_in(&[path("missing.txt")], None)
            .unwrap_err()
            .contains("Could not find missing.txt"));
        assert!(check_files_in(&["relative.txt".into()], None).is_err());
        assert!(check_files_in(&[], None).is_err());
        assert!(check_files_in(&vec![path("llms.txt"); 11], None).is_err());
        // Size bounds (sparse files: nothing is written).
        std::fs::File::create(path("huge.bin"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(check_files_in(&[path("huge.bin")], None)
            .unwrap_err()
            .contains("larger than 256 MB"));
        for name in ["a.bin", "b.bin", "c.bin"] {
            std::fs::File::create(path(name))
                .unwrap()
                .set_len(200 * 1024 * 1024)
                .unwrap();
        }
        assert!(
            check_files_in(&[path("a.bin"), path("b.bin"), path("c.bin")], None)
                .unwrap_err()
                .contains("larger than 512 MB together")
        );
    }

    #[test]
    fn hidden_folders_keychains_and_secret_names_are_never_offered() {
        let home = folder("home");
        let path = |relative: &str| {
            let path = home.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "secret").unwrap();
            text(&path)
        };
        for (relative, reason) in [
            (".ssh/config", "hidden folder"),
            (".aws/credentials", "hidden folder"),
            (".config/gh/hosts.yml", "hidden folder"),
            ("Developer/.worktrees/site/llms.txt", "hidden folder"),
            ("Library/Keychains/login.keychain-db", "Keychains folder"),
            ("Downloads/id_rsa", "looks like a secret"),
            ("Downloads/id_ed25519_work", "looks like a secret"),
            ("Downloads/server.pem", "looks like a secret"),
            ("Downloads/TLS.KEY", "looks like a secret"),
            ("Downloads/.env", "looks like a secret"),
            ("Downloads/.env.production", "looks like a secret"),
            ("Downloads/.netrc", "looks like a secret"),
        ] {
            let error = check_files_in(&[path(relative)], Some(&home.0)).unwrap_err();
            assert!(error.contains(reason), "{relative}: {error}");
            assert!(
                error.contains("Ask the user to upload it themselves"),
                "{error}"
            );
        }
        // A link from a visible folder into a hidden one is refused by its target.
        #[cfg(unix)]
        {
            let secret = path(".ssh/notes.txt");
            let link = home.0.join("Downloads/notes.txt");
            std::os::unix::fs::symlink(&secret, &link).unwrap();
            assert!(check_files_in(&[text(&link)], Some(&home.0))
                .unwrap_err()
                .contains("hidden folder"));
        }
        // Ordinary files are fine, including public keys and names that only
        // resemble a key.
        for relative in [
            "Downloads/llms.txt",
            "Downloads/id_rsa.pub",
            "Downloads/identity.png",
            "Documents/keynote.pdf",
        ] {
            let file = &check_files_in(&[path(relative)], Some(&home.0)).unwrap()[0];
            assert!(file.folder.starts_with("~/"), "{}", file.folder);
        }
        // Outside the home folder only names count.
        let other = folder("outside");
        std::fs::create_dir_all(other.0.join(".cache")).unwrap();
        std::fs::write(other.0.join(".cache/page.html"), "x").unwrap();
        assert!(check_files_in(&[text(&other.0.join(".cache/page.html"))], Some(&home.0)).is_ok());
    }

    #[test]
    fn copies_are_private_exact_and_deleted_unless_kept() {
        let source = folder("source");
        let root = folder("copies");
        let original = source.0.join("llms.txt");
        std::fs::write(&original, "# Site\n").unwrap();
        let files = check_files_in(&[text(&original)], None).unwrap();
        let copies = UploadCopies::create(&root.0, &files).unwrap();
        let copy = PathBuf::from(&copies.files()[0].path);
        assert_eq!(copy.file_name().unwrap(), "llms.txt");
        assert_ne!(copy, original);
        assert_eq!(std::fs::read(&copy).unwrap(), b"# Site\n");
        assert_eq!(copies.files()[0].bytes, 7);
        assert_eq!(copies.files()[0].folder, files[0].folder);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&copy), 0o600);
            assert_eq!(mode(copy.parent().unwrap()), 0o700);
            assert_eq!(mode(copy.parent().unwrap().parent().unwrap()), 0o700);
        }
        // Changing the original afterwards never changes what was approved.
        std::fs::write(&original, "# Changed and longer\n").unwrap();
        assert_eq!(std::fs::read(&copy).unwrap(), b"# Site\n");
        // A file that changed since it was checked is refused.
        assert!(UploadCopies::create(&root.0, &files)
            .err()
            .unwrap()
            .contains("changed after it was checked"));
        let folder_of = copy.parent().unwrap().parent().unwrap().to_owned();
        drop(copies);
        assert!(
            !folder_of.exists(),
            "declined or failed uploads leave nothing"
        );

        // Kept copies last until their chat ends, an hour passes, or Aven quits.
        let files = check_files_in(&[text(&original)], None).unwrap();
        let kept = UploadCopies::create(&root.0, &files).unwrap();
        let kept_folder = PathBuf::from(&kept.files()[0].path)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_owned();
        kept.keep("chat-a");
        let leftover = root.0.join("left-by-an-earlier-run");
        std::fs::create_dir_all(&leftover).unwrap();
        sweep(&root.0);
        assert!(kept_folder.exists());
        assert!(!leftover.exists());
        forget(Some("chat-b"));
        assert!(kept_folder.exists());
        forget(Some("chat-a"));
        assert!(!kept_folder.exists());
        let again = UploadCopies::create(&root.0, &files).unwrap();
        let again_folder = PathBuf::from(&again.files()[0].path)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_owned();
        again.keep("chat-a");
        sweep_older(&root.0, Duration::ZERO);
        assert!(!again_folder.exists());
        // An upload still waiting for the user is never swept away.
        let waiting = UploadCopies::create(&root.0, &files).unwrap();
        sweep_older(&root.0, Duration::ZERO);
        assert!(Path::new(&waiting.files()[0].path).exists());
        let quitting = UploadCopies::create(&root.0, &files).unwrap();
        let quitting_path = PathBuf::from(&quitting.files()[0].path);
        quitting.keep("chat-c");
        forget(None);
        assert!(!quitting_path.exists());
        drop(waiting);
    }

    #[test]
    fn the_site_is_its_registrable_domain_and_long_hosts_keep_their_end() {
        for (host, site) in [
            ("framer.com", "framer.com"),
            ("app.framer.com", "framer.com"),
            ("WWW.BBC.CO.UK.", "bbc.co.uk"),
            ("shop.example.com.au", "example.com.au"),
            ("me.github.io", "me.github.io"),
            ("a.b.me.github.io", "me.github.io"),
            ("project.vercel.app", "project.vercel.app"),
            ("localhost", "localhost"),
            ("127.0.0.1", "127.0.0.1"),
            ("[::1]", "[::1]"),
            ("co.uk", "co.uk"),
        ] {
            assert_eq!(registrable_domain(host), site, "{host}");
        }
        assert_eq!(shorten_host("framer.com", 40), "framer.com");
        let long = "login.accounts.secure-update.example-really-long-subdomain.framer.com";
        let short = shorten_host(long, 40);
        assert!(
            short.starts_with('\u{2026}') && short.ends_with(".framer.com"),
            "{short}"
        );
        assert!(short.chars().count() <= 40);
    }

    #[test]
    fn the_prompt_lists_every_file_with_its_folder_and_the_whole_size() {
        let file = |name: &str, folder: &str, bytes: u64| UploadFile {
            path: format!("/x/{name}"),
            name: name.into(),
            folder: folder.into(),
            bytes,
        };
        let files: Vec<_> = (0..10)
            .map(|index| {
                file(
                    &format!("photo-{index}.png"),
                    "~/Pictures/Trip",
                    1024 * 1024,
                )
            })
            .collect();
        let prompt = prompt(&files, "assets.app.framer.com");
        assert_eq!(prompt.site, "framer.com");
        assert_eq!(prompt.host, "assets.app.framer.com");
        assert_eq!(prompt.files.len(), 10);
        assert_eq!(
            prompt.files[9],
            ("photo-9.png".into(), "~/Pictures/Trip".into())
        );
        assert_eq!(prompt.size, "10.0 MB");
        assert_eq!(human_size(30), "30 bytes");
        assert_eq!(human_size(3 * 1024), "3 KB");
    }
}
