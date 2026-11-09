//! Avos documents: the write-ups Avos keeps for a project, such as a plan or
//! a review. Rows are keyed by the frontend's project key, like the project's
//! other saved data, and live beside notes in the session database. Nothing
//! is ever written into the project's own files.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::session_store::{now_millis, validate_id, SessionStore};

/// All counted in characters, like the frontend's limits.
const ID_MAX_CHARS: usize = 256;
const PROJECT_MAX_CHARS: usize = 4_096;
const TITLE_MAX_CHARS: usize = 200;
const SUMMARY_MAX_CHARS: usize = 280;
const BODY_MAX_CHARS: usize = 240_000;
/// Documents one listing returns, newest first.
const LIST_MAX: i64 = 200;
const OTHER_PROJECT: &str = "That document belongs to another project";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvosDocument {
    pub id: String,
    pub project: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A document without its body, for listings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvosDocumentMeta {
    pub id: String,
    pub project: String,
    pub title: String,
    pub summary: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvosDocumentUpsert {
    pub id: String,
    pub project: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub body: String,
}

pub fn ensure_avos_documents_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS avos_documents (
           id TEXT PRIMARY KEY,
           project TEXT NOT NULL,
           title TEXT NOT NULL,
           summary TEXT NOT NULL DEFAULT '',
           body TEXT NOT NULL DEFAULT '',
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS avos_documents_project_updated_idx
           ON avos_documents (project, updated_at DESC, id);",
    )
}

#[tauri::command(async)]
pub fn avos_documents_list(
    store: State<'_, SessionStore>,
    project: String,
) -> Result<Vec<AvosDocumentMeta>, String> {
    validate_project(&project)?;
    let conn = store.lock_conn()?;
    list_documents(&conn, &project).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn avos_document_get(
    store: State<'_, SessionStore>,
    id: String,
) -> Result<Option<AvosDocument>, String> {
    validate_document_id(&id)?;
    let conn = store.lock_conn()?;
    get_document(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn avos_document_upsert(
    store: State<'_, SessionStore>,
    document: AvosDocumentUpsert,
) -> Result<AvosDocument, String> {
    let conn = store.lock_conn()?;
    upsert_document(&conn, &document)
}

#[tauri::command(async)]
pub fn avos_document_delete(store: State<'_, SessionStore>, id: String) -> Result<(), String> {
    validate_document_id(&id)?;
    let conn = store.lock_conn()?;
    delete_document(&conn, &id).map_err(|e| e.to_string())
}

fn validate_document_id(id: &str) -> Result<(), String> {
    // Valid ids are ASCII, so bytes and characters count the same.
    if id.len() > ID_MAX_CHARS {
        return Err("Invalid document id".into());
    }
    validate_id(id, "document")
}

fn validate_project(project: &str) -> Result<(), String> {
    if project.is_empty() || longer_than(project, PROJECT_MAX_CHARS) {
        return Err("Invalid project".into());
    }
    Ok(())
}

/// Whether `text` has more than `max` characters. A string is never longer in
/// characters than in bytes, so most text is settled without a walk.
fn longer_than(text: &str, max: usize) -> bool {
    text.len() > max && text.chars().count() > max
}

fn list_documents(conn: &Connection, project: &str) -> rusqlite::Result<Vec<AvosDocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, project, title, summary, created_at, updated_at
         FROM avos_documents
         WHERE project = ?1
         ORDER BY updated_at DESC, id ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![project, LIST_MAX], |row| {
        Ok(AvosDocumentMeta {
            id: row.get(0)?,
            project: row.get(1)?,
            title: row.get(2)?,
            summary: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

fn get_document(conn: &Connection, id: &str) -> rusqlite::Result<Option<AvosDocument>> {
    conn.query_row(
        "SELECT id, project, title, summary, body, created_at, updated_at
         FROM avos_documents
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(AvosDocument {
                id: row.get(0)?,
                project: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                body: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
}

fn upsert_document(
    conn: &Connection,
    document: &AvosDocumentUpsert,
) -> Result<AvosDocument, String> {
    upsert_document_at(conn, document, now_millis())
}

/// `now` is a parameter so tests can order saves without sleeping.
fn upsert_document_at(
    conn: &Connection,
    document: &AvosDocumentUpsert,
    now: i64,
) -> Result<AvosDocument, String> {
    validate_document_id(&document.id)?;
    validate_project(&document.project)?;
    let title = document.title.trim();
    if title.is_empty() {
        return Err("A document needs a title".into());
    }
    if longer_than(title, TITLE_MAX_CHARS) {
        return Err("Document title is too long".into());
    }
    let summary = document.summary.trim();
    if longer_than(summary, SUMMARY_MAX_CHARS) {
        return Err("Document summary is too long".into());
    }
    if longer_than(&document.body, BODY_MAX_CHARS) {
        return Err("Document is too large".into());
    }

    let existing: Option<(String, i64, i64)> = conn
        .query_row(
            "SELECT project, created_at, updated_at FROM avos_documents WHERE id = ?1",
            params![document.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (created_at, updated_at) = match existing {
        Some((project, created_at, previous)) => {
            // An id never moves to another project.
            if project != document.project {
                return Err(OTHER_PROJECT.into());
            }
            // A revision always reads as newer than the one it replaces, even
            // within one millisecond or after the clock steps back.
            let updated_at = now.max(previous.saturating_add(1));
            conn.execute(
                "UPDATE avos_documents
                 SET title = ?1, summary = ?2, body = ?3, updated_at = ?4
                 WHERE id = ?5",
                params![title, summary, document.body, updated_at, document.id],
            )
            .map_err(|e| e.to_string())?;
            (created_at, updated_at)
        }
        None => {
            conn.execute(
                "INSERT INTO avos_documents (
                   id, project, title, summary, body, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    document.id,
                    document.project,
                    title,
                    summary,
                    document.body,
                    now,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;
            (now, now)
        }
    };

    Ok(AvosDocument {
        id: document.id.clone(),
        project: document.project.clone(),
        title: title.to_string(),
        summary: summary.to_string(),
        body: document.body.clone(),
        created_at,
        updated_at,
    })
}

fn delete_document(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM avos_documents WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_avos_documents_table(&conn).unwrap();
        conn
    }

    fn draft(id: &str, project: &str, title: &str, body: &str) -> AvosDocumentUpsert {
        AvosDocumentUpsert {
            id: id.into(),
            project: project.into(),
            title: title.into(),
            summary: String::new(),
            body: body.into(),
        }
    }

    fn save(conn: &Connection, id: &str, project: &str, title: &str, now: i64) -> AvosDocument {
        upsert_document_at(conn, &draft(id, project, title, "body"), now).unwrap()
    }

    fn listed(conn: &Connection, project: &str) -> Vec<String> {
        list_documents(conn, project)
            .unwrap()
            .into_iter()
            .map(|document| document.id)
            .collect()
    }

    #[test]
    fn the_session_store_creates_the_table_and_creating_it_twice_is_harmless() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'avos_documents'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
        ensure_avos_documents_table(&conn).unwrap();
        // The real clock path saves and reads back too.
        let saved = upsert_document(&conn, &draft("d1", "/p", "Plan", "text")).unwrap();
        assert!(saved.created_at > 0);
        assert_eq!(get_document(&conn, "d1").unwrap(), Some(saved));
    }

    #[test]
    fn insert_then_list_newest_updated_first() {
        let conn = open();
        let first = upsert_document_at(
            &conn,
            &AvosDocumentUpsert {
                id: "d1".into(),
                project: "/p".into(),
                title: "  Plan  ".into(),
                summary: "  What comes next  ".into(),
                body: "  kept as written\r\n".into(),
            },
            100,
        )
        .unwrap();
        assert_eq!(first.title, "Plan");
        assert_eq!(first.summary, "What comes next");
        assert_eq!(first.body, "  kept as written\r\n");
        assert_eq!((first.created_at, first.updated_at), (100, 100));
        assert_eq!(get_document(&conn, "d1").unwrap(), Some(first));

        save(&conn, "d2", "/p", "Review", 200);
        // Equal times fall back to the id.
        save(&conn, "d4", "/p", "Later", 300);
        save(&conn, "d3", "/p", "Later too", 300);
        assert_eq!(listed(&conn, "/p"), vec!["d3", "d4", "d2", "d1"]);

        // Revising the oldest moves it to the front.
        save(&conn, "d1", "/p", "Plan", 400);
        assert_eq!(listed(&conn, "/p"), vec!["d1", "d3", "d4", "d2"]);

        let meta = list_documents(&conn, "/p").unwrap().remove(0);
        assert_eq!(
            meta,
            AvosDocumentMeta {
                id: "d1".into(),
                project: "/p".into(),
                title: "Plan".into(),
                summary: String::new(),
                created_at: 100,
                updated_at: 400,
            }
        );
    }

    #[test]
    fn a_revision_keeps_created_at_and_project_and_changes_updated_at() {
        let conn = open();
        let first = save(&conn, "d1", "/p", "Plan", 100);
        let revised = upsert_document_at(
            &conn,
            &AvosDocumentUpsert {
                id: "d1".into(),
                project: "/p".into(),
                title: "Plan, revised".into(),
                summary: "Shorter".into(),
                body: "new body".into(),
            },
            250,
        )
        .unwrap();
        assert_eq!(revised.created_at, first.created_at);
        assert_eq!(revised.project, "/p");
        assert_eq!(revised.updated_at, 250);
        assert_eq!(revised.title, "Plan, revised");
        assert_eq!(revised.summary, "Shorter");
        assert_eq!(revised.body, "new body");
        assert_eq!(get_document(&conn, "d1").unwrap(), Some(revised));
        assert_eq!(listed(&conn, "/p"), vec!["d1"]);

        // A save in the same millisecond, or after the clock steps back, still
        // reads as newer.
        let same = save(&conn, "d1", "/p", "Plan", 250);
        assert_eq!(same.updated_at, 251);
        let earlier = save(&conn, "d1", "/p", "Plan", 10);
        assert_eq!(earlier.updated_at, 252);
        assert_eq!(earlier.created_at, 100);
    }

    #[test]
    fn an_id_under_another_project_is_refused() {
        let conn = open();
        let first = save(&conn, "d1", "/p", "Plan", 100);
        let error = upsert_document_at(&conn, &draft("d1", "/other", "Taken", "theirs"), 200);
        assert_eq!(
            error,
            Err("That document belongs to another project".to_string())
        );
        // Nothing about the stored document changed.
        assert_eq!(get_document(&conn, "d1").unwrap(), Some(first));
        assert!(listed(&conn, "/other").is_empty());
    }

    #[test]
    fn limits_are_enforced() {
        let conn = open();
        let refuse =
            |document: AvosDocumentUpsert| upsert_document_at(&conn, &document, 100).unwrap_err();

        assert_eq!(
            refuse(draft("d1", "/p", "   ", "body")),
            "A document needs a title"
        );
        assert_eq!(
            refuse(draft("d1", "/p", &"t".repeat(201), "body")),
            "Document title is too long"
        );
        assert_eq!(
            refuse(draft("d1", "/p", "Plan", &"b".repeat(240_001))),
            "Document is too large"
        );
        for id in ["", "has space", "dot.dot", "../up", "é", &"a".repeat(257)] {
            assert_eq!(
                refuse(draft(id, "/p", "Plan", "body")),
                "Invalid document id",
                "{id:?}"
            );
            assert!(validate_document_id(id).is_err(), "{id:?}");
        }
        assert_eq!(refuse(draft("d1", "", "Plan", "body")), "Invalid project");
        assert_eq!(
            refuse(draft("d1", &"p".repeat(4_097), "Plan", "body")),
            "Invalid project"
        );
        let mut wordy = draft("d1", "/p", "Plan", "body");
        wordy.summary = "s".repeat(281);
        assert_eq!(refuse(wordy), "Document summary is too long");
        // A refused save stores nothing.
        assert!(listed(&conn, "/p").is_empty());

        // Limits count characters, not bytes, and are inclusive; the title
        // and summary are measured after trimming.
        let mut full = draft(
            &"a".repeat(256),
            &"é".repeat(4_096),
            &format!("  {}  ", "é".repeat(200)),
            &"é".repeat(240_000),
        );
        full.summary = format!(" {} ", "é".repeat(280));
        let saved = upsert_document_at(&conn, &full, 100).unwrap();
        assert_eq!(saved.title.chars().count(), 200);
        assert_eq!(saved.summary.chars().count(), 280);
        assert_eq!(saved.body.chars().count(), 240_000);
        assert_eq!(get_document(&conn, &saved.id).unwrap(), Some(saved));
    }

    #[test]
    fn delete_then_get_is_none() {
        let conn = open();
        save(&conn, "d1", "/p", "Gone", 100);
        save(&conn, "d2", "/p", "Stays", 200);
        delete_document(&conn, "d1").unwrap();
        assert_eq!(get_document(&conn, "d1").unwrap(), None);
        assert_eq!(listed(&conn, "/p"), vec!["d2"]);
        // Deleting what is not there is fine.
        delete_document(&conn, "d1").unwrap();
        delete_document(&conn, "never-saved").unwrap();
        // The id is free again, for any project.
        let again = save(&conn, "d1", "/other", "New", 300);
        assert_eq!(again.created_at, 300);
    }

    #[test]
    fn list_is_scoped_to_its_project_and_capped() {
        let conn = open();
        save(&conn, "a1", "/a", "A one", 100);
        save(&conn, "b1", "/b", "B one", 200);
        save(&conn, "a2", "/a", "A two", 300);
        assert_eq!(listed(&conn, "/a"), vec!["a2", "a1"]);
        assert_eq!(listed(&conn, "/b"), vec!["b1"]);
        assert!(listed(&conn, "/c").is_empty());
        assert!(list_documents(&conn, "/a")
            .unwrap()
            .iter()
            .all(|document| document.project == "/a"));

        for index in 0..205 {
            save(
                &conn,
                &format!("many-{index}"),
                "/many",
                "Doc",
                1_000 + index,
            );
        }
        let many = listed(&conn, "/many");
        assert_eq!(many.len(), 200);
        assert_eq!(many[0], "many-204");
        assert_eq!(many[199], "many-5");
    }

    #[test]
    fn documents_cross_the_bridge_in_camel_case() {
        let upsert: AvosDocumentUpsert =
            serde_json::from_str(r#"{"id":"d1","project":"/p","title":"Plan","body":"text"}"#)
                .unwrap();
        assert_eq!(upsert.summary, "");
        let conn = open();
        let saved = upsert_document_at(&conn, &upsert, 100).unwrap();
        assert_eq!(
            serde_json::to_value(&saved).unwrap(),
            serde_json::json!({
                "id": "d1",
                "project": "/p",
                "title": "Plan",
                "summary": "",
                "body": "text",
                "createdAt": 100,
                "updatedAt": 100,
            })
        );
        assert_eq!(
            serde_json::to_value(list_documents(&conn, "/p").unwrap()).unwrap(),
            serde_json::json!([{
                "id": "d1",
                "project": "/p",
                "title": "Plan",
                "summary": "",
                "createdAt": 100,
                "updatedAt": 100,
            }])
        );
    }
}
