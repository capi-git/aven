# Browser, files and desktop control

Aven supplies these routes automatically to ordinary agent turns and follow-ups.
Use **Settings → Skills & tools** to inspect the installed tools and their status. Use **Settings → Connections** to add, remove, and sign in to MCP servers. Aven makes those changes through `claude mcp` and `codex mcp`, so each provider's own configuration stays authoritative.
The same setup works when Aven is the project you are developing.

## Websites and previews

Ask the agent to open or test a website. It uses the browser beside the conversation,
with a connection scoped to the requesting task. No browser extension, MCP server,
or change to the Mac's default browser is required.

Agents should start development servers without auto-opening a browser. They then
list pages first and reuse the matching page ID to inspect or reload the preview.
The `open` action reuses an exact matching URL within the task's workspace, including
when requests overlap. It preserves live page state; sleeping tabs wake as needed.
Different query strings and fragments remain separate addresses. Pass `"newTab":true`
only when a separate copy is intentional, such as preserving a user draft while
testing. Use `reload` to refresh the existing page after an edit, rather than
opening another copy. Agents inspect a snapshot and interact with elements from it. If the connection fails, the agent reports the error
instead of switching to another browser. Explicit requests for a different browser,
configured browser tests, and provider sign-in flows retain their normal behavior.

## Before and after screenshots

When a task changes how a page looks, the agent captures the preview before
editing and again after the change has reloaded, then shows both images in its
reply:

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-browser \
  '{"action":"screenshot","id":"PAGE_ID","label":"before"}'
```

The result is `{path,width,height,markdown}`. `markdown` is a ready-to-paste image
reference; the label is optional. A pair of images labelled **Before** and
**After** appears side by side with captions, stacked when the conversation is
narrow. Click either image to open it larger.

A page on screen is captured as you see it, without changing its size or zoom.
A background tab is captured at its current size. Screenshots are kept in Aven's
app data folder under `turn-shots` and deleted with their task.

## Markdown and code

Ask to open a local file. The agent uses the scoped `openfile` action:

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-browser \
  '{"action":"openfile","path":"/absolute/path/notes.md","line":12}'
```

The file opens in the requesting task's editor, including when that task is in a
detached Aven window. Line and column are optional, one-based positions. A line
request selects Markdown's Source view so the position is visible. Opening the
same file again reuses its tab.

The command accepts existing UTF-8 text files up to 8 MB, including Markdown,
source code, JSON and SVG. It reports unsupported formats rather than opening
another application. Its success response confirms the editor accepted the file;
an agent must still inspect the content before claiming to have reviewed it.

Clickable chat references use absolute file links. Wrap destinations containing
spaces in angle brackets, for example `[Notes](</project/My Notes.md:12>)`.
Regular clicks and middle-clicks use Aven's editor.

## Native Mac apps

Aven has built-in desktop control for observing and operating native Mac windows.
It is off by default. In **Settings → Skills & tools → Desktop control**, turn on
**Let agents see and use apps on this Mac**. macOS asks you for Screen Recording
and Accessibility access, with Aven listed by name. You can turn desktop control
off from the same switch at any time.

The card shows **Ready**, **Permissions needed**, **Off**, or **Unsupported**.
**Permissions needed** can still allow observation: with desktop control enabled
and Screen Recording granted, agents can list windows and take screenshots even
if Accessibility is missing. Reading an app's controls (`appState`), moving the
pointer, clicking, dragging, typing, pressing keys, scrolling, element actions and
activating apps require both permissions, so agents can observe and verify input.
For a missing permission, choose **Allow** to request access, or **Open settings**
to open its macOS pane. Use **Check again** after changing permissions. macOS may
ask you to quit and reopen Aven after allowing Screen Recording; save your work
and handle that restart yourself. Desktop control requires the macOS app.

Ask the agent to inspect or test an app; no slash command is needed. Every task
receives the command automatically, and **View instructions** or
`/aven-computer-use` provides the full workflow. There is nothing else to install.
The Aven executable accepts `--aven-desktop` with one JSON argument and reuses the
task's scoped in-app browser connection:

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop '{"action":"status"}'
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop --help
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop '{"action":"windows"}'
```

### Accessibility elements (preferred)

Agents work with an app's accessibility elements first, the way assistive
technology does. This happens in the background: Aven does not move your
pointer, take keyboard focus from the app you are using, or bring the target app
forward, and covered windows work.

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop '{"action":"appState","windowId":123}'
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop '{"action":"click","windowId":123,"element":7,"stateId":42}'
```

`appState` returns a `stateId`, the window's bounds, an indexed outline of its
controls and any open menu, and a fresh window image (`image`). Each outline line
lists the role, title, description, placeholder, value, disabled/focused/selected
state, available actions and frame in window-screenshot points, for example
`[7] Button "Send" @412,560 64x28 actions=Press`. Values of secure text fields are
never read; they always appear as `<redacted>`. The outline is bounded (250
elements by default, `maxNodes` 20 to 1000, a three-second read budget and a size
limit); `truncated` reports a cut. Slack, Notion, VS Code, Chrome, Finder, Mail,
Messages, Music and Spotify include short `tips`.

Element actions take the same `windowId`, an `element` index and the `stateId`:

- `click` presses the control (`AXPress`, then `AXPick` or `AXConfirm`), focuses a
  text field or selects a row. A right click opens its menu. When the app offers no
  equivalent, Aven sends plain app-directed mouse events at the element's centre,
  but only after the app's hit test there reaches that element or plain content
  inside it. If another control sits at the centre (an inline "Archive" button in
  a message row, for example), nothing is sent and the error names that control;
  the fallback never presses a different control through Accessibility.
- `typeText` inserts text at the caret of the element (or the app's focused field in
  that window); only if the app does not support that does it fall back to key
  events. When an app accepts the text but shows it a moment later (Chromium and
  Electron apps such as Slack and Notion), Aven waits briefly and otherwise reports
  `"confirmed": false` instead of inserting the text a second time. To insert or
  delete, Aven rewrites a whole value only for short single-line plain fields; text
  areas, rich editors, web content and text over 200,000 characters are edited with
  key events at the caret, so nothing is lost or truncated.
- `setValue` replaces a text, number or true/false value.
- `pressKey` maps Enter to Confirm, Escape to Cancel, arrows to
  Increment/Decrement on sliders and steppers, Space to Press, and Backspace/Delete to
  text edits. Without an `element`, Enter and Escape may instead press the window's
  default or cancel button, and the result names it in `button`; with an `element`
  they act only on that element (its own Confirm or Cancel, else focus-confirmed key
  events) and never press the window's buttons. Other keys and any modifiers use app-directed key events. For a named
  `element`, those events (and `typeText`'s key fallback) are sent only after Aven
  focuses that element inside its app and reads its focus back; otherwise nothing
  is sent and the action fails, so keys never reach another control.
- `scroll` with `direction` (and `pages`) pages the nearest scroll area; with
  `deltaX` and/or `deltaY` it sends a wheel event at the element's centre; with only
  `element` it scrolls that element into view.
- `selectText` selects `text`, or `start` and `length` in UTF-16 units.
- `secondaryAction` opens the element's menu, or runs one allow-listed action such
  as `Increment` or `ShowAlternateUI`.

A control the app reports as disabled is refused by every element action, including
`selectText` and every `pressKey` key. Without an `element`, a disabled default or
cancel button refuses Enter or Escape with an error that names that button.

Indexes belong to that state only, and any action in the window uses them up, so
agents call `appState` again before each element action. A newer `appState` of the
same window also replaces them. An element is refused with "State changed; call
appState again" when its role, label or place in the window changed. Elements that
are unlabelled or repeated (untitled rows, a "More actions" button on every
message) also record the text around them, so a list that changed underneath an
index (a new message at the top) is refused instead of acting on a different row.
Elements that cannot be told apart at all are listed in `ambiguous` and are never
acted on by index. A labelled, unique element that was rebuilt in place is found
again by its position and label. Web pages in Safari, Mail and other WebKit apps
can be served by a separate WebKit WebContent process; such elements are accepted
only when they lie in the target window and macOS attributes that process to the
app. Any other process's element is refused with "That control belongs to another
process", so agents switch to coordinates instead of re-querying in a loop. Each result names the `method` used;
`"confirmed": false` means the app did not confirm in time (a menu may be open) or
Aven had to use events.

Electron and Chromium apps build a complete accessibility tree only when asked.
Because that changes the app, `appState` (which needs no consent and works while
paused) turns the switch on only for an app this chat is already allowed to use, or
when app consent is off, and never while desktop control is paused, the chat is
stopped or the Mac is locked (a pause or stop during the change turns it straight
back off). Before that it returns the tree the app already exposes, with
`accessibilityMode: "limited"` and a hint to call `appState` again after the first
allowed action (or, while paused, after the user resumes). Once allowed, Aven turns on that app's `AXManualAccessibility` (Electron)
or `AXEnhancedUserInterface` (Chromium) switch, and turns it back off when the last
chat using it ends, if it was off before. Only the chat that turned a switch on
records its earlier value, and a chat that ends while its switch is being turned on
restores it straight away. Aven also keeps a small private record of switches it
turned on (`aven.accessibility-switches.json` in its data folder, with the app's
process ID, path and start time); if Aven quits unexpectedly, the next launch turns
those switches off again when the same app process is still running.

Element actions count as input: they use the same per-app consent, appear in the bar
with the control's title (for example “Clicking “Send””, never a typed value),
follow Pause, Stop and yield, and move the agent ring to the control. `appState` is
observation and remains available while paused.

### Coordinates (fallback)

When an element is missing or does not respond, the agent checks status once,
selects an observed window, and takes a `screenshot` with its `windowId`. The result is `{path,width,height,originX,originY}`; the agent
must open the PNG at `path` with an image or file reader before acting. A successful
JSON response alone is not visual verification. It then uses `move`, `click`,
`drag`, `type`, `press`, `scroll`, or `activate` as needed and takes and opens a new screenshot to
verify each result. Include the observed `windowId` for all input, including typing
and key presses. Coordinates are in screenshot points relative to that window.
The default `inputMode: "app"` delivers events to the target app without moving
the user's pointer or activating another app. Accessible single-click controls
use their semantic press action when available. Keys require that app's focused
window. Some apps ignore process-directed input; inspect the result before retrying.

Shared-pointer fallback uses `inputMode: "pointer"`. It always asks for the
current action, even with app consent off. Covered window targets are refused;
never drop the window ID to bypass that refusal. Activation also asks first,
because it changes the user's foreground app. Consent is checked again against
the target after the answer; moved or replaced windows require a fresh observation.

Use `drag` to grab and move UI such as pane dividers, sidebars, window edges,
sliders and tabs, for example to check that resizing is smooth:

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-desktop \
  '{"action":"drag","windowId":123,"from":{"x":300,"y":200},"to":{"x":420,"y":200},"durationMs":600}'
```

It presses at `from`, sends steady mouse-dragged events (100 per second by
default; `steps` can lower that, up to 125 per second) over `durationMs` (50 to
5000, default 500), pauses briefly and releases at `to`. `button` is `left` or
`right`. With `windowId`, both endpoints must lie inside that window and be
uncovered, and the window must not move before the press. The button is always
released, including when the task's access ends mid-drag. The result is
`{dragged,from,to,steps,durationMs}`.

When shared-pointer targeting is refused, its error identifies the first blocking
WindowServer rectangle with bounded diagnostic metadata: window ID, owning
process/app, layer, opacity and bounds, plus the target's local/global point.
The normal `windows` list exposes only ordinary layer-0 windows; a menu or
utility overlay can therefore block input without appearing in that list.
These diagnostics contain no window titles or page content. Opacity is only
diagnostic: a transparent window can still intercept input.

One system window has a narrow, verified exception. Current macOS draws the Dock
inside a window that spans the whole display, transparent and click-through
outside the Dock bar. It is ignored only when it belongs to the system Dock, the
Dock has no other window in front of the target, Accessibility reports just the
Dock bar (no Mission Control or App Exposé), and the point is clear of the bar.
The Dock bar itself, and every other window, still blocks input.

Use the blocker information to resolve the actual obstruction, then activate the
intended app and inspect a fresh display/region screenshot before retrying with
the same observed `windowId`. Do not remove `windowId`, switch to untargeted input,
or dismiss an unrelated app's window to bypass a refusal. If the reported blocker
is visually absent or appears mouse-transparent, report its bounded metadata for
investigation rather than assuming it is safe to ignore. Source changes to these
diagnostics take effect only in a rebuilt development host or installed release.

A provider-coloured ring and name tag mark the action point. The frosted bar
identifies the agent and app, with **Pause/Resume** and **Stop**. Esc twice stops
the active chat. App consent is on by default and lasts for the chat in that app;
shared control asks for every action. Shared control yields to user input;
app-directed control yields when the user works in the same app. Paused agents
can observe but cannot send input. Stopped agents need new consent. On pause,
stop, denial or timeout, agents wait for the user instead of retrying in a loop.
Both overlays are excluded from agent screenshots and cannot be input targets.

While the Mac is locked, or another user's session is on screen, desktop control
is paused completely: Aven reads the login session immediately before every
action, consent prompt and native event, and refuses observation as well as
input with "The Mac is locked. Desktop control is paused until the user
unlocks; keep working in Aven's browser or code, or wait." (or, when another
user's session is on screen, "The user's Mac session is not on screen"). A lock
reported by macOS's lock notification stays in force until the unlock
notification arrives or a later session read shows the lock and then the
unlock, so a session read that has not caught up cannot undo it. Nothing is typed into
the login window, no consent prompt waits for nobody, and the bar stays hidden.
Locking during a drag, typing or a multi-page scroll stops it at its next step
and releases any held button; an open consent prompt is cancelled with the same
message. `status` still reports settings and permissions. Agents continue other
work or wait, and observe again after the user unlocks.

Agent actions never trigger macOS permission prompts; per-app consent is separate. Agents read the status's `enabled`
flag and named permission grants before choosing an action; `permissionsRequired`
does not by itself block observation. If the switch is off or access needed for
that action is missing, the agent directs you to the Desktop control card. It must not change
macOS settings or install other tools to bypass the missing access.

Skills are instructions, not extra permissions or new tools. They do not bypass
the provider's sandbox, approvals, or macOS privacy controls. Websites continue
to use Aven's browser; local Markdown continues to use its editor.

## Checking a development build

Use the separate **Aven Dev** build described in [DEVELOPMENT.md](DEVELOPMENT.md).
Native command changes require rebuilding that app. Existing provider sessions
receive the new per-turn guidance on their next ordinary message; a new task also
receives the updated host policy. Source changes do not update the daily app until
a tested release is installed.
