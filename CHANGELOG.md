# Aven changelog

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
