//! Project memory: plain Markdown that Aven hands to every agent working in a
//! project. Rows are keyed by the frontend's `projectKey(path)`, like the
//! project's other saved data, and live beside notes in the session database.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::session_store::{now_millis, SessionStore};

/// Counted in characters. Claude Code receives the memory as a launch
/// argument, so it has to stay well inside Windows' 32,767-character command
/// line together with Aven's own host instructions.
pub(crate) const MEMORY_MAX_CHARS: usize = 8_000;
const KEY_MAX_BYTES: usize = 4_096;
/// Returned when a save was based on an older copy than the one stored.
pub(crate) const MEMORY_CHANGED: &str = "Project memory changed elsewhere.";
const MEMORY_FULL: &str = "Project memory is full. Remove something from it before adding more.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemory {
    pub key: String,
    pub path: String,
    pub body: String,
    pub updated_at: i64,
}

pub fn ensure_project_memory_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS project_memory (
           project_key TEXT PRIMARY KEY,
           path TEXT NOT NULL,
           body TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )
}

#[tauri::command(async)]
pub fn project_memory_get(
    store: State<'_, SessionStore>,
    key: String,
) -> Result<Option<ProjectMemory>, String> {
    validate_key(&key)?;
    let conn = store.lock_conn()?;
    read_memory(&conn, &key).map_err(|e| e.to_string())
}

/// Replace the memory. `base_updated_at` is the version the editor opened:
/// `0` when it opened an empty memory. A mismatch refuses the save so an item
/// remembered from a chat meanwhile is never silently overwritten.
#[tauri::command(async)]
pub fn project_memory_set(
    store: State<'_, SessionStore>,
    key: String,
    path: String,
    body: String,
    base_updated_at: Option<i64>,
) -> Result<Option<ProjectMemory>, String> {
    validate_key(&key)?;
    validate_path(&path)?;
    let conn = store.lock_conn()?;
    set_memory(&conn, &key, &path, &body, base_updated_at)
}

/// Add one item at the end, atomically, so two windows remembering at once
/// both keep their item.
#[tauri::command(async)]
pub fn project_memory_append(
    store: State<'_, SessionStore>,
    key: String,
    path: String,
    item: String,
) -> Result<ProjectMemory, String> {
    validate_key(&key)?;
    validate_path(&path)?;
    let conn = store.lock_conn()?;
    append_memory(&conn, &key, &path, &item)
}

#[tauri::command(async)]
pub fn project_memory_delete(store: State<'_, SessionStore>, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let conn = store.lock_conn()?;
    delete_memory(&conn, &key).map_err(|e| e.to_string())
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > KEY_MAX_BYTES || key.chars().any(char::is_control) {
        return Err("Invalid project".into());
    }
    Ok(())
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.len() > KEY_MAX_BYTES || path.chars().any(char::is_control) {
        return Err("Invalid project path".into());
    }
    Ok(())
}

/// Line endings and trailing blank space never change what agents read, so
/// they never count as an edit either.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim_end()
        .to_string()
}

fn ensure_fits(body: &str) -> Result<(), String> {
    if body.chars().count() > MEMORY_MAX_CHARS {
        return Err(MEMORY_FULL.into());
    }
    Ok(())
}

fn read_memory(conn: &Connection, key: &str) -> rusqlite::Result<Option<ProjectMemory>> {
    conn.query_row(
        "SELECT project_key, path, body, updated_at FROM project_memory WHERE project_key = ?1",
        params![key],
        |row| {
            Ok(ProjectMemory {
                key: row.get(0)?,
                path: row.get(1)?,
                body: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
}

/// Strictly increasing, so two saves within one millisecond still differ.
fn next_version(previous: Option<&ProjectMemory>) -> i64 {
    let now = now_millis();
    previous.map_or(now, |memory| now.max(memory.updated_at + 1))
}

fn write_memory(
    conn: &Connection,
    key: &str,
    path: &str,
    body: String,
    previous: Option<&ProjectMemory>,
) -> Result<ProjectMemory, String> {
    let memory = ProjectMemory {
        key: key.to_string(),
        path: path.to_string(),
        body,
        updated_at: next_version(previous),
    };
    conn.execute(
        "INSERT INTO project_memory (project_key, path, body, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_key) DO UPDATE SET
           path = excluded.path,
           body = excluded.body,
           updated_at = excluded.updated_at",
        params![memory.key, memory.path, memory.body, memory.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(memory)
}

fn set_memory(
    conn: &Connection,
    key: &str,
    path: &str,
    body: &str,
    base_updated_at: Option<i64>,
) -> Result<Option<ProjectMemory>, String> {
    let body = normalize(body);
    ensure_fits(&body)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let previous = read_memory(&tx, key).map_err(|e| e.to_string())?;
    if let Some(base) = base_updated_at {
        if previous.as_ref().map_or(0, |memory| memory.updated_at) != base {
            return Err(MEMORY_CHANGED.into());
        }
    }
    let saved = if body.is_empty() {
        delete_memory(&tx, key).map_err(|e| e.to_string())?;
        None
    } else if previous
        .as_ref()
        .is_some_and(|memory| memory.body == body && memory.path == path)
    {
        previous
    } else {
        Some(write_memory(&tx, key, path, body, previous.as_ref())?)
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(saved)
}

fn is_list_item(line: &str) -> bool {
    let line = line.trim_start();
    line.starts_with("- ") || line.starts_with("* ") || line.starts_with("+ ")
}

fn append_memory(
    conn: &Connection,
    key: &str,
    path: &str,
    item: &str,
) -> Result<ProjectMemory, String> {
    let item = normalize(item);
    let item = item.trim_start_matches('\n');
    if item.trim().is_empty() {
        return Err("Nothing to remember".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let previous = read_memory(&tx, key).map_err(|e| e.to_string())?;
    let existing = previous
        .as_ref()
        .map(|memory| memory.body.as_str())
        .unwrap_or("");
    let body = if existing.is_empty() {
        item.to_string()
    } else {
        // Keep a list a list; anything else starts its own paragraph.
        let last = existing.lines().last().unwrap_or("");
        let first = item.lines().next().unwrap_or("");
        let gap = if is_list_item(last) && is_list_item(first) {
            "\n"
        } else {
            "\n\n"
        };
        format!("{existing}{gap}{item}")
    };
    ensure_fits(&body)?;
    let saved = write_memory(&tx, key, path, body, previous.as_ref())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(saved)
}

fn delete_memory(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM project_memory WHERE project_key = ?1",
        params![key],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SessionStore {
        SessionStore::open_in_memory().unwrap()
    }

    #[test]
    fn migrate_creates_the_table() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'project_memory'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1);
        // Creating it again on a later launch is harmless.
        ensure_project_memory_table(&conn).unwrap();
    }

    #[test]
    fn saves_reads_and_normalizes_line_endings() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        assert_eq!(read_memory(&conn, "/p").unwrap(), None);
        let saved = set_memory(
            &conn,
            "/p",
            "/p",
            "- Use pnpm\r\n- Ship small\r\n\n",
            Some(0),
        )
        .unwrap()
        .unwrap();
        assert_eq!(saved.body, "- Use pnpm\n- Ship small");
        assert_eq!(read_memory(&conn, "/p").unwrap(), Some(saved.clone()));
        // Other projects are untouched.
        assert_eq!(read_memory(&conn, "/other").unwrap(), None);
    }

    #[test]
    fn an_unchanged_save_keeps_its_version() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let first = set_memory(&conn, "/p", "/p", "- a", None).unwrap().unwrap();
        let again = set_memory(&conn, "/p", "/p", "- a\n", Some(first.updated_at))
            .unwrap()
            .unwrap();
        assert_eq!(again, first);
    }

    #[test]
    fn a_stale_editor_cannot_overwrite_a_newer_memory() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let opened = set_memory(&conn, "/p", "/p", "- a", None).unwrap().unwrap();
        let remembered = append_memory(&conn, "/p", "/p", "- b").unwrap();
        assert!(remembered.updated_at > opened.updated_at);
        let refused = set_memory(&conn, "/p", "/p", "- a\n- edited", Some(opened.updated_at));
        assert_eq!(refused, Err(MEMORY_CHANGED.to_string()));
        assert_eq!(read_memory(&conn, "/p").unwrap().unwrap().body, "- a\n- b");
        // An editor that opened an empty memory conflicts with a new item too.
        assert!(set_memory(&conn, "/q", "/q", "x", Some(0)).is_ok());
        append_memory(&conn, "/r", "/r", "- first").unwrap();
        assert_eq!(
            set_memory(&conn, "/r", "/r", "- mine", Some(0)),
            Err(MEMORY_CHANGED.to_string())
        );
    }

    #[test]
    fn clearing_the_text_removes_the_row() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let saved = set_memory(&conn, "/p", "/p", "- a", None).unwrap().unwrap();
        assert_eq!(
            set_memory(&conn, "/p", "/p", "  \n", Some(saved.updated_at)).unwrap(),
            None
        );
        assert_eq!(read_memory(&conn, "/p").unwrap(), None);
    }

    #[test]
    fn append_keeps_lists_together_and_separates_paragraphs() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        assert_eq!(
            append_memory(&conn, "/p", "/p", "\n- first\n")
                .unwrap()
                .body,
            "- first"
        );
        assert_eq!(
            append_memory(&conn, "/p", "/p", "- second").unwrap().body,
            "- first\n- second"
        );
        assert_eq!(
            append_memory(&conn, "/p", "/p", "A paragraph.")
                .unwrap()
                .body,
            "- first\n- second\n\nA paragraph."
        );
        assert_eq!(
            append_memory(&conn, "/p", "/p", "   "),
            Err("Nothing to remember".to_string())
        );
    }

    #[test]
    fn the_size_cap_applies_to_saves_and_items() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let full = "é".repeat(MEMORY_MAX_CHARS);
        // The cap counts characters, not UTF-8 bytes.
        assert!(set_memory(&conn, "/p", "/p", &full, None).is_ok());
        assert_eq!(
            set_memory(&conn, "/p", "/p", &format!("{full}x"), None),
            Err(MEMORY_FULL.to_string())
        );
        assert_eq!(
            append_memory(&conn, "/p", "/p", "- one more"),
            Err(MEMORY_FULL.to_string())
        );
        assert_eq!(read_memory(&conn, "/p").unwrap().unwrap().body, full);
    }

    #[test]
    fn delete_removes_only_that_project() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        set_memory(&conn, "/p", "/p", "- a", None).unwrap();
        set_memory(&conn, "/q", "/q", "- b", None).unwrap();
        delete_memory(&conn, "/p").unwrap();
        assert_eq!(read_memory(&conn, "/p").unwrap(), None);
        assert!(read_memory(&conn, "/q").unwrap().is_some());
    }

    #[test]
    fn keys_and_paths_are_bounded() {
        assert!(validate_key("").is_err());
        assert!(validate_key("/p\n").is_err());
        assert!(validate_key(&"a".repeat(KEY_MAX_BYTES + 1)).is_err());
        assert!(validate_key("c:/users/me/project").is_ok());
        assert!(validate_path("/p\0").is_err());
        assert!(validate_path("/Users/me/My Project").is_ok());
    }
}
