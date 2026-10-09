//! Ordered transcript rows and optimistic deltas. All mutations run inside the
//! caller's transaction; metadata, transcript and worker ownership commit together.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const REVISION_MISMATCH: &str = "TRANSCRIPT_REVISION_MISMATCH";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Delta {
    pub base_revision: String,
    pub block_count: usize,
    pub updates: Vec<Update>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    pub index: usize,
    pub block: Value,
}

struct Block {
    json: String,
    role: Option<String>,
    lead: Option<String>,
}

pub(super) struct Prepared {
    base_revision: Option<String>,
    count: usize,
    blocks: Vec<(usize, Block)>,
}

pub(super) struct Applied {
    pub changed: bool,
    pub revision: String,
    pub has_user: bool,
    pub worker_lead: Option<String>,
}

fn invalid(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message.into(),
    )))
}

fn block(value: &Value) -> rusqlite::Result<Block> {
    Ok(Block {
        json: serde_json::to_string(value).map_err(|error| invalid(error.to_string()))?,
        role: value.get("role").and_then(Value::as_str).map(str::to_owned),
        lead: value
            .get("orchestrationLeadId")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

pub(super) fn prepare(full: &Value, delta: Option<&Delta>) -> rusqlite::Result<Prepared> {
    if let Some(delta) = delta {
        if !full.is_null()
            || delta.base_revision.is_empty()
            || delta.block_count > i64::MAX as usize
        {
            return Err(invalid("Invalid transcript delta"));
        }
        let mut seen = std::collections::HashSet::new();
        let blocks = delta
            .updates
            .iter()
            .map(|update| {
                if update.index >= delta.block_count || !seen.insert(update.index) {
                    return Err(invalid("Invalid or duplicate transcript position"));
                }
                Ok((update.index, block(&update.block)?))
            })
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Prepared {
            base_revision: Some(delta.base_revision.clone()),
            count: delta.block_count,
            blocks,
        })
    } else {
        let values = full
            .as_array()
            .ok_or_else(|| invalid("blocks must be an array"))?;
        Ok(Prepared {
            base_revision: None,
            count: values.len(),
            blocks: values
                .iter()
                .enumerate()
                .map(|(index, value)| Ok((index, block(value)?)))
                .collect::<rusqlite::Result<_>>()?,
        })
    }
}

/// Legacy writers replace blocks_json without knowing about the new rows. Mark
/// their write as legacy and invalidate its revision, so a cached delta can never
/// apply to an incompatible base. Downgrades still need the pre-migration backup:
/// an old reader cannot reconstruct rows written only by the new version.
pub(super) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for (name, decl) in [
        ("blocks_storage", "INTEGER NOT NULL DEFAULT 0"),
        ("blocks_count", "INTEGER NOT NULL DEFAULT 0"),
        ("blocks_revision", "TEXT NOT NULL DEFAULT ''"),
    ] {
        super::ensure_session_column(conn, name, decl)?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_blocks (
           session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
           position INTEGER NOT NULL CHECK(position >= 0),
           block_json TEXT NOT NULL,
           role TEXT,
           worker_lead TEXT,
           PRIMARY KEY(session_id, position)
         );
         CREATE INDEX IF NOT EXISTS session_blocks_role ON session_blocks(session_id, role);
         CREATE TRIGGER IF NOT EXISTS sessions_legacy_transcript_write
         AFTER UPDATE OF blocks_json ON sessions
         WHEN NEW.blocks_storage = OLD.blocks_storage
         BEGIN
           DELETE FROM session_blocks WHERE session_id = NEW.id;
           UPDATE sessions SET blocks_storage = 0, blocks_revision = '', blocks_count = 0
             WHERE id = NEW.id;
         END;",
    )?;
    let ids = conn
        .prepare("SELECT id FROM sessions WHERE blocks_storage = 0 ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        // Parse one transcript at a time; a malformed record aborts the entire
        // migration rather than committing a partially empty chat history.
        let full = read(conn, &id)?;
        apply(conn, &id, prepare(&full, None)?)?;
    }
    let broken: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions s WHERE blocks_storage != 1
           OR blocks_count != (SELECT COUNT(*) FROM session_blocks b WHERE b.session_id = s.id)
           OR (blocks_count > 0 AND blocks_count - 1 !=
              (SELECT MAX(position) FROM session_blocks b WHERE b.session_id = s.id)))",
        [],
        |row| row.get(0),
    )?;
    if broken {
        return Err(invalid(
            "Transcript rows are incomplete; restore the database backup",
        ));
    }
    Ok(())
}

pub(super) fn apply(conn: &Connection, id: &str, prepared: Prepared) -> rusqlite::Result<Applied> {
    let (storage, count, revision): (i64, usize, String) = conn.query_row(
        "SELECT blocks_storage, blocks_count, blocks_revision FROM sessions WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, count_from_row(row, 1)?, row.get(2)?)),
    )?;
    if let Some(base) = &prepared.base_revision {
        if storage != 1 || revision != *base {
            return Err(invalid(REVISION_MISMATCH));
        }
        // A delta may replace, append, reorder or truncate. Every new position
        // must be supplied: never leave holes that silently disappear on read.
        if prepared.count > count
            && prepared
                .blocks
                .iter()
                .filter(|(index, _)| *index >= count)
                .count()
                != prepared.count - count
        {
            return Err(invalid("Transcript delta is missing appended blocks"));
        }
    }
    let legacy_equal = if storage == 0 {
        let raw: String = conn.query_row(
            "SELECT blocks_json FROM sessions WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let previous: Value =
            serde_json::from_str(&raw).map_err(|error| invalid(error.to_string()))?;
        previous.as_array().is_some_and(|values| {
            values.len() == prepared.count
                && prepared.blocks.iter().all(|(index, block)| {
                    serde_json::from_str::<Value>(&block.json)
                        .is_ok_and(|value| values.get(*index) == Some(&value))
                })
        })
    } else {
        false
    };
    let mut changes = 0;
    {
        let mut write = conn.prepare(
            "INSERT INTO session_blocks(session_id, position, block_json, role, worker_lead)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(session_id, position) DO UPDATE SET
               block_json = excluded.block_json, role = excluded.role, worker_lead = excluded.worker_lead
             WHERE session_blocks.block_json IS NOT excluded.block_json",
        )?;
        for (index, block) in &prepared.blocks {
            changes += write.execute(params![
                id,
                *index as i64,
                block.json,
                block.role,
                block.lead
            ])?;
        }
    }
    changes += conn.execute(
        "DELETE FROM session_blocks WHERE session_id = ?1 AND position >= ?2",
        params![id, prepared.count as i64],
    )?;
    let changed = if storage == 0 {
        !legacy_equal
    } else {
        changes > 0
    };
    let revision = if changed || storage == 0 || revision.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        revision
    };
    let has_user: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_blocks WHERE session_id = ?1 AND role = 'user')",
        [id],
        |row| row.get(0),
    )?;
    let worker_lead = conn.query_row(
        "SELECT worker_lead FROM session_blocks WHERE session_id = ?1 AND role = 'user' AND worker_lead IS NOT NULL ORDER BY position LIMIT 1",
        [id], |row| row.get(0),
    ).optional()?;
    if storage == 0 {
        conn.execute(
            "UPDATE sessions SET blocks_json = '[]', blocks_storage = 1, blocks_count = ?2,
               blocks_revision = ?3, has_user_message = ?4 WHERE id = ?1",
            params![id, prepared.count as i64, revision, has_user],
        )?;
    } else {
        conn.execute(
            "UPDATE sessions SET blocks_count = ?2, blocks_revision = ?3, has_user_message = ?4
             WHERE id = ?1 AND (blocks_count != ?2 OR blocks_revision != ?3 OR has_user_message != ?4)",
            params![id, prepared.count as i64, revision, has_user],
        )?;
    }
    Ok(Applied {
        changed,
        revision,
        has_user,
        worker_lead,
    })
}

fn count_from_row(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<usize> {
    usize::try_from(row.get::<_, i64>(index)?)
        .map_err(|_| invalid("Invalid transcript position or count"))
}

pub(super) fn read(conn: &Connection, id: &str) -> rusqlite::Result<Value> {
    let (storage, count): (i64, usize) = conn.query_row(
        "SELECT blocks_storage, blocks_count FROM sessions WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, count_from_row(row, 1)?)),
    )?;
    if storage == 0 {
        let raw: String = conn.query_row(
            "SELECT blocks_json FROM sessions WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let value: Value =
            serde_json::from_str(&raw).map_err(|error| invalid(error.to_string()))?;
        if !value.is_array() {
            return Err(invalid("Legacy transcript must be an array"));
        }
        return Ok(value);
    }
    if storage != 1 {
        return Err(invalid("Unsupported transcript storage version"));
    }
    let mut values = Vec::with_capacity(count.min(100_000));
    let mut statement = conn.prepare(
        "SELECT position, block_json FROM session_blocks WHERE session_id = ?1 ORDER BY position",
    )?;
    let mut rows = statement.query([id])?;
    while let Some(row) = rows.next()? {
        let position = count_from_row(row, 0)?;
        if position != values.len() {
            return Err(invalid("Transcript row is missing"));
        }
        let raw: String = row.get(1)?;
        values
            .push(serde_json::from_str::<Value>(&raw).map_err(|error| invalid(error.to_string()))?);
    }
    if values.len() != count {
        return Err(invalid("Transcript row count does not match"));
    }
    Ok(Value::Array(values))
}
