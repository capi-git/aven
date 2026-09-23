# Aven branding and compatibility

This repository builds Aven. Use **Aven** in current product copy, documentation about current behavior, comments describing the app, and diagnostic labels. The frontend package is `aven-desktop`; the development preview is **Aven Dev**.

Aven began from MonoCode. Renaming the product does not change who authored inherited code. Preserve the original copyright and permission notice in [LICENSE](../LICENSE), the attribution in [NOTICE](../NOTICE), third-party notices, and accurate upstream references in historical documentation.

## Why older names remain in the source

These identifiers belong to Aven's implementation. Their names do not select an upstream app or update feed. Keep them stable until a deliberate compatibility migration is implemented and tested.

| Identifier | Why it stays |
| --- | --- |
| `com.capi.monocode.personal` | Production bundle identity and existing app data. Aven Dev uses `com.capi.aven.dev`. |
| Rust crate `monocode`, library `monocode_lib`, and executable `monocode` | Native build, packaging, launch, and control scripts refer to these names. |
| `Supermono Helper`, `supermono_chromium`, and related native names | Chromium packaging and runtime discovery agree on these helper paths and targets. |
| `monocode.*` settings and other persisted keys | Existing themes, preferences, and saved state must remain readable. |
| `MONOCODE_*`, `SUPERMONO_*`, `--supermono-browser`, browser guidance tags, and IPC/event names | Running agents, scoped browser tools, and native/frontend clients exchange these identifiers. |
| Provider client IDs, `monocode` skill source enum, and orchestration proposal markers | Internal and provider-facing contracts. Display the skill source as Aven in the UI. |
| Legacy interruption text, old app names in migration tests, and historical fixtures | Compatibility tests and readers must recognize data produced by earlier builds. |

Prefer a display label when the user only needs to see Aven. Avoid a repository-wide text replacement: it can break existing sessions or bundled browser tools. A larger internal rename needs old-name compatibility, data migration coverage where applicable, and verification of a complete packaged release.

Aven's repository and release feed are `capi-git/aven`. [UPSTREAM.md](UPSTREAM.md) records reviewed upstream work and its provenance; it is not an updater configuration.
