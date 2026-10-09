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

At `0d91a25c`, the combined branch passed 4,249 frontend tests across 385 files,
test-inclusive TypeScript, Prettier, lint (warnings remain), the production web
build, Rust formatting, and Clippy with warnings denied. Native tests passed
with Chromium (552) and without it (552). The preceding combined checks also
passed the tooling suites and Chromium pump/image tests. The complete development bundle uses the
separate Aven Dev identity and passed strict signature/package checks.

Live verification reproduced an old native browser covering Settings after a
full shell-document reload. The outgoing React document cannot run its normal
cleanup in that case. The trace showed three browser generations and no close
request until application quit. A primary-window page-load hook now captures
the outgoing native contexts; cleanup rechecks current docked ownership under
the transfer lock. Floating/detached pages are preserved. Cleanup also handles
pages created in a child and subsequently returned to the primary window. A
cached per-document epoch rejects delayed creation from a retired renderer, including
creation queued before Chromium initialization completes. Five focused native
lifecycle and three frontend handshake regressions pass; an independent review
found no remaining source blocker.

The final rebuilt Aven Dev preview passed the original reproduction twice:
reload with a visible browser, change the sidebar width, open Settings, and
return to the workspace. An additional startup document replacement was also
observed. All three outgoing native views received close acknowledgments and
had their clipping view detached; no stale page covered Settings. Dragging the
split divider in both directions kept the page aligned, and repeated Settings
transitions hid and restored the current browser correctly.

Interactive checks also confirmed readable sidebar library actions, the
reordered Appearance sections, a working status-bar opacity slider, color-field
drag/save, and separate dark/light color values. Test changes were restored to
the original dark theme, accent `#c4c8c8`, and 65% status-bar opacity. A separate
read-only frontend review passed 86 focused sidebar, Settings, picker, Git, and
footer tests. Provider execution and every separate-window scenario were not
re-run interactively; their automated checks and native ownership review remain
separate from the observed primary-window reproduction.

Before/after images and private diagnostic traces are retained in
`~/Developer/.worktrees/Aven/scratch/claude-handoff-20261008-163732/`.
The opt-in debug trace records only IDs, geometry, visibility and lifecycle
phases, uses a private bounded file, and excludes page URLs/content. Aven Dev is
left open for review. The installed Aven process stayed running throughout.

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
