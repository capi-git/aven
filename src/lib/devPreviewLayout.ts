import { leafIds } from "./layout";
import {
  placeAgentBrowserView,
  selectWorkspaceView,
  type WorkspaceView,
} from "./workspaceViews";

/**
 * Put a dev preview's page beside the requesting chat, as agent pages are:
 * into the existing browser pane, or one split to the right. The page also
 * comes to the front of its pane, keeping keyboard focus where it was unless
 * that pane's own page was replaced.
 */
export function placeDevPreview(
  view: WorkspaceView,
  id: string,
  browserIds: readonly string[],
  requesterId: string | undefined,
): WorkspaceView {
  const placed = placeAgentBrowserView(view, id, browserIds, requesterId);
  if (!placed.layout || leafIds(placed.layout).includes(id)) return placed;
  const selected = selectWorkspaceView(placed, id);
  if (!selected.layout) return selected;
  return leafIds(selected.layout).includes(placed.focusedId)
    ? { ...selected, focusedId: placed.focusedId }
    : selected;
}
