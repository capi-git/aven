use super::*;

fn input(id: &str, blocks: Value) -> SessionUpsert {
    serde_json::from_value(json!({
        "id": id, "cwd": "/nonexistent/fixture", "harness": "codex", "model": "test",
        "modelSettings": {}, "runtimeMode": "local", "title": "Fixture", "blocks": blocks
    }))
    .unwrap()
}

fn save(conn: &Connection, session: &SessionUpsert) -> SessionSummary {
    upsert_session(conn, session).unwrap()
}

fn patch(session: &SessionUpsert, revision: &str, count: usize, updates: Value) -> SessionUpsert {
    let mut next = session.clone();
    next.blocks = Value::Null;
    next.blocks_delta = Some(
        serde_json::from_value(json!({
            "baseRevision": revision, "blockCount": count, "updates": updates
        }))
        .unwrap(),
    );
    next
}

fn revision(summary: &SessionSummary) -> &str {
    summary.transcript_revision.as_deref().unwrap()
}

fn legacy(conn: &Connection, raw: &str) {
    conn.execute_batch(MIGRATION_V1).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(1, 1);").unwrap();
    conn.execute("INSERT INTO sessions(id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at) VALUES('saved', '/nonexistent/fixture', 'codex', 'test', 'local', 'Legacy', ?1, 11, 22)", [raw]).unwrap();
}

fn observe_rows(conn: &Connection) {
    conn.execute_batch("CREATE TEMP TABLE block_writes(position INTEGER, kind TEXT);
        CREATE TEMP TRIGGER observe_block_update AFTER UPDATE ON main.session_blocks BEGIN INSERT INTO block_writes VALUES(NEW.position, 'update'); END;
        CREATE TEMP TRIGGER observe_block_insert AFTER INSERT ON main.session_blocks BEGIN INSERT INTO block_writes VALUES(NEW.position, 'insert'); END;
        CREATE TEMP TRIGGER observe_block_delete AFTER DELETE ON main.session_blocks BEGIN INSERT INTO block_writes VALUES(OLD.position, 'delete'); END;").unwrap();
}

#[test]
fn delta_changes_only_the_streaming_block_of_a_long_transcript() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let blocks = (0..1200).map(|index| json!({"id":format!("b{index}"), "role":if index == 0 {"user"} else {"assistant"}, "text":"x".repeat(4096)})).collect::<Vec<_>>();
    let session = input("large", json!(blocks));
    let first = save(&conn, &session);
    observe_rows(&conn);
    let delta = patch(
        &session,
        revision(&first),
        1200,
        json!([{"index":1199,"block":{"id":"b1199","role":"assistant","text":"finished"}}]),
    );
    let second = save(&conn, &delta);
    assert_ne!(revision(&first), revision(&second));
    let writes = conn
        .prepare("SELECT position, kind FROM block_writes")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(writes, vec![(1199, "update".into())]);
    assert_eq!(
        get_session(&conn, "large").unwrap().unwrap().blocks[1199]["text"],
        "finished"
    );
    let raw: String = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id='large'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw, "[]");
    conn.execute("DELETE FROM block_writes", []).unwrap();
    let mut metadata = patch(&session, revision(&second), 1200, json!([]));
    metadata.title = "Renamed".into();
    metadata.queued_messages = vec![json!({"id":"next","text":"continue"})];
    let renamed = save(&conn, &metadata);
    assert_eq!(revision(&second), revision(&renamed));
    assert_eq!(second.updated_at, renamed.updated_at);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM block_writes", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert!(
        serde_json::to_vec(&delta).unwrap().len() * 1000
            < serde_json::to_vec(&session).unwrap().len()
    );
}

#[test]
fn append_replace_reorder_and_truncate_preserve_exact_block_values() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let user = json!({"id":"duplicate","role":"user","text":"find café","attachments":[{"path":"/fixture/a.png"}],"futureField":{"keep":true}});
    let tool =
        json!({"id":"duplicate","role":"tool","text":"diagnostic","tool":{"output":"Unicode 🦊"}});
    let session = input("sequence", json!([user]));
    let one = save(&conn, &session);
    let two = save(
        &conn,
        &patch(
            &session,
            revision(&one),
            2,
            json!([{"index":1,"block":tool}]),
        ),
    );
    assert_eq!(
        get_session(&conn, "sequence").unwrap().unwrap().blocks,
        json!([user, tool])
    );
    let three = save(
        &conn,
        &patch(
            &session,
            revision(&two),
            2,
            json!([{"index":0,"block":tool},{"index":1,"block":user}]),
        ),
    );
    let four = save(
        &conn,
        &patch(
            &session,
            revision(&three),
            1,
            json!([{"index":0,"block":user}]),
        ),
    );
    assert_eq!(
        get_session(&conn, "sequence").unwrap().unwrap().blocks,
        json!([user])
    );
    save(&conn, &patch(&session, revision(&four), 0, json!([])));
    assert_eq!(
        get_session(&conn, "sequence").unwrap().unwrap().blocks,
        json!([])
    );
    assert!(list_by_project(&conn, &session.cwd).unwrap().is_empty());
}

#[test]
fn bad_deltas_and_stale_or_recreated_bases_are_atomic() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let session = input("atomic", json!([{"role":"user","text":"original"}]));
    let one = save(&conn, &session);
    for (base, count, updates) in [
        ("stale", 1, json!([])),
        (
            revision(&one),
            3,
            json!([{"index":2,"block":{"text":"missing middle"}}]),
        ),
        (
            revision(&one),
            1,
            json!([{"index":0,"block":{}},{"index":0,"block":{}}]),
        ),
        (revision(&one), 1, json!([{"index":1,"block":{}}])),
    ] {
        let mut invalid = patch(&session, base, count, updates);
        invalid.title = "Must roll back".into();
        assert!(upsert_session(&conn, &invalid).is_err());
        let saved = get_session(&conn, "atomic").unwrap().unwrap();
        assert_eq!(saved.blocks, session.blocks);
        assert_eq!(saved.title, "Fixture");
    }
    let mut other_window = session.clone();
    other_window.blocks[0]["text"] = json!("other writer");
    save(&conn, &other_window);
    assert!(
        upsert_session(&conn, &patch(&session, revision(&one), 1, json!([])))
            .unwrap_err()
            .to_string()
            .contains(transcript::REVISION_MISMATCH)
    );
    delete_session(&conn, "atomic").unwrap();
    let recreated = save(&conn, &session);
    assert_ne!(revision(&one), revision(&recreated));
    assert!(upsert_session(&conn, &patch(&session, revision(&one), 1, json!([]))).is_err());
}

#[test]
fn failed_block_write_rolls_back_earlier_blocks_and_metadata() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let session = input(
        "rollback",
        json!([{"role":"user","text":"original"},{"role":"assistant","text":"answer"}]),
    );
    let first = save(&conn, &session);
    conn.execute_batch("CREATE TRIGGER reject_tail BEFORE UPDATE ON session_blocks WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;").unwrap();
    let mut delta = patch(
        &session,
        revision(&first),
        2,
        json!([{"index":0,"block":{"role":"user","text":"changed"}},{"index":1,"block":{"text":"fail"}}]),
    );
    delta.title = "Not committed".into();
    assert!(upsert_session(&conn, &delta).is_err());
    let restored = get_session(&conn, &session.id).unwrap().unwrap();
    assert_eq!(restored.blocks, session.blocks);
    assert_eq!(restored.title, session.title);
    let current: String = conn
        .query_row(
            "SELECT blocks_revision FROM sessions WHERE id='rollback'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current, revision(&first));
}

#[test]
fn legacy_writes_invalidate_even_when_the_legacy_column_was_already_empty() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    let session = input(
        "legacy-write",
        json!([{"role":"user","text":"new storage"}]),
    );
    let first = save(&conn, &session);
    conn.execute(
        "UPDATE sessions SET blocks_json='[]' WHERE id=?1",
        [&session.id],
    )
    .unwrap();
    assert_eq!(
        get_session(&conn, &session.id).unwrap().unwrap().blocks,
        json!([])
    );
    assert!(
        upsert_session(&conn, &patch(&session, revision(&first), 1, json!([])))
            .unwrap_err()
            .to_string()
            .contains(transcript::REVISION_MISMATCH)
    );
    let legacy_blocks = json!([{"id":"old","role":"user","text":"legacy writer kept"}]);
    conn.execute(
        "UPDATE sessions SET blocks_json=?1 WHERE id=?2",
        params![legacy_blocks.to_string(), session.id],
    )
    .unwrap();
    migrate(&conn).unwrap();
    assert_eq!(
        get_session(&conn, &session.id).unwrap().unwrap().blocks,
        legacy_blocks
    );
}

#[test]
fn corrupt_legacy_rows_abort_schema_and_backfill_without_erasing_any_blob() {
    for raw in ["not json", "null", "{}"] {
        let conn = Connection::open_in_memory().unwrap();
        legacy(&conn, raw);
        assert!(migrate(&conn).is_err());
        assert!(conn.is_autocommit());
        let preserved: String = conn
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id='saved'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, raw);
        let columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='blocks_storage'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 0);
        assert_eq!(
            conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1
        );
    }
}

#[test]
fn version_failure_rolls_back_a_completed_backfill() {
    let conn = Connection::open_in_memory().unwrap();
    let blocks = json!([{"role":"user","text":"preserved"}]);
    legacy(&conn, &blocks.to_string());
    conn.execute_batch("CREATE TRIGGER fail_version BEFORE INSERT ON schema_migrations WHEN NEW.version=12 BEGIN SELECT RAISE(ABORT, 'fixture version failure'); END;").unwrap();
    assert!(migrate(&conn).is_err());
    let raw: String = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id='saved'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw, blocks.to_string());
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='session_blocks'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER fail_version").unwrap();
    migrate(&conn).unwrap();
    let saved = get_session(&conn, "saved").unwrap().unwrap();
    assert_eq!(saved.blocks, blocks);
    assert_eq!((saved.created_at, saved.updated_at), (11, 22));
}

#[test]
fn missing_rows_report_corruption_instead_of_restoring_a_shortened_chat() {
    let store = SessionStore::open_in_memory().unwrap();
    let conn = store.lock_conn().unwrap();
    save(
        &conn,
        &input(
            "missing",
            json!([{"role":"user","text":"one"},{"role":"assistant","text":"two"}]),
        ),
    );
    conn.execute(
        "DELETE FROM session_blocks WHERE session_id='missing' AND position=0",
        [],
    )
    .unwrap();
    assert!(get_session(&conn, "missing").is_err());
    assert!(migrate(&conn).is_err());
}

#[test]
fn file_backup_includes_wal_and_restores_legacy_and_piecewise_history() {
    let root = crate::turn_shots::tests::TemporaryDirectory::new();
    let path = root.0.join("fixture.db");
    let old = Connection::open(&path).unwrap();
    old.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    let original = json!([{"id":"u","role":"user","text":"backup WAL content"}]);
    legacy(&old, &original.to_string());
    let store = SessionStore::open(path.clone()).unwrap();
    let backups = std::fs::read_dir(&root.0)
        .unwrap()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.to_string_lossy().contains("pre-transcript-v12"))
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&backups[0]).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    let backup = Connection::open(&backups[0]).unwrap();
    assert_eq!(
        backup
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id='saved'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        original.to_string()
    );
    assert_eq!(
        backup
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1
    );
    drop(backup);
    drop(old);
    let snapshot = root.0.join("normalized-backup.db");
    let final_blocks = json!([original[0],{"id":"a","role":"assistant","text":"piecewise needle"}]);
    {
        let conn = store.lock_conn().unwrap();
        let session = input("saved", original.clone());
        let first = save(&conn, &session);
        save(
            &conn,
            &patch(
                &session,
                revision(&first),
                2,
                json!([{"index":1,"block":final_blocks[1]}]),
            ),
        );
        set_archived(&conn, "saved", true).unwrap();
        set_pinned(&conn, "saved", true).unwrap();
        let search = SessionSearchOptions {
            query: "needle".into(),
            cwd: None,
            include_archived: false,
        };
        assert!(search_sessions(&conn, &search).unwrap().hits.is_empty());
        assert_eq!(
            search_sessions(
                &conn,
                &SessionSearchOptions {
                    include_archived: true,
                    ..search
                }
            )
            .unwrap()
            .hits[0]
                .block_id
                .as_deref(),
            Some("a")
        );
        conn.execute("VACUUM main INTO ?1", [snapshot.to_str().unwrap()])
            .unwrap();
        delete_session(&conn, "saved").unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM session_blocks", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    drop(store);
    let restored = SessionStore::open(snapshot).unwrap();
    let conn = restored.lock_conn().unwrap();
    assert_eq!(
        get_session(&conn, "saved").unwrap().unwrap().blocks,
        final_blocks
    );
    let summary = &list_by_project(&conn, "/nonexistent/fixture").unwrap()[0];
    assert!(summary.archived && summary.pinned);
    let legacy_restore = root.0.join("legacy-restored.db");
    std::fs::copy(&backups[0], &legacy_restore).unwrap();
    let restored = SessionStore::open(legacy_restore).unwrap();
    assert_eq!(
        get_session(&restored.lock_conn().unwrap(), "saved")
            .unwrap()
            .unwrap()
            .blocks,
        original
    );
    let reopened = SessionStore::open(path).unwrap();
    assert!(get_session(&reopened.lock_conn().unwrap(), "saved")
        .unwrap()
        .is_none());
}
