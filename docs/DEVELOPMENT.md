# Develop Aven inside Aven

Open this repository as a project in your installed Aven, and start a task in it. The same editor, terminal, agent providers, skills and in-app browser work on Aven's own source.

## One daily app, one optional preview

Keep the daily app in `/Applications/Aven.app`. Use **Aven Dev** only when checking changes. It has a separate bundle identity (`com.capi.aven.dev`), chats, settings and Chromium profile. Debug builds cannot use the production identity, and do not check for production app updates. Your provider accounts remain managed by the provider CLIs; a development preview does not copy production chat data.

From Aven's terminal in this repository:

```sh
npm ci
npm run dev:doctor
npm run dev:app
```

The runner builds the native app and its complete Chromium runtime, verifies the package, starts its own frontend server, and opens **Aven Dev**. Frontend edits refresh there. Quit **Aven Dev** normally before rerunning for Rust/native changes. The runner stops only its own frontend server when the preview closes. It refuses an occupied port or a second preview rather than killing another process. The installed Aven can stay open for your coding task throughout.

For small CSS and React changes, keep this preview running and edit the source in the checkout that owns it. Vite refreshes those edits in place; do not rerun `dev:app`, bump the version, or publish a release for each adjustment. Check the rendered result at narrow and wide pane sizes, then batch the finished changes into the next release. The installed public app uses bundled UI assets and does not receive these development edits.

`npm run dev:app -- --build-only` prepares the isolated bundle without opening it. `npm run dev` alone is a frontend preview and does not supply native APIs. A raw `tauri dev` run has isolated data but does not package Chromium; use `dev:app` for browser testing.

For a visual check of the native agent cursor, run `AVEN_DEV_CURSOR_PREVIEW=1 npm run dev:app`. The debug build animates the cursor over its own Dev window for about a minute, then fades it. This preview only draws the marker; it sends no mouse or keyboard input and changes no permissions. It also permits another host to capture the marker for visual QA; normal builds retain the window-sharing exclusion, and authenticated desktop screenshots always suppress the marker. Real desktop actions still require an enabled, authenticated task and the applicable macOS grants.

## Real-app check

`npm run check:app` builds Aven Dev and runs it once in a throwaway profile, without a window you need to touch. A stand-in `claude` (`scripts/smoke/fake-claude.py`) answers instead of a real provider, so nothing reaches an account or a network. It first checks the launch: the window must stay hidden until the workspace has drawn, be shown by that drawn frame rather than by its fallback timeout, and WebKit must have painted the workspace before the window appeared. The workspace sends one turn through the normal send path with the floating sidebar attached. That first finished turn in a project with an empty memory must offer the memory keeper above the message box; the check turns it on, and the keeper's pass must fill the project memory with its five sections in their own block. The stand-in answers as the keeper only when Aven started it with the keeper's instructions and every tool turned off, and its answer includes a line addressed to agents that must not reach the memory. The check then opens Search, Inbox, Automations, Notes and Settings in turn, checking that only one is on screen and that closing Settings returns to Notes and leaving Notes shows the workspace.

It then checks what moves. The stand-in holds two turns open for a few seconds (`AVEN_SMOKE_HOLD <ms>` in a message). During the first, the project's mascot in the pinned sidebar must be in its working state with its hop animation running (or still, with reduced motion on); when the turn ends it must cheer once, stop, and not cheer again. During the second, Home opens: every project's agent needs a mascot or logo, the working one moves, Right now counts it and today's recap counts the finished turns. The sidebar's New task, pressed over Home, must leave Home for the new chat. The check's project is a Git repository with one other checkout, so the Changes panel shows Parallel work, which must start folded to its header line. Then a new chat in the project discusses a topic for two rounds with another new chat. The check starts it from the chat on screen as a person would: its **+** menu must offer **Discuss**, the chip's dropdown picks **New chat with…** Claude, two rounds and the **Skeptic** role, and the chip must then read "… as Skeptic …"; sending the message starts it. The new chat must get no tab or pane, and the first chat must show the topic as the user's message followed by one live card (both mascots, "… are discussing" and **Watch**, with no Stop of its own: stopping it is the bar's **Stop discussion**) with none of the turns it stands for drawn; the discussion's floating panel must open by itself, its header naming the topic. While the second chat holds its first answer open, its first relayed message must start with "Your role in this discussion: Skeptic." and the Skeptic's mascot must be badged in the panel and on the card; the panel must show the first chat's reply and the second chat typing; what the check sends from the panel's box ("Add something for both of them…") must wait below the typing for the next reply; the bar above the first chat's message box must read Round 1 of 2, badge the Skeptic and offer **Watch**, and that message box must read "Add something for both of them…" too; the pinned sidebar must link both rows with one connector whose pulse runs toward the answering chat (or stays still with reduced motion); shrinking the panel must leave a pill reading round 1 of 2 and who is replying, and pressing the pill must bring the panel back; and the second chat, opened from its sidebar row, must show the first chat's reply as a relayed message with its card. The next two relays must carry the check's message, one to each chat, with each chat's agent saying it heard it (the stand-in agrees, and says so, when a relay carries `AVEN_SMOKE_JUMP_IN` from the user). Each reply must be relayed exactly once, the role must have reached the second chat once and the first never, both chats must get the closing note, and the connector and bar must go. The panel must then show the whole thread: the four replies alternating, the check's message between the second chat's first reply and the answer to it, the second chat's last reply marked as agreeing, the closing note, and **Where they landed** with Agreed and Still open from the stand-in playing the cheapest model (it answers as the summariser only when Aven started it with the summariser's instructions and no tools, and its line addressed to agents must not reach the panel). In the first chat the card must read "Discussion finished · 2 rounds" with **Watch**, followed by the same wrap-up with both lists kept in the closing note and none in the second chat; Activity must hold exactly one entry for the discussion, "Discussion finished · 2 rounds" on the first chat, with its four relayed turns recorded quietly and already read; the message box must be back to messaging the first chat's agent, and the wrap-up's **Have Claude build it** must send the plan to the first chat as an ordinary message. Last, after the panel is closed, the card's **Watch** must bring it back with the whole thread. A new chat then opens the project's README beside it: each pane must have one strip in the tab style laid out above its content, never floating over it (the file's tab row is its strip, and the old floating controls must be gone), the panes must be square and flush with the workspace's edges, with a hairline under each strip and a hairline between the two panes, both strips' tabs must share one height and shape, and no title row above the panes may name the tab again; a new chat alone in its tab must have no strip. Then two new chats each start the same pretend Vite server through the stand-in's Bash tool (`AVEN_SMOKE_DEV_SERVER <port>` in a message; nothing listens on the port): the second chat must show the second-server chip at once, the first must not, the second chat's next turn must carry the shared-work note naming the first server (the stand-in echoes it for `AVEN_SMOKE_ECHO_NOTE`), and **Keep both** must clear the chip. Then a new chat asks for an orchestration from its **+** menu's **Orchestrator** (`AVEN_SMOKE_ORCHESTRATE` in the request): the stand-in lead proposes two tasks with separate files, the plan card must show their file chips, and the check confirms it. While the lead works, its chat must offer one Stop, the bar's **Stop run**, with none on the run's card, in the run status or in its message box. One worker asks its lead a question through AskUserQuestion (`AVEN_SMOKE_ASK_LEAD` in its task); while it waits, Activity must hold no request for it or the lead, Home's Needs you must not list it and the lead's sidebar card must not ask for you. The stand-in lead answers it through Aven's control command, accepts both tasks and calls `finish`, which must succeed for the lead itself; Activity must then hold exactly one "Run finished" entry since the confirmation, none for the workers or the lead's hidden turns, and the card must read Finished and have become the run's result: the lead's verdict, both agents Accepted, each with a line on what it did from the stand-in playing the cheapest model (it answers as the run summariser only when Aven started it with the summariser's instructions and no tools), with **Review changes** and **Open agents**. A second orchestration carries `AVEN_SMOKE_STALL`, so the stand-in lead reads the results and never finishes: another chat in the project must be refused with the plain "is busy with a run in" wording, the bar above the lead's message box must say "The lead stopped without finishing" and offer **Finish run** and **Ask the lead to wrap up**; the bar's **Watch** must open the team panel with the lead's row, a row per agent, the stopped notice with **Finish run**, and **Stop run**; and **Finish run** must end the run. Then a new chat races a message from its message box: its **+** menu must offer **Race**, the chip must name the agents ("Race · …") and its dropdown list them. The first race needs a second provider, so the check also installs a stand-in Grok Build (`scripts/smoke/fake-grok.py`, the smallest provider protocol to stand in for), and it sends nothing unless both Claude and Grok resolve to the stand-ins and the dropdown's agents are exactly Claude and Grok, named apart. For `AVEN_SMOKE_RACE` each stand-in writes a file into its lane's copy, then another every half second while the turn holds; the stand-in Grok fails its first try in each copy (`AVEN_SMOKE_FAIL_ONCE`). Your message must stay in that chat, followed by the race's card, and the chat must stay on screen while the lanes work in their own tab; the card must show Claude's lane working and Grok's failed, the chat's bar must read "Racing · …" with the chat's one Stop, **Stop race**, and Grok's failed try must post nothing to Activity. **Watch** on the card must open the team panel with a column per lane in the states the card shows, a mascot per lane, **Compare** and **Stop race**. Both team panels (the race's and the stalled run's) must shrink to a pill that brings them back, and on a Mac ↗ must open the panel in a window of its own that draws and shows itself, and closing that window must leave the team's pill. The two lanes must be chats in the project working in separate copies, each writing only into its own; **Compare** on the card must open the overview; Grok's lane must read Failed while Claude's reads Working, and **Retry** must set it working again. The check then presses **Keep this** on Claude's lane while Grok's still works, at a moment when Claude has written a file the overview has not shown yet, and confirms the question, which must say how many agents it stops. The project must then have Claude's files, including that one and none of Grok's, both copies must be gone, both lane chats must point back at the project, and the race's card must have become its result, "Kept Claude's version · N files" with **Review changes** and **Continue with**. A second race, whose agents write their file and finish within seconds, adds a second stand-in Claude on another Claude model as a third agent, so the dropdown must list Claude, Grok and Claude again: the three must race in three copies on three branches, the two Claudes on different models, each writing into its own copy, and the card must name each by its app, the two Claudes by their models. It runs to its end: its card must read "Ready to compare", calm and with no Stop, and Activity must hold exactly one "Race ready to compare · 3 of 3 done" entry, every agent's turn recorded quietly. **Suggest a winner** must show the stand-in judge's pick, Grok's lane, with its reason (the stand-in answers as the judge only when Aven started it with the judge's instructions and no tools, and its line addressed to agents must not reach the card); keeping that lane from the overview, after a question that names whose work it deletes, must turn the card into "Kept Grok's version · 1 file" with why, and **Continue with** must send Grok's chat its recap. Then a new chat's held turn edits a file through the stand-in's Write tool (`AVEN_SMOKE_EDIT <name>` in a message) while the title bar's **Open board** opens the project's board: it must show **Ideas**, **Building**, **Review** and **Shipped**, and count the chat on its line for work outside the board; adding the chat from there must give it a card under Building while the turn runs which, once the turn ends, moves by itself to Review, naming the file and offering **Review** and **Ship it**; pressing the card must open the chat. The check removes its card afterwards. Keep Aven Dev's window uncovered while the check runs: macOS stops drawing a covered window, and a hidden window leaves reactions to windows you can see.

It presses Cmd+, and Cmd+W to open and close Settings the way a key press reaches the workspace. It opens the restart-to-update question's preview, checks that it names the made-up agents, terminal command and unsaved file and offers its three actions, and closes it. Last, the floating sidebar opens Settings and presses Back in its own page. The runner prints each step, exits non-zero on a failure, and keeps the throwaway folder for inspection when something fails.

The run uses its own home folder for chats, settings and the browser profile, and keeps web storage in memory, so your Aven Dev data is not read or changed. It refuses to send anything unless Aven resolved `claude` to the stand-in. Quit Aven Dev first; the check needs the preview port. The **Release Aven** workflow runs the same check and will not publish unless it passes.

## Restart-to-update previews

Development builds can show the restart-to-update screens without a real update. Open the command palette, type `>` and choose **Preview restart question**, **Preview restart waiting card** or **Preview restart overlay** (each marked development). They use made-up work: two agents, one waiting for an answer, a terminal running `npm` and an unsaved `App.tsx`. Every action in a preview only closes it; nothing stops, quits or restarts. Click or press a key to close the overlay. Release builds do not contain these commands.

## Speed test

`npm run perf:app` measures how Aven feels in use. It builds the interface in production mode (development React is several times slower), launches Aven Dev in a throwaway profile with the stand-in agent, keeps the window above others without taking the keyboard (macOS stops drawing covered windows), and drives the real workspace: six chats with streamed replies, a long stream, typing (alone and while an agent streams), switching chat tabs, showing and hiding the sidebar, opening and closing Settings, opening a local web page and switching to it, ten seconds idle, and last, an agent writing a 240-line code block.

It prints the time from launch to the workspace being ready and to its window appearing, then, for each scenario, the time from input to the next painted frame (median, 95th percentile, worst), slow frames, the worst frame, CPU as a share of one core, wakeups per second, and memory. CPU, wakeups and memory cover Aven's own processes: the app, the WebKit processes that draw its interface, and Chromium's processes for browser tabs. Agents and shells it started are counted apart. Each run is saved under `target/perf/`; pass `-- --perf-compare <saved file>` to print differences from an earlier run. A scenario during which the window was hidden is flagged, because its timings are not meaningful.

To find out why an interaction is slow:

- Each switching scenario also prints a breakdown of its input-to-frame time (script, style and layout, paint), React render time by component (the perf build uses React's profiling build), the calls that forced WebKit to style and lay out early, with the source file and line that made them, and DOM changes.
- `-- --perf-only switching,sidebar` runs only the scenarios whose names contain those words, after the shared setup, so an experiment takes about a minute.
- `-- --perf-only restyle` records every attribute an interaction changes, then replays each one alone and times the style and layout it costs, and lists the largest subtrees added or removed.
- `-- --perf-sample Settings` profiles the interface's WebKit processes with macOS `sample` during that scenario and prints the functions most often on the stack.

The speed test code is only built with `VITE_AVEN_PERF=1` and a debug native build; release builds do not contain it.

## Machine setup

Install the prerequisites and verified SDK in [CHROMIUM.md](CHROMIUM.md). Standard tools on `PATH` work. Optional machine-specific paths belong in `~/.config/aven/development.env`, outside the checkout:

```sh
export CEF_ROOT="/absolute/path/to/verified/cef-sdk"
# Only when needed:
export CMAKE="/absolute/path/to/cmake"
export NINJA="/absolute/path/to/ninja"
```

`scripts/with-dev-env.sh` loads that local file for the development commands. It also works with checks or builds, for example `./scripts/with-dev-env.sh cargo test --locked -p aven --lib`. Do not store provider tokens or release-signing keys in this file. Build tools and the SDK can live under `~/Library/Application Support/Aven Development` so source folders stay uncluttered.

The default local **Aven Dev** build uses ad-hoc signing. macOS can ask you to authorize **Aven Dev** to use Chromium's Safe Storage Keychain item when first opening its browser, and again after a native rebuild changes its signature. Complete or deny that protected system prompt yourself; the browser may wait until you do. If you already have a stable Developer ID signing identity in your login Keychain, set `AVEN_DEV_SIGNING_IDENTITY` to its name in your local configuration. The runner uses it for the complete bundle. It does not create a certificate, change Keychain permissions, disable encryption, or weaken the Chromium sandbox. Production release builds separately require the Developer ID identity specified by the release policy; see [RELEASING.md](RELEASING.md).

## macOS permission changes in the preview

The runner opens the exact **Aven Dev.app** through LaunchServices (`open -W -n -a <absolute bundle path>`). Do not start its `Contents/MacOS/aven` executable directly for permission testing: a direct child can retain the terminal host's privacy responsibility even with a separate bundle ID and process group. Apple describes [responsible-code attribution](https://developer.apple.com/forums/thread/678819) and distinguishes [LaunchServices from direct process launches](https://developer.apple.com/videos/play/wwdc2019/701/).

Grant permissions to **Aven Dev**, not your daily **Aven**. If macOS offers **Quit & Reopen**, choose **Later**, quit **Aven Dev** normally, and rerun `npm run dev:app`. The runner's `open -W` wait ends when the preview exits and then stops its own frontend server; a system-initiated reopen is not supervised and may otherwise show a blank preview. The runner never restarts the daily app or changes privacy grants.

In the September 28 comparison, the directly launched Dev app reported both permissions granted. Dev launched through LaunchServices reported both missing, while macOS's Screen Recording list contained **Aven**, but no **Aven Dev** entry. The production process remained running. This confirms a permissions difference between the launch modes; a "Ready" result from a direct executable launch does not establish that Dev has its own grants. Verify the **Aven Dev** entry and test its actions after a LaunchServices launch.

In the earlier dual-exit incident, the production app received a Quit AppleEvent and exited normally; there was no matching crash report. Its bundle and helper identifiers were distinct from Aven Dev's. The launch comparison strengthens the privacy-attribution explanation, but the retained logs do not identify the AppleEvent sender and do not prove the complete cause of both exits.

## Check and update

Run `npm run check:web` and the relevant native tests. Verify the changed flow in Aven Dev, then build a release with `./scripts/with-dev-env.sh ./scripts/build-release.sh`. This creates a complete candidate under `target/releases/`; it never replaces or restarts your daily app. See [RELEASING.md](RELEASING.md) for release and updater signing. Install a tested release only after saving work and quitting the daily app normally.

## Codex chat storage

Aven stores Codex conversations under its own app data directory in `codex-home`, separate from the Codex app and CLI history. Background title and Git text requests use unsaved threads. Shared file-based login, provider settings, skills and plugins continue to use the existing Codex setup; Aven does not change the selected account.

When an existing Aven or imported conversation resumes, Aven copies only its requested provider rollout into private storage and continues there. The original remains unchanged, and later resumes prefer the private copy. This does not archive or remove previous entries from Codex Recents.

Before starting a thread, Aven verifies that the effective Codex database path is private. Managed settings that override that path, unsupported configuration sharing, and keyring or automatic selection for `cli_auth_credentials_store` produce an explicit error instead of falling back to shared history. The currently supported shared Codex login uses its default file credential store; bridging its home-specific keyring account needs separate implementation and verification.

MCP OAuth has a separate credential store. Ordinary macOS keyring credentials remain shared, and file credentials use a managed hardlink with shared refresh locks. The encrypted `secrets` directory stays private because its encryption key depends on the Codex home. When `features.secret_auth_storage` is active (the Windows default), enabled remote MCP servers require `mcp_oauth_credentials_store = "file"`; unsupported combinations stop before a thread starts. Switching an existing encrypted MCP login to the file store requires signing in to that server again. An explicit `secret_auth_storage = false` keeps the ordinary keyring backend. Enterprise `ema-idp:` keyring identities are also home-specific and are not shared between Aven and Codex.

## Agent instructions and tools

Repository instructions live in [AGENTS.md](../AGENTS.md). Keep changes scoped, preserve other tasks' work, and use the supplied in-app browser connection for ordinary previews. Skills are reusable instructions, not permission grants. Enable Aven's built-in desktop control in **Settings → Skills & tools**; it is off by default. Listing windows and taking screenshots require Screen Recording; input and app activation require both Screen Recording and Accessibility, granted by the user in macOS. The separate Aven Dev app needs its own access; ad-hoc native rebuilds may reset those grants. Agents use the Aven executable's `--aven-desktop` command over the task's scoped browser connection, and their actions never trigger permission prompts. Browser inspection does not require enabling desktop control.

See [AGENT-TOOLS.md](AGENT-TOOLS.md) for automatic browser routing, opening Markdown in the editor, and native desktop control. The guidance is supplied to tasks automatically; the computer-use slash command is optional.

## Desktop presence preview

Run `AVEN_DEV_PRESENCE_PREVIEW=1 AVEN_DEV_CURSOR_PREVIEW=1 npm run dev:app`
for a visual-only demonstration of the consent, acting and paused states and
provider pointer. The preview posts no input, creates no desktop grant, and
changes no permissions. Its labels explicitly identify it as a preview. Release
builds exclude this trigger; normal agent screenshots suppress both overlays.
App-directed delivery and shared-input interruption require separate functional
validation; seeing the preview does not establish input behavior in other apps.

`AVEN_DEV_DESKTOP_SELF_TEST=1 npm run dev:app` runs separate debug-only native
input checks. It requires Aven Dev's existing enabled switch and both macOS
permissions; it never enables or requests either. The runner also builds a
passive **Aven Input Fixture** under this checkout's `target/debug/`. The test
uses its own disposable window and launches that receiver in the background.
Both are test-owned; it never targets another running app or posts HID input.
The receiver exits after the check, with a 45-second failsafe.

The checks cover clicks, scrolls, drag endpoints, accessible buttons, typing,
Backspace, and release during a deliberately interrupted drag. Consent is
seeded only for the synthetic test scope and those verified fixture targets.
A private receipt under Aven Dev's cache directory
(`aven.desktop-input-self-test.json`) records received events, input results,
and pointer/foreground stability. Event metadata contains coordinates, event
kinds and process IDs, never typed content or key names. Keep the keyboard and
mouse idle during this brief check; user input still interrupts it. Successful
AppKit fixture delivery is not a promise that every third-party app accepts
background events. Agents must inspect each result and ask before switching
to shared-pointer input.

The self-test also reads the receiver with `appState` and presses its button by
element index through the same gate. For the accessibility-element adapter on
its own, run the opt-in live check from this checkout:

```sh
AVEN_AX_LIVE=1 ./scripts/with-dev-env.sh cargo test -p aven --lib live_fixture -- --ignored --nocapture
```

It builds `scripts/desktop-accessibility-fixture.swift` into a temporary folder,
launches it in the background with its window behind other windows, and acts only
on that process: tree capture with secure-field redaction, button press, refusal
of indexes used up by an action or superseded by a newer state, text
value/insertion/deletion, slider, scroll, refusal of an untitled row after a row
is inserted above it, row selection, a context menu (shown for under a second),
refusal of a disabled button, a disabled text field (selection and keys) and a
disabled default button for Enter (named in the error, and not involved when a field
is named), a row whose inline button is never pressed by the row's click fallback,
a dialog whose enabled default and cancel buttons Enter and Escape press (and name)
only when no element is named, a button on
a local WKWebView page (no network) and a pause refusal. A passive listen-only
tap confirms that the test posted no pointer events; the fixture reports that it
never became active or key. The fixture quits afterwards (60-second failsafe). The
terminal running the test needs Accessibility access.

## iPhone pane

The iPhone pane's native bridge (`src-tauri/macos/ios_simulator.m`) is built
into every macOS build by `build.rs`; it loads Xcode's simulator frameworks at
runtime, so nothing links against Xcode. Unit tests cover Xcode project and
build-output parsing, point mapping, keys and the agent command's scoping. An
opt-in live test creates a throwaway simulator ("Aven Dev iPhone Test …"),
boots it, runs the input fix, builds and runs `tests/fixtures/ios-sample`,
taps, types, pastes, rotates and presses Home, then deletes the simulator:

```sh
AVEN_IOS_SIM_LIVE=1 ./scripts/with-dev-env.sh cargo test -p aven --lib ios_sim_live -- --ignored --nocapture
```

It needs Xcode with an iOS simulator runtime and takes about a minute and a
half; it never touches other simulators. `AVEN_IOS_SIM_FORCE_BASIC=1` makes
Aven Dev use the pane's basic mode, to check the fallback.

To time the pane's phases (picking a device, the input fix, Run with a clean,
unchanged and edited build, input, screenshots, the XCUITest agent), create a
throwaway simulator whose name starts with "Aven Perf" and run the opt-in
timing tests against it, before and after a change; they erase, boot and shut
down only that simulator:

```sh
U=$(xcrun simctl create "Aven Perf iPhone" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
AVEN_IOS_SIM_PERF=1 AVEN_IOS_SIM_PERF_UDID=$U AVEN_IOS_SIM_PERF_APP=$PWD/tests/fixtures/ios-sample \
  ./scripts/with-dev-env.sh cargo test -p aven --lib ios_sim_perf -- --ignored --nocapture --test-threads=1
xcrun simctl delete $U
```

`ios_sim_perf_repeat` repeats the slow paths (`AVEN_IOS_SIM_PERF_REPEAT`
times). Other agents' builds skew these numbers; alternate before and after
runs. `AVEN_IOS_SIM_STATS=1` makes Aven Dev log each live view's frame rate,
main-thread wait and click-to-frame time every five seconds.

`npm run check:iphone` checks the real pane in Aven Dev, in a throwaway
profile with the stand-in `claude`, on a throwaway simulator ("Aven Dev
iPhone") it creates and deletes afterwards. The sample app is the project. It
opens the pane from the header's iPhone button, waits for the device to start
and its screen to go live, presses Run, and reads the console under Logs.
Clicks and keys reach the pane's native view through debug-only hooks (its own
hit test and handlers, never system input), and Aven's XCUITest agent reads
the results back: a tap, the frames shown while the app animates, typing
including Option-E then E, a tap in landscape after Rotate, and Home. Last, the stand-in agent in the chat uses
the simulator through `--aven-simulator` (list, launch, snapshot, tap,
screenshot, logs, and a refused request for another simulator). Pass
`-- --iphone-shots <folder>` to keep its framebuffer screenshots. Quit Aven
Dev first; the check needs the preview port.
