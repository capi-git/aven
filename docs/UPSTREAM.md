# Reviewed MonoCode updates

Aven is maintained independently. Its version numbers do not imply feature parity with MonoCode, and its updater uses Aven releases only. Compatible upstream changes are reviewed and adapted with their attribution intact.

## Aven 0.1.117 — review to MonoCode main, 2 October 2026

Reviewed the [106 commits after the previous review point](https://github.com/hardbeat920/monocode/compare/0d3db9c26a460f1354dcf350969d87a6896b8bf0...5f950ec4), through MonoCode main `5f950ec4` (after MonoCode 0.6.0). Each candidate bug was confirmed in Aven's own code before porting, and every change was adapted rather than copied, since MonoCode reorganized its source tree.

Adapted changes, by Aven pull request:

| Aven PR | Upstream commits | Integration |
| --- | --- | --- |
| #46 rendering, scrolling and memory | cfb79a6d, a6554257, d7d7d915, 93810716, 9eebd894 (partial), 6c4b1c66, af4c01df, a67e614f, 4e876a88 (partial), ba4e0cca | Bounded code-highlight and inbox-media caches, cheaper composer and diff-stat measurement, no re-pinning while scrolling up (Aven's reading anchor kept), paragraph-scoped triple-click, hard line breaks for notes, skills and Markdown previews only, immediate Notes paint, and detaching finished orchestration workers. |
| #47 effort animations, menus and settings | 43aac9d2, 1e97594d, a28a9985, dad02c13, 413d699a, b4f5befb, 8fae5666, 16e9fea6, 90c5a655, ed696cc3, e833e83d (partial), f8769ee1 (partial) | MonoCode's effort tiles replace Aven's strength meter at the user's request (purple Ultra, gold Max). Help menu with Aven links only, Window menu items, focused-window menu events, a scale menu instead of a live slider, returning to the previous view after Settings, session ID copying, same-provider second opinions, `/orchestrator`, and `persist-credentials: false` where the token is unused. |
| #48 Git, editor and terminal | 4f6c17ea, e3220ca6, 7aa645db, 5f8d29dc, c43c209d, 3fb4c113, 1ce9057c, ec59d92e, da554f57, d6546d0d, 84633406, ed3c44c6, fea2c0a5, 5c00fe2a, a7e1f3df, 71fd1b54, 0f719180 | Login-shell PATH for networked Git and signing, `--relative` nested diffs, Windows reveal quoting, completed-issue status, CRLF preservation, `.jsonc`, explorer shortcuts, PTY teardown ordering and chunk guards, macOS terminal editing keys, section-scoped and line-level change review, cancelable commit messages, and optional autosave (off by default). |
| #49 agents, providers and streaming | d2a625e4, f028d9e6, 6b313ab9, 877ab2c9, 2cfc1788, 6b8376f9, 79ca3747, d7212c2c, 3b52f30a, f140b02e, 76465752 (partial), 22358b5e (partial), 1a3215d8 (partial) | Shell-first Claude resolution, readable shell command rows, inline subagents ending their turn, one row per background subagent, Claude task lists in the todo panel, exact Claude model versions (Opus 5.5 handling unchanged), OpenCode stream cleanup, window-owned output buffering, Codex monthly windows, unique catalog probe IDs, and batched streaming updates. |

Not imported:

- **Already in Aven:** rate-limit caching, polling constants, remaining-usage meters, reader-place holding during resize, provider CLI updates, and project-picker truncation.
- **Separate product decisions, not ported in this review:** remote SSH sessions and the host service, provider-wide MCP settings, customizable keybindings, configurable CLI paths, pasting files and screenshots from the system pasteboard, multi-folder project opening, bounded search, Pi usage and Codex image assets.
- **Skipped as upstream-only:**
  - MonoCode release, packaging and updater work, including Fedora and Linux glass.
  - Its compact rail, icons, celebrations and automation card.
  - Its BTW, Operator and app-CLI actions, and email masking.
  - Its harness update notices.
  - Changes that depend on any of these.

Aven keeps its own interface, persistent state, provider support, branding and release feed. Validation per pull request was source and headless: frontend and Rust test suites, TypeScript, fmt and clippy. The effort animations were also checked in Aven Dev. Packaged-app checks follow the 0.1.117 release.

## Aven 0.1.100 — project navigation review, 25 September 2026

Reviewed current MonoCode main at [`0d3db9c26a460f1354dcf350969d87a6896b8bf0`](https://github.com/hardbeat920/monocode/tree/0d3db9c26a460f1354dcf350969d87a6896b8bf0), including its project registry, rail ordering, remembered project panes, and per-project sidebar tab selection.

- **Adapted pane-aware project return from [#144 / `5c31b3a`](https://github.com/hardbeat920/monocode/commit/5c31b3a4b2084d7a1eb379d68b42ec919bf7c43e):** locate the requested project's mounted chat, editor, or terminal pane, focus that pane, and derive the active project from it. This prevents a mixed-project split tab from focusing another project's conversation or creating a duplicate tab merely because the requested project is not its first pane. Aven keeps its existing remembered-tab storage, workspace profiles, separate browser surfaces, detached-window routing, and destructive tab ownership rules.
- **Retained Aven's storage-loss fix (`c289e97`):** upstream [`recents.ts`](https://github.com/hardbeat920/monocode/blob/0d3db9c26a460f1354dcf350969d87a6896b8bf0/src/features/projects/model/recents.ts) still reloads storage on each `rememberProject` call, returning an empty list on a missing store. A reproduction using upstream source and fake localStorage loaded Aven, HOLO, and ClippedIn, cleared the fake store, and selected HOLO; upstream returned only HOLO. Copying that implementation would reintroduce the reported disappearance. Aven retains loaded lists and profile assignments through missing/corrupt storage and failed writes.
- **Not imported for this fix:** per-project Workspace tab preferences, folder rename recovery, and shared project context menus address different workflows. Aven's Files and Changes actions use its separate inspector; replacing that routing would change the interface without fixing project membership.

Regression coverage exercises both mixed-chat pane orders, editor/terminal focus, invalid or removed panes, distinct project paths, visible-tab inclusion without changing deletion ownership, and the existing lost-storage sidebar clicks. All 3,430 frontend tests, TypeScript checks, and the frontend build passed. Validation is source/headless only; no production data migration, app restart, or installation is part of this review.

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
