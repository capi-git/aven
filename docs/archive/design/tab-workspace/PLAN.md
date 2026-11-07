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


# Compact shared tabs with the Aven theme

Selected direction: Compact, one shared row for conversations, files, and browser pages, with Aven's saved theme. The user requested visible pickup motion and a tab-logic audit after selecting this direction.

## Implementation

- [x] Use flat rectangular tabs with stable widths and a fine active accent; preserve the native 32px pane-header geometry.
- [x] Remove the minimized-tabs mode, its menu/settings controls, and hover-card-only code. Keep compact titles visible even when an older saved preference enabled icon-only tabs.
- [x] Float an exact-size visual under the pointer in both axes; keep original hitboxes stationary and animate neighbouring tabs into the landing position.
- [x] Preserve source focus, reduced-motion preferences, zoom, cancellation, and cleanup. Keep the preview out of keyboard navigation and drop-target discovery.
- [x] Use the existing native-browser occlusion path where the floating preview intersects an embedded browser.
- [x] Unify arrow, Home/End, roving focus, and focus recovery across title and file tabs without intercepting modified shortcuts or nested controls.
- [x] Ignore stale explicit browser selection/close targets. Preserve active-page fallback only when no target was supplied.
- [x] Apply detached close transitions once, preserving reopened tabs and recording known closed descriptors for recovery.

Existing split-pane ownership, preview/kept rules, unsaved-file prompts, group membership, and persistent identities remain in place. This work uses the existing callbacks and theme tokens; it introduces no new settings or dependencies.

## Verification

- [x] Full web suite and TypeScript checks.
- [x] Focused drag, keyboard, close recovery, grouping, and browser occlusion regressions.
- [x] Real component fixture exercised in Aven's scoped browser: pickup dimensions at 100% and 125%, narrow/light theme, cancellation, reordering, and cleanup.
- [x] Separate signed Aven Dev build and screenshot inspection of compact native headers.
- [ ] Hands-on native drag across an embedded Chromium pane. The scoped desktop tool does not expose held-pointer dragging; controlled web tests do not prove native compositor output.

No release or installed-app replacement is part of this change. Browser-open reuse is tracked separately in PR #15.
