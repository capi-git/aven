# Aven's feature map

The maintained list of what a person can do in Aven, by area. A sweep uses each area once and keeps this map honest; ship reads the row of the area it changes. Each area names where its code is, the real-app check steps that cover it (`scripts/checks steps` lists what this checkout has, by their words), and what the checks cannot show. Made on 2026-11-12 from the source, `README.md` and the real-app check of 0.1.181; no area has been swept yet.

## Baseline

- Every use of the app is Aven Dev in a throwaway profile (the real-app check or the speed test, behind `scripts/window-gate`), the frontend in the Browser pane, or a rendered harness. Never the installed Aven, never the person's chats, never their screen.
- The real-app check first: it is the doctor. Its stand-ins answer `AVEN_SMOKE_*` markers (`scripts/smoke/fake-claude.py` says which); a sweep can add a marker in a scratch copy of the stand-in to reach a flow, but never commits it.
- Provider tools are never started with a throwaway home (a keychain box on the person's screen). Real provider turns run only when the notes ask.

## Driving conventions

- Stable handles over places: roles, `aria-` names and the words on a button. Places on the screen only for test-mouse steps, read from the element's box first.
- Each area that has to do with places (drags, splits, menus, the message box) is checked at 80%, 100% and 120% interface zoom and at a narrow and a wide pane; each that has to do with looks, in the dark and the light theme.
- A proof names how it was made: unit test, rendered (Browser pane or harness), real-app check step, test mouse, or seen by the person.

## A feature file

One file beside this index per area that has more to say than its row: an H1, one paragraph on what a person can do there, then four H2s in this order: `What a person can do` (short ids, one line each), `How to get to it`, `Checking it` (the steps, the tests, the harness), `Traps` (what wasted or misled an earlier run). Keep the code's inner workings out; name user paths, handles, state and proof.

## Areas

| Area | Where in the code | Real-app check steps (by their words) | Not shown by the checks |
| --- | --- | --- | --- |
| Start and first run | `src/surfaces/GettingStarted`, `Walkthrough`, `ProviderSetup`, `AstraWelcome` | window stayed hidden until the workspace drew | A real first launch on a clean Mac; the provider sign-in steps |
| Chats and the message box | `src/surfaces/AgentTranscript`, `AgentMarkdown`, `SessionPane`; `src/chrome` (message box, Hopper mark, pickers); `src/lib/harness/` | agent turn through the normal send path; Escape closes the / and @ pickers and Enter sends; Cmd+. opens the critter's dialog…; pointing at the critter opens its dialog… | A real provider's own output (only stand-ins); attachments from Finder; dictation with real speech |
| Projects, Home and the sidebar | `src/chrome` (sidebar, Stack), `src/surfaces/WorkspaceHome` | floating sidebar attached; the project's Stack stays still…; Home shows each project's agent…; deleting a project closes its hidden terminal panel; floating sidebar opens Settings and goes Back | The native floating sidebar's slide on a real trackpad; two displays |
| Tabs, panes and windows | `src/surfaces/PaneTree`, `DetachedWorkspace`, `WorkspaceStage`; `src/chrome` (tab strip) | a chat beside a file has one strip each…; a page alone in a pane moves by its header…; a divider dragged to the edge folds a pane…; a tab dragged over a page is cut out of it…; a tab pins to its mark… | A real mouse (the test mouse sends events straight to the web view); a tab moved to a window on a second screen |
| The browser | `src/surfaces/BrowserPane`, `RetainedBrowserPane`, `BrowserMarkup`, `WorkspaceBrowserSurface`; `src-tauri/chromium/` | an agent's opens build on one page; a second dev server is flagged… | Real websites and sign-ins; Comment on page with a real pointer; the WebKit and WebView2 builds |
| Files, changes and Git | `src/surfaces/FileEditor`, `FilePane`, `SessionChangesDiff`, `WorkingTreeDiff`, `CommitDiff`, `UnifiedDiffView` | Parallel work starts folded to one line | Ship it and a real push (never against a real remote) |
| Terminals | `src/surfaces/TerminalView`, `ProjectTerminalDock` | (none beyond the project delete step) | A long-running command across a restart |
| Discuss, Race and Orchestrator | `src/surfaces/Discussion*`, `RaceView`, `RaceCard`; `docs/ORCHESTRATION.md`, `docs/RACE.md` | two chats discuss for two rounds…; an orchestration runs its agents…; a run the lead leaves open offers Finish run; a race keeps one lane mid-run…; a finished race is ready to compare… | Real providers in a race; a Windows machine |
| Avos, teams and the Board | `src/surfaces/Avos*`, `Team*`, `CrewBoard`, `CrewChat`, `WorkBoard` | Open Avos opens the project's Avos…; a crew builds, checks and secures a card…; meeting Avos in a folder without Git…; the Researcher hands back findings…; the Designer's mock-up…; Avos changes a page…; a message to Avos reaches a helper…; a watch request in Avos's chat becomes its job…; Avos's settings keep their Access choices… | A night run under quiet hours; real web research |
| Automations, Inbox and Notes | `src/surfaces/AutomationsView`, `AutomationDetail`, `AutomationReviewCard`, `InboxView`, `ScheduledInbox`, `NotesView` | utility views open, return from Settings and close; (the job step under Avos) | A real schedule firing while the Mac sleeps; GitHub Inbox with a real account; a real Notion page |
| Search, Settings and looks | `src/surfaces/SearchView`, `SettingsView`, `SkillsSettings`, `AccentColorSetting`; `src/*.css`; `DESIGN.md` | utility views open…; keyboard shortcuts open Settings and close it | The light theme and chat backgrounds are not checked by a step |
| Desktop control and the iPhone pane | `src-tauri/src` (desktop control), `src/surfaces/IosSimulatorPane`, `AccessPanelWindow` | (none; `npm run check:iphone` and the opt-in live tests in `docs/DEVELOPMENT.md`) | macOS permission prompts; other apps' acceptance of background input |
| Updates and restart | `src/surfaces/ReleaseNotesSurface`; `docs/RELEASING.md` | restart question lists running work (preview) | A real older-to-newer update (only a published release shows it); a Windows update |
| Speed and motion | `docs/PERFORMANCE.md`, `src/lib/motionAudit.ts` | (the speed test, `npm run perf:app`, not the real-app check) | Numbers under other load; compare runs back to back |

A step that this table does not name, or a name here that `scripts/checks steps` does not print, is drift: correct the table.
