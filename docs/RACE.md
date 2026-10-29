# Race

A race gives one message to two to four agents at once. Each agent works separately, in its own folder outside your project, so your project doesn't change until you keep one. You then compare their changes and keep one agent's version or a per-file mix. An agent is an app and a model, so a race can put two models of one app side by side, such as Claude Opus against Claude Sonnet.

## Starting

Choose **Race** in the critter’s **Modes** (point at the critter on the message box, or press Cmd+.), beside Plan mode, Orchestrator and Discuss. A chip such as **Race · Claude · Codex** names the agents, and the paper plane that sends reads **Race 2 agents**. The chip's dropdown chooses two to four agents. This chat's agent always races, on the chat's model; its model menu picks another for this race only. Every other agent has a model menu and ×, which leaves it out (never below two). **Add** lists your installed apps: pressing one adds it on its usual model or, if it is racing already, on a model no agent races yet, so a second Claude or Codex model takes one press. No two agents race the same app and model. Your choice is remembered for the next race. With only one app installed, race two of its models.

If sending wouldn't start a race, the dropdown opens and says why instead: "Add another agent or model above to race.", "Install or enable another agent to race.", "Send or remove the attached card before racing." or "Type the task in the message box, then send." Race is one-shot: the next message sends normally. Attachments go to every agent, and every agent gets the chat's access setting. Agents in a race never take a role (see [Roles](ORCHESTRATION.md#roles)), so the comparison stays fair.

Race doesn't combine with Plan mode, Orchestrator or Discuss: turning one on turns the others off, and a message starting with `/plan` or `/orchestrator` is sent as that instead. If a race can't start, for example because the project isn't a Git repository, an error explains why and your message goes back in the box with Race still on.

From the command palette (⌘K), type a task and choose **Race it**, such as "Race it: Claude vs Codex", which uses the agents saved in the Race chip; ⌥↵ starts it directly. The project must be a Git repository with at least one commit.

A race starts from your files as they are now, including changes you haven't committed, without touching them. New files not yet added to Git aren't included, and Compare says so. The agents' chats open side by side in a new tab, and each agent is told that several agents have the same task and you will keep one. Your message stays in the chat you raced from, shown only: that chat's own agent never receives it. You stay there while the agents work. A race from the command palette opens its tab in front.

## While it runs

After your message, the race's card follows it: the agents' mascots, "Claude and Codex are racing" with "1 of 2 done", the line "Each agent works separately. Your project doesn't change until you keep one." and a row per agent with its state, its clock and the lines and files it changed, with **Compare** and **Watch**. Pressing a row opens that agent's chat. An agent waiting on an approval or question turns the card amber with "Needs you", what it needs and **Go to Claude**.

Once no agent is working, the race is ready to compare, which is calm, not amber. The card reads "Ready to compare" with "3 of 3 done" and offers **Compare**, **Suggest a winner** and **Ask a reviewer**; its line says whether every agent is done, only some are or every agent was stopped. If an agent failed and none finished, the race needs you instead: "No agent finished. Open Compare to retry one or discard the race."

The chat you raced from and each agent's chat have a bar in the message box, "Racing · 1 of 2 done" or "Racing · Ready to compare · 2 of 2 done", with **Watch** and **Compare**. In the chat you raced from it also has **Stop race** while an agent works. An agent's own chat keeps its message box's Stop, which stops that agent alone.

**Watch** opens the race in the [floating panel](ORCHESTRATION.md#the-floating-panel): a column per agent, side by side when the panel is wide, with its state and clock, what it is doing, its changes, the first lines of its last reply once it stopped and **Go to chat** when it needs you, with **Compare**, **Stop race**, **Suggest a winner** and **Ask a reviewer**.

Once no agent is working and at least one finished, the race posts "Race ready to compare · 3 of 3 done" (or "1 of 3 done · 2 failed") to Activity on the chat you raced from, and posts it again after a Retry. When an agent failed and none finished, it posts "Race needs you" instead. Either comes with a banner when you are elsewhere. Its agents' own turns post nothing, and neither does keeping or discarding. While the chat you raced from or Compare is on screen, the agents' replies count as seen. In the sidebar, a running race is one row: the chat you raced from shows the agents' mascots and "1 of 2 done", and the agents' chats fold into it until you keep or discard the race.

## Comparing and keeping

Open Compare with **Compare** on the race's card, bar or floating panel, on its row in Parallel work or by right-clicking the race's tab. It shows each agent's state, time and changes, the first lines of its last reply once it stopped, a list of changed files with the agents that touched each one and the selected file's changes for any agent. Closing the agents' tab doesn't lose the race.

Each agent's state comes from its chat: **Working**, **Needs you** (an approval or question), **Done**, **Failed**, **Stopped**, **Interrupted** (Aven quit mid-turn), **Not started** or **Closed** when its chat isn't open and nothing was recorded. Its clock stops when its turn ended. **Open chat** on an agent's row brings its chat back into a tab. An agent that failed, was interrupted, was stopped or whose chat closed with no outcome known has **Retry** on its row, which sends it the race's task again or says why it can't, for example while its chat is busy. The race's card has no Retry; it points you to Compare.

**Suggest a winner**, on the card, in the floating panel or in Compare once no agent is working, asks your cheapest model (the one the memory keeper uses: Claude Haiku, else a small Codex model), with no tools, which agent's result to keep and why, from each agent's last reply and its change numbers. The replies are treated as data, not instructions. The suggestion reads "Aven suggests Codex: <why>", and Compare marks that agent. Without a model, or if the call fails, it says "Couldn't suggest a winner. Compare the agents' changes to choose."

**Ask a reviewer**, on the card and in the floating panel, lets a chat of your choice judge instead. It lists the chats in the race's project, "The chat you raced from" first, never one of a race's agents or a run's agent; a chat that is working or waiting for you can't be picked. The chat you pick is sent, as your own message, "Your role for this race: Reviewer." with the Reviewer's instruction, each agent's state, change numbers, folder and last reply (marked as results to judge rather than instructions) and a request to end with "Winner:" and "Why:" lines. It can read the agents' folders to check their changes. While it works, the card shows it as a row of its own badged **Reviewer**, with "Claude is comparing the agents' work…". Its pick becomes the race's suggestion: "Claude (Reviewer) suggests Codex: <why>". A reply without the two lines, or a turn that fails or is stopped, leaves no suggestion ("The reviewer didn't pick one. Read its reply in its chat, or compare the agents' changes."), and you can ask again.

**Keep this** applies one agent's changes to your project; picking an agent per file and **Keep N selected files** combines agents. Keeping one agent reads its changes again after stopping it, so files it wrote at the last moment are kept too. Every change is checked before any is applied, so a conflict with edits you made in the meantime changes nothing and is reported instead.

Race asks before anything that can't be undone:

- **Keep this** asks while any agent is still working or when another agent's work would be deleted: "Keep Claude's version?" with "This stops 1 agent still working and deletes Codex's work (3 files)."
- **Keep N selected files** asks while any agent is still working: "This stops 1 agent still working and deletes any changes you didn't pick."
- **Discard race** always asks: "Discard this race?" with, for example, "This deletes Claude's work (2 files) and Codex's (1 file). Your project doesn't change."

Keeping or discarding stops the agents and deletes their folders.

After you keep one, the card becomes its result: "Kept Codex's version · 7 files" (or "Kept 3 files from 2 agents"), with why when you kept the suggested agent, the agents' final states, **Review changes** (the Changes panel) and **Continue with Codex**. Its earlier conversation can't follow it into your project, so keeping leaves that agent a short recap of its task, what was kept and its last reply, which goes with your next message to its chat however you open it; the chat you raced from is told, the same way, whose version is now in the project. Continuing opens that agent's chat. For a per-file mix it continues with the agent most files came from. Per-file picks are saved with the race, so reopening Compare keeps them. Aven keeps every running race and the 20 most recent finished ones.

## Parallel work

In the Changes panel, **Parallel work** shows a running race as one row, "Race · <your prompt>" with "2 of 3 done". Opening it lists each agent with its state and changed files, with **Compare** and **Discard race**. Each agent's chat is an ordinary chat working in the agent's folder, so its own Changes panel and approvals work as usual. A running race's chats keep their folders across restarts; once the race is kept or discarded, reopening an agent's chat points it back at your project.

## For developers

- Each agent works in a Git worktree under the app data folder's `races/<race id>/<slot>`, on an `aven/race/<race>-<slot>` branch. The slot is the agent's place in the race, so two models of one app each get their own. Changes to tracked files are recorded for the starting point with `git stash create`.
- Reading an agent's changes never stages anything in its worktree: Aven diffs against a scratch copy of its index (`GIT_INDEX_FILE`), so the agent's own `git diff` and `git add` behave as usual.
- The host commands in `src-tauri/src/race.rs` change and remove worktrees only inside the races folder, and create or delete only branches under `aven/race/`. The chosen agents are saved as `aven.raceLanes.v2`.
