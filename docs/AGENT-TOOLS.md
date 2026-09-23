# Browser, files and desktop control

Aven supplies these routes automatically to ordinary agent turns and follow-ups.
Use **Settings → Skills & Tools** to inspect the installed tools and their status.
The same setup works when Aven is the project you are developing.

## Websites and previews

Ask the agent to open or test a website. It uses the browser beside the conversation,
with a connection scoped to the requesting task. No browser extension, MCP server,
or change to the Mac's default browser is required.

Agents should start development servers without auto-opening a browser. They then
use the supplied command to open the URL, inspect a snapshot, and interact with
elements from that snapshot. If the connection fails, the agent reports the error
instead of switching to another browser. Explicit requests for a different browser,
configured browser tests, and provider sign-in flows retain their normal behavior.

## Markdown and code

Ask to open a local file. The agent uses the scoped `openfile` action:

```sh
"$SUPERMONO_BROWSER_EXECUTABLE" --supermono-browser \
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

Aven supports the optional [Peekaboo CLI](https://github.com/openclaw/Peekaboo)
for observing and operating native windows. Ask the agent to inspect or test an
app; no slash command is needed. `/aven-computer-use` contains the full workflow.

The agent checks the installed version, command help and current permission
status, then targets an observed app/window and verifies each action. It uses the
selected Peekaboo execution host or bridge. Screen Recording and Accessibility
must be granted to that host; optional Event Synthesizing may be needed for
additional input actions. Aven's status check does not change those permissions.

Skills are instructions, not extra permissions or new tools. They do not bypass
the provider's sandbox, approvals, or macOS privacy controls. Websites continue
to use Aven's browser; local Markdown continues to use its editor.

## Checking a development build

Use the separate **Aven Dev** build described in [DEVELOPMENT.md](DEVELOPMENT.md).
Native command changes require rebuilding that app. Existing provider sessions
receive the new per-turn guidance on their next ordinary message; a new task also
receives the updated host policy. Source changes do not update the daily app until
a tested release is installed.
