# Working on Aven

This repository is the source of Aven. The installed Aven may be hosting the very task changing this code.

- Preserve unrelated dirty changes and other agents' work. Agree on file ownership for parallel edits.
- Use `npm run dev:doctor` and `npm run dev:app` for a separate **Aven Dev** preview. See `docs/DEVELOPMENT.md`. Never replace or restart the installed host as part of a normal preview or test.
- Keep production bundle identity `com.capi.monocode.personal` for existing user data; debug identity is `com.capi.aven.dev`. Do not migrate, delete or copy production chats just to test a UI change.
- For websites and localhost previews, use the supplied scoped in-app browser connection when running inside Aven. Do not silently open an external browser when it fails. Explicit external-browser tests and provider sign-in flows can keep their configured routing.
- Skills and computer-use tools do not bypass access controls or macOS permissions. Use only the tools actually available in the current session.
- Run focused tests for the changed behavior, TypeScript checks, and applicable native tests. Keep source checks, rendered checks and packaged-app checks distinct in reports.
- Use `scripts/build-release.sh` for a complete Chromium release. It does not install or publish. Preserve MIT attribution and third-party notices when importing upstream changes.
- Aven is independently maintained. Review upstream MonoCode changes and port compatible fixes; do not replace Aven's UI, persistent state, provider support or release feed wholesale.
- Inspect the Git remote and explicitly verified account before pushing. Follow the user's account-routing instructions; never change a shared global account or expose credentials.
