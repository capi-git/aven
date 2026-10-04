# Aven for Windows

The Windows x64 installer is part of the regular [Aven release](https://github.com/capi-git/aven/releases/latest), built from the same source commit as the macOS app. It runs on Windows 10 or 11 and uses Microsoft WebView2 for the app and ordinary browser tabs. The installer can install WebView2 if it is missing; that step requires an internet connection.

## Install

1. Download the `Aven_<version>_x64-setup.exe` installer from the release, or download `Aven-<version>-windows-x64.zip` and extract it. The ZIP includes the same installer, licenses, and package checksums. [`Aven-windows-x64-setup.exe`](https://github.com/capi-git/aven/releases/latest/download/Aven-windows-x64-setup.exe) always downloads the latest installer.
2. Run the installer. It installs for your Windows user.
3. Open Aven and choose which providers you want to connect in the first-launch setup. Nothing is preselected or automatically installed. You can also open **Settings → Provider setup** later.
4. For Claude Code or Codex, review and explicitly run the offered installation or sign-in step, then complete the provider's prompts. Other providers link to their official guides. Select **Check again** after installation; reopen Aven if a custom PATH change is still not detected.
5. Choose a project folder, select a provider and model, and start a task. Aven does not include provider subscriptions. Local sign-in checks and an actual provider response are separate; see [Connect your providers](PROVIDER-SETUP.md).

The Windows installer is **unsigned**: it does not have an Authenticode publisher certificate. Windows SmartScreen may show an unknown-publisher warning when you first install it. Download only from this repository's releases and compare the file's SHA-256 with the release's `SHA256SUMS`. For example:

```powershell
Get-FileHash .\Aven_<version>_x64-setup.exe -Algorithm SHA256
```

A matching checksum verifies the downloaded file against the release; it is not a Windows publisher signature. No Windows signing certificate is configured in the current release workflow.

## Updates

Aven for Windows checks this repository's release feed and downloads signed updates in the background, the same way as on macOS. When an update is ready, choose **Restart to update** in the sidebar or in **Settings**. Aven does not interrupt running agents: it waits until tasks are finished, other Aven windows and browser tabs are closed, and it asks before closing open terminals. It saves your drafts and workspace, then a small installer progress window replaces Aven and reopens it.

Each update is checked against Aven's updater signing key before it can install. That check is separate from Authenticode, so it works even though the installer itself is unsigned. Updates install for your Windows user and need no administrator prompt.

Windows versions released before automatic updates were added need one manual update: download the newer installer from the release page, finish active work, close Aven, and run it. Later versions update themselves. If a release ships for macOS only, Windows simply reports that you are on the latest version.

## Available features and limitations

Windows includes agent conversations, projects and workspaces, the file editor, Git views, terminals, and ordinary WebView2 browser tabs.

Agent browser automation, browser screenshots and page annotation, grouped Picture in Picture, and built-in desktop computer use currently require macOS. Windows does not bundle Aven's macOS Chromium runtime. Windows ARM64, Linux, and Intel Mac release packages are not currently provided or verified.

Each Windows release goes through frontend checks, native Windows tests, installer creation, installation, and an app startup check on a Windows runner. Those automated checks do not cover installing an update over an older version, and do not establish that every provider sign-in, authenticated chat, or interactive browsing flow has been tested on a personal Windows computer.

The guided setup adds explicit provider selection, installation and sign-in actions. Its status checks do not establish that interactive provider installation, browser sign-in and a first authenticated task have been verified on a fresh Windows computer.

For a useful bug report, include the Aven version, Windows version, provider and CLI version, exact steps, and any error text. Do not include access tokens or private conversation contents.

## Build from source on Windows

Install Node.js 22 or later, stable Rust for `x86_64-pc-windows-msvc`, Python 3, and Visual Studio C++ Build Tools with the Windows SDK. Then run:

```powershell
npm ci
cargo fetch --locked --target x86_64-pc-windows-msvc
python scripts/generate-third-party-notices.py --target x86_64-pc-windows-msvc --npm-os win32 --npm-cpu x64
npm run build:windows
```

The installer is written under `target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

**Build Windows installer** (`.github/workflows/windows-candidate.yml`) runs the checks and launches the installed app on a disposable Windows runner. Running it on its own uploads an unpublished candidate and diagnostic artifacts. **Release Aven** reuses that workflow and publishes the regular Windows ZIP and installer alongside macOS after all requested platforms pass. Only a publishing release signs the installer as an update and adds it to `latest.json`; a standalone candidate is never offered as an update.
