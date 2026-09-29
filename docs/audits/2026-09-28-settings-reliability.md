# Settings and reliability audit — September 28, 2026

## Scope

Reviewed Settings, workspace restoration and shutdown, Notes persistence, and the native provider process lifecycle. This pass starts at `8b28cd2` on the native desktop-control branch. It is a targeted review, not a certification of the entire codebase or a new GPU benchmark.

All edits and builds use the isolated `fix/settings-audit` worktree. Rendered checks used its complete Aven Dev bundle and frontend. The installed Aven process, application bundle, production data, and macOS permissions were not changed for this audit. No release or installation is part of this change.

## Findings and corrections

| Priority | Trigger and consequence | Correction |
| --- | --- | --- |
| P1 | A transcript read error was treated as a missing record. Restoration could create an editable blank session with the original ID and later overwrite the saved transcript. | Actual read failures stop startup before hydration and reach the existing recovery screen. Retrying is allowed. Confirmed missing records still restore blank tabs. |
| P1 | Notes had a per-editor debounce and save queue. Quitting during an edit did not await that queue; returning to a note while its prior save was pending could restore stale text. | One draft and ordered writer per note survives editor remounts and participates in the awaited shutdown flush. Failed drafts remain available, with visible errors. Successful background saves refresh the Notes list. |
| P1 | Explicit quit swallowed transcript, layout, and in-flight state write errors and could proceed after a failed save. | Explicit quit/close stays open and shows the failure. A later retry is allowed. Unload remains best effort because it cannot reliably await work. |
| P1 | Synchronous stdin writes could block native dispatch if a live provider stopped reading a large prompt. | Writes run off the UI thread with a shared 15-second lock/write deadline and cancellation. A timed-out incomplete protocol frame retires only its captured child. |
| P2 | Process exit could arrive before buffered stdout/stderr, retiring frontend protocol handlers before the final result. | Drain both readers before EXIT, capped at two seconds for inherited pipes, then suppress late output. Retire the reaped process registration before draining so Stop does not strand an exited Windows PID. |
| P2 | Settings and the home toolbar kept separate default-access state. The label could disagree with the preference used for new tasks. | Both subscribe to the same stored preference, including same-window and storage events. Existing tasks retain their explicit access mode. |
| P2 | A Skills source filter could remain selected after its source disappeared, hiding other available skills. | Return to All when the selected source no longer exists. |
| P3 | Skills source radios lacked arrow navigation and roving focus. | Reuse the shared segmented control; keyboard selection and focus move together. |

## Settings review

Current-run computer-use screenshots and accessibility observations were displayed in the task. The screenshot tool exposes inline images but no documented local-file export; there is no separate saved screenshot set in this report.

1. **General:** the earlier layout spread labels and controls too far apart and unnecessarily wrapped toggle descriptions. Content now stops at 800 CSS pixels; toggle rows reserve only the switch width. Group outlines, sidebar spacing, and controls use existing theme tokens and outline icons.
2. **Appearance:** the color field previously stretched across the entire card. It now sits beside color targets and the hex field, stacking at narrow widths. Dark and light themes were inspected; the original dark theme was restored.
3. **Skills & tools:** repeated permission paragraphs and detached actions made status hard to scan. Each permission now has its purpose and either Granted or its own Allow/Settings actions. The enable switch, refresh action, and instructions remain available. No permission action was invoked during these visual checks.
4. **Responsive and keyboard behavior:** inspected a narrower native window and the stacked color-picker layout with enlarged interface text. Restored the original text zoom. In the running app, arrow keys selected Personal and Built in and moved focus to the selected radio. Settings search for “color” navigated to and focused the workspace color section.

These checks establish visible layout and the named interactions, not full accessibility conformance. Screen-reader speech, every custom theme's contrast, all display sizes, and Windows rendering were not tested.

## Validation

Checks ran sequentially on the candidate source:

- `npm run check:web`: 3,593 tests in 324 files, plus TypeScript.
- `npm run check:tooling`: packaging, signing, release, development-runner, update, versioning, and browser fixture checks passed.
- `npm run build`: production frontend built.
- `./scripts/with-dev-env.sh cargo fmt --check`: passed.
- `./scripts/with-dev-env.sh cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `./scripts/with-dev-env.sh cargo test --locked -p aven --lib`: 439 tests passed, including seven new native lifecycle regressions.
- `npm run dev:doctor` and `npm run dev:app`: complete Chromium development bundle built, strict signature verification passed, and the exact worktree bundle launched through LaunchServices.
- `git diff --check`: passed.

Existing diagnostics remain visible: Node's experimental localStorage warning, Vite's large chunk warning, and Chromium SDK compile/link warnings. No check was relaxed to hide them. The initial native check needed this worktree's Chromium archive built first; the subsequent check passed.

## Follow-ups and limits

- **P2: desktop screenshot lock contention.** `desktop_control_macos.rs::screenshot` holds the global captures mutex across capture and image scaling commands. Concurrent session bind/revoke operations can wait on it. A follow-up should use per-session ownership and revocation checks so capture work does not hold the global registry lock. This is a source-confirmed contention path; its UI latency was not measured here.
- **Provider replacement generations:** stdout/stderr still identify a session rather than a particular process generation. Late output during replacement needs a separate end-to-end protocol change and regression coverage. The drain fix addresses final output before exit, not all replacement races.
- **Notes across windows:** draft coordination is within one renderer. Simultaneously editing the same note in multiple windows still needs conflict/version handling.
- **Native desktop-control QA:** the current LaunchServices Dev instance reports Accessibility granted and Screen Recording missing. Positive capture/input testing with Dev's own grants remains pending; the UI review does not claim that permission-dependent feature is fully verified.
- Windows-specific behavior received source review and shared lifecycle regression coverage on macOS, not an actual Windows runtime test. No production update/restart or multi-provider end-to-end session was performed.
