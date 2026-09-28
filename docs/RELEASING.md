# Releasing Aven

Stable Aven releases target Apple Silicon Macs running macOS 13 or later. The release build now requires Developer ID signing with the team and bundle identity in `scripts/release-signing.json`; it never silently falls back to ad-hoc signing. Apple notarization is a separate step and is not yet part of this script. Published macOS builds through 0.1.107 were ad-hoc signed. From 0.1.80 onward, Aven checks this repository's release feed and downloads cryptographically signed updates automatically; users choose when to restart. Windows x64 test builds are published separately as prereleases. Linux and Intel Mac release builds are not currently provided or verified.

## Prepare a candidate

1. Review the changes and confirm that the checkout contains only material intended for the public repository. Do not include credentials, saved sessions, private project data, build logs, or local inspection artifacts.
2. Set the release version with `npm run set-version -- <version>` and add the corresponding entry to `CHANGELOG.md`.
3. Follow [CHROMIUM.md](CHROMIUM.md) to obtain and verify the pinned CEF SDK and install prerequisites.
4. Run `./scripts/with-dev-env.sh ./scripts/build-release.sh`. Its preflight requires a valid Developer ID Application identity from the configured team. It runs frontend checks and native library tests, uses locked dependencies for the Rust build, generates third-party notices, and signs and verifies the complete app, including Chromium and its helpers.

The script creates `target/releases/v<version>/` with the macOS app ZIP, the project license and notices, the aggregate dependency notices, `signing-verification.json`, and `SHA256SUMS`. It does not install or publish anything. Generated dependency notices may change when dependencies change; review and include the matching notice file in the source release.

The preflight selects the only valid Developer ID Application certificate from team `L54FM345MU`. If that team has multiple valid certificates, set `AVEN_RELEASE_SIGNING_IDENTITY` to the exact certificate name or SHA-1 fingerprint. An identity from another team is rejected. `AVEN_RELEASE_KEYCHAIN` optionally limits selection and signing to a specific keychain. Neither variable contains a private key. Private signing material stays in Keychain, never in the checkout.

Preserve the production identifier `com.capi.monocode.personal` and the existing helper identifiers. The verification step checks the signing team, stable designated requirements, secure timestamps, hardened runtime, and complete bundle integrity before archiving. Consistent signing allows macOS to recognize future versions as the same app. It does not grant Accessibility or Screen Recording, and moving from an older ad-hoc build may require a new user approval. macOS can attribute Peekaboo bridge requests to the responsible Aven app, so the bridge's executable identity alone does not determine which entry to enable in Privacy & Security. Check the live bridge status; an enabled Aven entry may still hold an obsolete ad-hoc code requirement and need approval again after installing the signed build.

For an explicitly disposable local test, `./scripts/build-release.sh --ad-hoc` writes only to `target/releases/ad-hoc/v<version>/`. It rejects updater-signing credentials and cannot be used by the release workflow. Use the separately identified Aven Dev app for normal development.

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

Every macOS workflow run requires two GitHub Actions secrets: `APPLE_DEVELOPER_ID_P12_BASE64`, containing an encrypted PKCS#12 export of the intended Developer ID identity, and `APPLE_DEVELOPER_ID_P12_PASSWORD`. These are independent of the Tauri updater key. Missing or invalid Apple signing secrets stop the build before compiling. Import uses a temporary runner keychain, restricts signing to the configured team, and deletes the decoded certificate archive and temporary keychain. The helper temporarily adds that keychain to the disposable runner's search list so macOS can resolve the certificate chain, then restores the original ordered list during cleanup. It never changes the default keychain or existing keys. Do not put the certificate export, passwords, or Keychain files in logs or workflow artifacts. The publish job also requires the checksummed Developer ID verification report; an ad-hoc candidate cannot be published through this workflow.

The separate frontend CI runs on pull requests and main-branch pushes with Node.js 22. It does not replace the macOS candidate build or native interaction checks.

## Publish a Windows test build

The **Build Windows test installer** workflow (`.github/workflows/windows-candidate.yml`) is available from the repository's Actions tab. Choose **Run workflow** and select the source branch to build. It runs web checks and native Windows tests, builds an NSIS installer, and installs and launches that installer on a Windows runner. It produces artifacts without publishing them.

To publish a successful run:

1. Download **Aven-windows-x64-test** and **Aven-windows-startup-evidence**. Confirm both jobs succeeded, inspect `windows-smoke-results.json` and the screenshot, and verify the package's `SHA256SUMS`.
2. Read the exact source commit appended to the package's `README.md`. Create a GitHub prerelease tag for that commit, such as `v0.1.103-windows-test.1`. Never attach the Windows binary to a macOS version tag that points to different source.
3. Package the complete `Aven-<version>-windows-x64-test` directory as a ZIP. Attach that ZIP, the setup `.exe`, `README.md`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, and a release-level `SHA256SUMS` covering all six assets. The ZIP retains its own payload checksums.
4. Mark the release **Prerelease**, and do not mark it as the latest stable release. The macOS updater uses the latest stable release; Windows test builds have automatic updates disabled.
5. State the exact source commit, successful workflow run, tested Windows runner, unsigned-installer status, and remaining manual checks in the release notes. Installation and startup checks do not establish provider authentication or interactive feature coverage.
6. Download the published assets and verify their checksums against the reviewed files. Update the Windows download link in the repository's README to the published prerelease.

Use the verified personal GitHub account for this repository (`ghp` locally), as required by the account-routing instructions. Inspect the remote and account identity immediately before publishing. Do not upload build logs, runner screenshots, or smoke JSON as distributable assets; they may contain local paths. Keep them in the workflow's diagnostic artifacts.

The current Windows test build is [Aven 0.1.106 Windows test 1](https://github.com/capi-git/aven/releases/tag/v0.1.106-windows-test.1). See [WINDOWS-TESTING.md](WINDOWS-TESTING.md) for installation, source-build commands, and feature limitations.

## Publish manually

After reviewing the exact candidate:

1. Create a version tag and a release in [capi-git/aven](https://github.com/capi-git/aven/releases) for the source revision that produced it.
2. Attach the versioned macOS ZIP, signed `.app.tar.gz`, `.sig`, `latest.json`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, `signing-verification.json`, and `SHA256SUMS` from that candidate's release directory. Mark it as the latest stable release so the configured `/releases/latest/download/latest.json` endpoint resolves.
3. Include the tested environment, changes, known limitations, and the actual signing and notarization status in the release notes. A Developer ID signature alone is not notarization. Explain background download and user-controlled restart.
4. Download the uploaded ZIP, compare its checksum with the reviewed candidate, and confirm its contents before directing users to it.

Do not publish packaging logs or receipts containing developer-local paths. Keep the project's MIT attribution and all bundled third-party notices. The ZIP is the distributable app; GitHub's automatically generated source archive is for building from source.

Users on versions before 0.1.80 need one manual replacement. Later versions download updates in the background and show **Restart to update**. Restart preparation blocks active/queued tasks, extra app windows, and terminal work. A failed preparation always leaves update mode, restoring any tab it can. The Chromium updater saves chat drafts, workspace state, and browser tab addresses/order/selection, then closes pages for restart and reopens them afterwards. Restored browser tabs load their saved addresses; this does not serialize a website's in-memory state, form contents, or navigation history. From 0.1.102, page state no longer holds an update: open dialogs, popups, filled forms and before-unload warnings are closed with the page. Only a download in progress keeps the update ready, together with active or queued tasks, extra app windows, detached browser tabs and terminal work. A persistence failure must leave the app running without installing the update. The WebKit fallback still requires manually closing browser pages.

For browser restart changes, verify ordinary tabs across workspaces return after restart, the latest navigated address is saved, a failed save closes no pages, a download in progress still holds the update, and a failed installation makes already closed tabs usable again. Keep native browser interaction and actual restart coverage separate from mocked lifecycle tests. Versions through 0.1.98 still require manually closing browser tabs to install the first release containing this flow (0.1.99).

A downloaded app without notarization may require an explicit opening approval in macOS **Privacy & Security**. Never instruct users to disable Gatekeeper or other system protections globally.

Verify the published archive against its signature with the configured public key and perform an actual older-to-newer update before claiming end-to-end upgrade coverage. Keep failed-signature and busy-work refusal checks separate from actual installation evidence. Automatic model discovery does not require publishing an Aven release; it uses each installed provider's model list and preserves the existing list on failures.

## Notarization

A Developer ID release still needs a separate notarization process for normal Gatekeeper distribution. Do not put private keys, certificates, passwords, or API credentials in the repository.

The release script passes the verified identity to the Chromium packager after building the host. Submit the final signed app archive to Apple's notarization service, wait for acceptance, staple and validate the ticket, and recreate the final ZIP and its checksum after stapling. Generate updater archives and their signatures only after that final change. Verify the downloaded release on another Mac.

The current script verifies Developer ID signing but does not submit to Apple or staple a ticket. Do not describe a candidate as notarized until those steps and validation pass. The Aven-owned updater feed and its signing key are independent of the Apple Developer certificate.
