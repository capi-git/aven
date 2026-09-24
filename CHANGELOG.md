# Aven changelog

## [0.1.95] - 2026-09-23

### More efficient browser zoom

- Correct the built-in browser's pixel density when zooming out, preventing canvas and WebGL pages from drawing oversized buffers.
- Follow display density changes while preserving per-tab zoom and the browser's native input and screenshot coordinates.
- Pause the optional composer mascot while its workspace or window is hidden, and resume from the same position.

## [0.1.94] - 2026-09-23

### Balanced browser memory saver

- Keep the three most recently used browser tabs in each window ready for fast switching. Older hidden tabs can release their native page after five inactive minutes and reload their last URL when reopened.
- Keep pages awake when they have agent access, forms or editors, media, downloads, popups, detached windows, or other state that cannot safely be restored. A failed eligibility check leaves the page intact; automatic sleeping never accepts an unsaved-work prompt.
- Restore a task's sleeping browser pages before connecting its agent. Preserve tab names, addresses, and workspace layout while pages sleep.
- Enable Memory saver by default, with an opt-out in Settings → General → Browser.

## [0.1.93] - 2026-09-23

### Less work in inactive workspaces

- Disconnect browser presentation observers and release temporary overlay images while a pane is hidden, retaining the page and its agent connection for immediate return.
- Skip unchanged native browser frames, visibility assignments, and corner masks instead of repeatedly invalidating the same layout.
- Pause decorative animations in hidden retained workspaces. Pause the optional welcome-screen arcade while hidden, and render only the boards participating in the visible slide.
- Preserve loaded browser pages, workspace layouts, conversation drafts, and game state rather than reloading them on every switch.

## [0.1.92] - 2026-09-23

### Aven command and application names

- Build the native app as `aven`, with Aven-named Chromium helpers, terminal identity, and generated browser and orchestration instructions.
- Keep a `monocode` executable alias and accept older browser flags and scoped environment variables so existing agent conversations continue to work. Preserve saved sessions, preferences, application identity, and original license attribution.

### Responsive sidebar dismissal

- Start the left sidebar's closing animation as soon as the pointer leaves, removing the extra hover-exit pause.
- Keep a pending close from being postponed by repeated focus and popup observations. Preserve edge-to-panel movement, open menus, keyboard focus, and the existing slide animation.

### Claude sign-in recovery

- Recognize Claude's structured API errors and failed results, so an expired sign-in shows a failed attempt instead of “Finished.”
- Show sign-in instructions with a shortcut to Aven's terminal. Retire failed Claude processes so retrying after login reads fresh credentials while preserving the conversation.

### Visible background agents

- Track child-agent status separately from the main reply. Keep active or unknown agent states visible after the reply ends, with expandable names, progress, and outcomes above the composer.
- Correct Codex and Claude lifecycle tracking, preserve background updates between turns, and include active workers in the workspace activity indicators.
- Keep provider processes alive while agents remain active, and make Stop reach detached workers. Show an unavailable status when a disconnect or failed shutdown leaves their state unconfirmed.

### Reliable Codex turn completion

- Match completion events to the current Codex turn. Ignore old or unrelated completion events instead of marking a new request finished while its provider is still working.

## [0.1.91] - 2026-09-23

### Prevent a Bluetooth privacy crash

- Include the required Bluetooth usage description in Aven and its Chromium helpers, preventing macOS from terminating the app when Chromium checks Bluetooth devices.
- Reject Chromium packages missing that description before signing, and verify that development builds and every helper retain it. Existing macOS permission choices still apply.

## [0.1.90] - 2026-09-23

### Home folders and skills that open correctly

- Resolve home-relative links such as `~/.agents/skills` against the user's home directory, without appending them to the project or substituting similarly named project files.
- Browse linked folders inside Aven and open their files in the editor. Recover older broken home links when their original path no longer exists.

## [0.1.89] - 2026-09-23

### Menus that stay with their controls

- Replace macOS tab, file-action, and browser toolbar menus with Aven's themed panels. Anchor them to their controls with display scaling and screen-edge placement.
- Reuse hidden menu, Usage, and Access windows so reopening avoids rebuilding their web renderer. Reject stale selections and late events from earlier openings.
- Use the same themed menu treatment for Settings selectors, including keyboard navigation and skill locations.

## [0.1.88] - 2026-09-23

### A clearer place to type

- Give the message composer a distinct surface, readable placeholder, and subtle focus treatment across grey, light, dark, and transparent themes.

## [0.1.87] - 2026-09-23

### Toolbar panels that belong together

- Give Activity, Usage, Access, and Open workspace the same panel frame, spacing, typography, close controls, and theme colors.
- Follow the chosen workspace palette in light and dark appearances, including native popups above the built-in browser.
- Replace the macOS Open menu with an Aven panel and remove opaque square corners behind native panels. Preserve action availability, keyboard navigation, provider usage, and access behavior.

## [0.1.86] - 2026-09-23

### One continuous workspace

- Bring navigation, task and browser tabs, and workspace controls into one toolbar. Keep split-pane headers, tab reordering, window dragging, and existing settings and tools available.
- Remove nested workspace outlines and mismatched browser corners, and soften the composer while preserving each workspace's appearance.
- Keep visited workspaces measured in memory and adopt the destination during a swipe, reducing avoidable layout work when switching between Work and Personal.
- Keep agent-opened websites in Aven's scoped browser, open local documents in the editor, and render Markdown skill instructions and document previews as formatted text.
- Improve native browser focus, annotation menus, floating controls, and rounded-corner clipping without moving focus away from active inputs.
- Refine Settings, provider usage, task status, and reusable tool instructions. Retain compatibility identifiers and upstream license attribution while using Aven branding in the interface.
- Improve startup recovery, file navigation, and tab movement with regression coverage.

## [0.1.85] - 2026-09-22

### Build Aven in Aven

- Add an isolated **Aven Dev** preview with its own chats, settings and Chromium profile, a prerequisite check, and a documented development workflow. Keep the installed host running while working on its source.
- Add **Skills & Tools** settings to find and inspect reusable instructions, review built-in browser support, and check optional Peekaboo desktop-control availability and macOS permissions. Include a portable Aven computer-use skill.
- Incorporate reviewed MonoCode fixes for stale approvals, editor file refresh, native Window menu registration, question keyboard navigation and additional syntax highlighting, preserving Aven's durable drafts and provider model support.
- Consolidate pending reliability fixes for search, editor navigation, keyboard focus and nested dialog dismissal with the latest sidebar layout.

## [0.1.84] - 2026-09-22

### Sidebar controls that stay in place

- Keep navigation controls inside the workspace sidebar as it resizes, with an in-app overflow menu at narrow widths.
- Align both resize handles with their visible dividers and start dragging from each panel's actual displayed width, including interface zoom.
- Restore navigation to the top bar when the sidebar is hidden and preserve the left sidebar's hover behavior.

## [0.1.83] - 2026-09-22

### Clearer sidebar separation

- Give the workspace sidebar a theme-aware surface tint and a subtle inner edge so it stays distinct from the main area, including Graphite and transparent macOS windows.
- Preserve matched-sidebar backgrounds, floating-panel behavior, and existing panel dimensions.

## [0.1.82] - 2026-09-22

### A consistent workspace

- Refresh tabs, sidebars, chat, the composer, browser controls, and file panels with quieter surfaces, clearer text, and consistent spacing in light and dark themes.
- Keep working, waiting, and queued states visible in narrow panes, and make attachments more compact without changing message, approval, or queue behavior.
- Bring the same styling to Home, Notes, Search, Inbox, activity, usage, access controls, and dialogs while retaining existing features and workspace preferences.
- Keep keyboard focus inside dialogs, restore it on close, and let nested dialogs and menus dismiss in the right order.

## [0.1.81] - 2026-09-22

### A calmer settings workspace

- Keep settings categories available with the sidebar closed, with compact navigation in narrow windows.
- Search across settings and jump directly to a highlighted control, with consistent keyboard and dismissal behavior.
- Organize preferences into focused groups with clearer device and workspace scope, larger theme swatches, and consistent controls in light and dark appearances.
- Keep connected providers prominent and tuck additional providers into an expandable section.
- Present keyboard shortcuts in a readable, searchable table with plain-language availability labels.

## [0.1.80] - 2026-09-22

### Stay current automatically

- Discover new provider models at startup, periodically, and when returning to Aven. Existing task selections and model lists survive refresh failures.
- Keep supported native Codex and Claude tools current through their official updaters, with a device setting to turn this off.
- Download signed updates from Aven's own GitHub releases in the background. Restart explicitly after saving and closing browser pages, terminals, and other windows; running or queued tasks block installation.

## [0.1.79] - 2026-09-22

### Open chat links safely

- Keep macOS right-click → Open Link from navigating away from Aven's interface and interrupting running tasks.
- Route web links opened through native navigation into the originating workspace's in-app browser.

## [0.1.78] - 2026-09-22

### Claude Opus 5.5

- Add Claude Opus 5.5 with a 1M context window, Medium reasoning by default, and optional Fast mode. The fallback catalog requires Claude Code 2.1.280 or later.
- Recognize the provider's live Opus 5.5 model entry while preserving saved model choices.
- Add Refresh models in provider settings so newly available models can be discovered without restarting Aven.

## [0.1.77] - 2026-09-22

### Keep agent previews in Aven

- Add Aven's browser routing to interactive Codex and Claude startup instructions, including Codex resumes and forks, while retaining the scoped browser connection on each turn.
- Refresh browser guidance when orchestration sends mid-turn instructions to a worker.
- Keep the in-app browser preference explicit even when its host is unavailable, and tell agents to disable development-server browser auto-open for ordinary previews.
- Preserve explicitly requested external-browser testing and provider sign-in flows.

## [0.1.76] - 2026-09-22

### Clear agent status

- Keep the current agent state visible above the message box while you scroll: working, waiting for you, finished, stopped, or failed.
- Show elapsed time, a short description of the current work, and a clearly labeled Stop button while the agent runs.
- Keep the original task running when a follow-up instruction cannot be delivered, and explain that failure without marking the task finished.
- Report failed or interrupted Codex turns accurately instead of treating them as successfully finished.

## [0.1.73] - 2026-09-17

### Browser annotations

- Select an element and write a comment beside it, with a blue outline and a compact in-app annotation card above the live browser.
- Add the comment and a clean element screenshot to the chat draft together; nothing is sent until you submit the draft.
- Change the selected element or exit with Escape, the close button, or Done in the browser toolbar.
- Keep annotation input outside website scripts and reject cancelled, stale, duplicate, or oversized annotation events.
- Retain Chromium element data across asynchronous capture and comment callbacks, preventing expired selections from crashing the app.

## [0.1.72] - 2026-09-17

### Workspace navigation and browser fixes

- Preserve the outgoing sidebar's rows and scroll position when changing workspaces from the header or footer.
- Select the destination when a mouse drag ends exactly on a workspace, and restore carousel alignment after hiding and reopening it.
- Avoid duplicate workspace preference writes and redundant appearance updates when workspaces share the same theme.
- Tell agents to use Aven's embedded browser for ordinary links and local previews, while respecting explicit external-browser requests and existing sign-in/test flows.
- Report unavailable embedded-browser access instead of silently opening an external browser.

The motion investigation and its limits are documented in [PERFORMANCE.md](docs/PERFORMANCE.md). Automated behavior checks are separate from physical trackpad and displayed-frame-rate testing.

## [0.1.71] - 2026-09-16

### First public release

- Independent Aven project, source repository, and manual release downloads.
- macOS Apple Silicon app with a dark blue default appearance and customizable workspace themes.
- Agent conversations with provider and model selection, approvals, queued follow-ups, and orchestration.
- Workspace profiles, split panes, an embedded browser, a file editor, Git change reviews, and terminals.
- Notes and Inbox shortcuts beneath the workspace heading. Inbox collects GitHub issues, pull requests, and Linear tasks from connected projects.
- Keyboard-accessible workspace switching and in-app controls for workspace appearance.

This is an early release. The macOS app is ad-hoc signed and not Apple-notarized. Updates are installed manually; other platform release builds are not yet provided or verified.

Aven began from the MIT-licensed MonoCode project. Earlier version numbers refer to development before this public release; attribution is preserved in [NOTICE](NOTICE) and [LICENSE](LICENSE).
