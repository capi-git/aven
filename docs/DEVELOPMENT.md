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

`scripts/with-dev-env.sh` loads that local file for the development commands. It also works with checks or builds, for example `./scripts/with-dev-env.sh cargo test --locked -p monocode --lib`. Do not store provider tokens or release-signing keys in this file. Build tools and the SDK can live under `~/Library/Application Support/Aven Development` so source folders stay uncluttered.

The default local build uses ad-hoc signing. macOS can ask you to authorize **Aven Dev** to use Chromium's Safe Storage Keychain item when first opening its browser, and again after a native rebuild changes its signature. Complete or deny that protected system prompt yourself; the browser may wait until you do. If you already have a stable Developer ID signing identity in your login Keychain, set `AVEN_DEV_SIGNING_IDENTITY` to its name in your local configuration. The runner uses it for the complete bundle. It does not create a certificate, change Keychain permissions, disable encryption, or weaken the Chromium sandbox.

## Check and update

Run `npm run check:web` and the relevant native tests. Verify the changed flow in Aven Dev, then build a release with `./scripts/with-dev-env.sh ./scripts/build-release.sh`. This creates a complete candidate under `target/releases/`; it never replaces or restarts your daily app. See [RELEASING.md](RELEASING.md) for release and updater signing. Install a tested release only after saving work and quitting the daily app normally.

## Agent instructions and tools

Repository instructions live in [AGENTS.md](../AGENTS.md). Keep changes scoped, preserve other tasks' work, and use the supplied in-app browser connection for ordinary previews. Skills are reusable instructions, not permission grants. Inspect installed skills and optional desktop tool readiness in **Settings → Skills & Tools**. Desktop control still requires macOS permissions and an installed supported tool; browser inspection can use Aven's built-in scoped browser without that desktop tool.
