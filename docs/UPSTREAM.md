# Reviewed MonoCode updates

Aven is maintained independently. Its version numbers do not imply feature parity with MonoCode, and its updater uses Aven releases only. Compatible upstream changes are reviewed and adapted with their attribution intact.

## Aven 0.1.165 — review to MonoCode main, 2 November 2026

Reviewed the [744 commits after the previous review point](https://github.com/hardbeat920/monocode/compare/5f950ec4...5a31951) (647 changes and 97 merges), through MonoCode main `5a31951` (after MonoCode 0.16.0 and its native previews). In this period MonoCode rewrote its desktop app in GPUI (a native Rust UI), added a mobile companion, a remote host service and resident "Mono" agents; most of the 744 commits belong to those. Aven stays a Tauri and React app with its own Teams and project bots, so the review looked for fixes to the shared provider protocols, the Tauri commands and the transcript model. Every candidate was confirmed in Aven's own code before porting, and each change was adapted rather than copied.

Adapted changes, one Aven commit per upstream change or tight group:

| Area | Upstream commits | Aven integration |
| --- | --- | --- |
| Claude Code | 0abb2c8 (#958), 2e0c5e4 (#532) | A `rate_limit_event` rejection whose window is the extra-usage pool (`rateLimitType` "overage", a refused fast mode) no longer holds the chat back until the monthly reset. A resume's replayed background-task result (`origin.kind` "task-notification", zero turns) never ends the real turn, and a limit it reported is cleared. |
| Codex | db006a4 (#878) | `resolve_codex` asks the login shell first, as `resolve_claude` already did, so Aven runs the same `codex` as the terminal instead of the ChatGPT app's older wrapper in `~/.local/bin`. |
| Skills | 33c23f4 (#978) | A SKILL.md whose 16 KiB prefix ends inside a multi-byte character is listed instead of silently dropped. |
| Pi and omp | a7e3b6d (#921), 41b7243 (#846), 5aef862 (#766) | The Pi probe polls until extension providers have registered their models (five-second window, one quiet second, 45-second deadline that keeps what it collected). omp probes with extensions loaded. Copilot's internal agents and legacy snapshots are hidden by name. |
| Cursor | 6a5b8d1 | Model discovery no longer sends `authenticate` with `cursor_login`, which could open a browser sign-in from a background refresh. |
| Transcript | 190902f (#763, partial), fd10730 (#882) | Punctuation-only assistant replies (a bare "." between tool calls) are dropped when sealed, completed or stopped. An opened thinking row is titled "Thinking" instead of repeating its first paragraph. |
| Git | 6e09ab8 (#1004) | Every local git command gets `cached_gui_search_path()` (the login-shell PATH only once it has been read, then the inherited PATH and the fixed dirs), so git-lfs filters resolve from a Finder launch without a status refresh waiting on the shell. |
| Windows | 6793b0e (#908) | `open_new_window` is an async command, so WebView2 builds the window off the main thread instead of deadlocking into a blank frame. |
| Styles | 51b561b (#876), b3bf7b4 | Markdown table cells keep a readable minimum width, and the `group-focus-within` variant is redefined so WebKit keys it on `.group` instead of re-checking the whole page on every focus move. |
| New chats | 7fdd048 (#896) | A new chat, and one started from the Inbox or a note, opens in the project the sidebar shows (`visibleProjectCwd`: the active chat, else the focused file tab, else the chosen project), not in the project of the first chat in the list. Aven has no per-session worktrees, so the worktree-focus part does not apply. |
| Turn clock | 4630908 (#1021) | A message sent mid-turn has no start of its own; `joinedTurnStart` walks back to the turn it joined, so the live clock no longer restarts at 0 whenever the chat comes back on screen. |
| Windows of the app | fb1aa9b (#909) | Appearance changes made in Settings (status bar opacity, chat background, sidebar glass, UI scale, scheme and tint) reach every other open window through the storage event, as workspace themes already did. |

Not imported:

- **Already in Aven:** the Codex `collaborationMode` omission until a model is known (c2b479d), keyed Pi status rows (b74e803), the 5,000-skill catalog cap (07f29c1), Pi probes with extensions (c7de48f), async Codex questions over `turn/steer` (98da85a), ephemeral text threads and deleted text sessions (3e157b7), the ETXTBSY spawn retry (e96c926), idle warm-agent caps (e7e19fe), live remaining-usage meters (3ab724d), literal git pathspecs and quoted-path handling (60102ab, 7a040c0), the `hasLiveCatalog` refresh guard (eb14d1a), the parked composer runner loop (92708f0), the consumed-handoff flush (73a7aa9: Aven's `setSessions` settles its ref synchronously) and saved Claude versions resolving to the live alias's settings (834e5b9: Aven's `pickerAliases`).
- **Not applicable to Aven:** turn token totals (2296c09), provider accounts (8e4da94, 5f1cc6e, 5fda02d), the host service's Pi detection (e9fd233), Hermes (081b1bc), remote sessions, tray behaviour (1a28c17), Linux-only fixes (624e603), sound cues (b859824), the shortcut recorder (05e5bb7), the Inbox, artifacts and lazy surfaces. Windows checkpoint overlap comparisons (735f2db): Aven's checkpoint matches a manifest to a project with `same_cwd`, which compares the two expanded paths component-wise (so `/` and `\` agree on Windows) and never compares saved parent and child workspaces. The 0700 selection directories (7d099eb): Aven creates no git selection directory; its race scratch index is a file git writes under the per-user temp dir.
- **Separate product decisions, not ported in this review:** Monos (resident agents with SOUL.md, memory, habits, their chat, triggers, Codex store and everything built only for them), the GPUI native app and its previews, the mobile companion and phone pairing, the remote host service, OpenCode 2.x servers (0eb2773 (#434): a new service URL/password transport, v2 endpoints and event stream, about 3,000 lines; it needs its own pull request and an OpenCode 2.x install to verify), the Devin and Antigravity providers, session worktrees, the Inbox integrations, Git-backed turn checkpoint reviews, HTML artifacts, per-project themes, the inset layout, and `CLAUDE_CODE_ENTRYPOINT` relabeling (59e0c42, 50a6f88: an opt-in experiment upstream; Aven sets nothing).
- **Skipped as upstream-only:**
  - MonoCode release, packaging, CI, notarization and changelog work.
  - Its transcript scrolling, pacing, pool and retention rewrites (214283c, 3e05e03, 7933972, 002d393, 53777ef, 51abda1, 5a73595, aa2ee18 and related): Aven keeps its own reading anchor, batching (#49) and performance program.
  - Its React-era UI fixes in areas Aven does not share (Notes slugs, file editor view modes, diff gutters and scrollbar markers, the Changes list, composer file drops, context menus, resource pressure notices, model picker labels) and its GPUI-era fixes.
  - Changes that depend on any of these.

Aven keeps its own interface, persistent state, provider support, branding and release feed. Validation was source and headless: `TZ=UTC npm run check:web` (Prettier, oxlint, Vitest, TypeScript) and `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test --lib`. The redefined CSS variant was confirmed in the built stylesheet. Packaged-app checks follow the next release.

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
