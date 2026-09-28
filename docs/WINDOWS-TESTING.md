# Aven Windows test build

This is an early Windows x64 build for testing on Windows 10 or 11. It uses the
Windows WebView2 runtime. The installer can install that runtime if it is missing;
an internet connection is required for that step.

## Install and try it

1. Run the included `Aven_*_x64-setup.exe` installer. It installs for your user.
2. Open Aven and choose a project folder, preferably a disposable Git repository
   for your first test.
3. Install and sign in to the provider CLI you want to use, then restart Aven so
   it sees any PATH changes. Aven does not include provider subscriptions.
4. Start a chat, check that the terminal runs a command, open and edit a file,
   review its Git diff, and open a website in the browser pane.
5. Close and reopen Aven to check that the workspace and conversation persist.

The test installer is not signed with a Windows publisher certificate. Windows
may show an unknown-publisher warning. Verify that the file came from the person
who supplied this test package and compare its SHA-256 with `SHA256SUMS`.

## Known limitations

- Agent browser automation, browser screenshots, and grouped Picture in Picture
  are currently macOS features. Ordinary Windows browser tabs use WebView2.
- Automatic updates are disabled for this test build. Install a newer Windows
  test installer manually when one is provided.
- The automated build checks native tests, installation, and app startup. Actual
  provider sign-in, authenticated chats, and interactive browsing still need a
  Windows tester.

For a useful bug report, include the app version, Windows version, provider and
CLI version, exact steps, and any error text. Do not include access tokens or
private conversation contents.

## Build from source on Windows

Install Node.js 22 or later, stable Rust for `x86_64-pc-windows-msvc`, Python 3,
and Visual Studio C++ Build Tools with the Windows SDK. Then run:

```powershell
npm ci
cargo fetch --locked --target x86_64-pc-windows-msvc
python scripts/generate-third-party-notices.py --target x86_64-pc-windows-msvc --npm-os win32 --npm-cpu x64
npm run build:windows
```

The installer is written under
`target/x86_64-pc-windows-msvc/release/bundle/nsis/`. The workflow
`.github/workflows/windows-candidate.yml` also runs tests and launches the
installed app on a disposable Windows runner. It uploads artifacts without
publishing a release or changing the macOS update feed.

