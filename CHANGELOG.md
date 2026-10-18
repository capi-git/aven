# Aven changelog

## [Unreleased]

### Added

- Discussions, races and orchestrator runs share one slim bar in the message box of the chat they started from and of each agent's chat: "Discussing · Round 2 of 4 · with Codex in “Login fix”", "Racing · 1 of 3 done" or "Orchestrating · 2 working · 1 queued". It has **Watch**, **Compare** for a race, **Open agents** for a run, **Resume** while paused and **Go to Codex** when another chat is waiting on you. One button stops the whole thing: **Stop discussion**, **Stop race** (in the chat you raced from) or **Stop run** (in the lead's chat). When something needs you, the bar says "Needs you" with what is needed on a second line, such as "Codex wants to run npm test" or "Claude asked: Which port?". The message box's own square Stop still stops only that chat's turn.
- **Watch** opens a discussion, race or run in a floating panel inside the window. Drag it by its header and resize it from any edge. Press – or Escape to shrink it to a pill, or × or ⌘W to close it; the discussion, race or run goes on either way. Several stack as pills, amber when one needs you; press a pill to bring its panel back, and a closed one stays hidden until you press **Watch** again. A race shows a column per agent, side by side when the panel is wide, with its state and clock, what it is doing, the lines and files it changed, the first lines of its last reply once it stopped and **Go to chat** when it needs you, with **Compare**, **Stop race** and, once it is ready, **Suggest a winner** and **Ask a reviewer**. A run shows the lead, then each agent with its task, model, state, what it is doing or waiting for ("Waiting for review: …") and the files it touched, with **Open agents** and **Stop run**; when it is paused, or the lead stopped without finishing, it says why first, with **Resume** or **Finish run**.
- On a Mac, ↗ in the floating panel's header opens it in a small window of its own that you can move anywhere, even to another screen. What you press there is done in the Aven window it runs in. ↙ puts it back there, and closing the small window (or ⌘W in it) leaves it there as a pill. If that Aven window is hidden, the small window says so and **Show window** brings it back; if it is gone, the small window says so. A small window that can't load says "This panel couldn't load. Close it and press Watch again.", and one that never appears hands its discussion, race or run back to the floating panel after a few seconds. Its buttons show a plain message when something can't be done from there.
- After you race a message, a card follows it in the chat: "Each agent works separately. Your project doesn't change until you keep one.", with a row per agent (its mascot, name, state, time and lines changed), **Compare** and **Watch**. Pressing a row opens that agent's chat. Once no agent is working the card reads "Ready to compare" with "3 of 3 done". After you keep one it records it, "Kept Codex's version · 7 files", with the reason when you kept the suggested one, **Review changes** and **Continue with Codex**, which sends that agent a short recap so it can carry on in your project.
- **Suggest a winner** on a race that is ready to compare, on its card, in the floating panel or in Compare, has your cheapest model read the agents' last replies and changes and say which one it would keep and why: "Aven suggests Codex: …". **Ask a reviewer** sends them to a chat you pick instead, as a Reviewer; its pick becomes the suggestion ("Claude (Reviewer) suggests Codex: …"), and the card shows the reviewer beside the agents while it works. Compare also shows the first lines of each agent's last reply.
- A race can put two models of one app side by side, such as Claude Opus against Claude Sonnet, in any mix of up to four agents, and with only one agent app installed, two of its models can race. Agents are named by their app ("Claude", "Codex", "Grok"), with the model only when two of one app are in the same discussion, race or run ("Keep Claude Sonnet 5's version?"); tooltips give the full name.
- Once you confirm an orchestrator plan, its card becomes the run's card: the lead and each agent with what it is doing (pressing an agent opens its chat), then, when the run ends, "Run finished · 4 agents", the lead's one-line verdict and a row per agent (title, model, outcome such as Accepted or Failed, the files it touched and a line on what it did from your cheapest model), with **Review changes** and **Open agents**. **Show plan** unfolds the plan it started from. Before you start, the plan shows each task's files as small chips, and you can **Remove task** (tasks that waited for it no longer do) or **Discard plan**. When the lead stops without finishing, the run needs you: "The lead stopped without finishing.", with **Finish run** (tasks that never started are cancelled) and **Ask the lead to wrap up**.
- Light roles for an agent you bring in: **Reviewer**, **Tester**, **Skeptic** or **Designer**, each a one- or two-sentence instruction shown on hover. Give one to a discussion's other chat in the Discuss chip's dropdown, or to a task's agent on a run's plan card. The instruction starts that agent's first message, where its chat shows it, and the role shows as a badge on its mascot and name on the cards, in the bar and in the floating panel. It lasts for that discussion or run only; a race's own agents never get one.
- Every chat gets one word for where its work stands, shown as a small pill on its sidebar row (also in the floating sidebar): **Needs you**, **Working** (or **Racing**, **Discussing** or **Orchestrating** while its discussion, race or run is going), **Review** or **Shipped**. **Review** means its last turn left changes you haven't kept, undone or shipped; **Shipped** means they went out through Ship it. Aven works it out from what happened; you never set it, and an idle chat with nothing pending shows none.
- Each project has a board that opens like a browser tab: from the board button beside the title bar's new browser tab button, from the project's row in the sidebar (an icon on hover or **Open board** in its menu), from ⌘K ("Open board for <project>") or from its tile on Home. It shows the project's chats in four columns, **Needs you**, **Working**, **Ready to review** and **Shipped** (this week, with **Show older**), under "Today: 3 shipped · 5 in progress". Each card has the chat's mascot, title and one plain line, and the buttons it needs: **Allow** and **Open chat** for an approval, **Answer** for a question, **Watch** for a discussion, race or run (one card each), **Compare** for a race ready to compare, **Preview** when a dev preview is running and **Review** and **Ship it** for changes; once shipped, it links the commit or pull request. Clicking a card opens its chat, and cards glide to their new column as things change. The board is saved with the workspace, stays in the main window and comes forward if you open it again.
- Quick motion that makes Aven feel faster, never slower: your message rises into the chat as you send it and the reply fades in as it starts; a new split pane fades in beside the one you were in (switching tabs stays instant); menus, dialogs and the floating panel open with a small spring and stay solid while they do; sidebar rows glide to their new place when a chat's order or status changes; a chat's tab and row get a brief underline when its turn finishes; counters and status words ("Round 3 of 4", "2 of 3 done", usage readings) roll to their new value; and buttons press at once. None of it delays what you did. **Settings → Appearance → Reduce motion** turns all of it off, as does your system's Reduce motion setting.

### Changed

- A discussion now lives in the chat you started it from as one live card: both mascots, "Claude and Codex are discussing", the round, the latest line and **Watch**. When it needs you it turns amber with **Go to Codex** or **Resume**, and once over it reads "Discussion finished · 4 rounds", followed by **Where they landed**; **Show in chat** unfolds the turns behind it. **Watch** opens the conversation in the floating panel, which opens by itself the first time and then as you last left it: the two agents face each other with the round between them, the replies go back and forth and its box sends to both. Long discussions fold their older rounds, a rail jumps to any round and a line marks what is new since you looked. Finished discussions stay openable for as long as their chat exists, instead of only the newest twenty, and a new chat started for a discussion runs in the background, listed in the sidebar.
- Race starts from the message box's **+** menu, beside Plan mode, Orchestrator and Discuss, and is exclusive with them. Its chip names the agents ("Race · Claude · Codex") and its dropdown chooses two to four, each with its model; if sending wouldn't start a race, the dropdown says why instead of sending the message normally. The agent pill no longer has a Race section; ⌘K's **Race it** stays, and your saved agents carry over.
- One rule for what needs you, everywhere: notifications, Activity, Home, the sidebar, the bar, the cards and the Dock badge, which always say "Needs you" with a plain line on what is needed. A paused discussion or run, a run whose lead stopped without finishing or a race where an agent failed and none finished needs you, with the reason and the chat to open; otherwise a race with no agent working is ready to compare, which is calm, not amber. While an orchestrator run is open, an agent's approval or question is its lead's to decide: the agent shows "Lead deciding" in a neutral colour, with no banner, Activity entry or Home row for you. If the lead leaves it unanswered for 15 seconds it comes to you, and once a run finishes or stops its agents are ordinary chats again. The chats of a discussion, race or run count as seen while the chat it started from, the discussion's panel or Compare is on screen.
- Each discussion, race and run posts one Activity entry each time it needs you and one when it ends, "Discussion finished · 4 rounds", "Race ready to compare · 3 of 3 done" or "Run finished · 4 agents" (or "Run paused" with its reason), with a banner when you are elsewhere. Its agents' turns, and a lead's behind-the-scenes turns, no longer post entries or banners of their own, cheer the mascot, count toward the streak or prompt the memory keeper one by one; the end counts once.
- Home's "Running now" and Activity's "Running" show each discussion, race and run as one row with its agents' mascots and its status, opening the chat it started from. In the sidebar, a running race is one row: its agents fold into the chat you raced from until you keep or discard it.
- Runs use plain words. Other chats in the project say "<project> is busy with a run in “<chat>”. Finish or stop it there." with **Go to lead**; the run's card reads Running, Paused, Finished or Stopped; and a pause says what happened and what to do next. **Stop run** is on the sidebar card whenever a run is running or paused, and a finished run's sidebar card folds to one line, such as "Finished · 4 agents · 2h ago", that opens when you click it. Its count leaves cancelled tasks out: "3 done · 1 cancelled".
- Race asks before what can't be undone. **Keep this** asks while an agent is still working or when it would delete another agent's work, **Keep N selected files** asks while an agent is still working and **Discard race** always asks. Each question names whose work is deleted: "Keep Claude's version? This stops 1 agent still working and deletes Codex's work (3 files)."
- Each race agent shows how it really ended: Working, Needs you, Done, Failed, Stopped or Interrupted after Aven quit, and its clock stops when it finished. In Compare, an agent that failed, was interrupted, was stopped or whose chat closed with no outcome known has **Retry** on its row, which sends it the task again or says why it can't, for example while its chat is busy.
- Files you pick in Compare are remembered when you reopen it, and Aven keeps running races plus the 20 most recent finished ones instead of every race ever run.
- In Parallel work, a running race is one row, "Race · <your prompt>" with "2 of 3 done", listing its agents inside with **Compare** and **Discard race**, and a folder with changed files says "3 files changed" (or "3 files changed · 2 to merge") instead of "Up to date". Opened, a folder says what its state means, "Has work not in main yet · main has newer work · 2 changed files", with the counts in its tooltip. The race tab's right-click **Open race overview** is now **Compare**.
- When two panes share a tab, each now has a slim strip at its top in the same style as tabs, with its name, a handle to drag it and a button to close it. The strip sits above the pane's content, so it no longer covers a chat's first message the way the floating controls did. A tab with one pane still has no strip.
- Discussions, races, runs and the board share one look: one amber for "Needs you", one button style across the cards, the bar, the floating panel and the board, Git's green and red for lines added and removed, soft shadows on the floating panel and pills in light mode, card buttons that brighten on hover in dark mode and mascots that sit clear of the row text on Home, in Activity and on the board. Discuss and Orchestrator have icons of their own.
- Long agent replies stream smoothly and use far less of your Mac, even while an agent writes a long file, and they look exactly as before. Long orchestrator runs are lighter on the workspace and the floating sidebar too.
- The status card above the message box says what the agent is doing, in the words Home uses ("Edit app.js", "npm test"), instead of "Working · Agent is working". Until the agent does something it can name, it reads "Working…".
- Discuss starts with a new chat with another agent, such as "New chat with Codex" for a Claude chat, listed first. Your open chats follow, most recently used first, each with its model, its project and when you last used it. A chat without a title is named by its first message, or "Empty chat", and chats in other projects are listed only when this project has none. A race's **Ask a reviewer** list names and orders chats the same way.
- While a commit message is being written, Ship it says which model is writing it ("Writing with Claude Haiku 4.5…"), and you can type your own at any time, which stops the writing. The commit box in the Changes panel works the same way.

### Removed

- The discussion page is gone. A discussion now lives in its chat's card and the floating panel, and **Watch** replaces **Open discussion**.
- Linear is gone from Aven. The Inbox now shows only GitHub issues and pull requests, without the GitHub | Linear switch, and Settings → Connections no longer has a Linear section. Your GitHub inbox, filters and read marks are unchanged.
- Aven removes the old Linear key file it no longer uses. If you had connected Linear, the API key Aven saved in its app data folder is deleted the next time Aven starts; you can also revoke the key in Linear's settings.

### Fixed

- The bar in a chat's message box no longer cuts off why a discussion is paused (such as "“Rollout” is busy with another turn."): the reason wraps to a second line.
- A run whose lead ended without finishing no longer holds the project with no way out.
- Closing the lead's tab no longer strands an orchestrator run's results or stops the run: the lead stays loaded while its run is running or paused.
- Finished agent turns no longer linger as unread on Home and in the unread count.
- An older plan card can no longer start a plan that a newer one replaced; it reads "Replaced by a newer plan".
- A run that finished normally no longer tells its lead that finishing failed.
- Keeping one agent's result while it was still working could leave out the files it wrote in the last few seconds, for example a new file that a kept change imports. Aven now reads that agent's changes again after stopping it.
- **Open chat** in Compare did nothing when that agent's chat was not in an open tab. It now brings the chat back.
- Comparing a race while its agents work no longer interferes with their own Git commands.
- A race started from changes you hadn't committed no longer shows every agent as having work to merge in Parallel work.
- Racing a message from a chat no longer makes it vanish from that chat or jump you to another tab.
- **Where they landed** no longer leaves an empty card when it can't be written: it says "Couldn't sum this up." with **Try again**.
- **Have Claude build it** sends the plan once, then reads "Sent to Claude", so a second press no longer sends it again.
- The Changes panel, Parallel work and Ship it no longer go stale while Aven is on screen but another app has focus, as when you watch it on a second screen. When an agent's turn ends, its changes show at once, and Ship it no longer says "Nothing to commit". Between changes, Aven still waits for you to come back before it checks Git on its own.
- With the live preview open beside a chat, **Review** opens Session Changes as a tab beside the preview, in the same group of tabs, instead of squeezing a third narrow column between the chat and the preview.
- In a narrow chat, the review bar and the message box no longer cut their words off. The review bar's **Undo All**, **Keep All**, **Review** and **Ship it** become icons with tooltips, the Race chip reads "Race · 2 agents" or "Race · 2", the Discuss chip "Discuss · Codex · 3", Plan and Orchestrator keep their icons and the agent pill keeps its mark. Tooltips give the full text.
- After Ship it, Session Changes reads "Shipped · 1a2b3c4 · nothing left to review" with **Close**, instead of still showing the diff that went out. It also updates when the changes are kept or undone.
- The memory keeper's offer no longer cuts itself off in a narrow chat. It asks "Keep this project's memory up to date?" and wraps to a second line when it has to.
- The files an orchestrator run's agents write, and the files of a race version you keep, now show in the chat the run or race started from, so its file bar, **Review**, its board card and **Ship it** cover all of them instead of only the files its own agent touched.
- A file you change after shipping it no longer shows as the agent's change, with the old line counts. When the agent edits it again, the count starts from what you shipped.
- The board's **Shipped** column keeps each ship for the week, named after its commit, even after the same chat has new changes to review, and "Today: 2 shipped" counts the same ships, so the two always agree.
- The board shows its title and columns as soon as it opens, instead of a blank pane for a moment.

## [0.1.144] - 2026-10-16

### Added

- You can join a discussion between two chats from its page. Type in the box at the bottom ("Add something for both of them…"): your message shows as your own bubble and goes to both chats with their next replies, without interrupting either; sending while paused resumes it, and after it has ended it continues for one more round. When a discussion uses up its rounds, the page shows **Where they landed**, what the two agreed on and what is still open, written once by your cheapest model, with **Have Claude build it** and **Have Codex build it** to send the plan to either chat. Replies that agree or push back get a small mark, and their mascot nods or tilts its head as they arrive.
- Right-click a file link in a chat to **Open** it, **Reveal in Finder** (**Reveal in File Explorer** on Windows) or **Copy Path**.

### Changed

- The workspace is calmer and easier to read. Each pane rests on its own rounded card with a small gap, and the gap between two cards is the divider you drag to resize. A split chat has one bar instead of two, and the model is named once, in the message box's agent pill: a turn says "Worked for 4s", naming its model only when it ran on a different one. Earlier replies show their actions and time when you point at them, a finished turn is one slim line instead of a card, and chat, browser, file and terminal tabs share one style. The bottom bar shows one small meter per account for the limit it is closest to, with every limit in plain words on hover, such as "Claude: 12% of your 5-hour limit used, resets in 1h 30m". In the sidebar, rows are a little taller, the chat in front is clearly marked, cut-off names show in full on hover, a project's changed files show as a dot until you point at it, and Notes, Inbox and Automations are one row of small buttons.
- Two chats discussing now share one page: your topic, then each chat's replies as messages back and forth, the opening chat on the left and the responding one on the right, each with its own pixel mascot in its provider's colour, its model's name and its part, round dividers, the answering chat typing, and the closing note, with **Stop** and **Resume** at the top. It opens beside the chat that started the discussion; **Open discussion** above either chat's message box, the sidebar's connector, or the discussion's note in either chat brings it back, even after it has ended. Starting one no longer needs `/discuss`: choose **Discuss** in the message box's **+** menu beside Plan mode and Orchestrator, pick the other chat and rounds from the chip's dropdown (**Discuss with Codex · 3 rounds**), and send your message as the topic.
- **Settings → Appearance** has six controls instead of eleven: Theme, Accent colour (preset swatches or **Custom…**), Interface scale, one **Glass** slider from Solid to see-through that replaces the opacity, blur, Include workspace and status bar settings, Chat background, and **Use for all workspaces**. Sidebars now always match the workspace, and your current look stays exactly as it is until you change a control.

### Fixed

- The Light theme is light again for workspaces that had a dark Background colour saved with the old colour picker. Light mode now uses Aven's white background whenever a saved one would need white text, since Settings no longer offers a Background colour to change it. Your accent colour is kept, nothing saved is rewritten, and Dark mode is unchanged.
- The memory keeper no longer says it needs Claude Code or Codex when they are installed. Aven only checked for installed providers when you opened the model list, so until then the switch stayed off and the offer to keep a project's memory never appeared.

## [0.1.143] - 2026-10-15

### Added

- Aven can keep a project's memory up to date for you. After your first finished task in a project whose memory is empty, the chat asks **Let Aven keep this project's memory up to date?** Turned on, Aven fills in the project's stack, how to run it, conventions, work in progress and gotchas, and refreshes its own sections after every eight finished tasks or once a day you use the project: never more than hourly, never while an agent works there, and not near a usage limit. It uses your cheapest model (Claude Haiku, else a small Codex model) with no tools, on a summary Aven reads itself that skips `.env` files and keys and ignores text that tries to instruct it. Your own lines are never changed, and a line you edit in Aven's sections becomes yours. The memory editor shows "Updated by Aven 2 h ago · +2 −1 lines · Undo", the model, its last run and **Refresh now**, and the sidebar marks an update until you open the memory. Turn it on or off there or in **Customize project…**.
- Agents in one project now know what the others are doing. With each message, a chat is told (only when something changed) which dev servers are running and who started them, which other chats are working and the files they are editing, so it reuses the server you already started instead of opening another. If an agent starts a second copy of a running app anyway, its chat shows **Codex started a second dev server on :5174 while :5173 is running**, with **Keep both** and **Stop the new one** (or **Ask Codex to stop it** when Aven cannot stop it itself), and when two chats edit the same file at once both show **Codex is also editing src/App.tsx** above the message box and an amber mark in the sidebar.

### Changed

- Aven has a new logo, the Pixel A: a pixel-art A with one blue pixel at its peak. It replaces the chevron on the app icon, the Windows installer, the update card in the sidebar and the browser's icon for pages without one, and stays sharp at every size.

### Fixed

- Websites in Aven's browser can now use the microphone and camera. Before, macOS blocked them without asking. Now macOS asks you to allow Aven the first time a site needs them, Aven remembers your answer for each site (forget it from the browser's **⋯** menu), and if macOS is blocking Aven the tab says so with a button that opens the right Privacy & Security page.
- On macOS, Aven opens straight to your workspace. Its window no longer shows an empty dark screen, or your desktop through empty glass, for a moment before the interface appears.

## [0.1.142] - 2026-10-15

### Added

- Two chats can discuss a topic when you ask them to: choose **Discuss with…** from the message box's **+** menu (or type `/discuss`), pick another open chat or a new one with any model, and set the topic and rounds. Aven passes each finished reply to the other chat, shows every relayed message in both transcripts, pauses for approvals, questions and your own messages, and the sidebar animates the two chats talking.

### Changed

- **Restart to update** no longer refuses with "Wait for current activity to finish". Aven waits a few seconds for background work such as a Claude Code or Codex tool update, brings detached tabs and Picture in Picture back, closes other workspace windows after saving them, and closes idle terminals by itself. If agents are working, waiting for your answer or have queued messages, or a terminal is running a command or a file has unsaved changes, one dialog lists them: **Restart when they finish** waits and restarts by itself, **Stop them and restart now** stops them first. Anything that still blocks is named.

## [0.1.141] - 2026-10-15

### Added

- Each project has its own colour and mark, so you can tell at a glance which project you are in. Sidebar rows show the project's logo, or its pixel mascot in the project colour; the active chat tab is underlined in the project colour (a tab group's own colour still wins inside the group); and a project's browser shows its mark beside the address. Choose **Customize project…** from a project's actions to set its name, colour, mascot and logo, or reset them. Changes show in every window at once, including the floating sidebar.
- Sidebar project rows show what is happening without opening the project: the mascot moves while an agent works, an amber dot means something is waiting for you, a number counts unread replies, and +N counts changed files. Hover the row for the details.
- Aven now warns before you hit a usage limit. When Claude or Codex will run out before the window resets at your current pace, the footer meter gets a small amber mark and its details say how long is left ("~40m to limit at this pace · resets in 2h 10m"), Home's Usage shows the projection for each window, and the composer's model pill offers a one-click switch to another account with room or a lighter model. It warns once per window unless your pace picks up, never blocks sending, and uses only the usage checks Aven already makes.
- Home is now a dashboard of your own work instead of a generic welcome. A greeting heads it, with small chips under it only for what is happening: agents working, things that need you, unread replies and changed files. **Your agents** gives each project a tile with its mascot (or logo) large: it hops while an agent works, with a speech bubble saying what it is doing ("Edit App.tsx"), shows an amber **!** when it is waiting for you, counts unread replies, and dims when the project has been untouched for a few days. Click a tile to open what needs you there, what is running, or its latest chat; **+** starts a task and **…** (or right-click) customizes the project. Below, **Needs you**, **Running now**, **Recent sessions**, an **Activity** feed of finished turns and your last known **Usage** fill two columns. Home never redraws while an agent streams unless something it shows changes.
- Project mascots react when a turn ends: a happy hop with a little sparkle when the task is done, a slump with a drop of sweat when it fails, and a blink when you stop it. The reaction plays once, about a second, in the window you are using: on the mascot running along the message box, on the project's row in the sidebar and on its tile on Home. With reduced motion turned on, the sparkle or drop shows without moving. On Home, a project left alone for three days or more dozes with a small "zzz".
- Home's greeting is followed by a short recap of today ("Today: 12 tasks done in 3 projects · 1 failed") and, from two days on, a streak of days with at least one task done, with a pixel flame. The streak dims until today has a task, and it is remembered even after older activity is cleared from the list.
- After a night or six hours away, Home opens with a **While you were away** card: turns that finished or failed meanwhile, what is waiting for you, which automations ran, and pull requests that ask for your review. Click a turn to open its task, the waiting line to jump to **Needs you**, or a pull request to open it in the browser. Pull requests are checked with the GitHub sign-in the Inbox uses, at most once every ten minutes and only while the card is shown; without a GitHub sign-in that line is simply left out. Dismiss the card with ×; it also goes away on its own after a few hours. It appears only when there is something to report.
- When a dev server starts in an Aven terminal or an agent's command (Vite, Next, Rails, Django, Flask and others), a **Preview ready · localhost:5173** chip offers to open the running app beside the chat, reusing its tab if it is already open; it turns quietly to **Preview stopped** when the server ends. Turn on **Settings → Browser → Open dev previews automatically** to skip the chip, and agents with Aven's browser are told which server is running so they check their work there.
- Each project has a memory that every agent in it receives, so switching from Claude to Codex, or starting a new chat, keeps the project's decisions, conventions, work in progress and gotchas. Open **Project memory…** from a project's actions or from **Customize project…**, or press **Remember this** under a reply to add a short item you can edit first. It stays in Aven, never in the project's files; edits reach new chats at once and open chats with their next message.
- The Changes panel opens with a card for the folder you are in (project mark, branch, how far it is from its upstream and its last commit), shows each file's added and removed lines with a small bar, greets a clean copy with its mascot, and lists history as message, refs, short id and age. **Ship it** commits, pushes or opens a pull request from one card that says whether the agent's last turn ran tests and how they went, then follows the pull request's checks until they finish; a finished turn's changes in the chat offer it too.

### Changed

- In the Changes panel, other copies are now **Parallel work**: separate copies of the project where agents work on their own branch. It folds to one line ("Parallel work · 7") with a moving project mark for each agent at work. Opened, each copy is one line with a short status ("78 to merge", "Up to date", "Merged") and dots for an agent working or uncommitted files; three show, busiest first, then "+N more". Open a copy for the full story ("78 commits not in main yet · main has 3 newer commits · 17 files uncommitted"), its chat, and Open chat, Ship it, Show in Finder and Remove. Merged copies fold into one "2 merged into main" line with Clean up. **Releases** is one line saying what is live and how many changes aren't released yet; open it for the existing actions.
- A project's changed-file count is rechecked only when something in that project changes, rather than after every edit in any project. Counts for projects in the sidebar are read a couple at a time in the background and never while Aven is hidden.

### Fixed

- Projects found by Search show their own logo instead of a broken image.

## [0.1.140] - 2026-10-15

### Development

- `npm run perf:app` runs a speed test in Aven Dev: it drives chats, streaming, typing, tab switching, the sidebar, Settings, the browser and idle with a production interface, and reports time to the next frame, frame pacing, CPU, wakeups and memory for each.
- Releases now wait for a real-app check: Aven Dev runs once against a stand-in provider, sends a message with the floating sidebar attached, opens and closes Settings, Search, Inbox, Automations and Notes by button and by shortcut, opens and closes Settings from the floating sidebar, and deletes a project whose terminal panel is hidden. Both 0.1.137 regressions fail this check. Run it locally with `npm run check:app`.
- The real-app check also types `/` and `@` in a chat, closes each list with Escape, keeps typing and sends with Enter. The speed test and this check now type into the message box that is on screen; since hidden tabs keep their layout, they could pick a hidden tab's box before.

### Changed

- Aven rests more when you are not using it: at idle with the workspace on screen it wakes the Mac about half as often, the browser engine stops waking Aven thirty times a second while no page is visible, and the floating sidebar's process is only started once you first unpin the sidebar.
- While agents edit files, the Changes panel checks less often when nothing changes, and the Releases, merged branches and copies lists refresh at most every 2 minutes, 30 seconds and 10 seconds. Before, they could call GitHub around 200 times a minute and run git dozens of times a second.
- Background web pages can be put to sleep to save memory unless they hold edits, play media, or embed frames or canvases, as Chrome's Memory Saver does. Before, almost any page you had clicked in, or that had a search box, stayed loaded all session.
- Pasted and attached images are no longer kept in memory as text once saved, which also stops drafts with images being rewritten in full after every pause in typing. Popups such as the usage panel are released after two minutes closed.
- Aven's windows open faster. The workspace loads about a third less code before it appears, and the floating sidebar and the usage, access and menu popups load less than half of what they did. The code highlighter now loads with the first code block, and Settings, Search, Inbox, Automations, Notes and the command palette load in the background just after startup.
- Switching between chats, tabs and the browser, showing or hiding the sidebar, and opening or closing Settings are faster: measured in the speed test, Settings takes about a third less time, the sidebar about a fifth less, and the slowest tab switches about a quarter less. Aven no longer stops to measure the window in the middle of these changes, and opening Settings no longer restyles the whole workspace.
- The `/` list shows skills you used recently in the project first, then the project's and your own skills, then Aven's commands such as `/plan`. Searching it matches skill names, with the matched letters marked, and lists at most a few skills whose description mentions the word you typed, instead of almost every skill.
- The `/` list ends with a "Create skill" row you can reach with the arrow keys and Enter.
- The message box now says what `/` and `@` do.
- Typing after `@` no longer pauses while Aven rereads the project's files every time the list opens; it reuses the list and checks for new files in the background.

### Fixed

- Escape closes the `/` and `@` lists and they stay closed while you finish the word, so a message ending in something like `/tmp` or `@alice` sends with Enter. The lists no longer reorder under the highlighted row when skills are rechecked, and Enter sends the message when nothing in the `/` list matches.
- Deleting a project works when its terminal panel still holds terminals, including a hidden panel or one from a project you are not in. Aven closes them as part of the delete, and asks first only if one is still running something. Before, it refused with "Close this project's terminal tabs before deleting it".
- Opening the usage panel, the access picker or a workspace menu no longer makes the workspace window flash inactive. These popups take the keyboard without taking over as the app's main window.
- A popup that was hidden and shown again stays above its workspace instead of slipping behind it.

## [0.1.139] - 2026-10-14

### Fixed

- On macOS, other projects in the sidebar list their tasks again. Since 0.1.137 a project you were not in could say "No tasks yet" until you opened it, in both the docked and the floating sidebar.

## [0.1.138] - 2026-10-14

### Fixed

- Agents work again on macOS. In 0.1.137 every message failed with "adapter failed" for every provider, because the floating sidebar's layer stopped Aven from authorizing turns in that window.
- Pressing Back, or another button that closes Settings, in the floating sidebar no longer freezes the sidebar.
- When a provider fails, the chat now shows the actual reason instead of a generic "adapter failed".
- When Claude limits how often usage can be checked, the usage panel keeps showing the last known usage and says when Aven will try again, instead of "Unavailable". All windows share one check, and a restart shows the last usage straight away instead of asking again.

## [0.1.137] - 2026-10-14

### Floating sidebar over browser pages

- On macOS, the hover sidebar now slides in above browser pages as its own native layer. The sidebar, the page's edge and the workspace beneath move as one, so the dark strip beside the sidebar is gone and it closes reliably when you move onto a page.
- The slide runs at your display's full refresh rate, and the sidebar is ready the moment the pointer rests on the window edge.
- Menus, dragging chats onto panes, adding projects, agent runs and the update button all work from the floating sidebar. Pinning it docks the sidebar from where it is on screen.

### macOS release reliability

- Retry the final check of Apple's notarization ticket when Apple's service drops the connection, as stapling already did.

## [0.1.136] - 2026-10-13

### Sidebar and workspace reliability

- Remove the floating sidebar's outer shadow while keeping its familiar motion, glass and pinning behavior.
- Keep pane selections in place when agents open background browser pages, including in detached windows.
- Reuse browser pages reliably when several agent requests arrive together, while preserving explicitly requested copies.
- Share tab and pane handling across windows, with consistent browser presentation, settings definitions and provider information.

### Agent questions and desktop controls

- Answer Codex's background questions while it continues working. Question cards queue, retain replies for retry, and stay visible until the answer is accepted.
- Recheck desktop consent, Pause, Stop and the target window immediately before native input, including actions queued on Aven's own interface.

### macOS release reliability

- Retry temporary Apple notarization ticket delivery failures on the accepted app, while retaining signature, stapling and Gatekeeper checks.

## [0.1.135] - 2026-10-13

### One approval to use your Mac

- An agent asks once per chat. That answer covers every app, your mouse and keyboard, and bringing apps forward until you press Stop. Declining once covers the chat too.
- Agents can open an installed app that isn't running, and bring apps forward even when they have no window open, such as Finder.
- When you ask an agent to open or switch to an app, it brings that app to the front instead of working behind your windows.

### See where the agent is working

- The agent's ring stays on screen while it works instead of fading between steps, glides to each window it reads, and disappears as soon as the reply ends or you press Stop.

### Agents can use Aven itself

- Agents can read and use Aven's own window without crashing it. Requests to Aven's interface now run where it can safely answer them, and the first read waits for the full interface instead of returning only the window frame.
- Scrolling pages that don't expose a scroll area now moves about a screen instead of a few points.

### Sidebar over the browser

- Opening and closing the floating sidebar over a browser page no longer shows a dark strip or a flash: the page edge follows the sidebar the whole way.

## [0.1.134] - 2026-10-12

### Agents work in the background

- Agents can operate Mac apps through Accessibility: they read an app's controls, then press, type, scroll and open menus directly, without moving your pointer or bringing the app to the front. Coordinate input remains as a fallback and never presses a different control than the one named.
- Electron and Chromium apps such as Slack, Notion and VS Code expose their full controls while an allowed agent uses them, and return to normal afterwards.
- Once you allow an agent, it keeps working while you use your Mac, even in the same app. Only Pause or Stop in the status bar, or Escape twice, stops it. Shared-pointer control pauses only after about three seconds of continuous mouse or keyboard use.

### Built-in browser

- Agents' clicks and typing appear as a ring with the agent's name inside the browser pane.
- Filling a field focuses it inside the page and types real text, so pressing Enter afterwards submits forms. Agents never take your caret, including in embedded payment fields.
- Agents can open pages without rearranging your panes.

### Working while your Mac is locked

- Your Mac stays properly locked. Agents keep working in the built-in browser and in code while it is locked, and the Mac stays awake while agents work (lid close and Sleep still sleep it). Turn this off in Settings → Tasks.
- Desktop control of other apps pauses completely while the Mac is locked: no input, prompts or status bar until you unlock.

### Arc-style sidebar

- The floating sidebar slides fully in and out on a spring, including over browser panes, and hands off smoothly when you pin it. Menus keep their blur.

## [0.1.133] - 2026-10-12

### Clearer control of Mac apps

- Desktop control shows which agent and app are acting, with a native status bar and a labelled ring at each action.
- Each chat asks before controlling an app. Pause, resume, or stop from the status bar, or press Escape twice to stop.
- Input targets the selected app window without moving your pointer or changing the foreground app. Apps that need the shared mouse and keyboard require separate approval for each fallback action.
- Your activity takes priority. Desktop control yields when you interact with its target, and interrupted drags release their held button.

## [0.1.132] - 2026-10-12

### Clean tab dragging

- Dragged tabs keep their rounded shape and use the theme's glass without a dark rectangular outline, extra rim, or shadow.
- Glass stays on the visible tab face, preserving the tab's size and position as it moves. Light themes and reduced transparency keep their opaque fallback.

### Sidebar chats and menus

- Rename chats under Sessions or in other projects with right-click or F2. Updated titles appear throughout the sidebar immediately.
- Archiving a standalone chat no longer leaves a blank replacement in Sessions.
- Menu tooltips appear only for truncated labels, preventing redundant labels from lingering after a menu closes.

## [0.1.131] - 2026-10-10

### Menus open without flashing

- Menus over the built-in browser no longer swap the page for a screenshot. The page stays live and sharp around the Recent, tab and browser "…" menus, which now appear straight away.
- Frosted glass appears with a menu instead of popping in after it opens, and menus open faster without starting as an empty box.
- Clicking a menu's button again closes it instead of reopening it. The model picker opens already on the current model, and moving between pages of the tab menu no longer restarts it.

### Delete workspaces

- Delete a workspace from the workspace switcher, or right-click any workspace in the sidebar. Its projects and standalone chats move to Personal; files and running agents are kept. Personal can't be deleted, and deleted workspaces stay deleted after restarting.

## [0.1.130] - 2026-10-09

### Consistent sidebar glass

- Popped-out navigation keeps the same native glass and tint as the pinned sidebar, including Settings, with opaque fallbacks for accessibility preferences.
- Covered chat content stays out of the translucent sidebar without changing its width or scroll position. Closing restores the full workspace immediately, including at different interface zoom levels.

### Browser resizing

- When WebKit delays an animation frame, browser layout now uses a 16 ms fallback instead of waiting up to 100 ms. Resize requests remain coalesced and stop when idle.

## [0.1.129] - 2026-10-09

### Direct startup

- Aven opens without the logo and “Opening Aven…” loading screen or its fade delay. Startup recovery still offers Retry if the interface cannot load.

### Menus stay in Aven

- Tab, group and Recent menus open inside the app, anchored to their controls like the provider details menu. They no longer create separate floating popup windows.
- Removed moving tabs or groups to detached windows, including dragging them outside the app. Existing detached workspaces can still return their tabs.
- Menu keyboard focus starts after placement, and delayed focus replies cannot pull the caret back after you move elsewhere.

### Browsers stay organized

- Agent opens reuse the same URL within a project, including across workspace windows and concurrent requests. An explicit new-tab request still opens a separate copy.
- New pages join an existing browser pane. Existing split sizes and minimized panes stay in place; a right-hand split is created only when needed.

### Keep your place while agents work

- Background browser and file opens preserve your selected chat, page and editor caret. Detached agent windows no longer activate themselves for those opens.
- Explicit file paths open without waiting for a repository-wide file scan. Delayed file and history opens yield to newer clicks or typing, and editor line jumps cannot reclaim focus after you leave.

## [0.1.128] - 2026-10-08

### Dependency maintenance

- Updated the HTML sanitizer and development source-map parser with upstream security fixes.

### Safer chat storage upgrade

- Windows can write and flush the pre-upgrade backup correctly, so existing chat history can finish upgrading.
- If the chat database upgrade from 0.1.127 cannot finish, Aven now opens and explains that chat history is unavailable instead of failing to start. It tries again on the next launch and reuses its one backup rather than writing a new copy each time.
- A single damaged chat no longer stops the others from upgrading; it stays readable in its original format.
- Older Aven versions can no longer erase an upgraded chat by saving to it; the save is refused instead. Do not reinstall 0.1.127 after this version. Returning to 0.1.126 or earlier still requires the pre-upgrade backup.
- The backup is fully written to disk before the upgrade continues, and is only reused while it still matches your chats.

### Git

- Undoing an agent's change affects only the files it named, even when names contain brackets or wildcards such as Next.js `[slug]` folders.
- Renamed files show as one removed and one added file with correct counts, and files with accented names can be opened, staged and discarded.
- Settings → Skills stays responsive with thousands of skills, showing 200 at a time.

### Providers and terminals

- Codex chats no longer fail with “model is not supported when using Codex with a ChatGPT account”. Before Codex's model list loaded, Aven could save Claude's default model on a Codex chat; affected chats now use your Codex default.
- Codex in Aven no longer stops working when Aven and the standalone Codex app each create the same setup folder. A conflicting local copy is kept aside instead.
- On Windows, settings Codex saves while running in Aven are no longer discarded.
- A line of garbled output from an agent no longer ends its turn.
- Plan and default modes apply to Codex turns even before a model is chosen.
- Detaching a window while a new terminal is still starting no longer drops a queued Run command, and the terminal panel's + button opens in the chat's worktree.

### Chat and interface

- Chats keep following new replies after work folds away, and a flick upward in a short chat no longer stops following.
- Confirming Japanese, Chinese or Korean input with Enter no longer runs a command in the command palette, model picker or find bar.
- “Thinking…” keeps moving while Aven is visible but not focused, and the run clock pauses while Aven is hidden.
- A view that fails to load shows a Retry button instead of blanking the window.
- Colour picker drags no longer snap back, and browser pages recover after a failed startup handshake.

## [0.1.127] - 2026-10-08

### Cleaner Codex history

- Aven keeps its Codex conversations in separate history, so new Aven chats no longer fill Codex's Recents. Background requests for chat titles and Git text stay unsaved. Existing Aven chats can resume with their provider context, and existing Codex entries are left in place.
- Your file-based Codex login, settings, skills and plugins remain shared. Keyring and automatic credential-store modes are not supported by the separate history yet; Aven reports that before starting a chat.
- Windows remote MCP servers require the file credential store with Codex's default encrypted storage backend. Standard macOS MCP keyring logins remain shared; enterprise MCP keyring logins remain specific to each app's history location.

### Every generated image stays visible

- Replies with several generated images show every image, in order, even when **Show the work** is collapsed. Captions stay with their images.

### Smoother workspaces

- Load heavier editor, terminal and diff features when needed, reduce repeated work while agents stream, and pause more background polling in inactive workspaces.
- Preserve deliberate chat scroll position during resizing, keep IME composition intact, and preserve terminal input order.
- Refine Race and sidebar actions, browser controls, Git history, Settings and staged updates while preserving Aven's existing layout and glass appearance.
- Close native browser pages left behind by a full workspace reload so they cannot cover Settings or another tab. Floating and detached pages stay open.

### Chat storage and provider reliability

- Store transcript blocks separately and send revision-checked changes between windows. Migration creates a consistent backup before upgrading the chat database. Returning to an older Aven version requires that backup and loses changes made after migration.
- Improve provider cleanup, protocol handling and model fallbacks, and keep Git path selection literal.

## [0.1.126] - 2026-10-08

### The Aven bubble is gone for now

- The bubble that floated over web pages in 0.1.125 has been removed, along with its section in **Settings → Browser**. Sidebar colour stays.

### Fable usage

- The usage panel now shows Claude's separate weekly Fable allowance under Claude Code, with its own remaining percentage and reset time.

## [0.1.125] - 2026-10-08

### Ask about the page you're on

- A small see-through Aven bubble now floats at the bottom of web pages in the built-in browser. Click it to ask the chat in your workspace. A ring turns while the agent works, and the answer appears in a card above the bubble with **Reply** and **Open chat**.
- The page stays fully usable around the bubble. It moves with the page and steps aside when a menu or dialog opens over it. Close it with ✕ or Esc, or by clicking back on the page.
- Turn it off or change its colour in **Settings → Browser → Aven bubble**.

### Colour your sidebar

- **Settings → Appearance → Window & sidebars → Sidebar colour** adds a wash of colour to the sidebar: Graphite, five presets, your workspace colour or any colour, with a strength slider. Each workspace keeps its own.

## [0.1.124] - 2026-10-08

### More room for either pane

- Hide a workspace pane with the small chevron on either side of a divider, or drag the divider to the outer edge and release. The remaining pane fills the workspace. This works for left/right and upper/lower splits, including detached windows.
- Hidden panes keep their own tabs instead of combining them with the visible tabs. Restore the original split, sizes and tab groups with one click; drafts stay intact and background agents keep running.
- Normal resizing and double-click balancing still work. Cancelling a drag leaves the panes open.

## [0.1.123] - 2026-10-06

### Automations get their own place

- **Automations** now sit beside **Inbox** at the top of the sidebar, with three tabs. Inbox keeps GitHub and Linear.
- New automations can start from six examples: a morning briefing, a nightly test run, a dependency check, issue triage, a weekly changelog and a sweep for stale TODOs.
- The page now says plainly when automations run: while your computer is awake and Aven is open. A missed run happens once when you're back.
- A new **Keep this Mac awake for automations** switch stops the computer going to sleep on its own while an automation is waiting, so overnight runs still happen. The screen can still turn off, and closing a Mac's lid still puts it to sleep.

### Smoother new browser tabs

- Opening a new or sleeping browser tab no longer stutters or briefly shows the previous page through it.

## [0.1.122] - 2026-10-05

### Steadier Settings on Mac

- Settings pages such as **Providers & models** no longer flicker on macOS. Cards in the page keep their frosted tint without a second blur, as the message box, footer and floating sidebars already do. Home and chat tool cards get the same fix.
- The built-in browser's toolbar and tab, and other bars such as the Settings toolbar and the file sidebar header, no longer flicker on macOS.

### Queued messages keep their attachments in view

- Queued messages now show their attachments: picture thumbnails and file names. While you edit a queued message they stay visible, and you can remove any before saving.

### Crash details

- If Aven ever quits unexpectedly, the error and where it happened are now saved to `Library/Logs/Aven/panics.log` (on Windows, `%LOCALAPPDATA%\Aven\logs`), so the cause can be found and fixed.

## [0.1.121] - 2026-10-04

### Opens normally on Mac

- The Mac app is now notarized by Apple as well as Developer ID signed, so it opens after download without a warning or a trip to **Privacy & Security**.

### Automatic updates on Windows

- Aven for Windows now downloads signed updates in the background, like the Mac app, and installs them when you choose **Restart to update**. It never interrupts running agents. This version must be installed manually once; later versions update themselves. The installer is still not Authenticode-signed, so Windows may warn on that first install.
- New stable download links always point at the latest build: `releases/latest/download/Aven-macos-arm64.zip` and `releases/latest/download/Aven-windows-x64-setup.exe`.

## [0.1.120] - 2026-10-04

### Steadier floating sidebars

- Hovering the unpinned sidebar or file sidebar on macOS no longer makes the conversation behind flash through. The floating panels use a near-opaque tint there instead of a second blur, as the message box and footer already do.

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
