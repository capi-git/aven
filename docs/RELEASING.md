# Releasing Aven

Regular Aven releases include Apple Silicon Macs running macOS 13 or later and Windows x64. The macOS release build requires Developer ID signing with the team and bundle identity in `scripts/release-signing.json`; it never silently falls back to ad-hoc signing. When Apple notarization credentials are supplied, the same script also notarizes and staples the app; see [Notarization](#notarization). Published macOS builds through 0.1.107 were ad-hoc signed. From 0.1.80 onward, Aven on macOS checks this repository's release feed and downloads cryptographically signed updates automatically; users choose when to restart. Windows x64 installers are regular release downloads built from the same commit. They are unsigned and require manual updates; no Windows Authenticode certificate or Windows updater is configured. Linux and Intel Mac release builds are not currently provided or verified.

## Prepare a candidate

1. Review the changes and confirm that the checkout contains only material intended for the public repository. Do not include credentials, saved sessions, private project data, build logs, or local inspection artifacts.
2. Set the release version with `npm run set-version -- <version>` and add the corresponding entry to `CHANGELOG.md`.
3. Follow [CHROMIUM.md](CHROMIUM.md) to obtain and verify the pinned CEF SDK and install prerequisites.
4. Run `./scripts/with-dev-env.sh ./scripts/build-release.sh`. Its preflight requires a valid Developer ID Application identity from the configured team. It runs frontend checks and native library tests, uses locked dependencies for the Rust build, generates third-party notices, and signs and verifies the complete app, including Chromium and its helpers. With notarization credentials it then notarizes and staples the app before creating any archive; without them it warns that the build is not notarized.

The script creates `target/releases/v<version>/` with the macOS app ZIP, the project license and notices, the aggregate dependency notices, `signing-verification.json`, and `SHA256SUMS`. It does not install or publish anything. Generated dependency notices may change when dependencies change; review and include the matching notice file in the source release.

The preflight selects the only valid Developer ID Application certificate from team `L54FM345MU`. If that team has multiple valid certificates, set `AVEN_RELEASE_SIGNING_IDENTITY` to the exact certificate name or SHA-1 fingerprint. An identity from another team is rejected. `AVEN_RELEASE_KEYCHAIN` optionally limits selection and signing to a specific keychain. Neither variable contains a private key. Private signing material stays in Keychain, never in the checkout.

Preserve the production identifier `com.capi.monocode.personal` and the existing helper identifiers. The verification step checks the signing team, stable designated requirements, secure timestamps, hardened runtime, and complete bundle integrity before archiving. Consistent signing allows macOS to recognize future versions as the same app. It does not grant Accessibility or Screen Recording, and moving from an older ad-hoc build may require a new user approval. Built-in desktop control requests access as Aven when the user turns it on in **Settings → Skills & tools**. Check the Desktop control status there; an enabled Aven entry in macOS Privacy & Security may still hold an obsolete ad-hoc code requirement and need approval again after installing the signed build.

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

## Release from GitHub Actions

Releases go through one manually started workflow, **Release Aven** (`.github/workflows/release.yml`). Start it from the repository's Actions tab or from the **Release** card in Aven's Changes panel. It builds whatever is on GitHub's `main`, so merge and push first.

The Release card confirms the version at the remote source revision and passes both to the workflow. If that revision changes before the run starts, the workflow stops before building. Refresh the card and review the new version before trying again; a local version bump alone is not ready to publish.

1. Merge the changes for this release into `main` through pull requests.
2. On a release branch, run `npm run set-version -- <version>`, add the matching `CHANGELOG.md` entry, and merge that through a pull request too.
3. Run **Release Aven** with **Publish** selected. Leave **Windows** selected to include the Windows installer.

One run builds the macOS app and the Windows installer from the same commit. The macOS job uses `macos-15`, currently documented by GitHub as an arm64 runner, asserts the architecture, downloads and verifies the pinned CEF archive, and runs the same release script. See [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The Windows job reuses **Build Windows installer**: web checks, native Windows tests, an NSIS installer, and an install-and-launch check on a Windows runner.

Without **Publish**, the run uploads **Aven-macos-arm64-candidate** and **Aven-windows-x64** as workflow artifacts for review and publishes nothing. With **Publish**, the macOS job also signs the complete update archive with the repository's `TAURI_SIGNING_PRIVATE_KEY` secret (and optional password secret). A separate publishing job, the only one with repository write permission, then creates a single `v<version>` release:

- The Developer ID signed macOS ZIP, `.app.tar.gz`, `.sig` and `latest.json` are the stable download and update. The release is marked latest.
- `Aven-<version>-windows-x64.zip` and the setup `.exe` are attached as regular Windows release downloads. The installer is unsigned; Windows may show an unknown-publisher warning. The ZIP keeps its own payload checksums. Windows builds have automatic updates disabled, and `latest.json` only describes macOS.
- The release `SHA256SUMS` covers every attached file.

Publishing waits for every requested platform and refuses missing or mismatched Windows artifacts when **Windows** was selected. If the Windows job fails, rerun it or run the release again without **Windows**; that explicitly creates a macOS-only release, with no Windows download on the latest release page. The version must not already exist; the workflow refuses to reuse a tag or continue when it cannot check the remote tag. Workflow artifacts expire; GitHub Releases is the public distribution channel. Do not upload build logs, runner screenshots, or smoke JSON as release assets; they may contain local paths. The Windows startup evidence stays in the workflow's diagnostic artifacts.

Three optional secrets, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER_ID`, turn on notarization; see [Notarization](#notarization). Without them, candidates and published releases are signed but not notarized, the run shows a warning, and the release notes say so.

Every macOS run requires two GitHub Actions secrets: `APPLE_DEVELOPER_ID_P12_BASE64`, containing an encrypted PKCS#12 export of the intended Developer ID identity, and `APPLE_DEVELOPER_ID_P12_PASSWORD`. These are independent of the Tauri updater key. Missing or invalid Apple signing secrets stop the build before compiling. Import uses a temporary runner keychain, restricts signing to the configured team, and deletes the decoded certificate archive and temporary keychain. The helper temporarily adds that keychain to the disposable runner's search list so macOS can resolve the certificate chain, then restores the original ordered list during cleanup. It never changes the default keychain or existing keys. Do not put the certificate export, passwords, or Keychain files in logs or workflow artifacts. The publish job also requires the checksummed Developer ID verification report; an ad-hoc candidate cannot be published through this workflow.

The README's download links point at `releases/latest`, so a release needs no follow-up commit. Use the verified personal GitHub account for this repository (`ghp` locally), as required by the account-routing instructions, and inspect the remote and account identity immediately before publishing.

The separate frontend CI runs on pull requests and main-branch pushes with Node.js 22. It does not replace the release build or native interaction checks.

## Windows candidates without publishing

Run **Build Windows installer** from the Actions tab to check a branch on Windows without releasing. It produces the same **Aven-windows-x64** package and startup evidence as artifacts and publishes nothing. Releases through 0.1.106 published Windows builds separately as `v<version>-windows-test.N` prereleases. Versions 0.1.107–0.1.109 attached packages labeled as Windows test downloads to the main release. From 0.1.110, Windows installers and ZIPs use regular release names without the test suffix. See [WINDOWS.md](WINDOWS.md) for installation, source-build commands, and feature limitations.

## Publish manually

After reviewing the exact candidate:

1. Create a version tag and a release in [capi-git/aven](https://github.com/capi-git/aven/releases) for the source revision that produced it.
2. Attach the versioned macOS ZIP, signed `.app.tar.gz`, `.sig`, `latest.json`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, `signing-verification.json`, and `SHA256SUMS` from that candidate's release directory. Include the Windows ZIP and setup `.exe` from the same source revision, verify their package checksums, and include both in the release checksums. Keep `latest.json` macOS-only. Mark the release as latest so the configured `/releases/latest/download/latest.json` endpoint resolves.
3. Include the tested environment, changes, known limitations, and the actual signing and notarization status in the release notes. A Developer ID signature alone is not notarization. Explain background download and user-controlled restart.
4. Download the uploaded ZIP, compare its checksum with the reviewed candidate, and confirm its contents before directing users to it.

Do not publish packaging logs or receipts containing developer-local paths. Keep the project's MIT attribution and all bundled third-party notices. The ZIP is the distributable app; GitHub's automatically generated source archive is for building from source.

macOS users on versions before 0.1.80 need one manual replacement. Later macOS versions download updates in the background and show **Restart to update**. Restart preparation blocks active/queued tasks, extra app windows, and terminal work. A failed preparation always leaves update mode, restoring any tab it can. The Chromium updater saves chat drafts, workspace state, and browser tab addresses/order/selection, then closes pages for restart and reopens them afterwards. Restored browser tabs load their saved addresses; this does not serialize a website's in-memory state, form contents, or navigation history. From 0.1.102, page state no longer holds an update: open dialogs, popups, filled forms and before-unload warnings are closed with the page. Only a download in progress keeps the update ready, together with active or queued tasks, extra app windows, detached browser tabs and terminal work. A persistence failure must leave the app running without installing the update. The WebKit fallback still requires manually closing browser pages.

For browser restart changes, verify ordinary tabs across workspaces return after restart, the latest navigated address is saved, a failed save closes no pages, a download in progress still holds the update, and a failed installation makes already closed tabs usable again. Keep native browser interaction and actual restart coverage separate from mocked lifecycle tests. Versions through 0.1.98 still require manually closing browser tabs to install the first release containing this flow (0.1.99).

A downloaded app without notarization may require an explicit opening approval in macOS **Privacy & Security**. Never instruct users to disable Gatekeeper or other system protections globally.

Verify the published archive against its signature with the configured public key and perform an actual older-to-newer update before claiming end-to-end upgrade coverage. Keep failed-signature and busy-work refusal checks separate from actual installation evidence. Automatic model discovery does not require publishing an Aven release; it uses each installed provider's model list and preserves the existing list on failures.

## Notarization

Notarization lets a downloaded Aven open normally instead of showing macOS's "Apple could not verify" warning. When credentials are supplied, the release script submits the final signed Chromium app to Apple and waits up to 45 minutes for the result. It then staples the ticket to the app and checks it with `xcrun stapler validate` and `spctl` before it creates the ZIP and the updater archive, so both carry the ticket. If Apple rejects the submission, the script prints Apple's notarization log and stops; nothing is packaged.

`signing-verification.json` records the result under `notarization`: whether the app is notarized, Apple's submission ID, and the stapling and Gatekeeper checks. The publish job reads it to choose the release notes, and refuses an incomplete record.

Without credentials, the build is still Developer ID signed. The script and workflow warn that it is not notarized, the report records `"notarized": false`, and the published release notes tell Mac users they may need to approve opening the app in **Privacy & Security**. Supplying only some of the three API key values stops the build before compiling. `--ad-hoc` builds are never notarized and refuse notarization credentials.

### Create the App Store Connect API key

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com) with an Apple Account that is Account Holder or Admin for team `L54FM345MU`.
2. Open **Users and Access → Integrations → App Store Connect API → Team Keys**. If this is the team's first key, request API access first.
3. Generate a key with a recognizable name, such as "Aven notarization", and the **Developer** role. That role is enough for notarization.
4. Download the `.p8` file. Apple allows only one download, so store it in a password manager or another safe place outside the repository.
5. Note the **Key ID** shown beside the key and the **Issuer ID** shown above the key list.

If the key is ever exposed, revoke it on the same page and create a new one.

### Add the GitHub secrets

Use the personal GitHub CLI wrapper `ghp`, never bare `gh`, and confirm the account before writing secrets:

```bash
ghp api user --jq .login   # must print capi-git
base64 -i /path/to/AuthKey_<KEY_ID>.p8 | ghp secret set APPLE_API_KEY_P8_BASE64 --repo capi-git/aven
ghp secret set APPLE_API_KEY_ID --repo capi-git/aven      # paste the Key ID when asked
ghp secret set APPLE_API_ISSUER_ID --repo capi-git/aven   # paste the Issuer ID when asked
```

Then run **Release Aven** without **Publish** and check that the candidate's `signing-verification.json` shows `"notarized": true`.

The build step hides these values from dependency installation, tests and compilation; only the notarization helper receives them. The decoded `.p8` file exists only in a private folder in the runner's temporary directory while Apple processes the submission, and an always-run cleanup step removes it again. It is never written to the checkout or to workflow artifacts.

### Notarize a local build

Either export the same three variables (create the first with `base64 -i AuthKey_<KEY_ID>.p8`), or store the key once in your Keychain and name that profile:

```bash
xcrun notarytool store-credentials aven-notary \
  --key /path/to/AuthKey_<KEY_ID>.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>
AVEN_NOTARY_KEYCHAIN_PROFILE=aven-notary ./scripts/with-dev-env.sh ./scripts/build-release.sh
```

Without either, the script prints that the build is Developer ID signed but not notarized. To check a finished app, run `python3 scripts/check-macos-release.py --app target/release/bundle/macos/Aven.app`; it reports the stapled ticket and the Gatekeeper result separately from signing. Still verify the downloaded release on another Mac. The Aven-owned updater feed and its signing key are independent of the Apple Developer certificate and of notarization.
