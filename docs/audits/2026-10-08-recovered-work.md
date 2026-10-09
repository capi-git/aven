# Recovered Claude work

The two interrupted chats covered an Aven audit and a selective MonoCode
upstream review. Both stopped at a session limit. Their work was recovered onto
`feat/complete-claude-work`, based on `1ba091b8` (0.1.126), and reconciled with
each other before validation. The original worktrees remain intact. Their
tracked patches, untracked source files and Git states were also saved outside
the repository before integration.

## Included changes

- Interface: distinct Race control; readable sidebar actions; less repeated Git
  history text; contextual browser controls; an unobtrusive single-message
  outline; refreshed staged updates; reorganized settings content; adjustable
  footer opacity while the sidebar is hidden. The existing footer overlap and
  Settings sidebar order remain as requested.
- Startup and rendering: load editor, terminal, diff and release-note code when
  needed; ship a small initial file-icon subset; keep sidebar/title projections
  stable during streaming; extract the workspace session state hook without
  replacing the existing live-session store.
- Native and background work: pause inactive polling and clocks; use bounded
  native process inspection for terminal labels; move terminal/control work
  off the UI thread; slow only the Chromium idle fallback heartbeat; compress
  temporary browser covers; retain the native glass appearance and fix stale
  asynchronous tint acknowledgments.
- Chat interaction: preserve deliberate scroll position during transcript and
  composer resizing; keep IME composition intact; preserve terminal input
  ordering and cancel pending starts when closed.
- Streaming and storage: deliver provider output only to its owning window;
  batch stdout without changing protocol line order; coalesce detached-window
  updates and send changed sessions; store transcript blocks independently and
  send revision-checked deltas, with transactional migration and a consistent
  pre-migration SQLite backup.
- Code quality: separate Git commands from filesystem commands; type-check
  tests; enable lint and stricter return checks; share color-picker interaction,
  error handling and small utilities; remove unused components and plugins;
  consolidate repeated text sizes without changing geometry.
- Selected upstream fixes: provider cleanup and protocol handling; live model
  catalog fallbacks; Pi extension models/status; literal Git paths; active
  worktree terminals; exact-path change selection; larger skill discovery cap;
  file-tree text bounds. Aven's providers, theme, state and release feed remain
  independently maintained.

The previously removed browser assistant bubble is not restored. The earlier
pane-minimization and Fable-usage changes are already in the base release.
Unrelated old worktrees were not folded into this batch.

## Verification boundaries

At `daa44f6c`, the combined branch passed 4,246 frontend tests across 384 files,
test-inclusive TypeScript, Prettier, lint (warnings remain), the production web
build, tooling checks, Rust formatting and Clippy with warnings denied. Native
tests passed with Chromium (546) and without it (552). The Chromium pump and
image tests also passed. The isolated Aven Dev package passed strict signature
and package checks and launched successfully.

Live verification is not complete. A restored native browser page remained over
Settings and persisted after its tab disappeared. Source review and 146 focused
browser/stage tests have not identified the cause. An opt-in development trace
is prepared to record bounds, visibility, native attachment state and lifecycle
phases without URLs or page content. Its privacy/bounds test, Chromium build
and 16 development-runner tests pass. A controlled Dev restart is needed to
collect the trace; the desktop input guard refused the close click when regular
Aven moved in front. Do not treat this candidate as release-ready yet.

Bundle-size reductions and fixture render counts describe the specific checks
in [the performance report](2026-10-08-performance.md), not measured launch
latency or a guaranteed frame-rate improvement. Source, native bridge and
packaged Aven Dev checks are recorded separately.

The target for this handoff is the isolated Aven Dev app. This work does not
replace or restart the installed Aven, change its production data, publish a
release, or push the recovered branches. Release/version changes belong in a
separate batched pull request after review.

The new transcript storage is a schema transition. Opening an older Aven build
against a migrated database is unsupported: downgrade recovery requires its
pre-migration backup and loses newer changes. See the performance report for
backup naming, atomicity and durability details. Migration tests use disposable
databases; the preview uses Aven Dev's separate data directory.

The clean dependency install still reports six pre-existing transitive audit
findings (five low, one high). This batch does not claim to resolve dependency
advisories or perform an unrelated dependency upgrade.
