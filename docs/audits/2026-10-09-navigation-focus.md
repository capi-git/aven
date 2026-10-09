# Navigation and focus follow-up — October 9, 2026

Reviewed release 0.1.128 (`1d907819`) in a separate Aven Dev checkout after reports
of duplicate browser panes, slow file-to-chat navigation, and background agents
selecting another chat or window. The installed task host remained 0.1.127; this
is source and Dev verification, not an installed-production upgrade audit.

## Changes

- Ordinary agent opens share an existing normalized URL within the authorized
  project, including pages in another workspace window. Concurrent opens share
  their pending result. Explicit `newTab` still creates a separate copy. Different
  URLs with the same title remain separate; query strings and fragments matter.
- Agent pages join an existing browser pane before considering another pane or
  a new right-hand split. Existing split sizes and minimized panes are retained.
  An open from a background task leaves the user's selected page and chat alone.
- Agent file opens preserve chat/editor selection. Detached browser and file
  requests no longer unminimize, show, recover or activate the receiving window.
  Intentional user selections still activate their destination.
- Explicit absolute file paths no longer wait for the project file index or
  silently fuzzy-match a different file. Relative/basename lookup remains.
- Delayed file/history navigation yields to the next user click, keystroke or
  navigation request. A delayed line reveal cannot focus an inactive editor;
  agent line reveals also preserve the selection/caret.

The production changes add no timer or animation loop. Pending browser entries
are released after success or failure. The navigation cancellation hook uses two
capture listeners, with cleanup on unmount.

## Automated verification

- Full web checks: 4,323 tests in 390 files, TypeScript, formatting and lint passed.
- Focused navigation/browser/file checks: 136 tests in nine files passed. The
  detached renderer suite additionally checks that a hidden agent-requested
  browser initializes with usable bounds; all five tests passed after that check.
- Locked native Clippy with warnings denied and formatting passed. All 592 native
  library tests passed both with Chromium and with `--no-default-features`.
- Packaging, release/signing, updater, development launcher and version tooling
  tests passed, including 14 Chromium browser sleep/update probe tests.
- Production frontend build passed. Static startup imports total 3,091,372
  minified bytes / 996,871 independently gzipped bytes, compared with 3,089,573 /
  996,304 in the preceding audit. No dependency was added. Existing lint and
  bundle-size warnings remain.
- The rebuilt Dev package passed strict signature verification for its 269 files
  and 10 native payloads, with Chromium sandboxing enabled.

## Native checks and measurements

A real Codex task in Dev opened the same URL twice and returned the same page ID.
A second URL joined the right-hand browser group without creating another split.
A subsequent delayed task reused the first URL and added a third page while a
separate chat held an unsent draft. That chat stayed selected; a second typed
phrase appended at the existing caret. The test draft was then cleared.

A detached-window browser/file test reached the requested page and README, but
other pointer actions occurred during that run. It cannot establish unattended
window-focus behavior and needs a separate uninterrupted run. Automated tests
cover the passive request flag and preserved detached selection independently.

The one-minute main-window background-open capture recorded 7,193 animation
intervals: p95 9 ms, p99 10 ms, maximum 36 ms, one interval over 33.4 ms. The
baseline project/chat navigation capture recorded 7,196 intervals with p95 9 ms,
p99 10 ms and maximum 40 ms. No uncaught error or unhandled promise rejection was
recorded. This measures callback scheduling, not physical presentation or INP;
the baseline did not reproduce a large-project file-index delay. The regression
test explicitly holds an index scan pending while opening an absolute path.

A 45-second browser/task workload averaged 18.87% of one CPU core and peaked at
63.11% for one sample. Attributed Dev process/helper footprint declined from
1,571 MiB to 1,152 MiB. The raw GPU driver counter delta was 593,865,291; it is not
a utilization percentage and excludes unattributed WindowServer composition.
These include Chromium pages and provider work, use the same process-responsibility
sampler as the preceding audit, and are not comparable to an empty-app baseline.
Other applications remained open. Short samples do not establish a leak bound,
thermal/power target, or guaranteed smoothness for every project.

The broader source audit, provider quota limit, and platform/installation
boundaries remain documented in [the preceding audit](2026-10-09-deep-audit.md).

## Startup follow-up

Removed the normal startup logo, “Opening Aven…” message and cover fade. The
workspace is no longer covered while it loads, and startup completion removes
the hidden recovery element in the first React layout commit, without waiting
for animation frames or a fade timer. Initial saved-theme styling, parallel
workspace/bundle loading, and native glass activation remain in place.

Recovery stays hidden during normal startup. A failed entry module or a startup
that has not completed after 15 seconds still exposes Retry; it does not restart
the app automatically or modify saved drafts. Tests check the actual startup CSS
so a display rule cannot accidentally override the hidden recovery element.

After this follow-up, all 4,322 web tests in 390 files, TypeScript, formatting,
lint and the production frontend build passed. The 30 focused startup/theme/
render-failure/detached-workspace tests passed; the recovery suite also passed
after its computed-style assertions were added. Aven Dev was unavailable on the
current desktop, so this does not claim an observed cold launch of the revised
startup flow. The installed host was not restarted.

## In-app menus and window detachment follow-up

Tab, group, browser-layout and Recent menus now use the same in-app Popover as
the footer provider details. They no longer create native popup windows. Their
placement follows the trigger and stays within the app viewport. The existing
browser overlay snapshot path keeps menus above Chromium without reloading or
closing the page. Native browser toolbar actions keep their existing host.

Removed tab/group move-to-window commands and drag-out creation from the main
workspace. Splitting, grouping and reordering inside the workspace remain.
Previously detached workspaces retain their saved state, recovery controls and
return-to-original-window actions.

Menu autofocus happens after the hidden measurement pass and requests keyboard
focus for the app webview. Escape and selection return DOM focus to the trigger;
outside dismissal leaves the user's new target alone. A late native focus reply
cannot refocus a closed menu or override a later pointer/focus change. No new
dependencies, production timers or polling were added. The React review covered
effect cleanup, async focus guards, keyboard access and retained browser state.

All 4,327 web tests in 390 files passed, including TypeScript, formatting and
lint. Coverage includes desktop-mode in-app menus, anchor movement on resize,
search autofocus, Escape return, canceled outside group drags, legacy window
returns and late native focus replies. Existing browser overlay/snapshot tests
also passed.

Live Aven Dev inspection confirmed the Recent menu and browser-tab context menu
inside the app over Chromium, correct trigger placement, outside dismissal, no
new native menu window, and the absence of detachment commands. The Dev preview
was hidden; its Dock icon restored it. The scoped desktop tool acknowledged
keyboard input but it produced no visible text in either the menu search or an
ordinary QA chat composer, so native typing/Escape are not counted as passed.
Automated keyboard tests passed. No messages were sent during these menu checks.
A cold launch of the new startup flow remains unobserved; the installed hosting
app was preserved. Temporary local focus diagnostics were removed before commit.

A separate 45-second background sample from the earlier navigation run averaged
2.28% of one CPU core (7.93% peak sample), with attributed footprint falling from
1,309 MiB to 1,298 MiB and a raw GPU driver counter delta of zero. These are short
Dev-workload observations, with the sampling limitations above, not a guarantee
for every project or a packaged-app benchmark.
