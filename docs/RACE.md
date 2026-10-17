# Race

A race gives one prompt to two to four agents at once, each in its own copy of the project, then lets you compare their changes and keep one result or a per-file mix.

## Starting

In a chat's message box, click the agent pill (the provider mark and model name). Its panel lists the models and their settings, with a **Race** section at the bottom: turn on **Race this message** and choose the other agents. The chat's own agent is always included, with at least two and at most four in total, one per provider. Each agent has a model menu beside its name, listing that provider's models. For other agents, picking a model also adds that agent if there's room, and the choice is remembered along with which agents to race. The chat's own agent starts on the chat's model; a model picked for it applies to the race only, and the chat keeps its model. While Race is on, the message box shows a **Race · N** chip (click it to turn Race off) and the send button reads **Race N agents**. Race is one-shot: the following message sends normally. Attachments go to every agent, and every lane gets the chat's access setting; the first lane also keeps the chat's model settings. With only one provider installed, the section says "Install or enable a second agent to race".

Race doesn't combine with Plan mode or Orchestrator: turning one on turns the others off, and a message starting with `/plan` is sent as a normal plan. Race is unavailable while a card (inbox task, note or handoff) is attached. If a race can't start, for example because the project isn't a git repository, an error explains why and the message is put back in the box.

From the command palette (⌘K), type a task: below **Start a chat** is **Race it**, which uses the chosen agent plus the agents and models saved in the Race menu; ⌥↵ starts it directly. The project must be a git repository with at least one commit.

The race starts from what you see: uncommitted changes to tracked files are recorded with `git stash create`, without touching your working tree, and every copy starts from that snapshot. New untracked files are not copied; the race view says so. The lane chats open side by side in a new tab, and each lane gets the prompt with a note that it is one of several agents, each working in its own copy.

Raced from a chat, your message stays in that chat as you wrote it (shown only: that chat's own agent never receives it), and you stay there while the agents work in their tab. A race from the command palette has no such chat and opens its tab in front.

## The race's card and bar

After your message, the race's card follows it, in the same family as a discussion's and an orchestration's (see "Discussions, races and runs together" in [ORCHESTRATION.md](ORCHESTRATION.md)): the agents' mascots, "Claude and Codex are racing" with "1 of 2 done", a status line, and a row per agent with its model, its state, its clock and the lines and files it changed, with **Compare**. Pressing a row opens that agent's chat. The numbers are read again whenever an agent's state moves and kept with the race (the overview refreshes them while it is open), so the card needs no timer. When every agent is done the card is calm, not amber: it reads "Ready to compare" with **Compare** and **Suggest a winner**. An agent waiting on an approval or question turns it amber with **Go to <agent>**, and a race where no agent finished asks you to retry one or discard it.

The chat you raced from and each lane's chat have the bar in their message box, "Racing · 1 of 2 done" or "Racing · Ready to compare · 2 of 2 done", with **Compare**. In the chat you raced from it also has **Stop all** while an agent works; a lane's chat keeps its own Stop, which stops that agent alone.

**Watch** on the card or in the bar opens the race in the floating team panel: one column per agent, side by side when the panel is wide, each with its state and clock, what it is doing, its changes, the first lines of its last reply once it stopped and a way to its chat when it needs you, with **Compare**, **Stop all** and **Suggest a winner**. A running race also gets a pill of its own there. On a Mac the panel can be popped out into a window of its own, for another screen. See "The team panel" in [ORCHESTRATION.md](ORCHESTRATION.md).

Each lane's turns are recorded quietly, so its chat's state still reads right, and post nothing of their own to Activity; the race posts one entry, "Race ready to compare · 3 agents", on the chat you raced from when every agent is done (again after a Retry), with a banner when you are elsewhere, and "Race needs you" when none finished. Keeping or discarding is your own action and posts nothing. While the chat you raced from or the overview is on screen, the lanes' replies count as seen. In the sidebar, a running race is one row: the chat you raced from shows the agents' mascots and "1 of 2 done", and the lane chats fold into it until the race is kept or discarded.

## Where the copies live

Each agent works in a git worktree under the app data directory's `races/<race id>/<slot>` folder, on an `aven/race/*` branch. Nothing is written inside the project until you keep a result. Each lane is an ordinary chat whose working directory is its copy, so its own Git panel and approvals work as usual. A running race's chats keep their copies across restarts; once the race is kept or discarded, reopening a lane chat points it back at the project.

Reading a lane's changes never stages anything in it. Aven diffs against a scratch copy of the lane's index (`GIT_INDEX_FILE`), so the agent's own `git diff` and `git add` behave as they would without Aven.

In the Changes panel, **Parallel work** shows a running race as one row, "Race · <prompt>" with "3 agents · 2 done". Opening it lists each lane with its state and changed files, with **Compare** and **Discard race**. Lanes are measured against the commit their race started from, so a fresh lane started from uncommitted work does not show commits "to merge".

## Comparing and keeping

The overview shows each lane's state, time and changes, the first lines of its last reply once it stopped working, a list of changed files with the agents that touched each one, and the selected file's diff for any agent. Open it with **Compare** on the race's card or bar, with **Compare** on the race's row in Parallel work, or from the race tab's right-click menu (**Open race overview**). Closing the lane tab does not lose it.

Once no agent is working, **Suggest a winner** (on the card or in the overview) asks the same cheapest model the memory keeper uses (Claude Haiku, else a small Codex model), with no tools, which agent's result to keep and why, from each agent's last reply and its change numbers. The replies are treated as data, not instructions, as a discussion's wrap-up does, and only the pick and a one-line reason are read back. The overview marks the suggested agent and both show "Suggested: Codex · GPT-5 — <why>"; without a model, or if the call fails, they say so and you compare as usual. The suggestion is kept with the race.

A lane's state comes from its chat's own last outcome: **Working**, **Needs you** (an approval or question), **Done**, **Failed**, **Stopped**, **Interrupted** (Aven quit mid-turn), **Not started**, or **Closed** when the chat isn't open and nothing was recorded. Its clock stops when its turn ended. Failed and Interrupted lanes offer **Retry**, which sends the race's task to that lane's chat again, in its copy. **Open chat** brings a lane's chat back into a tab when none holds it.

**Keep this** applies one agent's changes; choosing per file and **Keep N selected files** combines agents. Keeping a whole lane reads its changes again after its agent stops, so files written since the overview last refreshed are kept too. While any agent is still working, both ask first ("Keep Claude Code's version? This stops 2 agents still working and deletes their copies."). **Discard race** always asks, and names the copies and changes it deletes. Every patch is checked before any is applied, so a conflict with edits you made in the meantime changes nothing and is reported instead. Keeping or discarding stops the lanes and removes the copies and branches.

Per-file picks are saved with the race, so reopening the overview keeps them, and a kept race records what it kept ("Kept Claude Code's version · 4 files"). The race's card becomes its result: "Kept Codex · GPT-5 (7 files)", with why when you kept the suggested agent, the agents' final states, **Review changes** (the Changes panel) and **Continue with Codex · GPT-5**. Continuing opens that agent's chat and sends it a short recap of its task, what was kept and its last reply, because its provider session was reset when its copy went away; the chat shows "Carry on from the race: your version was kept." in its place. For a per-file mix it continues with the agent most files came from. Aven remembers every running race and the 20 most recently finished ones.

The host commands (`src-tauri/src/race.rs`) accept only paths inside the races directory and branches under `aven/race/`.
