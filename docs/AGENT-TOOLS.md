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
if Accessibility is missing. Moving the pointer, clicking, typing, pressing keys,
scrolling and activating apps require both permissions, so agents can observe and
verify input.
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

The agent checks status once, selects an observed window, and takes a `screenshot`
with its `windowId`. The result is `{path,width,height,originX,originY}`; the agent
must open the PNG at `path` with an image or file reader before acting. A successful
JSON response alone is not visual verification. It then uses `move`, `click`, `type`,
`press`, `scroll`, or `activate` as needed and takes and opens a new screenshot to
verify each result. Use `move` with `x,y` and an optional `windowId` for an
authorized hover. Screenshot pixels equal points. With `windowId`, move, click and
scroll `x,y` are that window screenshot's pixel coordinates. Window-targeted
moves, clicks and scrolling refuse points covered by another window. A window
capture can still show a covered window: activate its app, then inspect a fresh display
or region screenshot to confirm the intended window is in front. Without `windowId`,
use global points: `originX + x, originY + y` from the screenshot used. The help command documents all fields,
including optional screenshot regions.

A monochrome cursor with a compact **Aven** badge animates between move, click and
scroll targets, shows brief click or scroll feedback, and fades when idle. It ignores input and
focus and is excluded from agent screenshots and window lists. The cursor is a
visible activity cue; native input still uses the macOS pointer.

Agent actions never trigger permission prompts. Agents read the status's `enabled`
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
