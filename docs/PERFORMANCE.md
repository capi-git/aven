# Motion investigation

Aven retains its current Tauri interface. A separate Swift/AppKit prototype was used to explore sidebar navigation, workspace switching and chat scrolling before considering a native rewrite. The prototype is an experiment, not a replacement for the app.

## Findings from September 17, 2026

An isolated web baseline using production Sidebar, SessionPane and AgentTranscript components from 0.1.71 was compared with the simpler native prototype on an Apple Silicon Mac and a 120 Hz display. Each ran one warmup and three measured passes with a 1280 × 800 viewport, 24 sidebar rows and 40 retained messages per pane. The web host excluded providers, storage and embedded browser views.

Native callback intervals were usually about 8.33 ms, while web JavaScript callbacks were usually 17–18 ms. Native sidebar intervals still reached about 33.4 ms in each measured pass. Callback timing measures opportunities to update the interface; it is not displayed FPS or input-to-photon latency. Installed Aven's captured sidebar changes sometimes occurred faster than 60 Hz, so JavaScript callback cadence does not describe all compositor animations.

The implementations had different text rendering, scroll distances, transition curves and feature coverage. Runs were sequential, not randomized. The machine ran a macOS beta. No physical trackpad or optical display test was completed. These observations do not justify claiming a twofold speedup or committing to a full rewrite.

## Production fixes in 0.1.72

Code inspection and reproduced regression tests identified specific navigation issues:

- Header and footer workspace changes did not capture the outgoing live sidebar, so its visible rows and scroll position could be replaced during a transition.
- A mouse drag ending exactly on a page could receive no final scroll event and fail to select the destination.
- A carousel hidden at zero width could return at its former width without restoring its selected page.
- Restoring a project could redundantly acknowledge and save an already-selected workspace.
- Switching between identical workspace themes repeated document-wide appearance work.

The fixes preserve browser-managed wheel scrolling, momentum and snapping. They do not introduce a JavaScript animation loop or per-frame React state updates. Regression tests verify behavior and avoided redundant work; they are not a measured improvement in displayed frame rate.

## Verification boundaries

Run `npm run check:web` for frontend tests and type checking, and follow [CHROMIUM.md](CHROMIUM.md) for a complete packaged app. Native checks should cover repeated workspace changes, reversing direction without extra clicks, hidden/reopened sidebars, preserved drafts and scroll positions, and browser panes remaining visible.

Further performance work should measure the actual packaged app with continuous input and representative chat/browser workloads. Keep callback intervals, captured compositor changes, physical trackpad behavior and user-perceived latency separate. A native replacement also needs feature, text-selection and accessibility parity.

## Chat scrolling in 0.1.96

An isolated Aven Dev fixture used the production transcript and prompt outline with 32 synthetic turns of alternating short and long Markdown replies. The normal 20-turn initial page and code highlighting remained enabled. Input came from native wheel events, not assignments to `scrollTop`.

The 0.1.95 baseline changed its scroll height from 15,023 to 34,235 CSS pixels during two upward wheel events. Disabling only turn-level containment exposed a second source of shifts: Streamdown code blocks supplied their own inline `auto 200px` size estimate. Their actual height replaced the estimate as they entered view.

The fix removes estimated geometry for mounted turns and code fences, while retaining paging, collapsed completed work, and lazy highlighting. It also removes the transcript's blocking wheel interception and pauses hidden prompt outlines. Twelve wheel events through the corrected initial page held its height at 81,475 pixels; nine more after loading all 32 turns held it at 130,089 pixels. Both corrected samples recorded zero `getComputedStyle` calls during scrolling. The baseline recorded 25 such calls in its two-event sample.

These measurements establish stable geometry and less synchronous input work in the fixture. They do not establish a displayed frame rate, a GPU-use percentage reduction, or elimination of every possible browser flicker. The fixture's native browser page did not finish loading, so its zero browser-layout/snapshot calls are not visual browser verification. Regression tests separately cover scroll defaults, auto-follow, nested tool scrolling, code-block CSS against real Streamdown markup, and hidden-outline cleanup.
