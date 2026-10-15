import { leafIds } from "./layout";
import {
  placeAgentBrowserView,
  selectWorkspaceView,
  type WorkspaceView,
} from "./workspaceViews";

/**
 * Put a dev preview's page beside the requesting chat, as agent pages are:
 * into the existing browser pane, or one split to the right. An automatic
 * open stops there, so it never covers a page the user is reading. A click
 * also brings the page to the front of its pane, keeping keyboard focus where
 * it was unless that pane's own page was replaced.
 */
export function placeDevPreview(
  view: WorkspaceView,
  id: string,
  browserIds: readonly string[],
  requesterId: string | undefined,
  automatic: boolean,
): WorkspaceView {
  const placed = placeAgentBrowserView(view, id, browserIds, requesterId);
  if (automatic || !placed.layout || leafIds(placed.layout).includes(id))
    return placed;
  const selected = selectWorkspaceView(placed, id);
  if (!selected.layout) return selected;
  return leafIds(selected.layout).includes(placed.focusedId)
    ? { ...selected, focusedId: placed.focusedId }
    : selected;
}
