# Aven branding and compatibility

This repository builds Aven. Use **Aven** in current product copy, documentation about current behavior, comments describing the app, and diagnostic labels. The frontend package is `aven-desktop`; the Rust package is `aven`, its library is `aven_lib`, and the desktop executable is `aven`. Packaged Chromium helpers use **Aven Helper** names. The separate development preview is **Aven Dev**.

Aven began from MonoCode. Renaming the product does not change who authored inherited code. Preserve the original copyright and permission notice in [LICENSE](../LICENSE), the attribution in [NOTICE](../NOTICE), third-party notices, and accurate upstream references in historical documentation. Aven's repository and release feed are `capi-git/aven`. [UPSTREAM.md](UPSTREAM.md) records reviewed upstream work and its provenance; it is not an updater configuration.

## Commands for current sessions

New agent instructions use the current Aven executable, `--aven-browser`, and `AVEN_BROWSER_*` / `AVEN_CONTROL_*` scoped environment variables. For example, an installed app's control command is `/Applications/Aven.app/Contents/MacOS/aven control --help`.

The macOS bundle also includes a relative `monocode` executable alias, and the CLI accepts the older `--supermono-browser` flag and scoped environment variables. These keep commands in restored conversations usable. Historical transcript entries retain the command text that actually ran; renaming the executable does not rewrite conversation history.

## Why older names remain in the source

These identifiers belong to Aven's implementation. Their names do not select an upstream app or update feed. Keep them stable until a deliberate compatibility migration is implemented and tested.

| Identifier | Why it stays |
| --- | --- |
| `com.capi.monocode.personal` and existing helper bundle IDs | Production application identity and existing app data. Aven Dev uses `com.capi.aven.dev`. |
| `monocode` executable alias, `--supermono-browser`, and old scoped environment variable names | Resumed agents may still use commands supplied by an earlier Aven build. New instructions use Aven names. |
| `supermono_chromium`, native bridge symbols, and related private names | Internal Chromium build and bridge contracts; packaged executable and helper names use Aven. |
| `monocode.*` settings and other persisted keys | Existing themes, preferences, and saved state must remain readable. |
| Internal IPC/event names, diagnostic environment variables, and provider probe IDs | Native/frontend clients and security checks still exchange these identifiers. |
| `monocode` skill source enum and historical orchestration markers | Readers must recognize existing data. Display the skill source as Aven in the UI. |
| Legacy interruption text, old app names in migration tests, and historical fixtures | Compatibility tests and readers must recognize data produced by earlier builds. |

Avoid a repository-wide text replacement: it can break existing sessions or bundled browser tools. Internal renames need old-name compatibility, data migration coverage where applicable, and verification of a complete packaged release.

## Mark and default theme

Aven's default workspace theme is monochrome: near-black and white in dark mode, white and near-black in light mode, with no tint. The former sky-blue default remains selectable as **Sky**; saved workspace themes are never rewritten.

The mark is a white line chevron on a dark rounded tile, drawn like the interface's stroke icons. `scripts/render-brand-icons.py` renders the interface marks, the Icon Composer glyph layer and a 1024 px app icon source; regenerate bundle icons from that source with `npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons`. The compiled `src-tauri/macos/Assets.car` is not used by packaging, which installs `icon.icns`.
