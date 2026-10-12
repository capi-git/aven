# Desktop control experience

This branch adds a native agent presence bar, provider-labelled pointer,
per-chat app consent, pause/stop/yield controls, and explicit app-directed input.
It is a draft pending complete native input QA. It does not update the installed
Aven or publish a release.

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

## Validation so far

- `npm run check:web`: 395 files and 4,387 tests passed, including Claude/Codex
  actor binding, passive refresh behavior, and the consent setting; TypeScript,
  Prettier and lint passed. Lint retains pre-existing warnings.
- `npm run build` and `npm run check:tooling` passed. The development runner's
  16 focused tests also passed after adding explicit preview flag forwarding.
- The full Chromium Rust suite passed 634 tests, followed by 97 focused desktop
  tests after two additional consent/lifecycle regressions. Full native checks
  also passed with Chromium disabled. Clippy passed with warnings denied in
  both configurations; formatting passed. Final CI remains authoritative for
  Windows and release builds.
- A complete Aven Dev bundle passed package and strict signature checks. The
  first visual pass showed consent, acting and paused states and the new
  provider pointer. The consent button was clipped; its width is corrected in
  source and needs the final rendered confirmation.
- A debug-only self-test targets its own disposable native view through the
  app-directed route. The first live run returned a user-activity pause before
  completion. This is not proof of successful background input or proof of
  genuine versus synthetic event classification. No retries were attempted
  after that pause; the user was asked for a brief idle window. Added receipt
  metadata distinguishes event kinds, marker presence and source processes
  without collecting typed content.

The screenshots, initial receipt and command logs are retained locally at
`~/Developer/.worktrees/Aven/scratch/desktop-control-20261012/`.
The currently running Aven Dev bundle predates the last review fixes; source
and rendered validation are intentionally distinct.

## Remaining native checks

1. During a user-approved idle window, rerun the owned-window self-test and
   inspect receipt counts plus unchanged pointer/foreground assertions. Diagnose
   any false positive input classification before continuing.
2. Confirm the full consent-button label and the bar's final fade behavior.
3. Verify Pause/Resume/Stop, double Escape, cancellation during a held drag,
   and screenshot suppression in the rebuilt host. A visual-only preview does
   not establish actual event interception.
4. Test app-directed keys and representative external app controls. Some apps
   ignore process-directed events; a successful dispatch is not a guarantee
   that the app performed the requested change. Keep fallback explicit.

The visual demo uses `AVEN_DEV_PRESENCE_PREVIEW=1 AVEN_DEV_CURSOR_PREVIEW=1`.
The separate functional fixture uses `AVEN_DEV_DESKTOP_SELF_TEST=1`; it requires
Aven Dev's existing permissions and enabled setting and never changes them.
See [DEVELOPMENT.md](../DEVELOPMENT.md) for the isolated runner.
