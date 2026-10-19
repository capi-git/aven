//! The project board's cards: features the user wants built, each linked to
//! the chats building it. Rows are keyed by the frontend's `projectKey(path)`,
//! like the project's other saved data, and live beside project memory in the
//! session database. Nothing is ever written into the project's own files.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::session_store::SessionStore;

const KEY_MAX_BYTES: usize = 4_096;
const ID_MAX_BYTES: usize = 128;
/// Counted in characters, like the frontend's limits.
pub(crate) const TITLE_MAX_CHARS: usize = 200;
pub(crate) const NOTE_MAX_CHARS: usize = 4_000;
const URL_MAX_BYTES: usize = 2_048;
const BASIS_MAX_BYTES: usize = 16_384;
const CHATS_MAX: usize = 50;
const CHAT_ID_MAX_BYTES: usize = 256;
/// Cards one project keeps; a board this full has stopped being a board.
pub(crate) const CARDS_MAX: usize = 1_000;
const COLUMNS: [&str; 4] = ["idea", "building", "review", "shipped"];
pub(crate) const BOARD_FULL: &str = "The board is full. Delete some cards before adding more.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureCard {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// `idea`, `building`, `review` or `shipped`.
    pub column: String,
    /// The chats building it, oldest first.
    #[serde(default)]
    pub chat_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// When it entered its column.
    pub moved_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shipped_at: Option<i64>,
    /// Where it came from, such as a GitHub issue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Its chats' state when its column was last decided, by hand or by
    /// itself; the frontend compares it to tell a real change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
}

pub fn ensure_feature_cards_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS feature_cards (
           project_key TEXT NOT NULL,
           id TEXT NOT NULL,
           path TEXT NOT NULL,
           card_json TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           PRIMARY KEY (project_key, id)
         );",
    )
}

#[tauri::command(async)]
pub fn feature_cards_list(
    store: State<'_, SessionStore>,
    key: String,
) -> Result<Vec<FeatureCard>, String> {
    validate_key(&key)?;
    let conn = store.lock_conn()?;
    list_cards(&conn, &key)
}

/// Add a card or replace the one with its id, returning it as saved.
#[tauri::command(async)]
pub fn feature_card_put(
    store: State<'_, SessionStore>,
    key: String,
    path: String,
    card: FeatureCard,
) -> Result<FeatureCard, String> {
    validate_key(&key)?;
    validate_path(&path)?;
    let conn = store.lock_conn()?;
    put_card(&conn, &key, &path, card)
}

#[tauri::command(async)]
pub fn feature_card_delete(
    store: State<'_, SessionStore>,
    key: String,
    id: String,
) -> Result<(), String> {
    validate_key(&key)?;
    let conn = store.lock_conn()?;
    delete_card(&conn, &key, &id).map_err(|e| e.to_string())
}

/// Every card of one project, when the project's data is removed.
#[tauri::command(async)]
pub fn feature_cards_clear(store: State<'_, SessionStore>, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let conn = store.lock_conn()?;
    clear_cards(&conn, &key).map_err(|e| e.to_string())
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

fn plain_id(id: &str, max: usize) -> bool {
    !id.is_empty() && id.len() <= max && !id.chars().any(char::is_control)
}

/// Checks a card and puts it in its saved shape: trimmed text, no empty
/// note or link, each chat once.
fn normalize(card: FeatureCard) -> Result<FeatureCard, String> {
    if !plain_id(&card.id, ID_MAX_BYTES) {
        return Err("Invalid card".into());
    }
    let title = card.title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err("A card needs a title.".into());
    }
    if title.chars().count() > TITLE_MAX_CHARS {
        return Err(format!(
            "Keep the title under {TITLE_MAX_CHARS} characters."
        ));
    }
    let note = card
        .note
        .map(|note| {
            note.replace("\r\n", "\n")
                .replace('\r', "\n")
                .trim()
                .to_string()
        })
        .filter(|note| !note.is_empty());
    if note
        .as_ref()
        .is_some_and(|note| note.chars().count() > NOTE_MAX_CHARS)
    {
        return Err(format!("Keep the note under {NOTE_MAX_CHARS} characters."));
    }
    if !COLUMNS.contains(&card.column.as_str()) {
        return Err("Invalid column".into());
    }
    let mut chat_ids: Vec<String> = Vec::new();
    for id in card.chat_ids {
        if !plain_id(&id, CHAT_ID_MAX_BYTES) {
            return Err("Invalid chat".into());
        }
        if !chat_ids.contains(&id) {
            chat_ids.push(id);
        }
    }
    if chat_ids.len() > CHATS_MAX {
        return Err("A card can link at most 50 chats.".into());
    }
    let source_url = card
        .source_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    if source_url
        .as_ref()
        .is_some_and(|url| url.len() > URL_MAX_BYTES || url.chars().any(char::is_control))
    {
        return Err("Invalid link".into());
    }
    if card
        .basis
        .as_ref()
        .is_some_and(|basis| basis.len() > BASIS_MAX_BYTES)
    {
        return Err("Invalid card".into());
    }
    if card.created_at < 0 || card.updated_at < 0 || card.moved_at < 0 {
        return Err("Invalid card".into());
    }
    Ok(FeatureCard {
        title,
        note,
        chat_ids,
        source_url,
        shipped_at: card.shipped_at.filter(|at| *at >= 0),
        ..card
    })
}

fn list_cards(conn: &Connection, key: &str) -> Result<Vec<FeatureCard>, String> {
    let mut statement = conn
        .prepare(
            "SELECT card_json FROM feature_cards WHERE project_key = ?1
             ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![key], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut cards = Vec::new();
    for row in rows {
        let json = row.map_err(|e| e.to_string())?;
        // A row this build cannot read is skipped, not fatal to the board.
        if let Ok(card) = serde_json::from_str::<FeatureCard>(&json) {
            cards.push(card);
        }
    }
    Ok(cards)
}

fn put_card(
    conn: &Connection,
    key: &str,
    path: &str,
    card: FeatureCard,
) -> Result<FeatureCard, String> {
    let card = normalize(card)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let exists = tx
        .query_row(
            "SELECT 1 FROM feature_cards WHERE project_key = ?1 AND id = ?2",
            params![key, card.id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if !exists {
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM feature_cards WHERE project_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count as usize >= CARDS_MAX {
            return Err(BOARD_FULL.into());
        }
    }
    let json = serde_json::to_string(&card).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO feature_cards (project_key, id, path, card_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(project_key, id) DO UPDATE SET
           path = excluded.path,
           card_json = excluded.card_json",
        params![key, card.id, path, json, card.created_at],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(card)
}

fn delete_card(conn: &Connection, key: &str, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM feature_cards WHERE project_key = ?1 AND id = ?2",
        params![key, id],
    )?;
    Ok(())
}

fn clear_cards(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM feature_cards WHERE project_key = ?1",
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

    fn card(id: &str, title: &str) -> FeatureCard {
        FeatureCard {
            id: id.into(),
            title: title.into(),
            note: None,
            column: "idea".into(),
            chat_ids: vec![],
            created_at: 1_000,
            updated_at: 1_000,
            moved_at: 1_000,
            shipped_at: None,
            source_url: None,
            basis: None,
        }
    }

    #[test]
    fn migrate_creates_the_table() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'feature_cards'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1);
        // Creating it again on a later launch is harmless.
        ensure_feature_cards_table(&conn).unwrap();
    }

    #[test]
    fn adds_lists_and_replaces_cards_per_project() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        assert!(list_cards(&conn, "/p").unwrap().is_empty());
        let first = put_card(&conn, "/p", "/p", card("a", "Dark mode")).unwrap();
        let mut second = card("b", "Export to CSV");
        second.created_at = 2_000;
        put_card(&conn, "/p", "/p", second).unwrap();
        put_card(&conn, "/q", "/q", card("a", "Other project")).unwrap();
        let titles = |key: &str| {
            list_cards(&conn, key)
                .unwrap()
                .into_iter()
                .map(|card| card.title)
                .collect::<Vec<_>>()
        };
        assert_eq!(titles("/p"), vec!["Dark mode", "Export to CSV"]);
        assert_eq!(titles("/q"), vec!["Other project"]);
        // Replacing a card by its id keeps one row, now in Building.
        let moved = FeatureCard {
            column: "building".into(),
            chat_ids: vec!["chat-1".into()],
            updated_at: 3_000,
            moved_at: 3_000,
            basis: Some("chat-1=working".into()),
            ..first
        };
        put_card(&conn, "/p", "/p", moved.clone()).unwrap();
        let cards = list_cards(&conn, "/p").unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0], moved);
        assert_eq!(titles("/q"), vec!["Other project"]);
    }

    #[test]
    fn saves_cards_in_their_plain_shape() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let saved = put_card(
            &conn,
            "/p",
            "/p",
            FeatureCard {
                title: "  Dark   mode\n".into(),
                note: Some("  Follow the system.\r\n\r\n".into()),
                chat_ids: vec!["a".into(), "b".into(), "a".into()],
                source_url: Some("   ".into()),
                ..card("x", "")
            },
        )
        .unwrap();
        assert_eq!(saved.title, "Dark mode");
        assert_eq!(saved.note.as_deref(), Some("Follow the system."));
        assert_eq!(saved.chat_ids, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(saved.source_url, None);
        let blank = put_card(
            &conn,
            "/p",
            "/p",
            FeatureCard {
                note: Some(" \n ".into()),
                ..card("y", "Blank note")
            },
        )
        .unwrap();
        assert_eq!(blank.note, None);
        // The saved JSON reads back as the same card.
        assert_eq!(list_cards(&conn, "/p").unwrap(), vec![saved, blank]);
    }

    #[test]
    fn refuses_cards_it_cannot_keep() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        let refused = |card: FeatureCard| put_card(&conn, "/p", "/p", card).unwrap_err();
        assert_eq!(refused(card("a", "   ")), "A card needs a title.");
        assert!(refused(card("a", &"x".repeat(TITLE_MAX_CHARS + 1))).contains("title"));
        // Limits count characters, not bytes.
        assert!(put_card(&conn, "/p", "/p", card("a", &"é".repeat(TITLE_MAX_CHARS))).is_ok());
        assert!(refused(FeatureCard {
            note: Some("n".repeat(NOTE_MAX_CHARS + 1)),
            ..card("a", "t")
        })
        .contains("note"));
        assert_eq!(
            refused(FeatureCard {
                column: "needs-you".into(),
                ..card("a", "t")
            }),
            "Invalid column"
        );
        assert_eq!(refused(card("", "t")), "Invalid card");
        assert_eq!(refused(card("a\n", "t")), "Invalid card");
        assert_eq!(
            refused(FeatureCard {
                chat_ids: vec!["".into()],
                ..card("a", "t")
            }),
            "Invalid chat"
        );
        assert!(refused(FeatureCard {
            chat_ids: (0..=CHATS_MAX).map(|n| n.to_string()).collect(),
            ..card("a", "t")
        })
        .contains("50"));
        assert_eq!(
            refused(FeatureCard {
                source_url: Some("https://x\ny".into()),
                ..card("a", "t")
            }),
            "Invalid link"
        );
        assert_eq!(
            refused(FeatureCard {
                created_at: -1,
                ..card("a", "t")
            }),
            "Invalid card"
        );
        // Nothing refused was kept; the one good save was.
        assert_eq!(list_cards(&conn, "/p").unwrap().len(), 1);
    }

    #[test]
    fn a_full_board_takes_no_new_cards_but_still_saves_edits() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        for index in 0..CARDS_MAX {
            put_card(&conn, "/p", "/p", card(&index.to_string(), "Card")).unwrap();
        }
        assert_eq!(
            put_card(&conn, "/p", "/p", card("one-more", "Card")),
            Err(BOARD_FULL.to_string())
        );
        assert!(put_card(&conn, "/p", "/p", card("0", "Edited")).is_ok());
        // Another project's board is its own.
        assert!(put_card(&conn, "/q", "/q", card("one-more", "Card")).is_ok());
    }

    #[test]
    fn delete_and_clear_touch_only_their_cards() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        put_card(&conn, "/p", "/p", card("a", "A")).unwrap();
        put_card(&conn, "/p", "/p", card("b", "B")).unwrap();
        put_card(&conn, "/q", "/q", card("a", "Q")).unwrap();
        delete_card(&conn, "/p", "a").unwrap();
        assert_eq!(
            list_cards(&conn, "/p")
                .unwrap()
                .into_iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
            vec!["b".to_string()]
        );
        clear_cards(&conn, "/p").unwrap();
        assert!(list_cards(&conn, "/p").unwrap().is_empty());
        assert_eq!(list_cards(&conn, "/q").unwrap().len(), 1);
    }

    #[test]
    fn an_unreadable_row_is_skipped() {
        let store = store();
        let conn = store.lock_conn().unwrap();
        put_card(&conn, "/p", "/p", card("a", "A")).unwrap();
        conn.execute(
            "INSERT INTO feature_cards (project_key, id, path, card_json, created_at)
             VALUES ('/p', 'broken', '/p', '{not json', 5)",
            [],
        )
        .unwrap();
        assert_eq!(list_cards(&conn, "/p").unwrap().len(), 1);
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
