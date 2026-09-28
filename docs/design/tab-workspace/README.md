# Tab and browser workspace exploration

This folder contains five interactive layout mocks for Aven's session and browser tabs. They are design proposals, not changes to the app's tab behavior. Open `index.html` through a local server and review it in Aven's in-app browser.

From this checkout:

```sh
python3 -m http.server 4179 --directory docs/design/tab-workspace
```

Then open `http://localhost:4179/` in Aven. The page works without dependencies or network assets.

## Directions

| Mock | Placement idea | Main tradeoff |
| --- | --- | --- |
| A · Compact strip | Keep mixed session and browser tabs in one narrower row | Familiar, but a busy workspace can still overflow |
| B · Browser deck | Keep task tabs above the canvas and page tabs with the browser | Clearer browser hierarchy, with a second row while browsing |
| C · Icon shelf | Reduce top tabs to marks and reveal labels on demand | Largest canvas, with less immediate title recognition |
| D · Pane canvas | Put a short tab header on each pane and use a window overview | Makes placement explicit, but switching hidden tabs takes another step |
| E · Side dock | Give browsers a collapsible dock beside session tabs | Easy browser access, at the cost of some horizontal space |

## Shared behavior to evaluate

- Ordinary pane membership does not display a “3 tabs” or “4 tabs” label. A name and count appear only after the user deliberately creates a group.
- Minimizing a tab hides its title while keeping the tab, browser, and current work open. Hover, focus, and the active content header reveal its identity.
- Session and browser tabs can be reordered. The placement controls in the mocks show where a browser could move without silently changing its content.
- A tab, an explicit group, and a pane are different things. Collapsing labels should not merge panes or close tabs.

## Implementation notes after a direction is chosen

The current shared strip lives in `src/chrome/TitleBar.tsx`; its 216px preferred tab width comes from `src/chrome/TitleBar.css`. `src/App.tsx` currently passes a count based on pane members as the group label. That count needs an explicit user-created group state before it is shown. The existing 32px pane header height and `[data-surface-tab-id]` drop hitboxes support current drag and split behavior, so a compact implementation should preserve those geometry contracts unless the pane layout is updated with them.

No production tab state or persistence is changed by these mocks.
