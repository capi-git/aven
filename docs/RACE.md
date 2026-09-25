# Race

A race gives one prompt to two agents at once, each in its own copy of the project, then lets you compare their changes and keep one result or a per-file mix.

## Starting

Type a task in the command palette (⌘K). Below **Start a chat** is **Race it: A vs B**, which races the chosen agent against the next installed one; ⌥↵ starts it directly. The project must be a git repository with at least one commit.

The race starts from what you see: uncommitted changes to tracked files are recorded with `git stash create`, without touching your working tree, and every copy starts from that snapshot. New untracked files are not copied; the race view says so.

## Where the copies live

Each agent works in a git worktree under the app data directory's `races/<race id>/<slot>` folder, on an `aven/race/*` branch. Nothing is written inside the project until you keep a result. Each lane is an ordinary chat whose working directory is its copy, so its own Git panel and approvals work as usual. A running race's chats keep their copies across restarts; once the race is kept or discarded, reopening a lane chat points it back at the project.

## Comparing and keeping

The race tab shows each lane's status, time and changes, a list of changed files with the agents that touched each one, and the selected file's diff for any agent. **Keep this** applies one agent's changes; choosing per file combines agents. Every patch is checked before any is applied, so a conflict with edits you made in the meantime changes nothing and is reported instead. Keeping or discarding stops the lanes and removes the copies and branches.

The host commands (`src-tauri/src/race.rs`) accept only paths inside the races directory and branches under `aven/race/`.
