# Aven: the facts of this project

Every mode reads this file first. What a run learns that the next run needs is added here, in the part it belongs to, as one plain sentence with the date. The repository's own documents are the longer source: `AGENTS.md`, `DESIGN.md`, `docs/DEVELOPMENT.md` (Aven Dev, the real-app check, the speed test), `docs/RELEASING.md`, `docs/CHROMIUM.md`, `.github/CONTRIBUTING.md`.

## What it is

Aven is a desktop workspace for coding agents: React and TypeScript in `src/`, Rust and Tauri in `src-tauri/`. The Mac app embeds Chromium (CEF) for its browser; Windows uses WebView2. It began from MonoCode (MIT) and is kept apart from it; `docs/UPSTREAM.md` records what was ported. `src/chrome/` holds the sidebar, title bar, message box, tabs and pickers; `src/surfaces/` the chats, browser panes, editors, diffs, terminals, Notes and Inbox; `src/hooks/` stateful hooks; `src/lib/` logic, with the provider adapters in `src/lib/harness/`; `src-tauri/src/` windows, processes, files, Git and storage; `src-tauri/chromium/` the Chromium bridge; `scripts/` build, release, packaging and check tools.

- The installed app: `/Applications/Aven.app`, bundle id `com.capi.monocode.personal` (an older name, kept for the person's data). Never quit, replace or restart it.
- The development app: **Aven Dev**, bundle id `com.capi.aven.dev`, with its own chats, settings and Chromium profile.
- The version is in `package.json`, `Cargo.toml` and the Tauri config; `npm run set-version -- <version>` changes them together.

## Where the work is

- The main checkout is `~/Developer/Aven`, on `main`. It is often behind GitHub's `main`, it is not where work is done, and its `node_modules` has no `oxlint` and it has no `target/`. Release builds are made on GitHub, not here.
- A session works in the work tree the app made for it (under `.claude/worktrees/`) or in one it makes: `git -C ~/Developer/Aven worktree add ~/Developer/.worktrees/Aven/<short-name> -b <type>/<short-name> origin/main` after `git -C ~/Developer/Aven fetch origin main`. Branch names in use: `fix/…`, `feat/…`, `release/<version>`.
- A fresh work tree needs `npm ci` (or a link to the main checkout's `node_modules`, which then has no `oxlint`; `scripts/checks` borrows one from another work tree). `cargo` is not on the plain shell path: run it through `./scripts/with-dev-env.sh cargo …`. A first native build takes long; `cp -cR` of another work tree's `target/` (an APFS clone) saves it, but Aven Dev checks run only in the work tree that built them (a copied `target/chromium` breaks CMake's cache).
- Scratch files, evidence and records of a run: `~/Developer/.worktrees/Aven/scratch/aven-skill/<date>-<mode>/`. The sweep's ledger is kept there too.

## Accounts

- Personal GitHub: the command `ghp`; the user it must report is `capi-git`. Never bare `gh`, never `ghw` (the work account).
- `origin` is `git@github-personal:capi-git/aven.git`, the public repository. Its default branch is `main`; only squash merges are allowed and a merged branch is deleted on GitHub by itself; auto-merge is off.
- Preflight before any push, merge or workflow run: `git remote get-url origin` shows the address above, and `ghp api user --jq .login` prints `capi-git`. Stop on any other answer; do not repair it by switching an account for the whole Mac. `scripts/release-check` runs both.
- Issues and pull requests on capi-git/aven are public. Sweep findings are not filed there (the person chose a local ledger on 2026-11-12).

## Checks

`scripts/checks <set>` runs these with the traps handled; `--dry-run` prints them. Run what the change touched (the person's rule: the touched checks, the complete set only for a big change).

| Set | Commands | Where else it runs |
| --- | --- | --- |
| `changed` | Prettier and oxlint on the changed frontend files, Vitest on the tests named after them, `tsc --noEmit`; `cargo fmt --check` when Rust changed; `scripts/test-<name>.py` for a changed script | — |
| `web` | `npm run check:web`: Prettier, oxlint, every Vitest test, `tsc --noEmit` | pull request check `frontend` (Node 22, Linux) |
| `tooling` | `npm run check:tooling`: the packaging, release and runner tests | pull request check `frontend` |
| `native` | `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets --no-default-features -- -D warnings`, `cargo test --locked --workspace --no-default-features` (the WebKit build, no CEF) | pull request checks `native` (macOS) and `native-windows` |
| `native-release` | the same tests with `--release` | the release's Windows job |
| `rust` | `npm run check:rust` (the Chromium build; needs `CEF_ROOT`) | the release build |
| `app` | the window gate, then `npm run check:app` | the release's `real-app-check` job; never on a pull request |
| `steps` | lists the real-app check's steps | — |

Traps:

- The pull request checks run Node 22, where Vitest has a working `localStorage`; this Mac's newer Node does not. A test that writes storage can pass here and leak between tests there: stub `localStorage` per test.
- A local clippy run of the Chromium build misses faults of the `--no-default-features` build that the pull request checks. Run `checks native` before saying a Rust change is green.
- A native test that depends on `debug_assertions` passes the pull request and fails in the release's Windows job, which tests with `--release`. Run `checks native-release` for a new native test.
- A new Rust crate, even for tests only, needs the regenerated `THIRD_PARTY_NOTICES.txt` in the same change (`scripts/generate-third-party-notices.py`), or the release's checks fail.
- Format touched frontend files with Prettier; keep a formatting-only change apart from a change of behaviour.
- Tests are named after their module: `Name.test.ts` or `Name.topic.test.ts`, beside it.

## The window gate

The real-app check, the speed test and the iPhone check open Aven Dev in a throwaway profile and keep its window above every other window, on every Space, for minutes; `npm run dev:app` opens a visible window too. A locked screen, a person who uses the Mac, or a second preview make them fail for reasons that are not in the code, and the window sits on top of the person's work.

`scripts/window-gate` exits 0 only when: the screen is unlocked and the login window is not in front; no Aven Dev and no other `dev-aven.py` run is on; the preview port (1420, or `AVEN_DEV_PORT`) is free; nobody used the Mac in the last two minutes; and Rune's call check (when Rune's skill is on this Mac) says no call is on. Aven has no call check of its own. When the gate is busy, wait with one background command, `scripts/window-gate --wait`, and end the turn in a line that names it. Never a loop of your own. The person can say for one run that a window on top of their work is fine: `--allow-active`. That never covers a call.

## Aven Dev and the real-app check

- `npm run dev:doctor` checks the tools without building (it needs `CEF_ROOT` from `~/.config/aven/development.env`, which `scripts/with-dev-env.sh` loads). `npm run dev:app` builds Aven Dev with its Chromium and opens it; `-- --build-only` builds without opening. Quit Aven Dev from its own window before a native rebuild. `AVEN_DEV_PORT=1421` runs a second checkout beside one that holds 1420.
- `npm run check:app` builds Aven Dev and runs the real-app check once, in a throwaway home, with stand-in agents (`scripts/smoke/fake-claude.py`, `fake-grok.py`) that answer `AVEN_SMOKE_*` markers in messages; nothing reaches a provider. It runs every step (`scripts/checks steps` lists them; there are no subsets), retries once on a failure with a fresh app, prints each step with its time, and copies the run's logs to `target/smoke/`. `--keep-smoke-folder` keeps the throwaway folder (`aven-smoke-*` in the temporary folder).
- Its failures that are not the code: a locked screen or the login window in front ("covered" windows), a person who used the Mac during a real-pointer step, a runner with no Mac free (rerun), and timing on a loaded runner. Read the step's own words and its times against an earlier run before you blame a change.
- When a change moves a control that a step presses, the step changes with it in the same change (`src/hooks/useDevSmoke.ts`, `src/lib/devSmoke*.ts`); a pull request does not run the check, so the first run to see it is the release's.
- `npm run perf:app` is the speed test (production interface, throwaway profile). `-- --perf-only <names>` runs some scenarios; `-- --perf-compare <file>` compares with a saved run in `target/perf/`. Compare like with like, back to back; a `--perf-only` run reads lower than a full run. `npm run check:iphone` checks the iPhone pane on a throwaway simulator it makes and deletes.
- `AVEN_DEV_CURSOR_PREVIEW`, `AVEN_DEV_PRESENCE_PREVIEW` and `AVEN_DEV_DESKTOP_SELF_TEST` are opt-in previews and native input checks (`docs/DEVELOPMENT.md`); the live accessibility and simulator tests are `cargo test … -- --ignored` behind `AVEN_AX_LIVE=1` and `AVEN_IOS_SIM_LIVE=1`.

## Rendered checks without Aven Dev

- The frontend alone: Vite in the Browser pane. It has no native features: anything that calls the app's Rust side does not answer there. `npm run dev` holds port 1420 with a strict port, the port Aven Dev's runner uses, so start it on another port (`npx vite --port 1431 --strictPort`, through a `.claude/launch.json` entry of the work tree). The `dev` entry in the main checkout's `.claude/launch.json` names port 5173, which Vite does not use (seen 2026-11-12).
- A rendered harness: the person's scratch folders hold harnesses that draw real components with the app's styles (`~/Developer/.worktrees/Aven/scratch/business-mocks/harness`, a Vite root for the Browser pane, and `scratch/mark-colours/webkit`, a static render loaded in an off-screen WebKit view). They are outside the repository and may change; read their files before use. Say in the report that Aven Dev itself was not looked at.

## Evidence Aven keeps

- The installed app's data: `~/Library/Application Support/com.capi.monocode.personal/` (the database `monocode.db`, browser data, races, checkpoints). Read the database with `sqlite3 -readonly` only; show counts and times, never chat text, project names or paths.
- Aven Dev's data: `~/Library/Application Support/com.capi.aven.dev/`. The development tools: `~/Library/Application Support/Aven Development/`.
- The real-app check: `target/smoke/` in the work tree that ran it (the app's log, the result, the stand-ins' logs); the release workflow uploads it when the check fails. The speed test: `target/perf/`.
- A release run: `ghp run view <id> --repo capi-git/aven --log-failed`, and its artifacts.

## Release, in short

Releases are batched: feature pull requests merge into `main`; a `release/<version>` pull request sets the version and writes the `CHANGELOG.md` entry; then the **Release Aven** workflow, started with `ghp workflow run release.yml …`, builds the Mac app (Developer ID signed and notarized) and the Windows installer from `main`, runs the real-app check, and publishes `v<version>` with the update feed. Every installed Aven then downloads it and offers Restart to update. `references/release.md` has the steps; `scripts/release-check` reads the state and prints the publish command.

## What Aven lacks next to Rune

- No install on this Mac. Rune installs a local bundle; Aven reaches the person's Mac only as a published release that they restart into. A local candidate (`scripts/with-dev-env.sh scripts/build-release.sh`, into `target/releases/`) can be built, but this skill never installs it.
- No in-app self-test with groups. The real-app check runs all its steps; Vitest and Rust tests carry the rest.
- No hidden-page tools (Rune's `wkshot`, `wkdrive`, `pngdiff`). The real-app check's test mouse, the Browser pane and the person's rendered harnesses take their place.
- No call check of its own: the window gate borrows Rune's when it is here.
- No private repository: findings go to a local ledger, and every push is public. No separate public line either: `main` is public, so `scripts/public-scan` runs before every push, not only before a release.
- No local notarize step: the release workflow signs and notarizes on GitHub.

## What costs something

- A release run takes about 25 minutes of a GitHub Mac runner and sends the app to Apple; a published release reaches every installed Aven within a day. A candidate run (`-f publish=false`) builds and checks without publishing.
- A real provider turn (Claude Code, Codex of the person) costs their plan's use; the checks use stand-ins, and a live turn runs only when the notes ask.
- The repository's Actions cache has a limit of 10 GB; leave the cache settings of the workflows alone.

## Traps of the shell and the tools

- zsh: an unmatched glob is an error; quote `--include=*.ts`; a word that starts with `=` is a command lookup; `$T:refs/...` applies the `:r` modifier, so write `${T}:refs/...`.
- The harness refuses `rm -rf $VAR/...`; use literal paths. `sed -i ''` (BSD).
- Each Bash call starts with its own absolute `cd`; the main checkout and the work trees are different folders with the same file names.
- A background command wakes the session when it ends; do not poll its output. A pull request's checks are read with the app's pull request tools when they are there (bind the pull request first), else once with `ghp pr checks <n> --repo capi-git/aven --watch` in the background.
