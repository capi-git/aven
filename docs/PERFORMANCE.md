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

## Full refresh rate for Aven's interface

WebKit enables "Prefer Page Rendering Updates near 60fps" by default. It paces `requestAnimationFrame`, scrolling updates and CSS animations near 60 fps on 120 Hz displays, which explains the 17–18 ms callbacks measured above. The page reads the preference when it is created: a standalone WKWebView on a 120 Hz display measured a 17 ms median frame interval by default, 17 ms after disabling it on a live view, and 8 ms when it was disabled on the configuration before creation.

Aven's own documents (main window, detached workspaces, session pop-outs and panels) now receive a configuration with the preference disabled. On macOS, the main window is created during setup instead of from configuration so it can use one. Remote Chromium tabs are unaffected; they already use Chromium's compositor. Aven Dev's main window measured an 8 ms median `requestAnimationFrame` interval (p10 7 ms, p90 9 ms, 360 frames) on the same display. This is callback cadence, not a measurement of displayed frames or input latency.

Running at twice the frame rate would also double per-frame work tied to animation frames. Streamed transcript events are therefore flushed at most about every 32 ms instead of every frame. Other changes in the same pass reduce work that competes with the frame budget:

- The workspace snapshot is not rebuilt and serialized while only transcripts change.
- Overscroll containment checks nested scrollers only when a container is at an edge.
- The terminal spinner updates its glyph without React renders and pauses while hidden.
- Pinned diff headers, approval toasts and detached composers use solid surfaces instead of backdrop blur.
- The browser loading bar animates `transform` instead of `left`.

Hidden workspace tabs stay mounted; editors and terminals in them retain memory until closed.

## Streaming without workspace re-renders

Sessions previously lived only in `App` state, so every streaming flush re-rendered the whole workspace and the sidebar. A live session store now holds the newest sessions. When a flush changes only transcripts (no other session field, and no change in whether input is needed), visible chat panes read the update from the store while `App` state catches up after at most 250 ms. Any other change commits immediately. Sessions shown in pop-out or detached windows also commit immediately, because those windows sync from committed state. Hidden panes do not subscribe.

In an Aven Dev fixture, 180 simulated `message.delta` events over about three seconds re-rendered `App` and the sidebar 40 times, compared with 214 times on the previous code; the chat pane rendered about 200 times in both. Development builds use React StrictMode, which doubles render counts. Frame intervals in this lightweight fixture were similar in both runs (8 ms median), so the fixture does not demonstrate a frame-time change; the saving grows with workspace size.

The composer is memoized, and the chat pane passes it stable handlers and a memoized review element, so streamed text re-renders the transcript but not the composer. In two alternating pairs of the same fixture, the composer rendered 222 and 208 times before the change and 0 times after, while the chat pane rendered 208–232 times in each run. Frame intervals were again similar before and after.

## Sidebar hover dismissal

Leaving a hover-revealed sidebar previously started its fade only after `App` re-rendered, because the slot's `data-open` attribute came from `App` state. The hover hook now sets `data-open="false"` on the panel when it dismisses, then commits the state in a React transition, so the re-render is interruptible work behind the compositor-driven fade. If the pointer returns before that commit, the hook restores the attribute. While hidden, the sidebar keeps its last profile and project previews instead of clearing them, which previously removed rows during the fade.

In the Aven Dev fixture (twelve simulated leave events), the closing transition started a median 13 ms after pointer leave before the change and 1 ms after it. The worst frame interval during the 300 ms after leaving was similar (13–14 ms before, 11–15 ms after), so the remaining cost is the later re-render rather than a delayed start. The fixture had few projects, so it does not measure how long that re-render takes in a large workspace.

## Footprint on small laptops

Measurements of the installed app on September 24, 2026, while an agent streamed and a heavy page was open, showed roughly 5 GB across about twenty processes: about 3 GB in Chromium (ten renderers plus a 2 GB GPU process), about 1 GB in the interface's WebKit process, and about 360 MB in the host. Aven started Chromium with no memory-related options, so it behaved like a full desktop browser. The interface held 13 open chats whose saved transcripts totalled 20 MB, the largest 7 MB with 1,800 tool results.

An isolated WKWebView test with 13 tab-sized stages, each holding a long scroller, measured the process's owned graphics memory: 54 MB when hidden stages use `visibility: hidden; opacity: 0` (Aven's retained-tab approach), 68 MB with `display: none`, and 309 MB with `content-visibility: hidden`. Hidden tabs therefore do not explain the interface's graphics memory, and `content-visibility` would make it worse.

Changes in this pass:

- Chromium tabs of the same site share a renderer (`--process-per-site`), and the spare pre-launched renderer is disabled. Localhost previews on different ports are one site. The feature name was confirmed present in the pinned engine; runtime process counts were not measured because Aven Dev had no tabs.
- The native window stays opaque unless the sidebar opacity setting is below 100%, the only setting that reveals the desktop; blur and body glass mix the theme background at that opacity. Aven Dev confirmed `opaque=true` before, during and after appearance activation with `SUPERMONO_GLASS_DIAGNOSTICS=1`.
- The host subscribes to macOS memory-pressure notices and publishes `aven:memory-pressure`. The browser memory saver then sleeps hidden tabs immediately, keeping one recent hidden tab under a warning and none under a critical notice. The notice itself was not simulated, which needs root; flag mapping and the sleep policy are unit tested.
- Saving a transcript no longer re-parses the stored copy when the serialized text is unchanged, and a chat that is still running is fully saved at most every 10 seconds instead of every 650 ms. The final state is still saved when a turn ends. Serializing the 7 MB transcript measured about 20 ms in JavaScript and 25 ms to parse.
- Terminal scrollback is 2,000 lines instead of 5,000 for each retained terminal.

Not yet done: incremental (append-only) transcript saves, loading only the recent part of long transcripts, and an optional low-memory browser mode.
