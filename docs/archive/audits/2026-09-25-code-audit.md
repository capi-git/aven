# Aven code audit — 2026-09-25

## Scope

Reviewed `work/next-changes`, starting from clean commit `8294ad9`. The separate `fix/update-session-restore` branch is outside this audit and has not been merged.

This was a targeted manual review of persistence, project removal, process ownership, browser/native security boundaries, dependencies, and development/release checks, supported by the full existing automated suites. It is not a line-by-line certification of every feature. The installed Aven, production chats, and user settings were not replaced or modified for testing. No release or remote write was performed.

## Findings corrected

| Area               | Finding                                                                                                                                                       | Correction and regression coverage                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database migration | A failed or interrupted historical migration could leave a column without its version row, preventing the next startup.                                       | Schema changes, repair/backfill work, and version rows now commit together. Historical column additions are idempotent. Tests exercise interrupted legacy migrations, rollback after a simulated write failure, and preservation of a saved transcript.                                                            |
| Notes deletion     | A rejected deletion permanently disabled the editor's autosave. Concurrent delete requests and a post-delete list failure could also produce incorrect state. | Serialize deletion behind existing saves, suppress duplicate requests, restore autosave on failure, and update the list directly after a successful mutation. Tests cover failure, edits during deletion, unmount, and successful deletion without resurrection.                                                   |
| Notes reads        | Storage failures appeared as an empty collection, and stale list responses could overwrite newer reads or mutations.                                          | Propagate failures, retain the last good cache, show a retry action, and discard superseded responses. Optional composer suggestions handle read failures locally.                                                                                                                                                 |
| Project deletion   | Errors were swallowed while the project disappeared from the sidebar; normal history queries also omitted saved workers and other hidden rows.                | Await the established conversation shutdown/save/delete lifecycle using a complete project inventory, retain the project on failure or cancellation, report partial completion, and check for newly opened work before removing it. Deletion remains per conversation rather than atomic across an entire project. |
| Usage refresh      | Simultaneous Codex usage probes shared one native child ID and could replace or kill one another.                                                             | Assign each invocation a UUID and restrict watch, cleanup, and kill operations to that invocation. A concurrency regression checks independent ownership.                                                                                                                                                          |
| Terminal handles   | Duplicated PTY descriptors were inherited by unrelated child processes; fallible setup after spawning could leave a shell unregistered.                       | Open and duplicate descriptors with close-on-exec, manage ownership with `OwnedFd`, and finish fallible descriptor setup before spawning. Native tests check descriptor flags and actual shell output through the PTY.                                                                                             |
| TLS dependency     | Locked `rustls` 0.23.43 was affected by [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html).                                           | Updated to compatible 0.23.45 and regenerated third-party notices. The final OSV query reports no advisory for that version. The advisory concerns TLS 1.3 handshake encryption-level validation; it does not establish an authenticated-transcript MITM bypass.                                                   |

## Quality gates and documentation

- Pull-request CI now includes native macOS formatting, Clippy with warnings denied, and tests using the WebKit fallback. Release CI continues to build the Chromium app.
- Packaging, development-runner, update-archive, and versioning fixture tests now have a `check:tooling` command included in `npm run check` and frontend CI.
- Corrected the security documentation's outdated statement that Aven has no updater.
- Corrected an intentionally unused browser option in the fallback build so its Clippy gate passes.

## Verification

All commands below passed on the final source candidate. Logs remain under ignored `target/audit-*` paths for this checkout. The two native configurations share many tests; their counts must not be added as unique coverage.

| Check                                                                                                            | Result                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run check:web`                                                                                              | 3,309 tests across 296 files; TypeScript passed.                                             |
| `npm run build`                                                                                                  | Production frontend bundle built successfully.                                               |
| `npm run check:tooling`                                                                                          | 23 Python fixture tests passed.                                                              |
| `./scripts/with-dev-env.sh npm run check:rust`                                                                   | Formatting and Clippy passed; 384 native tests passed with the default Chromium feature.     |
| `cargo clippy --locked --workspace --all-targets --no-default-features -- -D warnings` and matching `cargo test` | Clippy and 391 native tests passed with the WebKit fallback.                                 |
| `./scripts/with-dev-env.sh ./scripts/build-chromium.sh`                                                          | Native Chromium bridge/helpers compiled successfully. No Chromium bridge source was changed. |
| Third-party notice generation                                                                                    | Complete for 632 packages; only the rustls version/archive URL changed.                      |
| Diff and scoped formatting checks                                                                                | Passed.                                                                                      |

Native commands used `scripts/with-dev-env.sh` for the local toolchain and Chromium SDK environment. Existing build diagnostics remain: Vite reports some large chunks, the test runner emits Node's experimental localStorage warning, and the Chromium SDK headers emit two initializer warnings. These were not hidden by relaxing checks. Rust Clippy still runs with warnings denied.

### Rendered check

Used Aven's scoped in-app browser to render the actual Notes component with disposable mocked storage. A forced delete failure displayed an error and retained the note. Editing the title afterward produced a successful autosave and updated the sidebar. This verifies the component interaction; it does not exercise production storage or a packaged app.

Also rendered the actual project-removal dialog with disposable inventory responses. A failed inventory displayed a visible error and disabled Delete. A successful inventory displayed all three fixture conversations, including the worker, and enabled Delete. No project deletion was performed in the running app.

### Dependency and security review

- `npm audit --json`: zero known npm vulnerabilities at audit time.
- Queried OSV for all 539 registry packages in the final Cargo lockfile. Remaining findings are described below; the pre-fix and final scans are separate artifacts.
- A bounded scan of tracked text files found no matching private-key headers, AWS access-key IDs, or GitHub token patterns. This does not establish that all possible secrets are absent.
- Reviewed Tauri capabilities/CSP, browser permission and download handling, page/host bridge separation, typed DOM actions, scoped agent socket authentication, caller ownership, and grant/revocation paths. No additional concrete defect was established in that source review; no penetration test or complete packaged security assessment was performed.

## Remaining work and limits

1. **Resolve the Linux GTK dependency before a Linux release.** `glib` 0.18.5 is affected by [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), a `VariantStrIter` memory-safety defect. The fixed line starts at 0.20, which is incompatible with the current GTK dependency line. This dependency is absent from the explicit Apple Silicon macOS graph. An upstream transition or reviewed backport needs a separate Linux validation effort; it was not silently overridden here.
2. **Track upstream maintenance advisories.** Linux-only `proc-macro-error` 1.0.4 and five `unic-*` 0.9.0 packages carry unmaintained notices. These are maintenance findings, not additional demonstrated vulnerabilities. The Unicode packages remain transitive requirements through `tauri-utils` and `urlpattern`; the current compatible upstream line does not remove them.
3. **Reduce the responsibilities of `src/App.tsx` incrementally.** It remains roughly 9,700 lines and coordinates storage, session lifecycle, tabs, and integrations. The audit makes focused reliability changes; a wholesale extraction would need separate behavior-preservation work.
4. **Complete packaged runtime validation before release.** These checks do not cover every provider, native window interaction, multi-window orchestration race, updater restart, or platform. No newly packaged production app was installed or launched. The new hosted CI jobs have not been dispatched from this local audit.

The corrected macOS code passes the checks recorded in this report. That is a bounded quality result, not a claim that the entire application is free of defects.
