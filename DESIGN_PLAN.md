# Tab viewing: C, one preview slot

Selected direction: keep Aven's existing sidebar and tab rows. Show kept tabs and one temporary preview in each file pane or browser group. Earlier items remain available from a searchable Recent menu.

## Implementation

- [x] Add optional `kept` metadata for files and browser pages, including snapshots, recovery, and detached windows.
- [x] Show one preview without closing hidden files, replacing browser identities, or discarding editor buffers.
- [x] Support Keep open and double-click to keep; editing a file keeps it after saving.
- [x] Add searchable Recent menus with file paths and browser URLs, keyboard navigation, and empty results.
- [x] Preserve hidden tabs during reordering, splitting, combining, and dragging between groups.
- [x] Keep the sidebar and native header height unchanged.

## Main components

- `SurfaceTabs` and `TitleBar`: preview display, Keep open, and Recent.
- `previewTabs`: visible selection and full-order merge helpers.
- `WorkspaceMenuPanel`: searchable menus in browser and native surfaces.
- `App` and `DetachedWorkspace`: persistence and movement callbacks.

The new keep callbacks change presentation metadata only. Existing selection and close callbacks retain their behavior. Styling uses the existing content, accent, and focus tokens.

## Verification

- [x] Web suite and TypeScript checks.
- [x] Focused regressions for retained editors, dirty files, restore, movement, and detached windows.
- [x] Native menu validation tests and Rust formatting.
- [x] Source component preview exercised through Aven's in-app browser.
- [ ] Full native application visual review; no installed application replacement performed.
