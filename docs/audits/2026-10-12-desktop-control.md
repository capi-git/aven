# Desktop control experience

This branch adds a native agent presence bar, provider-labelled pointer,
per-chat app consent, pause/stop/yield controls, and explicit app-directed input.
Source and live native checks are recorded below. A release still goes through
the normal PR, version, build, signing and publication workflow.

## Behavior

- The task's trusted frontend binding supplies its provider and chat title.
  Claude, Codex and the other supported providers share the same control path.
- A non-activating frosted bar identifies the provider, app and action, with
  Pause/Resume and Stop. It never displays typed content or key names.
- Per-app consent defaults on and persists for the chat's grant generation.
  Native Settings can disable that prompt. Shared pointer/keyboard input and
  focus changes always need one-action consent, independent of that toggle.
- `inputMode: "app"` is the default. Input requires an observed `windowId`.
  Accessible single clicks use AXPress where supported; remaining events go to
  the specified process. Typing and keys require its focused window. An
  uncertain AX result is not retried as a click.
- `inputMode: "pointer"` explicitly uses the shared system input. Covered
  window targets remain refused. There is no automatic fallback between modes.
- User input pauses shared control. App-directed control yields when the user
  works in that same app. Two Escape presses stop the active chat. Interruptions
  invalidate in-flight tickets and release held buttons.
- Paused chats can observe; stopped chats need new consent for input or
  observation. Refusals and timeouts tell agents to wait for the user.
- The ring and name tag glide between targets, show click/drag feedback, and
  fade when idle. They respect reduced motion and higher contrast. The bar
  respects reduced transparency and motion. Overlays do not appear in normal
  agent captures, and input cannot target the presence controls.
- Consent rechecks target identity and geometry. Closed requester sockets cancel
  pending prompts. A cancelled one-action approval cannot authorize a new
  command. Button generations prevent an old Stop click becoming a new Allow.

## Validation

- `npm run check:web`: 395 files and 4,388 tests passed, including Claude/Codex
  actor binding, passive refresh behavior and consent settings; TypeScript and
  lint passed (lint retains pre-existing warnings).
- `npm run check:tooling` passed. The isolated Dev runner's 17 focused tests
  include refusing a live listener while allowing reuse after its own server
  closes. The opt-in test builds a passive AppKit receiver outside the main app
  bundle; ordinary previews do not build or launch it.
- Full Chromium native tests: 636 passed; Clippy passed with warnings denied.
  GitHub CI remains the separate macOS/Windows validation boundary.
- A complete Aven Dev bundle passed package and strict signature checks.
- Live app-directed input reached both an owned native view and a separate,
  background AppKit process: two presses/releases, scrolling, a complete drag
  to the expected endpoint, one accessible button action, typing and Backspace.
  The pointer and foreground app stayed unchanged across the complete run.
- Controlled Pause and Stop each interrupted an in-progress native drag. Both
  delivered its release event. No HID input or real user document was used.
- Native button clicks showed Pause and Resume correctly. Double Escape through
  the native event monitor displayed the stopped-provider notice, which faded.
  The consent label is fully visible at its final width.

Live QA found that raw `CGEventCreateMouseEvent` events carried no AppKit
window number. Setting the two pointer-window metadata fields did not route
these events into the intended view. Input now originates as an `NSEvent` with
its destination window and the correct local-coordinate conversion for an
owned or foreign window. Drag events and matching releases are prepared before
pressing, preserving the native position instead of mutating only the CG point.
Scroll events retain that routing and copy the public pixel-scroll fields.
The cross-process fixture catches regressions in actual received coordinates.

An accessibility action inside the sending app reported an AX error after its
button ran once. Aven returned the uncertainty and did not retry it. The separate
AppKit receiver confirmed one successful semantic press. Errors include the AX
code and continue to require inspection before any retry or pointer fallback.

The final receipt and native screenshots are retained locally at
`~/Developer/.worktrees/Aven/scratch/desktop-control-20261012/`.
`final-input-passed.json` records the completed functional run.

## Scope of the evidence

The AppKit receiver uses real native controls in another process; it does not
establish compatibility with every third-party app. Process-directed events can
still be ignored by particular apps. Agents must inspect the result and obtain
one-action consent before using the shared pointer. Provider binding is tested
for Claude and Codex through their shared frontend/native path; the checks do
not claim a separate end-to-end provider chat run or a production app upgrade.

The visual demo uses `AVEN_DEV_PRESENCE_PREVIEW=1 AVEN_DEV_CURSOR_PREVIEW=1`.
It draws a labelled preview, exercises the native interruption monitor and
posts no input. The functional check uses `AVEN_DEV_DESKTOP_SELF_TEST=1` and
requires Aven Dev's existing permissions and enabled setting. See
[DEVELOPMENT.md](../DEVELOPMENT.md) for the isolated runner and fixture details.
