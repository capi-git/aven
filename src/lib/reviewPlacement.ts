import {
  editorTabKey,
  leaf,
  leafIds,
  newEditorPane,
  newSessionChangesTab,
  type LayoutNode,
  type WorkspaceTab,
} from "./layout";
import {
  moveWorkspaceTab,
  selectWorkspaceView,
  workspaceGroupOwner,
  type WorkspaceView,
} from "./workspaceViews";

/** Each pane on screen and its share of the view's width (1 for one pane). */
export function paneWidths(
  node: LayoutNode,
  share = 1,
  out = new Map<string, number>(),
): Map<string, number> {
  if (node.type === "leaf") {
    out.set(node.id, share);
    return out;
  }
  node.children.forEach((child, index) =>
    paneWidths(
      child,
      node.dir === "right"
        ? share * (node.sizes[index] ?? 1 / node.children.length)
        : share,
      out,
    ),
  );
  return out;
}

/**
 * Where a chat's review opens instead of a third column squeezed in beside
 * the chat: the widest other pane on screen whose shown tab is not a chat
 * (a live preview, a board), as a tab in its group. None when there is no
 * such pane; the chat's own tab then splits as before.
 */
export function reviewPaneFor(
  view: WorkspaceView,
  chatTabId: string,
  isChat: (surfaceId: string) => boolean,
): string | undefined {
  if (!view.layout) return undefined;
  const own = workspaceGroupOwner(view, chatTabId);
  let best: string | undefined;
  let widest = -1;
  for (const [pane, width] of paneWidths(view.layout)) {
    if (pane === own || isChat(pane)) continue;
    if (width > widest) {
      best = pane;
      widest = width;
    }
  }
  return best;
}

/**
 * Show `id` in front in `pane`'s tab group, focused. A tab already in front
 * of another pane on screen is brought forward where it is.
 */
export function showInPane(
  view: WorkspaceView,
  id: string,
  pane: string,
): WorkspaceView {
  const owner = workspaceGroupOwner(view, id);
  if (!owner || !view.layout) return view;
  const onScreen = leafIds(view.layout).includes(id);
  const placed =
    onScreen || owner === workspaceGroupOwner(view, pane)
      ? view
      : moveWorkspaceTab(view, id, pane);
  return selectWorkspaceView(placed, id);
}

/** A workspace tab of its own holding one chat's review. */
export function newSessionChangesWorkspaceTab(
  cwd: string,
  sessionId: string,
  focusPath?: string,
): WorkspaceTab {
  const pane = newEditorPane(newSessionChangesTab(cwd, sessionId, focusPath));
  return {
    kind: "session",
    id: crypto.randomUUID(),
    layout: leaf(pane.id),
    focusedId: pane.id,
    editorPanes: [pane],
    terminalPanes: [],
  };
}

/** The workspace tab already holding this chat's review, if any. */
export function sessionChangesTabFor(
  tabs: readonly WorkspaceTab[],
  cwd: string,
  sessionId: string,
): WorkspaceTab | undefined {
  const key = editorTabKey(newSessionChangesTab(cwd, sessionId));
  return tabs.find((tab) =>
    tab.editorPanes.some((pane) =>
      pane.files.some((file) => editorTabKey(file) === key),
    ),
  );
}
