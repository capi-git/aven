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

`npm run dev:app -- --build-only` prepares the isolated bundle without opening it. `npm run dev` alone is a frontend preview and does not supply native APIs. A raw `tauri dev` run has isolated data but does not package Chromium; use `dev:app` for browser testing.

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

## Agent instructions and tools

Repository instructions live in [AGENTS.md](../AGENTS.md). Keep changes scoped, preserve other tasks' work, and use the supplied in-app browser connection for ordinary previews. Skills are reusable instructions, not permission grants. Enable Aven's built-in desktop control in **Settings → Skills & tools**; it is off by default. Listing windows and taking screenshots require Screen Recording; input and app activation require both Screen Recording and Accessibility, granted by the user in macOS. The separate Aven Dev app needs its own access; ad-hoc native rebuilds may reset those grants. Agents use the Aven executable's `--aven-desktop` command over the task's scoped browser connection, and their actions never trigger permission prompts. Browser inspection does not require enabling desktop control.

See [AGENT-TOOLS.md](AGENT-TOOLS.md) for automatic browser routing, opening Markdown in the editor, and native desktop control. The guidance is supplied to tasks automatically; the computer-use slash command is optional.
