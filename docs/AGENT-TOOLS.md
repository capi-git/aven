# Browser, files and desktop control

Aven supplies these routes automatically to ordinary agent turns and follow-ups.
Use **Settings → Skills & tools** to inspect the installed tools and their status. Use **Settings → MCP servers** to add, remove, sign in to, and turn off MCP servers. Aven makes those changes through `claude mcp` and `codex mcp`, and turns servers off with each provider's own switch: Claude Code's `mcp_toggle` (the same as `/mcp disable`, saved for the open project only) and Codex's config writer (`enabled = false` on that server's entry in your `config.toml`, removed again when turned on). Codex is only changed for servers written as their own `[mcp_servers.<name>]` table or as dotted keys; Aven keeps the file's bytes first, writes only if the file is unchanged since it read it, checks that Codex can still read the result, and puts the bytes back if it can't. With no project open, Claude's servers can only be hidden. Each provider's own configuration stays authoritative. A server a provider can't turn off, such as ChatGPT apps, can be hidden from the page instead; Aven keeps that list under `aven.mcpHidden`, and the provider still loads the server.
The same setup works when Aven is the project you are developing.

## Websites and previews

Ask the agent to open or test a website. It uses the browser beside the conversation,
with a connection scoped to the requesting task. No browser extension, MCP server,
or change to the Mac's default browser is required.

Agents should start development servers without auto-opening a browser. They then
list pages first and reuse the matching page ID to inspect or reload the preview.

Each chat builds on one page per site. The first `open` from a chat makes a
page that is that chat's own. Its next `open` on the same site (the same
scheme, host and port, with `localhost`, `127.0.0.1` and `[::1]` counting as
one) lands on that page: the same address reloads it, keeping its scroll
position, and another route, query string, fragment or mock file navigates it.
The result says `"reused":"reloaded"` or `"reused":"navigated"` (a page that
woke for the open counts as reloaded). Overlapping requests from one chat share
one page, its opens on one site take turns so the page ends on the address
asked for last, and sleeping tabs wake as needed. An open that reloads or
navigates the chat's page first lets a load still running finish (it stops one
still running after two seconds), then returns once the new page has arrived,
its document committed, though images and scripts may still be loading. So the
agent's next snapshot reads the new page and two navigations never overlap on
one page. Hidden pages report their loads as quickly as pages on screen. A
page that does not report its load within about four seconds (a slow site, for
one) is handed back anyway, with a note that it is still loading, and the next open of the chat's on that site waits at most
ten seconds for the one before it. Another local server, or
another site, gets a page of its own. The page's tab names the chat in its
tooltip: "Opened by … ; the chat reuses this page".

`open` never navigates a page the user opened, and one chat never gets
another chat's page: a page of the user's at the same address is only shown,
as it is, and another chat's is left to it. A page stops being the agent's the
moment you use it (a click, a key, a dropped file or an annotation; the
agent's own clicks and typing do not count), when you choose **Keep this
page** in its tab's menu or double-click its tab, or when you type an address
into it. The agent's next `open` then makes a new page. If you use the page
just as an agent's open arrives, Aven leaves it as it is and opens a new page
too, and the result says why. Moving a page into a split keeps it as a tab but
leaves it the agent's.

Agents are told to iterate on a mock-up or preview in place: edit the same
file and reload its page, rather than making `mock-v2` files or more tabs,
unless you ask for alternatives side by side. They pass `"newTab":true` only
for a second page they need at the same time; `"arrange":false` already leaves
your view alone. Agents often asked for a new tab just to be safe, so a
new-tab request at the same path as the chat's own page reuses that page
(reloaded, or navigated to the new query or fragment) instead of copying it;
one at another path or site opens a second page. The browser shows `http` and `https` pages only, so a mock is
served from a local server rather than opened as a `file://` address. Agents inspect a snapshot and interact with elements from it. If the connection fails, the agent reports the error
instead of switching to another browser. Explicit requests for a different browser,
configured browser tests, and provider sign-in flows retain their normal behavior.

Agents are told to finish the job rather than hand steps back. When a page
does not respond, they take a fresh snapshot and click by reference, hover
first, use keys (Tab, Enter, Space, Escape, arrows), wait for a menu and look
again, and use `upload` for file choosers. If the browser actions still cannot
do a step (a canvas app, for example), they move to desktop control inside the
page, on the Aven window that shows it. Aven's window titles name the tab in
front, so that window may be titled with another project; it is still the
agent's own page. Agents never operate file, open, save or folder dialogs or
Aven's own interface (settings, other chats, approval bars) through desktop
control, and hand another site's sign-in or payment frames to you. Aven
enforces the first two: in its own windows, desktop input is accepted only
inside the browser pages that chat uses, keys only while such a page has the
keyboard focus, and nothing while one of Aven's file dialogs is open. They lead with real blockers they find, such as a paid
plan, and hand back only the step that needs you (payment, sign-in, two-factor
codes, a plan upgrade, or an approval you declined): they get as far as they
can, show a screenshot labelled `stopped-here` of the exact spot, and give one
precise next step, such as "Click Add, choose llms.txt from Downloads, then
Publish".

When a development server starts in an Aven terminal or in an agent's shell
command, Aven notices the local address it prints (loopback only: `localhost`,
`127.0.0.1`, `[::1]` and `*.localhost`; a server bound to `0.0.0.0` opens on
`localhost`) and offers **Preview ready · localhost:5173 — Open beside chat**
above the chat, or in the terminal panel's header for that panel's servers.
Opening it reuses a tab already showing that server. **Settings → Browser →
Open dev previews automatically** opens each new server start once without
asking; a bare "listening on port 3000" line, often an API, is only offered.
When the server stops, the offer turns to
**Preview stopped**; the page stays open.

## Pages you have open

Agents can use any page you have open in Aven, including sites you are signed
in to, such as a Notion page a friend shared or your Gmail. Ask the way you
would ask a person ("add the Notion page I have open to my Framer site"); you
don't need to point at the tab.

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-browser tabs
"$AVEN_BROWSER_EXECUTABLE" --aven-browser read TAB_ID
"$AVEN_BROWSER_EXECUTABLE" --aven-browser export TAB_ID --to /path/to/project/content/launch-plan
```

Each is also a JSON action: `{"action":"tabs"}`, `{"action":"read","id":"TAB_ID"}`
and `{"action":"export","id":"TAB_ID","to":"/absolute/folder","name":"article","replace":true}`.

- `tabs` lists every browser tab open in Aven: in every project, the
  workspace without a project, other Aven windows and detached windows. Each
  tab has an id, its title and address, its project and window, and whose it
  is: the asking chat's own page ("yours"), "the user's", or "another chat's"
  (named). It says when a tab is asleep or on screen. The id stays the same
  while a tab sleeps and wakes (`browser-…`; a second Aven window's tabs start
  `w1-…`). The asking chat's project comes first.
- `read` returns the page's main content as Markdown, without the site's
  menus, sidebars and footers: headings, paragraphs with bold, italic, code
  and links, lists, to-dos, toggles, callouts, quotes, code blocks with their
  language, tables, equations, and images with their alt text and captions.
  Notion pages are read by their own blocks, including a page open in
  Notion's side peek. At most 100,000 characters come back; export saves more.
- `export` saves the same into the chat's project: `<to>/article.md` (or
  `--name`) with front matter giving the title, source address, time saved and
  a note that the text came from a web page, and the page's images in
  `<to>/images/`, named by their place in the page and their alt text or
  caption (`images/03-launch-diagram.png`) and linked with relative paths.
  Images load through the page's own frame in Chromium. An image on the
  page's own site (`file.notion.so` for a page on `www.notion.so`) carries
  your cookies for it, so Notion's private images work; an image on another
  site is loaded without your cookies (signed addresses need none), so a page
  cannot use your sign-ins elsewhere. A page on the web never gets an image
  loaded from this Mac or your local network. Aven prefers the address the
  page actually showed. Each file must really be an image (a sign-in page sent
  instead is refused), and an SVG is saved only when it just draws: no
  scripts, event handlers, embedded pages or links out. An image that cannot be
  saved keeps its web address in the Markdown and is listed as skipped, with
  the reason. One export saves at most 150 images, 10 MB each and 100 MB in
  all, and stops fetching after about 75 seconds.
- `export` writes only inside the chat's project. The folder is checked when
  the export starts and again before every file it writes, as it resolves,
  so a link that leads out of the project or into `.git` stops it; an
  `images` folder that is a link is refused. Files are created new and never
  through a link, and nothing that exists is replaced unless
  `"replace":true` (an image name already taken gets a new number instead).
- The Markdown is inert text under CommonMark, raw-HTML renderers and MDX:
  page text cannot become markup, an `{expression}` or an `import` line, and
  equations are kept as math code (`` $`…`$ `` and ```` ```math ````).
- Toggles closed in a Notion page have no content in the page to save. The
  Markdown keeps their title (`<details><summary>…`) and the result says how
  many were closed, so the agent can ask you to open them.
- Reading never changes your tab: nothing navigates, scrolls, takes focus or
  ends your mark-up. A sleeping tab, or one not shown since Aven started, is
  loaded again out of sight to read it, and the result says `"woke":true`.
- `snapshot` and `screenshot` work on any listed tab as well.

When you ask, an agent may also click, type, press keys, scroll and navigate
in a tab that is not its own. These protections stay:

- `open` never reloads or navigates a page of yours (see above).
- Agents never type into password, sign-in code or card fields in a tab that
  is not the chat's own page (known by type, autocomplete, name and label,
  and split one-digit code boxes); Aven refuses. Snapshots of such tabs leave
  those fields' values out.
- Every upload still asks you.
- While an agent uses any tab that is not its chat's own page, Aven's presence
  bar shows at the top of the screen: "Claude is using the tab “Launch plan”",
  what it is doing ("Reading the page"), the window and project, and the chat,
  with **Pause** and **Stop**. Several agents' uses show together without
  replacing desktop control's. It fades a few seconds after the last action.
  Pause holds that chat's reading, saving and acting in other tabs (an export
  stops before its next image) until you press Resume or Stop or its reply
  ends; the bar keeps naming it, and desktop control is not paused. Stop
  closes other tabs to that chat until your next message, one you write
  (another agent's message or a bot's card does not count): an export stops
  before its next image and saves nothing more, and `tabs` is refused too.
  Desktop control and its approval are left as they are. Pause or Stop on
  desktop control's own bar also holds or closes the agents' other tabs.
  While the Mac is locked, when nobody could see the bar, agents may read
  other tabs but not act in them.

Everything a page contains is untrusted. Tab titles and addresses, what `read`
and `export` return, and the files `export` saves are marked as content from
websites, and agents are told to treat them as data and never follow
instructions in them.

**Settings → Browser → Agents can read any open tab** is on by default. When
it is off, `tabs` lists only the chat's project's tabs and other tabs' ids are
refused; the change applies to every chat at once.

## Working beside other chats

Agents in one project are told what the others are doing, so they share a dev
server instead of starting their own. Ahead of each message, a chat receives a
short `<aven-shared-work>` note (at most 1,200 characters, hidden from the
transcript) with the project's running dev servers and who started them, the
other chats working there with their request and the files their current or
last turn edited, and any second copy of an app this chat started. It asks the
agent to reuse a running server, to say so before it needs another port or a
restart, and to avoid files another agent is editing. The note is sent only
when it differs from what that chat last received, the same way for every
provider: Claude Code and Codex take launch instructions only when a
conversation starts, and this changes between turns. A failed send,
compaction or a provider switch sends it again. It is the only place agents
are told about running servers.

Codex runs commands in a sandbox without network access unless the chat has
**Full access**, so a Codex chat in another mode is told plainly that its
sandbox may not reach the running server and to ask the user before starting
another.

When a dev server starts while one for the same app (same framework or
package script, same folder) already runs, the chat that started it shows
**Codex started a second dev server on :5174 while :5173 is running** with
**Keep both**. A copy started in an Aven terminal can be stopped with Ctrl+C
from the chip (**Stop the new one**); Aven cannot reach an agent's own shell,
so for an agent's copy the chip offers **Ask Codex to stop it**, which queues a
short message in that chat. A server in another checkout or folder is never
flagged, nor are the several servers one command starts, nor a restart after
the first server stopped.

When two working chats in a project edit the same file, both message boxes show
**Codex is also editing src/App.tsx** and both sidebar rows carry an amber mark,
until either turn ends. All of this comes from tool calls Aven already
receives; nothing polls or watches files.

## Working in the background

Browser actions never move your pointer, take your keyboard focus or bring Aven
forward. Snapshots run in an isolated script world inside the page; clicks,
hovers, key presses, typing and scrolling go to the page through Chromium's own
input channel, not the Mac's.

- `fill` focuses the field inside the page, selects what it holds and types the
  value with Chromium's trusted text input, so frameworks see ordinary
  `beforeinput` and `input` events. A following `press` with `Enter` reaches
  that field and submits its form. The result's `method` is `typed`. Aven types
  only when that field really holds focus, checked again just before typing:
  if the page moves focus elsewhere (a focus trap or redirect), if your caret
  is in another field or an embedded cross-origin frame of the page you are
  using, if the page refused typed text, or for selects, date and time fields
  and clearing a field, Aven sets the value directly and reports `value`. Once
  you click or type in the page, a field the agent filled earlier counts as
  yours.
- `click` works like a careful mouse (`method: "pointer"`): Aven scrolls the
  element into view, moves the pointer onto a point that really lands on it,
  lets hover settle (menus and row actions appear), checks the point again,
  then presses, holds briefly and releases. This works in hidden panes, in
  other windows and at any page or pinch zoom, so menus that open on press or
  hover (Radix, Headless UI, Framer) respond. The result says whether the press
  reached the element; a press the page took without a click event (menu items
  that act on pointerup and close first) is reported as pressed, with a note to
  take a snapshot rather than click again. Only when no pointer can reach it (something such as a
  cookie banner covers every part of it, it is off screen, or it opens a
  native picker such as a select or date input) does Aven click the element
  directly (`method: "element"`, with `reason` and `coveredBy`); some apps
  ignore that.
- `hover` rests the pointer on an element so hover menus, tooltips and row
  actions appear. Snapshots list controls hidden until hover with
  `"hidden": true`; clicking one hovers it first.
- Snapshots list buttons, links, fields, menu items, options, tabs, switches,
  anything a site made clickable with a pointer cursor, controls inside open
  shadow roots and same-site frames (`frame`), and hidden file inputs. Frames
  from another site appear as one `crossOrigin` entry; their controls are not
  listed.
- If a click, fill or key press gets no reply in time, the error says it may
  have been applied. Take a snapshot before retrying, so a form is never
  submitted twice.
- In a visible page, Aven draws its pointer: a ring in the agent's colour with
  its name, gliding to each click, field or focused element, with a ripple for
  clicks and a soft pulse for typing and keys. It never shows typed text. It
  fades about two seconds after the last action, respects Reduce Motion, is
  clipped with the pane and is never drawn for hidden panes. It is hidden while
  a page screenshot is taken, so screenshots never contain it.
- `open` normally shows its page beside the requesting chat. Pass
  `"arrange":false` to leave your panes exactly as they are: a new page waits as
  a background tab in the focused pane, and an existing page stays where it is.
  Pages in detached windows keep that window's own placement.

While a chat is working, Aven keeps the Mac from idle sleep and from App Nap
(**Settings → Tasks → Keep the Mac awake while agents work**, on by default).
The display can still sleep and the screen can still lock; closing the lid or
choosing Sleep still sleeps the Mac. This shares one hold with the automations
setting, which only prevents idle sleep while automations wait. A chat waiting
for your approval or answer does not keep the Mac awake, and a turn that shows
no progress for four hours stops holding it until it makes progress again.

Agents never unlock or bypass a locked screen. While the Mac is locked, browser
results include `"screenLocked":true` and a short `lockNote`. Hidden and locked
pages run with Chromium's background throttling, and a locked display may not
render new pixels: a screenshot waits at most four seconds, then later
screenshots fail at once with a clear message until the lock changes. Snapshot,
click, fill, press and scroll keep working.

## Automation runs

An automation's run is a chat of its own that stays in **Automations**, under
its automation in its project's folder; it gets no tab and is not listed with
the project's chats, on Home or in the palette until you choose **Open as
chat**. Chats that runs started before this change stay ordinary chats where
they were, and their runs are listed under their automation as well. A run
posts nothing to Activity when it simply finishes. A run that fails, cannot
start or is given up on after four hours without a reply posts one entry, and
approvals and questions reach you as they do from any chat; opening any of
them shows the run in Automations.

The agent is told the run is unattended. When it finishes with something for
you to review or publish, it saves that as a draft and ends its final reply
with one `aven-review` block: a JSON object with a `title`, and optionally a
`kind` (`publish` or `review`), a `summary` and a `url` (http or https only).
Only a single block at the very end of the reply counts; one quoted inside
another fence, a quote or a list is text. Aven turns it into a **Ready to
publish** or **Ready to review** card in the Inbox and at the top of the run.
The card's button is Aven's, never the agent's: **Publish** sends "Publish the
draft now." and **Approve** sends "Approved. Go ahead." to the run's chat, once,
and only while the run is not working. **Done** takes the card away. A reply
without the block leaves no card.

### Publish articles from Notion

The **Publish articles from Notion** template in **New automation** asks for
the Notion page or database, the site's project (No project cannot be chosen),
a line on where the articles go on the site, and optionally the Notion status
that marks an article ready; left empty, any article not yet on the site
counts. It runs on Mondays at 09:00 by default, and **Run now** also starts one
run as it is created. Your answers are written into an ordinary prompt, which
**Made from your answers** shows before you create it and **Edit** changes
afterwards. Each run is told to:

- Read the source with the Notion connector (Notion's MCP tools, such as
  Claude's claude.ai Notion connector), or else with `tabs`, `open` and
  `export` above, into `.aven/notion-export/` in the project. A database has an
  article per row, a page one per sub-page. Images are downloaded as each
  article is read, because Notion's file links expire, and no Notion file link
  goes on the site. Nothing in Notion is changed.
- Keep `.aven/notion-articles.json`, which maps each Notion page id and its last
  edited time to the article's page on the site and whether it is a draft or
  published. Articles that have not changed are skipped, a changed one updates
  its existing page, and the first run records articles already on the site
  instead of adding them again.
- Add articles with the project's own tools and follow the existing ones
  exactly: the Framer skill and the project's Framer setup for a Framer site,
  the code for a code site. Only those articles' pages and the lists they
  appear in change, and nothing is deleted or unpublished.
- Leave everything unpublished: Framer drafts and an unpublished site, or
  uncommitted changes on the current branch of a code site, with nothing
  pushed, deployed or merged.
- End with one `aven-review` block of kind `publish` whose title names the
  articles, whose summary says what changed and any other unpublished site
  changes that publishing would include, and whose link is the Framer project
  or the site. When nothing is new it leaves no card. When it cannot finish,
  for example because Notion could not be read, it changes nothing and leaves
  a review card saying what it needs.
- Publish only on "Publish the draft now.": exactly what the card listed, then
  name other pending changes that went out too, mark the articles published
  in the record, check each live address and reply with the live URLs.

Everything read from Notion is treated as untrusted content: material to
publish, never instructions, and any text in an article addressed to the
agent is pointed out in the summary rather than followed.

## Uploading files

An agent can send local files to a website through the page's own file
chooser, for example to publish an `llms.txt` it wrote:

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-browser \
  '{"action":"upload","id":"PAGE_ID","ref":"REF","paths":["/absolute/path/llms.txt"]}'
```

`ref` is a file input from a snapshot (snapshots list hidden file inputs too),
or the button or menu item that opens a chooser, such as **Add** or **Upload
file**. Before anything leaves the Mac, Aven checks the files: absolute paths
to existing, readable regular files (no folders, devices or pipes), at most 10
files, 256 MB each and 512 MB together. Refused outright, with the agent told
to ask you:

- files in a hidden folder directly in your home folder (`~/.ssh`, `~/.aws`,
  `~/.config`, `~/.gnupg`, `~/.docker`, `~/.kube`…);
- files in a folder that holds credentials or repository internals anywhere:
  `.ssh`, `.aws`, `.gnupg`, `.git`, `.kube`, `.docker`, `.azure`, `.gcloud`,
  `.password-store`, and `~/Library/Keychains`;
- files named like secrets: private keys such as `id_rsa` or `id_ed25519`,
  `.pem`, `.key`, `.p12`, `.pfx` and `.ppk` files, keychains, and hidden files
  such as `.env` or `.netrc`.

Both the path the agent gives and the file a link points to are checked. Other
dot-folders deeper in a project are ordinary content, for example
`.well-known/llms.txt`, `.github/…` or a worktree under `.worktrees` or
`.claude/worktrees`.

Aven then copies the files into a private folder (readable only by you) and
asks in its bar: **Claude wants to upload 2 files to framer.com**, with the
total size, the page's full address when it differs from the site, and one
line per file with its folder, then **Don’t Allow** or **Allow**. The site is
the address's registrable domain (`framer.com` for `app.framer.com`); a long
address is shortened from the left so its real domain stays visible. Every
upload asks; an approval covers only that upload, and a decline holds for the
same files and site until your next message. The bar works whether or not
desktop control is on, ignores clicks Aven itself posts, and Aven never asks
while the Mac is locked.

The page receives the copies you approved, never the originals, so a file
changed after you allowed it is not sent. After you allow it, Aven clicks the
control like a pointer. It answers a file chooser only around that click: while
the click is being made and for five seconds after it, and only the chooser in
that page's own tab, with the approved copies. Choosers you open yourself,
folder and save dialogs, and choosers in popup windows are never answered for
you. If you click or type in that page while the upload waits, or the page
navigates to another address or site, Aven stops and uploads nothing. The page
side always ends within 30 seconds, and if the agent's request gives up first,
Aven cancels it too. Copies are deleted at once when nothing was uploaded;
copies a page received are kept for an hour (a site may read the file only
when it sends a form), until that chat ends, or until Aven quits.

The result lists the uploaded names, or says why nothing was sent: declined,
no answer, no chooser opened (the control may open a menu first), a
single-file chooser offered several files, or the page changed. A chooser that
asks for other file types gets a note, since the site may reject the file.

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

Agents check pages by reading, not pictures: a snapshot shows a page's text,
structure, state and behaviour. They take a screenshot only to judge how
something looks, typically one before and one after each visual change, and
never just to confirm text a snapshot already shows.

A page on screen is captured as you see it, without changing its size or zoom.
A background tab is captured at its current size. Screenshots are saved as
compressed JPEG files at the page's on-screen size: a Retina capture is scaled
to 1x and the long edge is at most 2,000 pixels, so small text stays readable
at a fraction of a PNG's size. Screenshots are kept in Aven's app data folder
under `turn-shots` and deleted with their chat. PNG files saved by earlier
versions stay as they are.

When a chat's turn ends, Aven deletes the screenshots taken during that turn
that are neither labelled nor shown in the chat's messages, such as one taken
only to look at a page. A screenshot counts as shown when its file name
appears in a message or an attachment; tool output and reasoning do not count.
Nothing is deleted while the turn is still running, and if Aven cannot tell
whether a screenshot is shown, it keeps it.

A chat keeps at most 300 screenshots. When it is full, a new screenshot makes
room by deleting the chat's oldest screenshots that are neither labelled nor
shown in its saved messages. Only when none can go is the screenshot refused,
with "This chat already has 300 screenshots…".

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

## iPhone and iPad apps

On a Mac with Xcode, a project with an `.xcodeproj` or `.xcworkspace` gets an
**iPhone** button in its pane header, next to the browser and board buttons
(also **iPhone** in the strip's right-click menu). It opens the simulator
beside the chat. Without Xcode the menu shows "Install Xcode to run iPhone
apps" instead; Windows shows nothing.

The pane's toolbar picks the device (iPhones and iPads Xcode offers; picking
one starts it) and the scheme (hidden when there is only one), and has Home,
Rotate, Screenshot (copies the screen to the clipboard) and **Run**. Run
builds the scheme for the simulator, installs and opens the app, and becomes
**Stop** while it builds or runs. The strip below reads "Building…",
"Running · built in 1.8 s" or "Build failed · 2 errors" with **Show errors**,
which opens the build log with the errors listed first. **Logs** opens the
app's console output. Builds use their own DerivedData in Aven's app data
folder (`ios-sim/<project>`), removed with the project; the chosen device and
scheme are remembered per project.

The screen is live: Aven shows the simulator's own framebuffer in a native
layer, at the simulator's frame rate, with no Simulator window. Click and drag
to touch, scroll to swipe, and type while the screen has the keyboard: keys go
to the device by position with their modifiers, so Option-E then E types é;
Paste (Command-V) copies the Mac's clipboard text into the device first.
Aven uses Xcode's private simulator frameworks for this, loaded when the pane
first opens, only for the framework versions Aven was tested with, and checked
before use. Right after Aven starts a device it fixes
the device's input once ("Getting the iPhone ready…"), which restarts its home
screen (about ten seconds). Picking a simulator that is already running does
the same once when its input needs it. The pane opens on the device the project
last used, else on one Aven started or one that is shut down; it never takes
over a simulator that is already running until you pick it. A running one the
project used before shows without the fix and says to pick it again if its
touches need it. With an Xcode whose simulator frameworks Aven has not been
tested with, or when the check fails, the pane falls back to **Basic mode**:
screenshots a few times a second, with taps, swipes and typing anywhere on the
screen through Aven's XCUITest agent (`AVEN_IOS_SIM_ALLOW_UNTESTED=1` tries
the live view on an untested Xcode). When only Xcode's command line tools are
selected, the pane says how to select Xcode instead.

Agents use the same simulator with `--aven-simulator`, over the chat's scoped
connection, only while an iPhone pane is open beside that chat, and only on
the simulators Aven started for that project or the user picked in its iPhone
pane. Real devices are never reachable.
Each such turn carries a short `<aven-iphone>` note with the command.

```sh
"$AVEN_BROWSER_EXECUTABLE" --aven-simulator '{"action":"list"}'
"$AVEN_BROWSER_EXECUTABLE" --aven-simulator '{"action":"launch"}'
"$AVEN_BROWSER_EXECUTABLE" --aven-simulator '{"action":"snapshot"}'
"$AVEN_BROWSER_EXECUTABLE" --aven-simulator '{"action":"tap","x":201,"y":249}'
"$AVEN_BROWSER_EXECUTABLE" --aven-simulator --help
```

- `list` names the devices in scope with their screen size in points and
  orientation, and the app's run status.
- `launch` builds, installs and opens the app like Run and waits for the
  result, including build errors; `"build":false` reopens the last build.
- `snapshot` returns the accessibility outline (role, label, identifier,
  value, frame) of the project's app when it is in front, otherwise of the
  home screen, with the screen's size in points. It comes from Aven's XCUITest
  agent, which Aven builds into its app data the first time (about a minute)
  and starts per device (about ten seconds). Secure fields read `<redacted>`.
- `tap`, `swipe`, `type`, `press` (Enter, Tab, Backspace, arrows…), `button`
  (home, lock) and `rotate` act on the device. Coordinates are the screen's
  upright points from its top-left corner, the same as snapshot frames and
  screenshots, also in landscape. Taps show the agent's ring in the pane.
- `screenshot` saves a JPEG at point size with the browser's screenshots
  (`turn-shots`), returning `{path,width,height,markdown}`; labels and tidying
  work the same way.
- `logs` returns the app's recent console lines.

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
restores it straight away. A chat's restore and another chat's switch-on for the
same app never overlap, so a switch another chat still needs is not turned off. Aven also keeps a small private record of switches it
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

Shared-pointer fallback uses `inputMode: "pointer"`. It needs the chat's
consent even with app consent off. Aven asks once per chat, and that answer
covers every app, the shared pointer and activation until the user presses Stop.
Covered window targets are refused; never drop the window ID to bypass that
refusal. Consent is checked again against
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
the active chat. Consent is on by default and asked once per chat; that answer
covers every app, shared control and activation. Shared control pauses once the user keeps using the mouse or keyboard for about 3 seconds; a brief bump is ignored. App-directed and
element control keep running while the user works, even in the same app; only
Pause, Stop or Esc twice stops them. Paused agents
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
