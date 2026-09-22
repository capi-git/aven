# Aven changelog

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
