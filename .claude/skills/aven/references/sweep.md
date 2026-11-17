# Sweep

A sweep uses Aven the way its people do, over its whole feature map, with the code as context, and writes what it finds to a local ledger with evidence, grouped into batches that `ship` can take as they are. It observes and records; it fixes nothing in the app. The one thing it may change is the map and the helpers in this skill's folder. No finding is owed: a sweep is judged on whether each finding is real, never on how many it records. "Used the whole map and found nothing to record" is a good result, reported as such.

The ledger stays on this Mac. The Aven repository is public, and the person chose on 2026-11-12 that sweep findings are not filed there. A finding goes to GitHub only when the person asks for that one, after the scan in `references/reporting.md`.

Target: nothing means the whole map; names of areas narrow it. Notes can narrow more (`read only`, `no app` for no Aven Dev window at all, an area to leave alone), or name a time budget.

A sweep never touches the person's installed Aven, their chats, their screen or their provider accounts. Everything it uses is Aven Dev in a throwaway profile, the frontend in the Browser pane, a rendered harness, or the source.

## 1. Before you use the app

Read `references/aven.md`. Make the run's folder, `~/Developer/.worktrees/Aven/scratch/aven-skill/<date>-sweep/`; everything below that says "this run's folder" goes there, and the ledger is `ledger.md` in it. Work in a work tree at `origin/main` (the session's own, or a detached one under `~/Developer/.worktrees/Aven/`), with `npm ci` run.

Read the map: `references/features/README.md` and each feature file. Fix the index on the spot (missing, extra, dead entries), nothing more. Compare it with `scripts/checks steps` and with `git log` since the map last changed: a surface a person can reach that the map lacks is named with its source path, and gets a row or a feature file by the end of the run.

Read the earlier ledgers in `~/Developer/.worktrees/Aven/scratch/aven-skill/` and the open issues and pull requests of capi-git/aven (`scripts/release-check` lists the pull requests; `ghp issue list --repo capi-git/aven --state open`), so that nothing is recorded twice. An earlier finding that the run proves fixed is marked so in its old ledger, with the date.

## 2. Know the app before you use it

One read-only reader per area of the map, launched together as subagents (a cheaper model is enough: they read and explain). Each explains how its area works from the source, says where the map disagrees with the source, and lists the faults it suspects, each with the line that triggers it and how to see it in the app, plus what a real person would do there that the checks do not cover: empty and full states, long names, a narrow pane, a split, a second window, two workspaces, 80% and 120% zoom, the light and the dark theme, an agent that streams while the person types, a restart to update in the middle. Each writes its whole report to this run's folder and returns its leads in 300 words or fewer with the report's path. Readers never start Aven Dev, never start a provider tool (and never one with a throwaway home), and never edit a file. Give each reader the titles of the earlier findings of its area.

## 3. Use it like a person

First the doctor, behind the window gate: `scripts/window-gate`, then `scripts/checks app` (the real-app check, which builds Aven Dev in this work tree). It tells you that this build is worth using. A step that fails is read in its own words and against its times; a check that fails on both tries in a way that the window gate or the runner explains is not a finding. When the gate is busy, start `scripts/window-gate --wait` and go on with what needs no window.

Then each area of the map once, in flows and not in screens: make a thing, find it again, change it, undo it, remove it. Use the strongest tool that reaches the area:

- What a person sees and presses, when it needs no native side: the frontend in the Browser pane (Vite on a port of its own, `references/aven.md`, Rendered checks), or a rendered harness; read element boxes and computed styles, at the zooms, sizes and themes the map names.
- What needs the app itself (sending, agents, the browser, teams, Git): the real-app check's steps, and the stand-in agents with their markers; a sweep may run a scratch copy of the stand-in that answers a new marker, kept in this run's folder, never committed.
- Motion and speed: the speed test (`npm run perf:app -- --perf-only <names>`, behind the window gate), with its saved run compared back to back.
- A rule that is pure (parsing, ordering, a stored format, a provider's protocol): a short test that asserts what the code does today, written in this run's folder and run with `npx vitest run <file>` or a Rust test appended by a script and taken out again in the same command. A pass is the proof of the fault. Never commit such a test.

An area that cannot be reached is `unreachable` only with the thing it needs (a real provider, a second Mac, a Windows machine, a real schedule, macOS permissions) and the route tried.

A finding is something that stops, misleads or costs a person, seen with your own eyes and reproduced once more before it counts:

- It fails: an error, wrong data, a lost draft or chat, an action that did not happen or happened twice.
- It lies: the screen shows something that is not so (a chat "Working" that is idle, a card that is done but reads Building).
- It is hard: a person cannot tell what to do or what happened, a label is wrong, two places do one thing two ways, the keyboard or the focus is lost.
- It is slow: over the limits in `docs/DEVELOPMENT.md` (33 ms to the first response or a frame in motion), with the numbers.
- It breaks at a size, a zoom or a theme the app supports.
- It costs their attention: a window, a sound, a question, a prompt of macOS or a notification they did not ask for.

Not a finding: a choice `DESIGN.md` makes on purpose; a wish that something looked different; what the notes said to leave alone; an artefact of the tool (the Browser pane has no native side, the test mouse is not a real mouse, a covered window on a locked Mac); and a case with no trigger, which is a source outside your head that makes the case happen. Collect each finding's evidence at the moment, in this run's folder: the picture (of Aven Dev's own render or the harness, never of the person's screen), the steps that reproduce it, the log lines from `target/smoke/`, the failing test.

## 4. Triage and grade

Confirm each finding against the source once: the file and the lines, and why it happens. Grade it by how likely today's people are to meet it and what it costs them: high when it will happen in normal use and costs a chat, a draft, work in a project or the task; medium when it will happen and costs a retry or confusion; low when it is rare but real (written with its trigger) or small and wrong. Nothing is graded low to be safe. Fold duplicates. A finding that needs the person's decision (a change to stored data, a feature to remove, a layout they chose) is written with the decision you would make and why, and goes in a held batch.

Drift in this skill (a step that no longer works, an area the map lacks, a helper that could not reach a working feature) is corrected in this skill's folder, and named in the report.

## 5. The ledger

`ledger.md` in this run's folder: one entry per finding, numbered `F1`, `F2` and on, in the form `references/reporting.md` gives, high first; then the low ones of each area as a checklist, one line each with its file and lines; then the batches. Nothing to record means a ledger that says so, with what was used.

## 6. Batches

Group the findings by the files their fix touches and by size, into batches that make one pull request each: the small wording and style fixes of an area together, a frontend finding with its native side together, the data safety ones first and apart, the ones that need the person's decision held. Write each batch as a command anyone can paste, with a name after `--`; a held batch is written as its numbers with `held` and the reason, never as a command:

```
/aven ship F3 F4 F9 -- sidebar small
held: F7, a stored key would change (the decision proposed is in its entry)
```

## 7. Report

As `references/reporting.md` says. Then one line each, and no line where there is nothing to say:

```
High: F<n>: <one line>  (each high finding)
Batches: <the commands, one per line, held ones marked>
Coverage: <areas used> used, <area>: unreachable (<what it needs>), <area>: left alone per notes
Skill: <what was corrected in the map or the helpers, or "no drift">
Ledger: <this run's folder>
Not proven: <what the Browser pane, a harness or the stand-ins could not show>
```

A request after the report to fix a finding is a ship request: answer with that batch's `/aven ship` line. The sweep itself never builds a fix.
