# Writing for the person who reads it

One reader: the maintainer of Aven, who often reads on a phone, between other things, and did not see your tool calls. Their own instructions for replies come first (plain language, Simplified Technical English, short); this file adds what a run of this skill owes them.

## The report

- The first lines are the whole story: what is now true for them, and what is not done or not proven. A person who reads only those lines must not be surprised later.
- Then only what they can act on or need to know, under short bold labels: what changed (in what they see and do, not in files), where it is (a pull request, merged to `main`, released, or only on a branch on this Mac), how it was proven, what was not proven and why, what waits for them.
- No code, no file paths, no line numbers and no command output, unless they asked. Offer the detail in one sentence. A pull request or release is given as its link.
- A number means something only with its base: "37 of 38 steps; the one that failed passed on its retry".
- Say "I did not run this in Aven Dev" when that is so. A rendered harness or the Browser pane is named as that, and the real-app check's test mouse is not a real mouse.
- Say plainly that their own Aven gets the work only after a release and their Restart to update.
- A mistake of the run is said plainly, with what it cost and what you changed so that it does not happen again.
- A question goes at the end, in the text itself, with its choices; they may not see a button.

## What a person can do with it

When a change gives them something new, say how to use it in the words on the screen: the menu, the key, what they will see. When a change alters how chats, settings or projects are kept, say what changes, what does not, and what cannot be undone, before it merges.

## A finding in the ledger

Written for a reader who has never seen the fault:

```
F<n> [<area>] <what is wrong>   (<high | medium | low>)
What a person sees: <one or two sentences>
Steps: <numbered, as a person would do them>
What should happen: <one sentence>
Cause: <file and lines, and why>
Evidence: <the run's folder and the file names>
```

The ledger stays on this Mac. If the person later asks to file one on GitHub, it becomes public: scan it (`scripts/public-scan --file`), take out names of their projects and chats, paths with their name, employer names and tokens, and read it whole before it goes.

## A commit message and a pull request

A subject in plain words that says what a person now gets, as the subjects in `git log --oneline origin/main` do ("Every chat ends with the same room under its last line"). A body that says what was wrong (the person's own words when they reported it), why it happened, what was changed, and what proved it and what did not. Wrapped at about 72 letters. The attribution line the session's instructions give comes last. The pull request body follows the repository's template; it is public, so it holds nothing private.

## A changelog entry

Written in the release pull request only. Each line is a bold sentence a person would notice, then one or two plain sentences: what they see now, and for a fault what they saw before and since which version. No code, no file names, nothing about how it was built.
