# Reviewed MonoCode updates

Aven is maintained independently. Its version numbers do not imply feature parity with MonoCode, and its updater uses Aven releases only. Compatible upstream changes are reviewed and adapted with their attribution intact.

## Aven 0.1.85 — 22 September 2026

Reviewed [MonoCode 0.1.54](https://github.com/hardbeat920/monocode/releases/tag/v0.1.54), main commit `e0a9ab79bc82fb903593e97448f38b64abb539a5`, including [94 commits since the preceding review](https://github.com/hardbeat920/monocode/compare/7d307094e4a4da498419ba2cd23c7b3ce47af0a4...e0a9ab79bc82fb903593e97448f38b64abb539a5).

Adapted changes:

| Area | Upstream reference | Aven integration |
| --- | --- | --- |
| Stale approvals | [f187922](https://github.com/hardbeat920/monocode/commit/f1879228996f75134c14efd33e97a4405e2c980e) | Settle unresolved approvals after stopped turns while preserving active steering and prior decisions. |
| Editor refresh and question navigation | [41f3e80](https://github.com/hardbeat920/monocode/commit/41f3e80a58ebf4c0e24f0c4abd5f215b65f85859) | Reconcile initial file watches, invalidate completed edits even with unchanged timestamps, and add keyboard navigation to questions. |
| Native Window menu | [dc950c4](https://github.com/hardbeat920/monocode/commit/dc950c4a8a85281436acfc5cf4063b3119de2e4f) | Register the native macOS menu using Tauri's Window submenu identifier. |
| Syntax highlighting | [de95d66](https://github.com/hardbeat920/monocode/commit/de95d668824a305a1c18ed58bda11d5f646930f8) | Lazy language support for Swift, C/C++, shell, TOML, YAML, SQL and additional file types. |
| Development identity | [7c18c8f](https://github.com/hardbeat920/monocode/commit/7c18c8fe02867416684fcc0481549bc5fe7d1fa4) | Reference for an independent Aven implementation that also isolates data, IPC, browser profiles and updater behavior. |

Aven retains its existing Opus 5.5 support, automatic model discovery, persistent drafts, custom interface and embedded-browser routing. Larger upstream worktree, automation, provider-account and saved-message migrations remain separate integration work; they are not included in this release. Source-tree reorganization, branding and updater endpoints were not imported.

Keep this record updated when porting further changes, and distinguish source/test coverage from packaged macOS verification.
