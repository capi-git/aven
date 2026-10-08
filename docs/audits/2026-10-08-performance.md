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

| Startup JavaScript |  Baseline | Candidate |
| ------------------ | --------: | --------: |
| Minified bytes     | 3,384,118 | 3,071,022 |
| Gzip bytes         | 1,041,354 |   989,848 |

This is 313,096 fewer minified bytes (9.3%) and 51,506 fewer gzip bytes (4.9%).
The icon lookup/subset chunk is 156,695 minified bytes; the previous icon
package chunk loaded just after paint was 1,129,785 bytes. That deferred
chunk is outside the static startup totals above. The full icon table remains
available for uncommon files.

These are build-output measurements, not measured startup time or frame rate.
Source tests cover preserved editor buffers, editor shortcuts, file icon
identity, PDF visibility, and release note content after asynchronous loading.
The combined Aven Dev preview supplies the separate native runtime check.

## Session saves

Git metadata and JSON serialization now finish before acquiring the shared
SQLite lock. History listing also gathers Git metadata before locking. An
unchanged upsert executes no row update; changes to metadata, context or the
queued follow-ups still persist even when transcript text is unchanged.
The frontend shares adjacent identical pending saves, while preserving
A–B–A ordering, failure retries and archive/delete barriers. It does not cache
completed writes across windows. App's existing immutable-block fingerprint
continues to skip unchanged periodic snapshots.

On disk, connections use `synchronous=NORMAL` only after SQLite confirms WAL
mode. This avoids a disk sync on every streaming snapshot. WAL integrity is
preserved, but the latest committed transactions can be lost after an OS crash
or power loss before a checkpoint; this is the durability tradeoff of NORMAL.
The fixture verifies the configured pragmas, reopening saved history and
SQLite integrity. No schema, production data or transcript format changed.

Storage is still one `blocks_json` value per session. Saving individual messages
would require a schema/format transition and compatibility work for restore,
search, worker ownership, backups and older records. That was explicitly
deferred in the original audit; the changes above reduce redundant work without
pretending to implement incremental message storage.
