# Releasing Aven

Aven releases target Apple Silicon Macs running macOS 13 or later. The app is ad-hoc signed and is not Apple-notarized. From 0.1.80 onward, Aven checks this repository's release feed and downloads cryptographically signed updates automatically; users choose when to restart. Windows, Linux, and Intel Mac release builds are not currently provided or verified.

## Prepare a candidate

1. Review the changes and confirm that the checkout contains only material intended for the public repository. Do not include credentials, saved sessions, private project data, build logs, or local inspection artifacts.
2. Set the release version with `npm run set-version -- <version>` and add the corresponding entry to `CHANGELOG.md`.
3. Follow [CHROMIUM.md](CHROMIUM.md) to obtain and verify the pinned CEF SDK and install prerequisites.
4. Run `./scripts/build-release.sh`. It runs frontend checks and native library tests, uses locked dependencies for the Rust build, generates third-party notices, and packages and verifies the complete signed app.

The script creates `target/releases/v<version>/` with the macOS app ZIP, the project license and notices, the aggregate dependency notices, and `SHA256SUMS`. It does not install or publish anything. Generated dependency notices may change when dependencies change; review and include the matching notice file in the source release.

To produce update artifacts, set `TAURI_SIGNING_PRIVATE_KEY_PATH` to the private Aven updater key outside the checkout (or supply `TAURI_SIGNING_PRIVATE_KEY` securely). `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional. The script signs the **final Chromium app**, producing `.app.tar.gz`, its `.sig`, and `latest.json`. Keep `bundle.createUpdaterArtifacts` false: Tauri's intermediate bundle is missing the final Chromium packaging. Never sign that intermediate bundle for delivery.

The public verification key is committed in `src-tauri/tauri.conf.json`. Keep the matching private key securely backed up; never commit or log it. Losing it prevents existing installations from verifying new updates. Key rotation requires a planned transition release. Updater signatures verify the update's publisher; they do not provide Apple notarization.

Run the checksum verification from the artifact directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Inspect the packaged app's signature:

```bash
codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/Aven.app
```

A passing signature check means the bundle is intact and signed consistently. It is not proof of notarization, Gatekeeper approval on another Mac, or correct app behavior.

## Verify the app people will receive

Extract the final ZIP and exercise that app before sharing it. At minimum, verify startup and restart, project opening, provider discovery, one real agent turn, approvals and queued messages, workspace switching, Notes and Inbox, browser navigation, tab movement, dropdowns, resizing, and attachments. Keep automated test results separate from physical interaction checks.

Check the download on a second Mac or clean macOS account when possible. In release notes, distinguish checks that ran from anything still unverified. Do not claim broad platform or website compatibility from one local launch.

## Build in GitHub Actions

The **Build macOS release candidate** workflow is started manually with `workflow_dispatch`. It uses `macos-15`, currently documented by GitHub as an arm64 runner, and asserts the architecture before building. It downloads the pinned CEF archive over HTTPS, verifies the fixed SHA-256, and runs the same release script. See [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

A normal run uploads **Aven-macos-arm64-candidate** as a workflow artifact and does not publish. For a reviewed source revision, select the **Publish** workflow input. The build then signs the complete archive using the repository's `TAURI_SIGNING_PRIVATE_KEY` secret (and optional password secret); a separate job creates a versioned stable GitHub release. Only that publishing job receives repository write permission. The version must not already exist. Workflow artifacts expire; GitHub Releases is the public distribution channel.

The separate frontend CI runs on pull requests and main-branch pushes with Node.js 22. It does not replace the macOS candidate build or native interaction checks.

## Publish manually

After reviewing the exact candidate:

1. Create a version tag and a release in [capi-git/aven](https://github.com/capi-git/aven/releases) for the source revision that produced it.
2. Attach the versioned macOS ZIP, signed `.app.tar.gz`, `.sig`, `latest.json`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, and `SHA256SUMS` from that candidate's release directory. Mark it as the latest stable release so the configured `/releases/latest/download/latest.json` endpoint resolves.
3. Include the tested environment, changes, known limitations, and the ad-hoc/not-notarized status in the release notes. Explain background download and user-controlled restart.
4. Download the uploaded ZIP, compare its checksum with the reviewed candidate, and confirm its contents before directing users to it.

Do not publish packaging logs or receipts containing developer-local paths. Keep the project's MIT attribution and all bundled third-party notices. The ZIP is the distributable app; GitHub's automatically generated source archive is for building from source.

Users on versions before 0.1.80 need one manual replacement. Later versions download updates in the background and show **Restart to update**. Restart preparation blocks active/queued tasks, extra app windows, and terminal work. The Chromium updater saves chat drafts, workspace state, and browser tab addresses/order/selection before automatically closing pages for restart. Restored browser tabs load their saved addresses; this does not serialize a website's in-memory state, form contents, or navigation history. Pages with possible unsaved edits or other unsafe activity keep the update ready until that work is saved or finished. The checks are conservative: filled forms, embedded frames, and complex editors can require attention even when the website has already saved its work. A persistence failure must leave the app running without installing the update. The WebKit fallback still requires manually closing browser pages.

For browser restart changes, verify ordinary tabs across workspaces return after restart, the latest navigated address is saved, a failed save closes no pages, unsaved forms and before-unload warnings prevent data loss, and a failed installation makes already closed tabs usable again. Keep native browser interaction and actual restart coverage separate from mocked lifecycle tests. Versions through 0.1.97 still require manually closing browser tabs to install the first release containing this flow.

A downloaded ad-hoc-signed app may require an explicit opening approval in macOS **Privacy & Security**. Never instruct users to disable Gatekeeper or other system protections globally.

Verify the published archive against its signature with the configured public key and perform an actual older-to-newer update before claiming end-to-end upgrade coverage. Keep failed-signature and busy-work refusal checks separate from actual installation evidence. Automatic model discovery does not require publishing an Aven release; it uses each installed provider's model list and preserves the existing list on failures.

## Future Developer ID and notarization

A Developer ID release needs a stable Apple Developer signing identity and a separate notarization process. Do not put private keys, certificates, passwords, or API credentials in the repository.

The Chromium packager accepts `--identity "Developer ID Application: …"` to sign the complete nested app consistently. Use it only after building the host and before archiving. Then submit the final signed app archive to Apple's notarization service, wait for acceptance, staple and validate the ticket, and recreate the final ZIP and its checksum after stapling. Verify the downloaded release on another Mac.

The current build script always produces the documented ad-hoc candidate. Adding notarized releases requires a reviewed build change; supplying a certificate to the current workflow alone does not enable that process. The Aven-owned updater feed and its signing key are independent of an Apple Developer certificate.
