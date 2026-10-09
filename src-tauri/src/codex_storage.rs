//! Aven owns Codex conversation state while reusing the user's provider setup.
//!
//! Never link history, databases, writer locks, or generated output into the
//! shared Codex home. Legacy resumes import only the requested rollout.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

static PREPARING: Mutex<()> = Mutex::new(());
const MAX_SCAN_ENTRIES: usize = 100_000;
const MAX_ROLLOUT_BYTES: u64 = 256 * 1024 * 1024;
const SHARED_RESOURCES: &[&str] = &[
    "AGENTS.md",
    "AGENTS.override.md",
    "auth.json",
    "config.toml",
    "hooks.json",
    ".credentials.json",
    "mcp-auth.json",
    "skills",
    "plugins",
    "memories",
    "rules",
    "agents",
    "instructions",
    "prompts",
    "model-catalogs",
    "themes",
    "mcp-oauth-locks",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStorage {
    pub home: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_path: Option<String>,
}

#[tauri::command(async)]
pub fn harness_prepare_codex_storage(
    caller: tauri::Webview,
    app: AppHandle,
    thread_id: Option<String>,
) -> Result<CodexStorage, String> {
    crate::browser::label(&caller, "agent-check")?;
    prepare(&app, thread_id.as_deref())
}

pub(crate) fn prepare(app: &AppHandle, thread_id: Option<&str>) -> Result<CodexStorage, String> {
    let source = shared_home()?;
    let private = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("codex-home");
    prepare_at(&source, &private, thread_id)
}

fn shared_home() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err("Codex history isolation requires an absolute CODEX_HOME path".into());
        }
        return Ok(path);
    }
    crate::dirs_home()
        .map(|home| PathBuf::from(home).join(".codex"))
        .ok_or_else(|| "Cannot locate the user's Codex configuration".into())
}

/// Apply this only to the provider's app-server, never shell/terminal commands.
pub(crate) fn is_codex_app_server(command: &str, args: &[String]) -> bool {
    let name = Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    (name.eq_ignore_ascii_case("codex") || name.eq_ignore_ascii_case("codex.exe"))
        && args.iter().any(|arg| arg == "app-server")
}

pub(crate) fn configure(cmd: &mut Command, storage: &CodexStorage) {
    cmd.env("CODEX_HOME", &storage.home);
    cmd.env("CODEX_SQLITE_HOME", &storage.home);
    // A configured sqlite_home wins over CODEX_SQLITE_HOME. Override it only
    // for this process; never edit the shared user configuration.
    cmd.args([
        "-c",
        &format!(
            "sqlite_home={}",
            serde_json::to_string(&storage.home).unwrap()
        ),
    ]);
    cmd.args([
        "-c",
        &format!(
            "log_dir={}",
            serde_json::to_string(&Path::new(&storage.home).join("log")).unwrap()
        ),
    ]);
}

fn prepare_at(
    source: &Path,
    private: &Path,
    thread_id: Option<&str>,
) -> Result<CodexStorage, String> {
    if let Some(id) = thread_id {
        validate_thread_id(id)?;
    }
    let _guard = PREPARING.lock().map_err(|_| "Codex storage is locked")?;
    ensure_private_directory(private)?;
    let private = private.canonicalize().map_err(|e| e.to_string())?;
    let source = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    if private.starts_with(&source) || source.starts_with(&private) {
        return Err(
            "Aven Codex history must be stored separately from the shared Codex home".into(),
        );
    }
    for name in [
        "sessions",
        "archived_sessions",
        "generated_images",
        "sqlite",
        // The encryption key for this directory is scoped to CODEX_HOME.
        // Never share ciphertext with a provider using a different home key.
        "secrets",
    ] {
        ensure_private_directory(&private.join(name))?;
    }
    share_setup(&source, &private)?;
    let resume_path = thread_id
        .map(|id| import_requested_rollout(&source, &private, id))
        .transpose()?
        .flatten();
    Ok(CodexStorage {
        home: crate::fs::path_to_js(&private),
        resume_path: resume_path.map(|path| crate::fs::path_to_js(&path)),
    })
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_redirect(&metadata) || !metadata.is_dir() => {
            return Err(format!(
                "Aven Codex storage is not a private directory: {}",
                path.display()
            ));
        }
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn share_setup(source: &Path, private: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(source.join(".credentials.json")) {
        if is_redirect(&metadata) || !metadata.is_file() {
            return Err("Codex MCP credentials must be a regular provider file; no credentials or history were changed".into());
        }
        if !source.join("mcp-oauth-locks").is_dir() {
            // Only create an empty coordination directory. Credential bytes,
            // user settings, and shared conversations remain unchanged.
            ensure_private_directory(&source.join("mcp-oauth-locks"))?;
        }
    }
    let mut names: BTreeSet<String> = SHARED_RESOURCES.iter().map(|name| (*name).into()).collect();
    let mut configs = Vec::new();
    if source.is_dir() {
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "config.toml" || name.ends_with(".config.toml") {
                names.insert(name);
                configs.push(entry.path());
            }
        }
    }
    for config_path in configs {
        let text = fs::read_to_string(&config_path)
            .map_err(|_| "Cannot read the user's Codex configuration")?;
        let config: toml::Value = toml::from_str(&text)
            .map_err(|_| "Cannot parse the user's Codex configuration for history isolation")?;
        let auth_store = config
            .get("cli_auth_credentials_store")
            .and_then(toml::Value::as_str);
        if config_path
            .file_name()
            .is_some_and(|name| name == "config.toml")
            && matches!(auth_store, Some("keyring" | "auto"))
        {
            // Codex keys its keyring entry by canonical CODEX_HOME. Do not
            // silently lose the login or fall back to shared conversation state.
            return Err("Aven cannot isolate Codex history while preserving keyring or auto authentication yet. Your Codex login and history are unchanged.".into());
        }
        collect_relative_assets(&config, source, &mut names)?;
    }
    for name in names {
        let origin = source.join(&name);
        if origin.exists() {
            let destination = private.join(&name);
            if name == ".credentials.json" {
                // Codex deliberately rejects symbolic links when writing MCP
                // fallback credentials. A hardlink retains shared refreshes.
                share_hardlink(&origin, &destination)?;
            } else {
                share_link(&origin, &destination)?;
            }
        } else {
            remove_missing_managed_file(&origin, &private.join(&name))?;
        }
    }
    Ok(())
}

fn collect_relative_assets(
    value: &toml::Value,
    source: &Path,
    names: &mut BTreeSet<String>,
) -> Result<(), String> {
    match value {
        toml::Value::String(value) => {
            let path = Path::new(value);
            if !path.is_absolute() && source.join(path).exists() {
                if path
                    .components()
                    .any(|component| component == Component::ParentDir)
                {
                    return Err("Codex configuration uses a relative asset outside its home; use an absolute asset path for isolated Aven history".into());
                }
                if let Some(Component::Normal(name)) = path
                    .components()
                    .find(|component| *component != Component::CurDir)
                {
                    let name = name.to_string_lossy().into_owned();
                    if private_state_name(&name) {
                        return Err("Codex configuration references private provider state that Aven cannot safely share".into());
                    }
                    names.insert(name);
                }
            }
        }
        toml::Value::Array(values) => {
            for value in values {
                collect_relative_assets(value, source, names)?;
            }
        }
        toml::Value::Table(values) => {
            for (key, value) in values {
                // These are overridden for the child rather than shared.
                if !matches!(key.as_str(), "sqlite_home" | "log_dir") {
                    collect_relative_assets(value, source, names)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn private_state_name(name: &str) -> bool {
    matches!(
        name,
        "sessions"
            | "archived_sessions"
            | "sqlite"
            | "secrets"
            | "history.jsonl"
            | "session_index.jsonl"
            | "generated_images"
            | "attachments"
            | "log"
            | "logs"
            | "tmp"
            | "cache"
            | "shell_snapshots"
            | "thread-writer-locks"
            | "rollout-migrations"
            | "ipc"
            | "app-server-control"
            | "app-server-daemon"
            | "process_manager"
            | "node_repl"
    ) || name.ends_with(".jsonl")
        || name.contains(".sqlite")
}

fn share_link(origin: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    if origin.is_file() {
        // Hardlinks/junctions need no symbolic-link privilege on Windows.
        return share_hardlink(origin, destination);
    }
    match fs::symlink_metadata(destination) {
        Ok(metadata) if is_redirect(&metadata) => {
            let destination_target = destination
                .canonicalize()
                .map_err(|_| "Cannot verify Aven's shared Codex setup link")?;
            let origin_target = origin
                .canonicalize()
                .map_err(|_| "Cannot verify the user's shared Codex setup")?;
            if destination_target == origin_target {
                return Ok(());
            }
            return Err(
                "Aven Codex setup points to a different provider home; no files were replaced"
                    .into(),
            );
        }
        Ok(_) => {
            return Err(
                "Aven Codex setup contains a local file; no provider configuration was replaced"
                    .into(),
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(origin, destination);
    #[cfg(windows)]
    let result = junction::create(origin, destination);
    #[cfg(not(any(unix, windows)))]
    let result: std::io::Result<()> = Err(std::io::Error::other(
        "Shared provider setup links are unsupported",
    ));
    result.map_err(|_| "Cannot share Codex provider setup with Aven's private history; shared history was not used".into())
}

fn is_redirect(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn same_file(first: &Path, second: &Path) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let first = fs::metadata(first).map_err(|e| e.to_string())?;
        let second = fs::metadata(second).map_err(|e| e.to_string())?;
        Ok(first.dev() == second.dev() && first.ino() == second.ino())
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        fn identity(path: &Path) -> Result<(u32, u32, u32), String> {
            let file = File::open(path).map_err(|e| e.to_string())?;
            let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let info = unsafe { info.assume_init() };
            Ok((
                info.dwVolumeSerialNumber,
                info.nFileIndexHigh,
                info.nFileIndexLow,
            ))
        }
        Ok(identity(first)? == identity(second)?)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (first, second);
        Err("Shared provider files are unsupported".into())
    }
}

fn managed_files(destination: &Path) -> Result<(PathBuf, BTreeMap<String, String>), String> {
    let marker = destination
        .parent()
        .ok_or("Invalid shared Codex setup location")?
        .join(".aven-shared-files.json");
    if let Ok(metadata) = fs::symlink_metadata(&marker) {
        if is_redirect(&metadata) || !metadata.is_file() {
            return Err("Aven Codex setup metadata must be a private file".into());
        }
    }
    let files = match fs::read(&marker) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Aven Codex setup metadata")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(error) => return Err(error.to_string()),
    };
    Ok((marker, files))
}

fn share_hardlink(origin: &Path, destination: &Path) -> Result<(), String> {
    let (marker, mut files) = managed_files(destination)?;
    let name = destination
        .file_name()
        .ok_or("Invalid shared Codex setup filename")?
        .to_string_lossy()
        .into_owned();
    let source = crate::fs::path_to_js(origin);
    match fs::symlink_metadata(destination) {
        Ok(metadata) if is_redirect(&metadata) => {
            let destination_target = destination
                .canonicalize()
                .map_err(|_| "Cannot verify Aven's shared Codex credential link")?;
            let origin_target = origin
                .canonicalize()
                .map_err(|_| "Cannot verify the user's shared Codex credential file")?;
            if destination_target != origin_target {
                return Err("Aven Codex credentials point to a different provider home; no files were replaced".into());
            }
            fs::remove_file(destination).map_err(|e| e.to_string())?;
        }
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err("Aven Codex shared setup is not a file".into());
            }
            if same_file(origin, destination)? {
                files.insert(name, source);
                fs::write(marker, serde_json::to_vec(&files).unwrap())
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
            if files.get(&name) != Some(&source) {
                return Err("Aven Codex setup contains a local file; no provider configuration was replaced".into());
            }
            // The source may have been atomically replaced by the provider or
            // editor. Refresh only a link Aven previously recorded as managed.
            fs::remove_file(destination).map_err(|e| e.to_string())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let origin = origin.canonicalize().map_err(|e| e.to_string())?;
    fs::hard_link(origin, destination).map_err(|_| "Cannot share Codex provider files across these volumes; shared conversation history was not used")?;
    files.insert(name, source);
    fs::write(marker, serde_json::to_vec(&files).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_missing_managed_file(origin: &Path, destination: &Path) -> Result<(), String> {
    let (marker, mut files) = managed_files(destination)?;
    let name = destination
        .file_name()
        .ok_or("Invalid shared Codex setup filename")?
        .to_string_lossy()
        .into_owned();
    if files.get(&name) == Some(&crate::fs::path_to_js(origin)) {
        // Reflect source logout/removal; never retain a stale credential copy.
        match fs::remove_file(destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        files.remove(&name);
        fs::write(marker, serde_json::to_vec(&files).unwrap()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_thread_id(id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid Codex conversation ID".into());
    }
    Ok(())
}

fn find_rollout(home: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    let suffix = format!("-{id}.jsonl");
    let mut pending = vec![home.join("sessions"), home.join("archived_sessions")];
    let mut scanned = 0;
    while let Some(directory) = pending.pop() {
        if !directory.exists() {
            continue;
        }
        let metadata = fs::symlink_metadata(&directory).map_err(|e| e.to_string())?;
        if is_redirect(&metadata) {
            continue;
        }
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                return Err("Codex history lookup exceeded its safe limit".into());
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() && entry.file_name().to_string_lossy().ends_with(&suffix) {
                verify_rollout(&entry.path(), id)?;
                return Ok(Some(entry.path()));
            }
        }
    }
    Ok(None)
}

fn verify_rollout(path: &Path, id: &str) -> Result<(), String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_ROLLOUT_BYTES {
        return Err("Codex conversation is too large to import safely".into());
    }
    let mut first = String::new();
    BufReader::new(File::open(path).map_err(|e| e.to_string())?)
        .take(1024 * 1024)
        .read_line(&mut first)
        .map_err(|_| "Cannot read Codex conversation metadata")?;
    let meta: serde_json::Value =
        serde_json::from_str(&first).map_err(|_| "Invalid Codex conversation metadata")?;
    if meta.get("type").and_then(|value| value.as_str()) != Some("session_meta")
        || meta
            .get("payload")
            .and_then(|value| value.get("id"))
            .and_then(|value| value.as_str())
            != Some(id)
    {
        return Err("Codex conversation metadata does not match its requested ID".into());
    }
    Ok(())
}

fn import_requested_rollout(
    source: &Path,
    private: &Path,
    id: &str,
) -> Result<Option<PathBuf>, String> {
    // An Aven conversation may have advanced after import. Never overwrite it
    // with an older shared rollout, even if the original still exists.
    if let Some(path) = find_rollout(private, id)? {
        return Ok(Some(path));
    }
    let Some(origin) = find_rollout(source, id)? else {
        return Ok(None);
    };
    let relative = origin
        .strip_prefix(source)
        .map_err(|_| "Invalid Codex history location")?;
    let destination = private.join(relative);
    if let Some(parent) = destination.parent() {
        // Check every component; checking only the final directory would miss
        // a symlink at sessions/<year> that redirects the copy into shared data.
        let relative_parent = parent
            .strip_prefix(private)
            .map_err(|_| "Invalid private Codex history location")?;
        let mut directory = private.to_path_buf();
        for component in relative_parent.components() {
            if let Component::Normal(component) = component {
                directory.push(component);
                ensure_private_directory(&directory)?;
            } else {
                return Err("Invalid private Codex history location".into());
            }
        }
    }
    let temporary = destination.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    let copied = (|| {
        let before = fs::metadata(&origin).map_err(|e| e.to_string())?;
        fs::copy(&origin, &temporary)
            .map_err(|_| "Cannot copy the requested Codex conversation")?;
        let after = fs::metadata(&origin).map_err(|e| e.to_string())?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("The original Codex conversation changed during import; retry when its turn finishes".into());
        }
        verify_rollout(&temporary, id)?;
        fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        Ok(Some(destination))
    })();
    if temporary.exists() {
        let _ = fs::remove_file(temporary);
    }
    copied
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "019d0430-9886-7ff3-b132-ab15e9127141";
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("aven-codex-storage-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(path.join("shared")).unwrap();
            fs::create_dir(path.join("shared/mcp-oauth-locks")).unwrap();
            Self(path)
        }
        fn source(&self) -> PathBuf {
            self.0.join("shared")
        }
        fn private(&self) -> PathBuf {
            self.0.join("private")
        }
        fn rollout(&self, id: &str) -> PathBuf {
            let path = self
                .source()
                .join("sessions/2026/10/08")
                .join(format!("rollout-2026-10-08T10-00-00-{id}.jsonl"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, format!("{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{id}\"}}}}\n{{\"type\":\"response_item\"}}\n")).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn only_codex_app_servers_are_isolated() {
        assert!(is_codex_app_server("/bin/codex", &["app-server".into()]));
        assert!(is_codex_app_server("codex.exe", &["app-server".into()]));
        assert!(!is_codex_app_server("/bin/codex", &["exec".into()]));
        assert!(!is_codex_app_server("/bin/claude", &["app-server".into()]));
    }

    #[test]
    fn process_overrides_keep_config_and_database_state_private() {
        let mut cmd = Command::new("codex");
        configure(
            &mut cmd,
            &CodexStorage {
                home: "/private/codex".into(),
                resume_path: None,
            },
        );
        let env: std::collections::HashMap<_, _> = cmd.get_envs().collect();
        assert_eq!(
            env.get(std::ffi::OsStr::new("CODEX_HOME"))
                .unwrap()
                .unwrap(),
            "/private/codex"
        );
        assert_eq!(
            env.get(std::ffi::OsStr::new("CODEX_SQLITE_HOME"))
                .unwrap()
                .unwrap(),
            "/private/codex"
        );
        assert!(cmd
            .get_args()
            .any(|arg| arg == "sqlite_home=\"/private/codex\""));
    }

    #[test]
    fn setup_and_relative_assets_are_shared_but_history_is_private() {
        let fixture = Fixture::new();
        let source = fixture.source();
        fs::create_dir(source.join("custom-assets")).unwrap();
        fs::write(source.join("custom-assets/instructions.md"), "custom rules").unwrap();
        fs::write(
            source.join("config.toml"),
            "model_instructions_file = './custom-assets/instructions.md'\nsqlite_home = 'sqlite'\nlog_dir = 'log'\n",
        )
        .unwrap();
        fs::create_dir(source.join("sqlite")).unwrap();
        fs::create_dir(source.join("log")).unwrap();
        fs::write(source.join("auth.json"), "synthetic auth").unwrap();
        fs::write(source.join(".credentials.json"), "synthetic mcp auth").unwrap();
        fs::write(source.join("history.jsonl"), "other history").unwrap();
        fs::write(source.join("state_5.sqlite"), "other database").unwrap();
        prepare_at(&source, &fixture.private(), None).unwrap();
        assert_eq!(
            fs::read_to_string(fixture.private().join("custom-assets/instructions.md")).unwrap(),
            "custom rules"
        );
        assert!(fixture.private().join(".credentials.json").exists());
        assert!(!fixture.private().join("history.jsonl").exists());
        assert!(!fixture.private().join("state_5.sqlite").exists());
        assert!(!fs::symlink_metadata(fixture.private().join("sessions"))
            .unwrap()
            .file_type()
            .is_symlink());
        // Provider refresh opens auth.json with truncate/write, following the
        // link; no duplicate refresh token is created by storage preparation.
        fs::write(
            fixture.private().join("auth.json"),
            "synthetic refreshed auth",
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(source.join("auth.json")).unwrap(),
            "synthetic refreshed auth"
        );
        prepare_at(&source, &fixture.private(), None).unwrap();
    }

    #[test]
    fn encrypted_secrets_are_private_and_never_modify_the_source_store() {
        let fixture = Fixture::new();
        let source = fixture.source().join("secrets");
        fs::create_dir(&source).unwrap();
        let original = b"synthetic ciphertext encrypted for the shared home";
        fs::write(source.join("mcp_oauth.age"), original).unwrap();

        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        let private = fixture.private().join("secrets");
        let metadata = fs::symlink_metadata(&private).unwrap();
        assert!(metadata.is_dir());
        assert!(!is_redirect(&metadata));
        assert_ne!(
            private.canonicalize().unwrap(),
            source.canonicalize().unwrap()
        );
        assert_eq!(fs::read_dir(&private).unwrap().count(), 0);

        let isolated = b"synthetic ciphertext encrypted for the private home";
        fs::write(private.join("mcp_oauth.age"), isolated).unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert_eq!(fs::read(source.join("mcp_oauth.age")).unwrap(), original);
        assert_eq!(fs::read(private.join("mcp_oauth.age")).unwrap(), isolated);
        assert_eq!(fs::read_dir(&source).unwrap().count(), 1);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn existing_private_secrets_redirect_is_rejected_without_touching_source() {
        let fixture = Fixture::new();
        let source = fixture.source().join("secrets");
        fs::create_dir(&source).unwrap();
        let original = b"synthetic source ciphertext";
        fs::write(source.join("mcp_oauth.age"), original).unwrap();
        fs::create_dir(fixture.private()).unwrap();
        let private = fixture.private().join("secrets");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &private).unwrap();
        #[cfg(windows)]
        junction::create(&source, &private).unwrap();

        let error = prepare_at(&fixture.source(), &fixture.private(), None).unwrap_err();
        assert!(error.contains("not a private directory"));
        assert!(is_redirect(&fs::symlink_metadata(&private).unwrap()));
        assert_eq!(fs::read(source.join("mcp_oauth.age")).unwrap(), original);
        assert_eq!(fs::read_dir(&source).unwrap().count(), 1);
    }

    #[test]
    fn relative_assets_cannot_reintroduce_shared_secrets() {
        let fixture = Fixture::new();
        let source = fixture.source().join("secrets");
        fs::create_dir(&source).unwrap();
        let original = b"synthetic source ciphertext";
        fs::write(source.join("mcp_oauth.age"), original).unwrap();
        let config = "model_instructions_file = 'secrets/mcp_oauth.age'\n";
        fs::write(fixture.source().join("config.toml"), config).unwrap();

        assert!(prepare_at(&fixture.source(), &fixture.private(), None)
            .unwrap_err()
            .contains("private provider state"));
        assert!(!is_redirect(
            &fs::symlink_metadata(fixture.private().join("secrets")).unwrap()
        ));
        assert_eq!(fs::read(source.join("mcp_oauth.age")).unwrap(), original);
        assert_eq!(
            fs::read_to_string(fixture.source().join("config.toml")).unwrap(),
            config
        );
    }

    #[test]
    fn imports_only_requested_thread_and_preserves_advanced_private_copy() {
        let fixture = Fixture::new();
        let origin = fixture.rollout(ID);
        let other = fixture.rollout("019d0430-9886-7ff3-b132-ab15e9127142");
        let original = fs::read(&origin).unwrap();
        let storage = prepare_at(&fixture.source(), &fixture.private(), Some(ID)).unwrap();
        let copied = PathBuf::from(storage.resume_path.unwrap());
        assert_eq!(fs::read(&origin).unwrap(), original);
        assert_eq!(fs::read(&copied).unwrap(), original);
        assert!(other.exists());
        assert!(
            find_rollout(&fixture.private(), "019d0430-9886-7ff3-b132-ab15e9127142")
                .unwrap()
                .is_none()
        );
        let mut advanced = original;
        advanced.extend_from_slice(b"{\"type\":\"advanced_turn\"}\n");
        fs::write(&copied, &advanced).unwrap();
        prepare_at(&fixture.source(), &fixture.private(), Some(ID)).unwrap();
        assert_eq!(fs::read(copied).unwrap(), advanced);
    }

    #[test]
    fn mcp_credentials_share_refreshes_and_follow_source_replacement_and_removal() {
        let fixture = Fixture::new();
        let source = fixture.source().join(".credentials.json");
        fs::write(&source, "synthetic credentials").unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        let private = fixture.private().join(".credentials.json");
        assert!(same_file(&source, &private).unwrap());
        assert!(!fs::symlink_metadata(&private)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::write(&private, "synthetic refreshed credentials").unwrap();
        assert_eq!(
            fs::read_to_string(&source).unwrap(),
            "synthetic refreshed credentials"
        );
        let replacement = fixture.source().join("replacement.json");
        fs::write(&replacement, "synthetic replacement credentials").unwrap();
        fs::remove_file(&source).unwrap();
        fs::rename(replacement, &source).unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert!(same_file(&source, &private).unwrap());
        assert_eq!(
            fs::read_to_string(&private).unwrap(),
            "synthetic replacement credentials"
        );
        fs::remove_file(&source).unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert!(!private.exists());
    }

    #[test]
    fn hardlink_sharing_preserves_unmanaged_local_files() {
        let fixture = Fixture::new();
        let source = fixture.source().join(".credentials.json");
        fs::write(source, "synthetic provider credentials").unwrap();
        fs::create_dir(fixture.private()).unwrap();
        let local = fixture.private().join(".credentials.json");
        fs::write(&local, "synthetic local credentials").unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None).is_err());
        assert_eq!(
            fs::read_to_string(local).unwrap(),
            "synthetic local credentials"
        );
    }

    #[test]
    fn mcp_file_sharing_creates_only_the_shared_refresh_lock_domain() {
        let fixture = Fixture::new();
        fs::remove_dir(fixture.source().join("mcp-oauth-locks")).unwrap();
        fs::write(
            fixture.source().join(".credentials.json"),
            "synthetic credentials",
        )
        .unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert!(fixture.source().join("mcp-oauth-locks").is_dir());
        assert_eq!(
            fs::read_dir(fixture.source().join("mcp-oauth-locks"))
                .unwrap()
                .count(),
            0
        );
        assert_eq!(
            fixture
                .private()
                .join("mcp-oauth-locks")
                .canonicalize()
                .unwrap(),
            fixture
                .source()
                .join("mcp-oauth-locks")
                .canonicalize()
                .unwrap()
        );
        assert_eq!(
            fs::read_to_string(fixture.source().join(".credentials.json")).unwrap(),
            "synthetic credentials"
        );
    }

    #[cfg(unix)]
    #[test]
    fn shared_mcp_file_accepts_provider_no_follow_refresh_writes() {
        use std::os::unix::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        fs::write(
            fixture.source().join(".credentials.json"),
            "synthetic credentials",
        )
        .unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        let file = fs::OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(fixture.private().join(".credentials.json"))
            .unwrap();
        assert!(file.metadata().unwrap().is_file());
    }

    #[cfg(unix)]
    #[test]
    fn mcp_source_redirect_is_rejected_like_the_provider_secure_writer() {
        let fixture = Fixture::new();
        let target = fixture.source().join("credentials-target.json");
        fs::write(&target, "synthetic credentials").unwrap();
        std::os::unix::fs::symlink(&target, fixture.source().join(".credentials.json")).unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None)
            .unwrap_err()
            .contains("regular provider file"));
        assert_eq!(fs::read_to_string(target).unwrap(), "synthetic credentials");
        assert!(!fixture.private().join(".credentials.json").exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_setup_uses_junctions_and_refreshable_file_hardlinks() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.source().join("skills")).unwrap();
        fs::write(fixture.source().join("config.toml"), "model = 'first'\n").unwrap();
        fs::write(fixture.source().join("auth.json"), "synthetic auth").unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert!(junction::exists(fixture.private().join("skills")).unwrap());
        assert!(same_file(
            &fixture.source().join("auth.json"),
            &fixture.private().join("auth.json")
        )
        .unwrap());
        let replacement = fixture.source().join("replacement.toml");
        fs::write(&replacement, "model = 'second'\n").unwrap();
        fs::remove_file(fixture.source().join("config.toml")).unwrap();
        fs::rename(replacement, fixture.source().join("config.toml")).unwrap();
        prepare_at(&fixture.source(), &fixture.private(), None).unwrap();
        assert_eq!(
            fs::read_to_string(fixture.private().join("config.toml")).unwrap(),
            "model = 'second'\n"
        );
    }

    #[test]
    fn invalid_ids_and_mismatched_rollouts_are_rejected() {
        let fixture = Fixture::new();
        assert!(prepare_at(&fixture.source(), &fixture.private(), Some("../sessions")).is_err());
        let rollout = fixture.rollout(ID);
        fs::write(
            &rollout,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"wrong\"}}\n",
        )
        .unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), Some(ID)).is_err());
        assert!(find_rollout(&fixture.private(), ID).unwrap().is_none());
    }

    #[test]
    fn keyring_auth_fails_explicitly_without_changing_user_setup() {
        let fixture = Fixture::new();
        let config = "cli_auth_credentials_store = 'keyring'\n";
        fs::write(fixture.source().join("config.toml"), config).unwrap();
        let error = prepare_at(&fixture.source(), &fixture.private(), None).unwrap_err();
        assert!(error.contains("keyring or auto"));
        assert_eq!(
            fs::read_to_string(fixture.source().join("config.toml")).unwrap(),
            config
        );
        fs::write(
            fixture.source().join("config.toml"),
            "cli_auth_credentials_store = 'auto'\n",
        )
        .unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None)
            .unwrap_err()
            .contains("keyring or auto"));
        fs::write(
            fixture.source().join("config.toml"),
            "cli_auth_credentials_store = 'ephemeral'\n",
        )
        .unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_shared_history_symlinks_and_config_collisions() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.private()).unwrap();
        fs::create_dir(fixture.source().join("sessions")).unwrap();
        std::os::unix::fs::symlink(
            fixture.source().join("sessions"),
            fixture.private().join("sessions"),
        )
        .unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None).is_err());
        fs::remove_file(fixture.private().join("sessions")).unwrap();
        fs::write(fixture.source().join("config.toml"), "model = 'shared'\n").unwrap();
        fs::write(fixture.private().join("config.toml"), "model = 'local'\n").unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), None).is_err());
        assert_eq!(
            fs::read_to_string(fixture.private().join("config.toml")).unwrap(),
            "model = 'local'\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn nested_history_symlink_cannot_redirect_import_into_shared_data() {
        let fixture = Fixture::new();
        let origin = fixture.rollout(ID);
        let original = fs::read(&origin).unwrap();
        fs::create_dir_all(fixture.private().join("sessions")).unwrap();
        std::os::unix::fs::symlink(
            fixture.source().join("sessions/2026"),
            fixture.private().join("sessions/2026"),
        )
        .unwrap();
        assert!(prepare_at(&fixture.source(), &fixture.private(), Some(ID)).is_err());
        assert_eq!(fs::read(&origin).unwrap(), original);
        assert_eq!(fs::read_dir(origin.parent().unwrap()).unwrap().count(), 1);
    }
}
