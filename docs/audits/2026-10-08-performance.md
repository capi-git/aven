# Performance follow-up — October 8, 2026

## Startup imports

File editors, diff views, terminal views, Race views and the decorative grid
games now load when rendered. Retained file and terminal slots keep their
existing identity and dimensions while a chunk loads. App's editor shortcut
handlers use a small synchronous dispatcher populated by the editor module.
The bundled changelog loads when release notes are requested.

File icons first load the theme's name lookup and a generated subset. Common
icons use the original SVGs exactly; an uncommon icon loads the complete SVG
table on demand. Regenerate the subset with
`node scripts/generate-file-icon-subset.mjs` after upgrading the icon theme.
Tests compare every subset SVG with the installed package, verify uncommon
icons, and retain the unchanged-SVG/hidden-panel regression coverage.

The baseline is main commit `1ba091b8`. Both builds used the same installed
dependencies and `npm run build -- --manifest`. The script
`node scripts/measure-boot-bundle.mjs [dist-directory]` follows static imports
from the entry and App, including App's static dependencies even though the
boot splash loads App dynamically. It counts each JavaScript chunk once and
sums independently compressed gzip sizes at level 9. It excludes optional
dynamic imports, CSS and other assets.

| Startup JavaScript |  Baseline | Candidate |
| ------------------ | --------: | --------: |
| Minified bytes     | 3,384,118 | 3,071,022 |
| Gzip bytes         | 1,041,354 |   989,848 |

This is 313,096 fewer minified bytes (9.3%) and 51,506 fewer gzip bytes (4.9%).
The icon lookup/subset chunk is 156,695 minified bytes; the previous icon
package chunk loaded just after paint was 1,129,785 bytes. That deferred
chunk is outside the static startup totals above. The full icon table remains
available for uncommon files.

These are build-output measurements, not measured startup time or frame rate.
Source tests cover preserved editor buffers, editor shortcuts, file icon
identity, PDF visibility, and release note content after asynchronous loading.
The combined Aven Dev preview supplies the separate native runtime check.
