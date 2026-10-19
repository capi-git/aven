# Orchestrator and discussions

Aven has three ways to have agents work together, each started from the **+** menu in the message box: **Orchestrator**, where a lead agent shares out the work to other agents; **Discuss**, where two chats talk a question through; and **Race**, where several agents try the same task and you keep the best result (see [RACE.md](RACE.md)). This page covers the first two, then what all three share.

## Orchestrator

Choose **Orchestrator** in the **+** menu in the message box and describe the work. The lead proposes a plan before any agent starts. The plan card shows each task's instructions, its files as small chips ("Whole project" for the whole folder), what it waits for and its agent's model, and **Agents at once** sets how many work at the same time (two by default, up to four). Change a task's model, title or instructions, give its agent a **Role** (see [Roles](#roles); the lead never sets one), **Remove task** (tasks that waited for it no longer do; a plan keeps at least one task) or **Discard plan**, then **Confirm and start**. The apps and models you can pick depend on what is installed and enabled in Aven. Only the newest plan in a chat can start: an older card reads "Replaced by a newer plan".

Once you confirm, the plan card becomes the run's card: the lead's and each agent's mascot, the plan's title with Running, Paused, Finished or Stopped, a status line and a row per agent with its model, its state ("Working", "Lead deciding", "Accepted") and what it is doing. Pressing a row opens that agent's chat. Until the lead hands out tasks, the card says "The lead hasn't handed out any tasks yet." **Show plan** unfolds the plan, read-only. When the run ends, the card becomes its result: "Run finished · 4 agents", the lead's one-line verdict and a row per agent with its title, model, outcome (Accepted, Cancelled or Failed) and the files it touched, with **Review changes** (the Changes panel) and **Open agents**. A finished run also gets a line per agent on what it did, written once by your cheapest model (the one the memory keeper uses) from the end of each agent's result, treated as data, not instructions. The card says "Writing a line on what each agent did…" meanwhile, or "Couldn't write the summaries. Open agents to read their replies." if that fails.

Agents appear under their lead in the sidebar. **Open agents** opens their chats beside the lead, and **Watch** opens the run in the [floating panel](#the-floating-panel). The lead can inspect results, ask for corrections, answer its agents' questions and approvals and redirect agents that support it while they run. Tasks whose files overlap wait their turn.

While a run is open, the lead's message box has a bar: "Orchestrating · 2 working · 1 queued" ("Lead reviewing" or "Waiting on the lead" when no agent is busy), or "Orchestrating · Paused" with the reason, with **Watch**, **Resume** while paused, **Open agents** and **Stop run**. A run ends only when the lead finishes it. If the lead goes idle while no agent is working and nothing is left to start, the run needs you: the bar says "The lead stopped without finishing." and offers **Finish run**, which ends the run as it is and cancels tasks that never started, and **Ask the lead to wrap up**, which asks the lead, as your own message, to review what's done and finish. The run posts one Activity entry ("Run needs you · The lead stopped without finishing."), marks the lead's chat in the sidebar and on Home and counts toward the Dock badge until the lead works again or the run ends.

**Stop run** is in the bar, in the floating panel and on the sidebar card whenever the run is running or paused; it stops the lead and every agent. While a run is running, or paused with an agent still working, other chats in the project are refused with "<project> is busy with a run in “<lead>”. Finish or stop it there." and their bar has **Go to lead**. A paused run whose agents have all stopped doesn't hold the project.

While its run is open, an agent's approval or question is its lead's to decide: the agent shows "Lead deciding" in a neutral colour, and there is no banner, Activity entry or Home row for you. The lead asks you in its own chat when the call is yours. If the lead was told about the request and then sits idle for 15 seconds without answering it, the request comes to you: the agent's chat asks you as any chat does, and the lead's bar offers a **Go to** button for that agent's chat. Once a run finishes or stops, its agents are ordinary chats again, and anything they ask is yours.

Agents' turns and the lead's behind-the-scenes turns post nothing to Activity. The run posts one entry, "Run finished · 4 agents" or "Run paused" with its reason, with a banner when you are elsewhere. A paused run says what happened and what to do next, such as "The lead checked in 20 times without finishing. Its agents were stopped. Check the files, then resume or stop the run."

The lead's chat stays loaded while its run is running or paused, so closing its tab never strands results or stops the run. Runs are saved on your computer. An interrupted run reopens paused for review, and **Resume** anywhere loads the lead's chat first. A run whose lead is archived loads only when that chat is opened. A run paused more than a week ago still shows Paused with Resume on its own card and bar, but no longer counts as needing you anywhere else. A finished or stopped run's sidebar card folds to one line, such as "Finished · 4 agents · 2h ago", and opens when you click it; its count leaves cancelled tasks out ("3 done · 1 cancelled"). Stop or finish a run before moving its tabs to another window.

## Message queue

Messages you send while an agent is working default to **Wait their turn**. **Send right away** (or **Send now** on a waiting message) remains available for agents that support it. Waiting messages keep their order, including when a switch to another agent is pending. **Resume** runs the next queued message. A message that can't be sent stays in the box to edit or retry.

## Discussions

Choose **Discuss** in the **+** menu in the message box to have this chat talk your message through with another open chat, or with a new chat on the model you choose. A chip such as **Discuss with Codex · 3 rounds** appears in the message box. Its dropdown picks the other chat (or **New chat with…**), the rounds (one to six) and the other chat's **Role** (see [Roles](#roles)), and says why a chat can't join or why sending wouldn't start yet; with a role the chip reads **Discuss with Codex as Skeptic · 3 rounds**. Each round is one reply from each chat. Send your message to start: it becomes the topic. Typing `/discuss` turns the mode on too. Starting waits until both chats are idle with nothing waiting for you.

### In the chat

Your topic shows as your own message, and everything after it folds into one live card: both agents' mascots, "Claude and Codex are discussing" with a **Round 2 of 4** badge, the latest reply on one line and **Watch**. When the discussion needs you, the card reads "Discussion paused" with the reason and **Go to Codex** (the chat it waits for), **Show approval** (when this chat's own approval is waiting) or **Resume**. Once done it reads "Discussion finished · 4 rounds", followed by **Where they landed**; a stopped one reads "Discussion stopped after 2 of 4 rounds". **Show in chat** unfolds the turns behind the card.

Both chats' message boxes have the bar, "Discussing · Round 2 of 4 · with Codex in “Login fix”", with **Watch**, **Resume** while paused, **Go to Codex** when the other chat is the one waiting and **Stop discussion**. In the other chat, each message passed on from this one starts with a line such as "From Claude in “Auth bug” · Round 2 of 4"; pressing it opens the discussion.

### In the floating panel

**Watch** opens the conversation in the floating panel. It opens by itself the first time a discussion starts; after that, a new discussion opens the way you last left the panel. Its header reads "Discussion · “topic”". Below it the two agents face each other, each with its mascot, name and part ("Opened the topic", "Joined the topic", "Replying…"), with "Round 2 of 4" and a track of the rounds between them. The thread shows each chat's finished replies, the opening chat on the left and the other on the right, with round dividers and the chat answering now typing at the end. A reply that agrees with the one before it gets a small check ("Agrees"), and one that pushes back a small ↔ ("Pushes back"); Aven reads this from the reply's first words, without asking a model, and leaves anything mixed or unclear unmarked. As such a reply lands, its mascot nods or tilts its head. Long replies fold behind **Show more**. In a long discussion, older rounds fold behind "Show rounds 1–3", a rail of round numbers jumps to any round and "3 new since you looked" marks where you left off. Pressing either agent at the top opens its chat. **Stop discussion** is here too. A finished discussion's panel shows "Finished · 4 rounds" and stays until you close it.

### Adding something for both

While the discussion runs or is paused, the starting chat's message box reads "Add something for both of them…" and its send button **Send to both**; the box at the bottom of the panel does the same. What you send shows as your own message in the panel and reaches each chat once, with the next reply it is passed, so neither turn is interrupted. Until then it waits at the end of the panel, marked "Goes with the next reply" (or "Sends when it resumes" while paused). Sending while paused resumes the discussion; during the last reply, or after it has finished, it continues for one more round, starting with your message. Each discussion keeps up to ten such messages.

### Where they landed

When a discussion uses up its rounds, a card after its closing note shows **Where they landed**: up to four things they agreed on and up to four still open. Aven writes it once, with your cheapest model and no tools, treating the agents' words as data, not instructions. It shows "Summing up…" meanwhile, or "Couldn't sum this up." with **Try again** if that fails. **Have Claude build it** and **Have Codex build it** bring that chat forward and send it, as your own message, a request to carry out the plan, quoting what they agreed on; once sent, the button reads "Sent to Claude". The same card, smaller, appears in the starting chat after the discussion's card. The lists are also kept in the closing note, so the chat still shows them later. A stopped discussion isn't summed up: its panel shows only the two buttons.

### How it runs

Aven passes the replies; neither agent can message the other, and an agent can never start a discussion. Each time a chat finishes its turn, Aven sends its final reply to the other chat, shortened past 8,000 characters with a note, with its `/` skills and `@` references left as written. When the rounds are used up, Aven posts a short note in both chats.

A discussion pauses when either chat needs an approval or has a question, when either chat is archived (until it is unarchived), when a chat refuses or can't take the message and when the chat that should answer next is busy with your own turn, has your messages queued or has a card waiting in its message box: your own work comes first. Press **Resume** in the bar, on the card or in the panel to continue, or **Stop discussion** in the bar or the panel to stop it; a reply already being written finishes, but the other chat won't get it. To interrupt an agent at once, use its chat's own Stop in the message box: stopping either chat's turn stops the discussion too. An error pauses it, and Resume sends the same message again.

Discussions are saved on your computer and run from the window that started them. Reloading or closing that window pauses them ("The window it ran in reloaded or closed. Resume to continue."). If a chat moves to another window, its bar there can stop the discussion, or resume it once both chats are open in that window.

A new chat started for a discussion gets no tab: it runs in the background, listed in the sidebar under its project, and is let go like any idle chat once the discussion is finished. While the starting chat or the discussion's panel is on screen, the other chat's replies count as seen. The discussion posts one Activity entry when it finishes, "Discussion finished · 4 rounds", and one, "Discussion paused" with its reason, each time it stops for you, with a banner when you are elsewhere. Finished discussions can be opened again for as long as the chat that started them exists; their replies stay in the two chats. Deleting that chat forgets its discussions, and deleting the other chat stops a running one.

## Discussions, races and runs together

### The bar and the card

One slim bar sits in the message box of the chat each started from and of its agents' chats: "Discussing · Round 2 of 4 · with Codex in “Login fix”", "Racing · 1 of 3 done" or "Orchestrating · 2 working · 1 queued". It has **Watch**, **Compare** for a race, **Open agents** for a run, **Resume** while paused, **Go to** the chat that is waiting on you when it is another one, and one Stop for the whole thing: **Stop discussion** in either discussion chat, **Stop race** in the chat you raced from while an agent works and **Stop run** in the lead's chat. A race agent's chat and a discussion chat keep their message box's own Stop, which stops only that chat's turn.

In the chat it started from, each has a card: the agents' mascots, a title and a badge, a status line, a row per agent and its buttons. An agent brought in with a role has a badge with the role's name. Each card turns into its result when it ends.

### Needs you and Activity

One rule decides what needs you everywhere (notifications, Activity, Home, the sidebar, the bar, the cards, the board and the Dock badge), and it always shows as "Needs you" with a plain line on what is needed, such as "Codex wants to run npm test" or "Claude asked: Which port?". An agent's approval or question is yours, except a run's agent's while its run is open, which its lead decides unless it leaves it unanswered. A paused discussion or run, or a run whose lead stopped without finishing, needs you, with its reason and the chat to open. A race with no agent working is ready to compare, which is calm, not amber, unless an agent failed and none finished; then it needs you.

The agents' own turns post nothing to Activity. Each discussion, race and run posts one entry for each new need and one at its end, "Discussion finished · 4 rounds", "Race ready to compare · 3 of 3 done" or "Run finished · 4 agents", with a banner when you are elsewhere, and its end counts once for mascot cheers, the streak and the memory keeper. What it did (a run's verdict and a line per agent, what a race kept and why, where a discussion landed) shows beneath its entry. If the window that runs a discussion or race closes, the main window takes it over.

### The floating panel

**Watch** on a card, in a bar or on the board opens a discussion, race or run in a floating panel inside the window. Drag it by its header and resize it from any edge. It stays inside the window, above panes and browser pages and below menus and dialogs, and its place and size are remembered for each window. Press – or Escape to shrink it to a pill, or × or ⌘W to close it; neither stops anything. Every discussion, race and run in the window that is still going gets a pill, stacked, amber when it needs you; press one to show its panel. A closed panel's pill stays hidden until you press **Watch** again.

A discussion shows as described above, and a race as a column per agent (see [RACE.md](RACE.md)). A run shows the lead, then a row per agent: its task (with its role's badge), model, state, what it is doing, what it waits for ("Waiting for review: …", "Waiting for files: …") or what its lead is deciding for it ("Lead deciding: …") and the files it touched, with **Open agents** and **Stop run**. A paused run, or one whose lead stopped without finishing, says why first, with **Resume** or **Finish run**.

### Its own window

On a Mac, ↗ in the panel's header opens it in a small window of its own that you can move anywhere, even to another screen. Everything you press there is done in the Aven window it runs in. ↙ puts it back, **Watch** there brings the small window forward and closing the small window (or ⌘W in it) leaves it there as a pill. **Go to chat**, **Compare**, **Open agents** and **Have … build it** bring that Aven window forward. If you close that window while its chats still run (on a Mac it is then only hidden), the small window says "The Aven window this runs in is hidden. It's still running there." with **Show window**; clicking Aven in the Dock brings it back too. If that window goes for good, the small window says "The Aven window this ran in is gone, so it can't be shown here." A small window that can't load says "This panel couldn't load. Close it and press Watch again."; one that never appears hands its discussion, race or run back to the floating panel after a few seconds. Its buttons show a plain message when something can't be done from there. On Windows the panel stays in its window and ↗ isn't offered.

### Home, the sidebar and the board

Home's "Running now" and Activity's "Running" show each discussion, race and run as one row with its agents' mascots and its status, opening the chat it started from. In the sidebar, a running race is one row (its agents fold into the chat you raced from), a discussion's two chats stay as your own rows, marked "Discussing with “<chat>”" and a run's agents fold into the lead's card. On a project's board, a discussion, race or run started from a card's chat is that card's work: the card is in **Building** with the team's mascots and **Watch** while it runs, marked **Needs you** with **Open chat** when it waits on you, and in **Review** with **Compare** when a race is ready to compare. One that no card links to is counted on the board's line for work outside the board, where **Add** gives it a card.

## Roles

An agent brought into a discussion or run can be given one of four fixed roles, each a short instruction in plain words, shown when you hover over it:

- **Reviewer**: "Review the work carefully: check that it does what was asked, look for bugs and risks, and say plainly what should change."
- **Tester**: "Work out how to prove it works: run or write the checks that matter, and report what passed, what failed and what is still untested."
- **Skeptic**: "Push back on weak points and look for what could go wrong; agree only when convinced."
- **Designer**: "Look at it from the user's side: how it looks, reads and feels to use. Suggest concrete changes to layout, wording and flow."

They are offered only where an agent is brought in: the other chat of a discussion (the Discuss chip's dropdown), a run task's agent (its plan card) and a race's reviewer (**Ask a reviewer**, always as Reviewer; see [RACE.md](RACE.md)). A race's own agents never take one, so their comparison stays fair, and the chat that starts a discussion or leads a run has none.

The instruction is added once, to the start of that agent's first message, where its chat shows it: "Your role in this discussion: Skeptic. Push back on weak points…" before the reply passed to it, "Your role for this task: Tester. …" before a task's instructions, "Your role for this race: Reviewer. …" before the comparison. Later messages go as they are. The role is kept with that discussion, run or race and shows as a badge on the agent's mascot and name: on the cards, in the bar, in the floating panel and on the plan card. Nothing remembers it for the next one.

## Access and review

Orchestrator doesn't replace each agent's own permissions or your review of the result. Agents work in the project folder and can make changes within the access you gave them. Review the task scopes and the resulting changes, especially when several agents edit the same project.

The lead's connection to Aven works only on this computer, only from its window and only for its own run. Its credentials go to the lead alone, never into a chat or to its agents.

## Attribution

This implementation began with the MIT-licensed [MonoCode orchestration feature](https://github.com/hardbeat920/monocode/pull/228), commit `ed89e347af207b3639f1ed086f83f14201ed11b3`, with subsequent Aven changes. See the repository [NOTICE](../NOTICE) and [LICENSE](../LICENSE).
