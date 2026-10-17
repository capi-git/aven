# Race

A race gives one prompt to two to four agents at once, each in its own copy of the project, then lets you compare their changes and keep one result or a per-file mix.

## Starting

In a chat's message box, click the agent pill (the provider mark and model name). Its panel lists the models and their settings, with a **Race** section at the bottom: turn on **Race this message** and choose the other agents. The chat's own agent is always included, with at least two and at most four in total, one per provider. Each agent has a model menu beside its name, listing that provider's models. For other agents, picking a model also adds that agent if there's room, and the choice is remembered along with which agents to race. The chat's own agent starts on the chat's model; a model picked for it applies to the race only, and the chat keeps its model. While Race is on, the message box shows a **Race · N** chip (click it to turn Race off) and the send button reads **Race N agents**. Race is one-shot: the following message sends normally. Attachments go to every agent, and every lane gets the chat's access setting; the first lane also keeps the chat's model settings. With only one provider installed, the section says "Install or enable a second agent to race".

Race doesn't combine with Plan mode or Orchestrator: turning one on turns the others off, and a message starting with `/plan` is sent as a normal plan. Race is unavailable while a card (inbox task, note or handoff) is attached. If a race can't start, for example because the project isn't a git repository, an error explains why and the message is put back in the box.

From the command palette (⌘K), type a task: below **Start a chat** is **Race it**, which uses the chosen agent plus the agents and models saved in the Race menu; ⌥↵ starts it directly. The project must be a git repository with at least one commit.

The race starts from what you see: uncommitted changes to tracked files are recorded with `git stash create`, without touching your working tree, and every copy starts from that snapshot. New untracked files are not copied; the race view says so. A new tab opens with the lane chats side by side, and each lane gets the prompt with a note that it is one of several agents, each working in its own copy.

## Where the copies live

Each agent works in a git worktree under the app data directory's `races/<race id>/<slot>` folder, on an `aven/race/*` branch. Nothing is written inside the project until you keep a result. Each lane is an ordinary chat whose working directory is its copy, so its own Git panel and approvals work as usual. A running race's chats keep their copies across restarts; once the race is kept or discarded, reopening a lane chat points it back at the project.

Reading a lane's changes never stages anything in it. Aven diffs against a scratch copy of the lane's index (`GIT_INDEX_FILE`), so the agent's own `git diff` and `git add` behave as they would without Aven.

In the Changes panel, **Parallel work** shows a running race as one row, "Race · <prompt>" with "3 agents · 2 done". Opening it lists each lane with its state and changed files, with **Compare** and **Discard race**. Lanes are measured against the commit their race started from, so a fresh lane started from uncommitted work does not show commits "to merge".

## Comparing and keeping

The overview shows each lane's state, time and changes, a list of changed files with the agents that touched each one, and the selected file's diff for any agent. Open it with **Compare** on the slim "Racing · 2 of 3 done" bar above any lane chat's message box, with **Compare** on the race's row in Parallel work, or from the race tab's right-click menu (**Open race overview**). Closing the lane tab does not lose it.

A lane's state comes from its chat's own last outcome: **Working**, **Needs you** (an approval or question), **Done**, **Failed**, **Stopped**, **Interrupted** (Aven quit mid-turn), **Not started**, or **Closed** when the chat isn't open and nothing was recorded. Its clock stops when its turn ended. Failed and Interrupted lanes offer **Retry**, which sends the race's task to that lane's chat again, in its copy. **Open chat** brings a lane's chat back into a tab when none holds it.

**Keep this** applies one agent's changes; choosing per file and **Keep N selected files** combines agents. Keeping a whole lane reads its changes again after its agent stops, so files written since the overview last refreshed are kept too. While any agent is still working, both ask first ("Keep Claude Code's version? This stops 2 agents still working and deletes their copies."). **Discard race** always asks, and names the copies and changes it deletes. Every patch is checked before any is applied, so a conflict with edits you made in the meantime changes nothing and is reported instead. Keeping or discarding stops the lanes and removes the copies and branches.

Per-file picks are saved with the race, so reopening the overview keeps them, and a kept race records what it kept ("Kept Claude Code's version · 4 files"). Aven remembers every running race and the 20 most recently finished ones.

The host commands (`src-tauri/src/race.rs`) accept only paths inside the races directory and branches under `aven/race/`.
