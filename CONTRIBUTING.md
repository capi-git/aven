# Contributing to Aven

Bug reports, documentation improvements, and focused fixes are welcome. For a new feature, provider adapter, or substantial refactor, open an [issue](https://github.com/capi-git/aven/issues) first so we can agree on scope.

## Development setup

Start with [the Chromium build guide](docs/CHROMIUM.md), which describes the macOS development environment and the runtime packaging required for a complete release. Apple Silicon macOS is the initial release target; other platforms need their own build and interaction verification.

Install and sign in to an agent CLI to test real agent sessions. You can run frontend and protocol tests without authenticating to every provider. Never put provider credentials, personal sessions, or private project data in a commit or test fixture.

## Project layout

- `src/chrome/`: sidebar, title bar, composer, tabs, and pickers.
- `src/surfaces/`: conversations, browser panes, editors, diffs, terminals, Notes, and Inbox.
- `src/lib/harness/`: provider adapters and protocol translation.
- `src-tauri/src/`: native window behavior, processes, filesystem operations, Git, and local storage.
- `docs/`: build, release, and feature documentation.

## Check your change

Install dependencies with `npm ci`, then run the relevant checks:

```bash
npm run check:web
npm run check:rust
```

`check:web` runs Vitest and the TypeScript compiler. `check:rust` runs Rust formatting, Clippy, and native tests. `npm run check` runs both. Native checks require the Rust and platform prerequisites described in the build guide.

For UI changes, also exercise the affected interaction in a running app. For browser, window, focus, or drag-and-drop changes, check the Chromium build. Automated tests alone do not establish that native interactions work correctly.

## Pull requests

Keep changes focused and describe the problem, the resulting behavior, and how you verified it. Include a screenshot for visible changes. Mention any checks you could not run rather than presenting them as passed.

Do not include generated release bundles, local build caches, logs containing personal data, credentials, or unrelated formatting changes. Preserve third-party copyright and license notices. Contributions are made under the repository's [MIT license](LICENSE).

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations and [SECURITY.md](SECURITY.md) for private vulnerability reporting.
