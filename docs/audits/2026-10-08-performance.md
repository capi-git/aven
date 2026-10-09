# Performance follow-up — October 8, 2026

## Startup imports

File editors, diff views, terminal views, Race views and the decorative grid
games now load when rendered. Retained file and terminal slots keep their
existing identity and dimensions while a chunk loads. App's editor shortcut
handlers use a small synchronous dispatcher populated by the editor module.
The bundled changelog loads when release notes are requested.

File icons first load the theme's name lookup and a generated subset. Common
icons use the original SVGs exactly; an uncommon icon loads the complete SVG
table on demand. Regenerate the subset with
`node scripts/generate-file-icon-subset.mjs` after upgrading the icon theme.
Tests compare every subset SVG with the installed package, verify uncommon
icons, and retain the unchanged-SVG/hidden-panel regression coverage.

The baseline is main commit `1ba091b8`. Both builds used the same installed
dependencies and `npm run build -- --manifest`. The script
`node scripts/measure-boot-bundle.mjs [dist-directory]` follows static imports
from the entry and App, including App's static dependencies even though the
boot splash loads App dynamically. It counts each JavaScript chunk once and
sums independently compressed gzip sizes at level 9. It excludes optional
dynamic imports, CSS and other assets.

| Startup JavaScript | Baseline | Lazy-loading pass | Combined batch |
| ------------------ | -------: | ----------------: | -------------: |
| Minified bytes     | 3,384,118 | 3,071,022 | 3,085,384 |
| Gzip bytes         | 1,041,354 | 989,848 | 994,874 |

This is 313,096 fewer minified bytes (9.3%) and 51,506 fewer gzip bytes (4.9%).
The icon lookup/subset chunk is 156,695 minified bytes; the previous icon
package chunk loaded just after paint was 1,129,785 bytes. That deferred
chunk is outside the static startup totals above. The full icon table remains
available for uncommon files.

The complete recovered batch, measured at `daa44f6c` with the same script,
includes the subsequent storage and window-synchronization work. Its startup
graph remains 298,734 minified bytes smaller (8.8%) and 46,480 gzip bytes smaller
(4.5%) than the baseline.

These are build-output measurements, not measured startup time or frame rate.
Source tests cover preserved editor buffers, editor shortcuts, file icon
identity, PDF visibility, and release note content after asynchronous loading.
The combined Aven Dev preview supplies the separate native runtime check.

## Session saves

Git metadata and JSON serialization finish before acquiring the shared SQLite
lock. History listing also gathers Git metadata before locking. The frontend
shares adjacent identical pending saves while preserving A–B–A ordering,
failure retries and archive/delete barriers. App's immutable-block fingerprint
continues to skip unchanged periodic snapshots.

The follow-on v12 migration stores each transcript block in an ordered
`session_blocks` row. It preserves duplicate or missing block IDs, unknown JSON
fields, attachments, tools and queued follow-ups. Metadata, transcript edits and
worker ownership commit in one transaction. A save updates only changed rows;
metadata-only changes preserve the transcript revision and activity timestamp.
Normal sidebar listing retains its covering index.

The first save sends a full snapshot. Later saves sanitize unchanged blocks
once and compare identity tokens, sending only changed positions plus an
explicit new length. The native store checks an opaque base revision before
applying each delta. A conflict retries once with the full current snapshot
inside the same ordered queue. Failed writes discard the cached base. A bounded
cache retains tokens rather than closed transcript objects. Legacy responses
without a revision continue to use full snapshots.

Before migrating a populated legacy file, SQLite `VACUUM INTO` writes a
consistent adjacent backup named
`monocode.db.pre-transcript-v12-<uuid>.db`, including committed WAL pages. Schema,
backfill and migration version commit together; malformed legacy transcripts or
any write failure abort the migration without deleting their original JSON.
Reopening an already migrated database does not create another migration
backup. Backups contain chat history and remain in the same app data directory.

**Downgrade limitation:** older Aven versions cannot read the new block rows.
A downgrade requires closing Aven and restoring the pre-v12 backup (including
handling stale WAL/SHM files while the app is closed); that backup reflects the
moment before migration, not subsequent chats. Never copy only a live main
SQLite file as a backup. Use a SQLite snapshot or a cleanly closed database.
Legacy writers that update `blocks_json` invalidate the new revision and clear
obsolete block rows, so their writes cannot silently accept a stale delta.

On disk, connections use `synchronous=NORMAL` only after SQLite confirms WAL
mode. This avoids a disk sync on every streaming snapshot. WAL integrity is
preserved, but the latest committed transactions can be lost after an OS crash
or power loss before a checkpoint; this is the durability tradeoff of NORMAL.

Validation uses disposable databases only. All 55 native session-store tests
pass, including v1 migration, corrupt-record and interrupted-backfill rollback,
revision conflicts, append/reorder/truncate, worker release/delete, search,
archive/pin, and both legacy and normalized snapshot restore. In a 1,200-block
fixture with roughly 4.9 MB of text, changing the last block writes exactly one
transcript row; its delta payload is over 1,000 times smaller than a full
snapshot. A metadata-only follow-up writes zero transcript rows. All 42 focused
web persistence tests pass, covering serialization, queue ordering, retry,
sanitized block positions and deletion barriers. These are deterministic
fixture checks, not a claim of measured end-to-end application latency.

## Native terminal and orchestration waits

Terminal spawn, terminal pipe writes, and orchestration JSON/SQLite saves now run on blocking workers. Terminal input is chained per terminal, so rapid keystrokes retain their order while another terminal can progress independently. Closing a terminal invalidates queued input and a reserved startup; a child that loses that reservation is terminated and reaped rather than installed after Close. Existing completion and error promises remain observable.

Validation: 110 focused PTY/orchestration web tests, TypeScript, 9 native PTY tests and 23 control-filter native tests passed. Regression cases cover ordered input, independent terminals, failed-write recovery, close/kill-all during queued input, pending startup cancellation, and malformed/oversized orchestration saves retaining the previous fixture record. Tests use disposable state and do not touch installed-app data.
