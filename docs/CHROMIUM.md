# Building Aven with Chromium

Aven uses a Tauri interface and an embedded Chromium runtime for browser tabs on macOS. Browser views and their helper processes must be packaged with the app; a plain Tauri bundle is not a complete release. The first public build targets Apple Silicon Macs running macOS 13 or later.

## Prerequisites

- An Apple Silicon Mac running macOS 13 or later natively, with Xcode Command Line Tools.
- Node.js 22 or newer and npm.
- A current stable Rust toolchain, including Cargo.
- Python 3.9 or newer, CMake 3.21 or newer, and Ninja.
- The verified CEF distribution below. Keep the full extracted SDK until building is complete.

The build uses macOS tools including `clang`, `codesign`, `ditto`, and `lipo`. Install missing prerequisites before running the release script. The pinned CEF framework declares macOS 13 as its minimum; the host and helper metadata use the same minimum. This is a build requirement, not evidence of testing on every macOS version.

## Pinned engine

| Component | Pin |
| --- | --- |
| CEF | `152.0.6+g708dc14+chromium-152.0.7977.83` |
| Chromium | `152.0.7977.83` |
| Distribution | `macosarm64_minimal` |
| Archive SHA-256 | `b0f277f1025dcedd690f59dfe3d1ec5e2f7f90564d0e5de997e6fc3c1febfa48` |
| Original framework SHA-256 | `f3edb1933329befbd09f03d05b15c49f0688d28ed81257d7931a5fded925ee8c` |

Download from the [CEF distribution service](https://cef-builds.spotifycdn.com/cef_binary_152.0.6+g708dc14+chromium-152.0.7977.83_macosarm64_minimal.tar.bz2), verify the archive before extraction, then set `CEF_ROOT`. From the repository root:

```bash
set -euo pipefail
task_cef_name='cef_binary_152.0.6+g708dc14+chromium-152.0.7977.83_macosarm64_minimal'
task_cef_downloads="$PWD/target/cef-sdk"
mkdir -p "$task_cef_downloads"
task_cef_archive="$task_cef_downloads/$task_cef_name.tar.bz2"
curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
  "https://cef-builds.spotifycdn.com/$task_cef_name.tar.bz2" \
  --output "$task_cef_archive"
printf '%s  %s\n' \
  b0f277f1025dcedd690f59dfe3d1ec5e2f7f90564d0e5de997e6fc3c1febfa48 \
  "$task_cef_archive" | shasum -a 256 -c -
tar -xjf "$task_cef_archive" -C "$task_cef_downloads"
export CEF_ROOT="$task_cef_downloads/$task_cef_name"
```

The release script verifies the extracted CEF header and original framework binary against its pins before compilation. The packager verifies them again before creating the final bundle. Do not substitute a different SDK without updating and reviewing all pins together.

## Build a release candidate

With the verified `CEF_ROOT` exported:

```bash
./scripts/build-release.sh
```

The script installs JavaScript dependencies using `npm ci`, builds the Chromium wrapper and helper, runs frontend checks and locked native tests, builds the host app with the locked Cargo dependencies, generates third-party notices, and packages the complete app. It signs the final bundle ad-hoc and verifies its signature, then creates a ZIP and checksums.

Outputs are in `target/releases/v<version>/`:

- `Aven-<version>-macos-arm64.zip`
- `LICENSE`
- `NOTICE`
- `THIRD_PARTY_NOTICES.txt`
- `SHA256SUMS`

The unpackaged/intermediate host app is not a release artifact. Use the ZIP produced after successful packaging. The final app is also available at `target/release/bundle/macos/Aven.app`; packaging diagnostics stay beside it and may contain local filesystem paths, so they are not part of the public artifacts.

The script never installs, launches, stops, or publishes an app. It requires the checkout's `target/` directory for Rust output; unset a custom `CARGO_TARGET_DIR` or `CARGO_BUILD_TARGET` before running it. A candidate app must be closed before rebuilding it.

Optional environment settings:

| Variable | Meaning |
| --- | --- |
| `CEF_BUILD_DIR` | Native wrapper output; defaults to `target/chromium`. Export it for direct Cargo or Tauri commands. |
| `CEF_JOBS` | Parallel wrapper build jobs; defaults to 4. |
| `CARGO_BUILD_JOBS` | Parallel Rust build jobs; defaults to 4. |
| `CMAKE`, `NINJA` | Build-tool commands or absolute executable paths. |
| `AVEN_SKIP_NPM_CI=1` | Reuse dependencies already installed with `npm ci`. Use only when they match the current lockfile. |

`scripts/build-personal.sh` is a compatibility entry point for the same release pipeline.

## Development and focused checks

Build the wrapper first and keep `CEF_BUILD_DIR` exported for Rust to find it:

```bash
npm ci
export CEF_BUILD_DIR="$PWD/target/chromium"
./scripts/build-chromium.sh
npm run check:web
cargo test --locked -p monocode --lib
npm run tauri -- dev
```

A development window is useful for interface work. Check final browser, helper, signing, and restart behavior in the packaged Chromium app before distributing a release. `npm run dev` by itself serves the frontend and does not supply the native desktop APIs.

## Signing and runtime behavior

The packager adds the complete CEF framework, helper applications, CEF licenses and credits, and Aven's project and dependency notices. It signs nested native code before the host app, then runs strict signature verification. Some internal helper and executable identifiers retain compatibility names; the app is presented as Aven.

Ad-hoc signing has no Apple Developer Team ID. The package uses a scoped library-validation entitlement for its bundled framework; it does not change global macOS security settings. Renderer and GPU helpers receive the JIT entitlement required by Chromium. The CEF sandbox remains enabled. No remote-debugging, mock-keychain, or no-sandbox workaround is part of the build.

Notarization is a separate process and is not performed by these scripts. See [RELEASING.md](RELEASING.md) for the release boundary and the future Developer ID path.

## Browser data and maintenance

Chromium keeps browser data under the app's data directory in `browser/chromium`. Local workspace profiles organize the interface and projects; they do not switch or isolate external accounts. Configure GitHub project accounts as described in [GITHUB-ACCOUNTS.md](GITHUB-ACCOUNTS.md).

Embedded Chromium does not include every Chrome service, extension, DRM provider, or website integration. Test the sites and interactions important to the release, including normal quit and restart.

Chromium does not update itself in Aven. An engine update requires reviewing an official CEF release, verifying its archive, updating the version and hashes in the packager, workflow, and this guide, rebuilding, and running native browser checks. Ship the complete runtime and its license notices with each build.
