# Aven branding and compatibility

This repository builds Aven. Use **Aven** in current product copy, documentation about current behavior, comments describing the app, and diagnostic labels. The frontend package is `aven-desktop`; the Rust package is `aven`, its library is `aven_lib`, and the desktop executable is `aven`. Packaged Chromium helpers use **Aven Helper** names. The separate development preview is **Aven Dev**.

Aven began from MonoCode. Renaming the product does not change who authored inherited code. Preserve the original copyright and attribution in [NOTICE](../NOTICE), the MIT permission notice in [LICENSE](../LICENSE), third-party notices, and accurate upstream references in historical documentation. Aven's repository and release feed are `capi-git/aven`. [UPSTREAM.md](UPSTREAM.md) records reviewed upstream work and its provenance; it is not an updater configuration.

Current terminal CSS classes, new temporary file names, provider probes and their request labels, and ordinary test examples use Aven names. Old product names remain where they identify existing data, maintain a compatibility contract, or record attribution and history.

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
| Existing IPC/event names and the legacy harness process-ownership environment marker | Native/frontend clients and cleanup of existing child processes still depend on these contracts. |
| Legacy provider probe IDs in security checks | New probes use `aven-`; the browser permission guard rejects both old and new internal probe prefixes. |
| `monocode` skill source enum and historical orchestration markers | Readers must recognize existing data. Display the skill source as Aven in the UI. |
| Legacy interruption text, old app names in migration tests, and historical fixtures | Compatibility tests and readers must recognize data produced by earlier builds. |

Avoid a repository-wide text replacement: it can break existing sessions or bundled browser tools. Internal renames need old-name compatibility, data migration coverage where applicable, and verification of a complete packaged release.

## Mark and default theme

Aven's default workspace theme follows the system appearance. In dark mode it is black glass with a blue accent (`#57b5ff`): translucent panels at 52% opacity with a soft blur, so the desktop shows through on Macs with native glass; other platforms and light mode stay opaque. Light mode is white and near-black with no tint. The former monochrome default remains selectable as **Mono** and the sky-blue one as **Sky**. Installs that already saved appearance settings keep their opaque look; saved workspace themes are never rewritten.

The mark is the Pixel A: a pixel-art capital A, 7 cells wide and 8 tall, in off-white (`#f2f2f0`) with one blue pixel at the apex, the summit, in Aven's accent (`#57b5ff`). On the app icon it sits on a charcoal glass tile: a soft top-to-bottom gradient, a sheen and a rim that catch light along the top, and a very faint glow behind the glyph, in the style of macOS dark icons. The A spans about 52% of the tile's width and sits a quarter cell above centre. Its cells are always exact squares on whole pixels, so each size is drawn on its own pixel grid rather than scaled from a larger one.

`scripts/render-brand-icons.py` renders the interface marks (`public/aven-mark.png`, `public/aven.png` and the browser's fallback tab icon `public/aven-mark.svg`), the Icon Composer glyph layer and a 1024 px app icon source. Regenerate bundle icons from that source with `npx tauri icon target/brand/app-icon-1024.png -o src-tauri/icons`, then run `python3 scripts/render-brand-icons.py --bundle` on a Mac: it redraws each desktop bundle PNG at its own size and rebuilds `icon.icns` and `icon.ico`, replacing Tauri's resampled copies, which blur the pixels. The iOS and Android icons keep Tauri's output. Packaging installs the generated `icon.icns` for the macOS app.

Inside the app, `AvenMark` draws the A inline without its tile. The body takes the text colour, so it is near-black in light mode, and the summit stays blue. The grid lives in `src/lib/avenMark.ts` and in the script; keep the two in step.

The Windows installer uses `src-tauri/icons/installer-sidebar.bmp` with the Aven mark and wordmark. Keep it a 164 × 314, 24-bit uncompressed BMP. This separate sidebar asset, like the README banner in `.github/assets/banner.png`, is not regenerated by the icon script.
