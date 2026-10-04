# Aven changelog

## [Unreleased]

## [0.1.119] - 2026-10-03

### Consistent glass and a new Settings

- Cards, menus, dialogs, toasts and popovers share one frosted-glass style that follows your Background opacity setting, instead of a mix of dark blocks and one-off tints. Popovers now blur what's behind them, so text no longer shows through.
- Settings is redesigned: larger titles, frosted cards, roomier rows, smoother switches and controls, provider icon tiles, and colour-coded connection statuses. Archive uses the same cards as the other pages.

### A calmer title bar and footer

- The title bar drops the context, task-access, Open externally and Settings buttons, which duplicated controls in the message box, browser, project menu and sidebar.
- The footer shows only Claude and Codex usage, side by side, and the terminal toggle. Click the usage for details, including task context.
- Branch switching and line counts move to the Changes tab, beside Commit, Publish and Create PR.

## [0.1.118] - 2026-10-03

### Clearer agent status and tabs

- Show a clear message when Claude unexpectedly interrupts or cancels a turn, instead of marking it Finished. Preserve explicit user stops, background agents, and the conversation when continuing.
- Shorten tab fills so a tab group's coloured underline sits below the fill instead of cutting into it.

## [0.1.117] - 2026-10-02

### Smoother glass and model controls

- Fix bottom-edge flicker around the message box, run status, and footer on macOS while retaining the native glass and workspace colors.
- Low, Medium, High, and Extra High reasoning options now ripple in green, blue, orange, and pink. Only the highlighted row animates, and Reduce motion shows a still pattern. Max stays gold and Ultra stays purple.
- Toolbar popups use the workspace's frosted glass and accent. New installations use lighter glass defaults; saved appearance settings stay unchanged.

### Rendering and agent reliability

- Reduce background rendering work and bound highlighting and media caches. Scrolling upward no longer pulls the conversation back to the bottom.
- Improve Claude task lists, subagent completion tracking, provider discovery, and streaming updates.
- Improve focused-window shortcuts, interface scaling, returning from Settings, and second opinions using another model from the same provider.

### Coding and desktop control

- Add optional editor autosave, preserve Windows line endings, improve JSONC highlighting, and fix Git and terminal handling.
- Group finished working copies under a collapsed section and provide cleanup that rechecks active or unfinished work before removing a copy.
- Add native desktop dragging and fix false input refusals caused by the Dock's invisible window.

## [0.1.116] - 2026-10-02

### Smoother resizing

- Resizing a sidebar, the inspector, the browser split, the divider between panes or the window no longer makes the conversation slide up or down. While you're scrolled up, the line at the top of your view stays in place as the text rewraps; file and plan previews behave the same way.
- Dragging dividers is smoother. The browser split updates once per frame instead of recalculating the whole workspace on every mouse movement, a visible browser page checks for overlapping menus less often, and frosted glass pauses its blur until the drag or window resize ends.

### Glass, model controls and chat navigation

- The message box and floating panels show more of your background through the glass, while their text stays solid and readable.
- Choosing a model or reasoning strength responds with brief motion, and reasoning strength shows as a small pixel meter. Reduce motion turns the animation off.
- The prompt rail beside a chat can now be dragged, scrolled with the mouse wheel or trackpad, and used from the keyboard to move through the conversation, as well as clicked to jump to a prompt.
- Chat tabs keep a steady single-line title, and floating sidebar corners share one rounded outline without a stray divider line.

## [0.1.115] - 2026-10-01

### Scheduled agents

- Inbox has a new **Scheduled** tab. Create a schedule with a prompt, project, agent, model and access mode, and choose set days at a time (Every day and Weekdays presets) or every 1–24 hours. While Aven is open, a due schedule starts a normal chat in the background, and its result appears unread in the tab with a summary and **Open chat**.
- Missed times run once instead of catching up, and only one window starts each run. A schedule whose agent, model or project is gone records a failed run with the reason instead of starting. **New scheduled agent** is also in the command palette.

### Before and after screenshots

- Agents can take a screenshot of a page in Aven's browser. When they change something visible, they capture the page before and after and show both in their reply, side by side, so you can review the change without opening anything. Click either image to see it larger. Screenshots are deleted with their chat.

### Settings

- Search sits at the top of the Settings sidebar and filters it to matching settings; picking one opens its page and highlights the setting. Escape clears the search before closing Settings.
- Settings are grouped as Personal, Agents, Coding, Integrations and Archived. "Keyboard" is now "Keyboard shortcuts".
- New **Coding → Git** page: choose what agents do when they finish — follow each project's instructions (default), leave changes for you, commit on a branch without pushing, or open a pull request.
- New **Provider setup** page and first-launch setup on Mac and Windows: choose providers, install their command-line tools, sign in, and test the connection. Every install, sign-in and test needs your go-ahead.

### Look and feel

- Dark workspace surfaces such as chat bubbles, the composer, tool cards, menus and Settings now use frosted glass over your background. Light mode, Reduce transparency and Increase contrast keep solid surfaces.
- Other copies in the Changes panel no longer call work "to merge" just because its commit history differs after a squash merge; counts are neutral and a main copy reports Up to date or Behind accurately.

### Fixes

- When desktop control refuses to click because another window is in the way, the error now names that window so agents can work around it.
- Remove leftover unused interface code and an unused macOS icon catalog.

## [0.1.114] - 2026-09-30

### Links open in a new tab, and PDFs show

- A link that opens in a new tab, such as one with an external-link icon, now opens as a new tab in Aven's browser beside the page, instead of an empty window with no address bar. Command-click opens it behind the current page. Sign-in pop-ups that ask for their own window still get one.
- PDFs open in Aven's browser using Chromium's own viewer, instead of a blank page saying the address cannot be opened.

## [0.1.113] - 2026-09-30

- Desktop control shows a monochrome cursor with a compact **Aven** badge, smooth movement and brief click or scroll feedback. It fades when idle and stays out of agent screenshots. Agents can also use `move` to hover over a target.
- Every open file has its own visible tab beside the others. File tabs no longer use a preview slot, pinning, or a hidden Recent list.

## [0.1.112] - 2026-09-29

### Faster startup

- Aven opens sooner. It reads your saved workspace while the interface loads instead of afterwards, and no longer rewrites every open conversation to disk before showing the window.
- The opening screen uses your workspace's own background colour from the first frame, instead of briefly showing a default palette.

### Brave-style tab groups fold all the way

- Clicking a group's label folds it down to just the label and its tab count, including the tab you were on; Aven moves to the nearest tab outside the group, as Brave does. Opening a tab from a folded group, for example from the sidebar, unfolds it again.
- Remove the ⠿ grip beside each pane's tabs. Move a pane by dragging its tabs, or right-click the tab row for the pane's menu.

## [0.1.111] - 2026-09-29

### MonoCode-style tabs, one seamless workspace, and a crash fix

- Fix Aven quitting unexpectedly when macOS Writing Tools appeared over a text box, such as the message box. Writing Tools is turned off inside Aven's own windows; websites in the browser are unchanged.
- Tabs now always sit in their pane's own row, whether one pane fills the window or several share it, instead of moving up into the window's top bar when there is a single pane. The top bar keeps only navigation, Activity and window tools.
- A new browser tab shows your background like the other panes until you open an address, instead of a solid black page.
- The top bar now uses the same surface as the sidebar, so the two read as one frame around your work instead of a dark bar above a lighter panel.
- Activity (the task list and unread count) always sits on the left, next to the navigation buttons, including while Settings is open.
- Tabs take MonoCode's look: equal-width, rounded tabs in one light row, with a soft fill on the tab you're on. That tab adds a second line saying what it's working on, such as the model, once it's wide enough; other tabs keep a single line.
- New tabs grow into place and closed tabs collapse smoothly, so the tabs beside them slide instead of jumping. Middle-click closes a tab.
- Picking up a tab to drag it is smoother and follows the pointer.
- Tab titles stay visible as the row gets crowded. The minimized-tabs option is removed, and the group drag dots stay visible.
- When an agent opens a page that is already open in the project, Aven switches to that tab instead of opening a duplicate, keeping the page as it was. Agents can still ask for a separate copy.
- Split panes sit closer together, and the chat background now runs unbroken behind every pane, tab row and gap, so panes are separated by a single faint line instead of dark bands and hairlines. A project's own background, or showing it only in empty chats, still applies per pane.

## [0.1.110] - 2026-09-29

### Lighter tabs and regular Windows releases

- Tabs use flat surfaces without decorative outlines, and hover cards are smaller and borderless. Subtle 1px drop markers follow the workspace theme in both the app and native browser panes.
- Dragging reuses layout measurements within each frame, avoids rewriting unchanged tab styles and destinations, and stops edge scrolling when it cannot move. Tab hitboxes, zoom behavior, keyboard focus, and reduced-motion support are preserved.
- Compact Skills rows keep their controls aligned and allow long source names to wrap in narrow settings panels.
- Windows x64 installers are now regular downloads on the main release, with no test suffix. They are built from the same source as macOS and checked for installation and startup on Windows. Windows installers remain unsigned and require manual updates; current platform limitations are documented in the Windows guide.

## [0.1.109] - 2026-09-28

### Desktop control, clearer Settings, and safer saves

- Optional desktop control is available as a preview, letting agents observe and use Mac apps from Aven without an extra install. It starts off; enable it in **Settings → Skills & tools**. The permission card shows what is missing and provides **Allow** and **Open settings** actions. Screenshots need Screen Recording access, and input also needs Accessibility access.
- Settings has tighter spacing, consistent controls, a more compact color picker, and clearer permission status. Skills source filters support keyboard navigation, and the default access setting stays in sync with the home toolbar.
- Failed conversation reads no longer restore writable blank replacements. Notes keep pending edits across navigation, and failed saves keep the window open for retry instead of discarding unsaved work when closing or quitting.
- Provider input no longer blocks the interface when a process stops reading. Aven waits for buffered provider output before reporting that its process has exited, with a bounded wait so an inherited pipe cannot leave the task stuck.
- **Restart to update** can close terminals after an explicit **Close terminals and restart** confirmation. **Keep working** leaves the downloaded update ready. Terminal tabs and working directories reopen with fresh shells after updating; running commands, terminal output, and unfinished terminal input do not carry over.
- Pages opened by agents or links now keep separate visible tabs beside the page already open, including in detached windows. Older hidden pages remain in Recent, and opening an existing address selects its tab.

### Desktop control preview limitations

- Capture, permission revocation, app activation, and keyboard input were verified in the signed Aven Dev build. Positive click and scroll verification remains incomplete: the conservative visibility check refused targeted input during testing. The check remains enabled and can also refuse transparent overlays.
- Some floating dialogs need a screenshot of their screen region instead of a window-only capture. Desktop control remains off until explicitly enabled and macOS permissions are granted.

## [0.1.108] - 2026-09-28

### Releases, merges and branch clean-up in the Changes panel, and a signed Mac app

- The Changes panel has a **Release** card for projects with a release workflow. It shows the latest release and how many changes on main aren't released yet. Once a new version is set, **Publish** runs the release on GitHub, after you confirm, and the card follows it until it finishes.
- **Squash and merge** sits next to **View PR** for an open pull request. The pull request lands on the default branch as one commit, and GitHub deletes its branch.
- **Merged branches** lists local and GitHub branches whose work is already in main, including squash-merged ones, and deletes them in one step after you confirm. Branches open in any copy are kept.
- Cleanup preserves branches that changed after they were checked. Removing another copy refuses ignored local files and detached commits, and explains what will be deleted. Release confirmation stays tied to the project, version and remote source you reviewed.
- The Mac app is now signed with Aven's Apple Developer ID. It is not yet Apple-notarized, so macOS may still ask you to approve opening a downloaded copy once.
- Each release now includes the Windows test installer, built from the same commit as the Mac app, instead of a separate Windows release. Windows builds remain unsigned test downloads without automatic updates.
- The Windows installer now shows the Aven mark and name. Aven names also cover internal terminal styling, new temporary files, provider probes and test examples. Existing app data, signing identifiers and upstream attribution remain compatible.
- New installs start with black glass and a blue accent in dark mode. The previous monochrome look is available as the **Mono** preset, and saved themes are unchanged.
- Tabs lose their grey fill; the tab you're on is shown with full-strength text and icon, and tab and toolbar icons are slightly smaller. Dragging a tab over a pane previews the drop as a plain grey outline. With Minimized tabs on, browser tabs keep their titles unless the window is split.
- Switching to a browser tab no longer flashes the window background while the page appears.
- Opening a new browser tab yourself no longer replaces the page you had open. Both stay in the tab strip; pages that open on their own still share one preview slot.

## [0.1.107] - 2026-09-28

### Tab menus open from their tab

- Right-clicking a tab or a group's label now opens its menu directly beneath that tab instead of at the pointer, so the menu no longer appears away from the tab you clicked.
- **Minimized tabs** is back on each tab's right-click menu. It also stays on the menu for empty tab-bar space and in Settings › General.

## [0.1.106] - 2026-09-28

### A Changes panel that shows where work is happening

- When the open project has nothing to commit, the Changes panel shows a status card instead of an empty commit box: clean and up to date, commits to push or pull, or a branch that isn't on GitHub yet. Push, pull and pull request buttons still appear when they apply.
- A new **Other copies** section lists this project's other working copies, such as agent and Race copies, with their unsaved files, lines added and removed, and how far behind main they are. Race copies are named after their prompt and agent, and fully merged copies are marked. Click one to see its files or show it in Finder.
- The history graph now fills the free space instead of leaving a blank gap.

## [0.1.105] - 2026-09-28

### Tab groups and a shorter tab menu

- Group tabs like in Brave or Chrome. Right-click a tab and choose **Add to new group**, then name it. A group shows a coloured label ahead of its tabs and one line beneath them. Conversations, files and browser pages can share a group, and groups are remembered after a restart.
- Click a group's label to fold it down to the label and a count; the tab you're on stays visible. Double-click the label to rename it, or right-click it to change its colour, open a new tab in it, move it to a window, ungroup it or close it.
- Drag a label to move its whole group, or drag it off the window to open the group in a new window. Drop a tab right after a label, or between two of its tabs, to add it; drag it out to remove it. Moving a tab to another pane or window takes it out of its group.
- The tab menu is shorter. Split, Move to and Close others each open their own page with a Back entry. Minimized tabs, folding all groups and moving every tab in a pane to another window are on a new menu when you right-click empty space in the tab bar. "Focus this tab" has been removed.
- Chat tabs now size to their titles like browser tabs instead of staying at the minimum width, and the empty space before the first tab is gone; the pane drag grip only appears in split view.

## [0.1.104] - 2026-09-28

### Compact tabs, minimized tabs and one tab per Race

- Tabs are shorter and only as wide as their titles. The tab you're on gets the most room, and a crowded strip shortens titles before it scrolls. The "N tabs" label on split groups is gone; the group's drag grip appears only while the pointer is over the tab bar.
- New **Minimized tabs** setting in Settings › General, also available from any tab's right-click menu. Every tab except the one you're on shows only its icon. Hover an icon for a card with its title, project, model, status (working or needs your input) and latest reply, or a browser page's address.
- A Race now shows as one tab named after your prompt, with a flag icon and each agent's mark. Agent panes are labelled "Provider · Model" without repeating the model. The Race overview no longer opens automatically; right-click the Race tab and choose **Open race overview**.
- Picture in Picture has been removed from tab menus and the browser toolbar. To keep work on screen, move a tab or group to its own window instead.
- Windows test builds now include the WebView2 license notices, keep their window controls visible in every workspace, and verify installer checksums. Windows builds remain unsigned test prereleases.

## [0.1.103] - 2026-09-27

### Cleaner tabs and reliable Race handoffs

- Files and browser pages use one preview slot per pane or tab group. Choose **Keep open** or double-click a preview to leave it in the tab strip; use searchable **Recent** menus to return to earlier items. Editing a file keeps it open automatically, including after saving. Aven's sidebar stays the same.
- Switching previews preserves editor buffers and browser page identities. Kept tabs survive workspace recovery and detached windows; moving or combining groups preserves their visible pages without bringing every background tab back.
- Finishing a Race waits for lane agents and follow-up chats to stop before applying changes or removing temporary copies. Follow-up chats retain their original project, and temporary Race folders no longer appear as new projects.
- Orchestration recovers proposals that arrive after the planning turn finishes, shows them in the assignment card, and keeps raw proposal markup out of the conversation. Stopped or failed turns cannot revive an outdated proposal.
- Includes the pending 0.1.102 updater improvements: browser dialogs, popups, forms and leave-page warnings no longer hold up a restart. Addresses reopen after updating; unsaved page state is not preserved. Running tasks, terminal work and active downloads still hold the update. Updating from 0.1.101 uses its existing restart checks once.

## [0.1.102] - 2026-09-26

### Update without closing tabs

- Restart to update no longer stops for a browser tab showing a dialog, a sign-in popup, a filled form or a leave-page warning. Aven saves every tab's address and reopens it after the update; what a page held in memory, including anything typed and not saved, is not kept.
- An update still waits for running or queued tasks, terminal work and downloads in progress.
- Update messages now appear in Aven's own dialog instead of a macOS alert.
- Updating from 0.1.101 or earlier still uses the old checks once; later updates don't.

## [0.1.101] - 2026-09-26

### A reorganized Settings, MCP servers, and turns that finish when the agent does

- Settings is grouped into App, Agents and Data. The former General page is split into General, Notifications, Tasks & review, Connections and Browser, and search opens each setting on its new page. The sidebar scrolls in short windows.
- Pick workspace colors by dragging instead of choosing a preset: drag the square for richness and brightness and the strip for hue, for the background, accent or highlight. A drag previews in place and saves once when released. Dark and light colors are still saved separately.
- Connections lists the MCP servers Claude and Codex load, with their status, and can add, remove and sign in to them. Aven makes these changes through `claude mcp` and `codex mcp`, so each provider's own settings stay authoritative. Linear moves here too.
- When a connected server asks a question or needs approval mid-task, it now appears in the task for both Claude and Codex. Plan turns decline those requests.
- Fix turns that appeared to finish after about a second while the agent kept working. Claude's reply to a background task, and OpenCode's late report from a stopped turn, no longer end the next turn; Pi and Oh My Pi no longer finish while a retry or compaction is starting.
- Skills & tools is shorter: one-line tool summaries, only the macOS permissions still missing, and source filters with one-line skill descriptions.
- Remove the "next turn" label from the access button; its tooltip still explains when a change applies.

## [0.1.100] - 2026-09-25

### Reliable project selection

- Keep the loaded project list and Personal/Work assignments when saved settings become missing, unreadable, or fail to save. Selecting a project no longer removes the other loaded projects or unexpectedly switches its workspace.
- Keep project ordering stable when opening projects, while accepting intentional additions, removals, and assignments from other windows.
- Adapt MonoCode's pane-aware project navigation: returning to a project focuses its chat, editor, or terminal pane in a split tab instead of another project's pane. Keep that selected tab visible without changing project deletion behavior.
- Preserve valid project entries from partially damaged saved lists. These protections do not restore previously deleted data.

## [0.1.99] - 2026-09-25

### Updates without closing browser tabs by hand

- Restart to update now saves browser tabs and closes them for you, then reopens them after the update. Addresses, order and the selected tab are kept; a page's in-memory state and history are not.
- A tab you (or an agent) have clicked, typed in or dropped something onto still stops the update if it might hold unsaved work, as do downloads, playing media, camera or microphone use, open dialogs and pages still loading. The message names the tab and what to do, usually close it. Untouched tabs close whatever they contain.
- If saving or installing fails, Aven leaves update mode and brings the tabs back.
- Updating from 0.1.98 or earlier to this version still asks you to close browser tabs once; later updates don't.

## [0.1.98] - 2026-09-25

### Race, a command palette, and a faster chat box

- Race a task across two to four agents. Turn on Race from the chat box or choose **Race it** in the command palette. Each agent works in its own git worktree, starting from the project as you see it, and can use any of its provider's models. A race tab compares status, time, changed files and diffs. Keep one agent's result or pick per file; every patch is checked before any is applied, so a conflict changes nothing.
- Press ⌘K for a command palette over any surface: start a chat from what you type (Tab changes agent, Shift-Tab changes project, Command-Enter starts it in the background), and jump to chats, commands, projects, files and settings. Search moves to Shift-Command-K.
- Open agent-opened pages beside the chat that asked for them instead of behind it, with a notice when the page opens in a project that isn't on screen.
- Fix chat box controls: failed uploads, a `/compact` that can't run yet, and an unfinished new skill now explain themselves or recover; the project picker's Enter picks a project instead of sending; menus that are meant to take the keyboard now do, including arrow keys in the + and Race menus. Typing after `@` in a large project no longer drops frames.
- Keep the macOS toolbar and traffic-light spacing aligned at every interface zoom level.
- Harden saving and process ownership after a code audit: database migrations commit atomically, Notes deletion and reads recover from storage failures, project removal waits for its conversations and keeps the project on failure, simultaneous usage checks no longer stop one another, and terminal handles are no longer inherited by unrelated processes. Update the TLS library for RUSTSEC-2026-0285.
- Fix memory-saver edge cases: a memory-pressure notice during a sleep sweep is applied afterwards, lightweight mode keeps the most recent inactive tab ready, and engine options no longer ask for a needless restart.
- Give the Aven mark a charcoal glass tile.

## [0.1.97] - 2026-09-24

### Smoother streaming and a lighter desktop app

- Render Aven windows at the display's full refresh rate while trimming per-frame layout work. Stream transcript text into the visible chat without redrawing the whole workspace or composer, and save running transcripts less often.
- Share Chromium renderers between same-site tabs, sleep eligible hidden tabs under macOS memory pressure, and release render trees for workspaces hidden for a long time. Add a Lightweight browser setting that keeps fewer tabs ready and uses Chromium's low-memory mode.
- Make the monochrome appearance the default and redraw the Aven mark. Refine the sidebar's hover-close timing and keep it visible when pinned.
- Keep windows opaque unless desktop transparency is enabled, and add an optional compositing-borders diagnostic.

## [0.1.96] - 2026-09-23

### Stable chat scrolling

- Let the browser scroll chat history without a blocking JavaScript wheel handler, while preserving scroll containment, nested tool output, and Jump to bottom.
- Keep mounted messages and code blocks at their actual heights so scrolling does not swap in size estimates and shift the conversation. Older-message paging, collapsed tool trails, and lazy syntax highlighting remain in place.
- Pause prompt navigation observers and previews in hidden chats; resume them when the chat becomes visible.

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
