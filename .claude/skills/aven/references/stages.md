# The stages: implement, simplify, review

Each is a mode of its own (`/aven implement …`) and a step of `ship`. On its own, a stage ends with a commit on the work branch and a report; it does not push, merge or publish.

## Implement

**Read before you design.** The ask, whole: the finding with its evidence, the issue with its comments, or the person's message and the picture they sent. A picture of one part of a screen means: look at every part of that screen for the same fault. Then `DESIGN.md` for anything a person sees, and the code the change touches and the code next to it, far enough to know how that part is built today and which tests cover it. When the ask is a fault the person met, read the evidence first (`references/aven.md`, Evidence) and reproduce the fault before you change anything: in a Vitest test, a Rust test, the rendered interface, or a real-app check step. A fault you cannot reproduce is reported as such, with what you tried; a fix for a fault you did not see is a guess.

**Decide what was meant.** The person writes short and fast. Read their words for what they want to be able to do, not for the literal sentence. When two readings differ in what gets built, take the one their earlier messages, `DESIGN.md` and the app's taste support, say in the report which one you took, and build it so that the other is cheap. Ask only when a wrong guess would cost their data or their chats.

**Build it.** The smallest change that does it, where that part of the code already does such things: hooks in `src/hooks`, logic in `src/lib`, chrome in `src/chrome`, views in `src/surfaces`; shared theme tokens and spacing variables over new colours and sizes; `errorText` and `logError` from `src/lib/errors` for errors. Targeted edits. A comment says why, in the plain style of the code around it, and names the fault it prevents when there was one. Any change to how chats, settings or projects are stored is a decision of the person (SKILL.md) and comes with: new keys under `aven.`, old `monocode.*` and `supermono.*` keys still read, what an older Aven does with the new data, and a test of the round trip. A change that a real-app check step presses or reads changes that step in the same commit.

**Port, do not replace.** A fix that MonoCode made upstream is adapted into Aven's own code with its attribution (`docs/UPSTREAM.md`), never copied over Aven's interface, stored data, providers or release feed.

**Prove it.** A test for a rule, named after its module and beside it. The rendered interface for what a person sees, at a narrow and a wide pane. Run what you wrote (`scripts/checks changed`).

**Commit and report** as `ship.md` (step 2.5) says.

## Simplify

The goal is the change's goal, not fewer lines. Read everything the change built, as if another person wrote it, and challenge each piece:

- Does the goal fail without it? An option nobody asked for, a guard for a case with no trigger, a second way to do one thing, a helper used once, a setting: out, unless you can name what breaks.
- Is it built the way the code next to it is? A new pattern beside an old one that does the same is replaced by the old one.
- Does it add a button, a row, a menu item, a setting or a message? Each must earn its place against `DESIGN.md` (name a thing once, its actions once, no stacked chrome); say in the report why it stays. Menus show only the rows that apply, rather than greyed ones.
- Is anything left from the work: a debug print, a diagnostic in a test, a comment about the old code, a test that proves nothing, a formatting change mixed into a change of behaviour?

Make the changes, then prove that the goal still holds with the same proofs as before. "Read it all, nothing to take out" is a result.

## Review

An independent read, because the writer of a change cannot see what they assumed.

1. **The reviewer.** A subagent that only reads (no edits, no builds, no Aven Dev, no provider tools). Give it the diff's range, the files and functions to trace, and concrete questions: what input breaks this, what state loses a chat, a draft or a file, what an older Aven does with the stored data, what happens with two windows, two workspaces, a split pane, at 80% and 120% interface zoom, while an agent streams, during Restart to update, on Windows (WebView2, no Chromium bridge), and in the WebKit build (`--no-default-features`). Do not give it your conclusion. Ask for findings ranked by harm, each with file and lines, whether it traced the path or only suspects it, a concrete failing input, and the smallest fix; and for one line per area on what it read fully and what partly. For a change in an area the person depends on every day (chats and their sending, the message box, tabs and panes, teams and Avos, the browser), add a second reviewer that walks through real use, step by step, and says what the person would see.
2. **The gate.** Every finding is a claim (SKILL.md). Read the code for each one. Will it happen? Fix it, with a test that fails without the fix. Rare but real? Write it in the report with its trigger. Not real? Drop it and say why. A reviewer's finding about your own fix is the most valuable kind: a read-only review of a merged batch has found real faults that every check had passed.
3. **Fix, prove, commit.** As Implement. A fix that grows the change beyond the ask goes in the report as a follow-up, not in the change.

The report of a review names: what was fixed, what waits with its trigger, what was dropped and why, and what the reviewer did not read.
