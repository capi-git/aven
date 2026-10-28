import type { Tab } from "../chrome/TitleBar";
import type { WorkspaceSurfaceDropTarget } from "../surfaces/WorkspaceStage";
import { leafIds, neighborLeafId, type LayoutNode } from "./layout";
import { stepPane } from "./paneDock";
import {
  collapseWorkspaceView,
  combineWorkspaceGroups,
  minimizeWorkspaceSide,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  restoreWorkspaceSplit,
  splitWorkspaceView,
  swapWorkspacePanes,
  toggleWorkspaceExpansion,
  workspaceIsSpace,
  type ViewEdge,
  type WorkspaceView,
} from "./workspaceViews";

/**
 * An arrangement change asked for by a pane header, the stage or a tab drag.
 * The main window and detached windows apply these through one function, so
 * the move-or-split and keep-open rules cannot drift between them.
 */
export type WorkspaceIntent =
  | { type: "drop"; id: string; target: WorkspaceSurfaceDropTarget }
  | { type: "split"; id: string; edge: ViewEdge; beside?: string }
  | { type: "reorder"; group: string; ids: string[] }
  | { type: "combine"; group: string; into: string }
  | { type: "unsplit"; group: string }
  | {
      type: "minimize";
      split: string;
      index: number;
      side: "before" | "after";
    }
  | { type: "restore" }
  | { type: "resize"; layout: LayoutNode }
  /** Swap a pane with the one across a seam (Cydonia's Move). */
  | { type: "swap"; group: string; with: string }
  /** Expand a pane over the others, or put it back (Cydonia's zoom). */
  | { type: "zoom"; group: string };

export type WorkspaceIntentResult = {
  view: WorkspaceView;
  /**
   * Browser pages to keep open. A deliberate move must not leave a page as
   * the preview that the next opened link replaces.
   */
  keep: string[];
};

/** Intents whose panes glide to their new places (the zoom has its own). */
export const GLIDING_INTENTS: ReadonlySet<WorkspaceIntent["type"]> = new Set([
  "drop",
  "split",
  "combine",
  "unsplit",
  "minimize",
  "restore",
  "swap",
]);
/** Intents that move panes, so a native page moves as a picture of itself. */
export const MOVING_INTENTS: ReadonlySet<WorkspaceIntent["type"]> = new Set([
  ...GLIDING_INTENTS,
  "zoom",
]);

/** Tabs an intent moves, which may come from elsewhere on the strip. */
export function workspaceIntentIds(intent: WorkspaceIntent): string[] {
  if (intent.type === "drop") return [intent.id];
  if (intent.type === "split")
    return intent.beside ? [intent.id, intent.beside] : [intent.id];
  return [];
}

export function applyWorkspaceIntent(
  view: WorkspaceView,
  intent: WorkspaceIntent,
): WorkspaceIntentResult {
  switch (intent.type) {
    case "drop": {
      const { target } = intent;
      return {
        view:
          target.edge === "tab"
            ? moveWorkspaceTab(
                view,
                intent.id,
                target.id,
                // Hidden Recent tabs can precede the visible slot.
                target.orderIndex ?? target.index,
              )
            : splitWorkspaceView(view, intent.id, target.edge, target.id),
        keep: [intent.id],
      };
    }
    case "split":
      return {
        view: splitWorkspaceView(view, intent.id, intent.edge, intent.beside),
        keep: [],
      };
    case "reorder":
      return {
        view: reorderWorkspaceGroup(view, intent.group, intent.ids),
        keep: [],
      };
    case "combine":
      return {
        view: combineWorkspaceGroups(view, intent.group, intent.into),
        keep: [intent.group, intent.into],
      };
    case "unsplit":
      return {
        view: collapseWorkspaceView(view, intent.group),
        keep: view.layout ? leafIds(view.layout) : [],
      };
    case "minimize":
      return {
        view: minimizeWorkspaceSide(
          view,
          intent.split,
          intent.index,
          intent.side,
        ),
        keep: [],
      };
    case "restore":
      return { view: restoreWorkspaceSplit(view), keep: [] };
    case "resize":
      return { view: { ...view, layout: intent.layout }, keep: [] };
    case "swap":
      return {
        view: swapWorkspacePanes(view, intent.group, intent.with),
        keep: [],
      };
    case "zoom":
      return {
        view: toggleWorkspaceExpansion(view, intent.group),
        keep: [],
      };
  }
}

const NEIGHBORS = [
  ["left", "left pane"],
  ["right", "right pane"],
  ["up", "pane above"],
  ["down", "pane below"],
] as const;

/** Adjacent panes that `group` can combine with, each listed once. */
export function neighborCombineTargets(
  view: WorkspaceView,
  group: string,
): Array<{ id: string; label: string }> {
  const { layout } = view;
  if (!layout) return [];
  const targets: Array<{ id: string; label: string }> = [];
  for (const [direction, label] of NEIGHBORS) {
    const id = neighborLeafId(layout, group, direction);
    if (id && !targets.some((target) => target.id === id))
      targets.push({ id, label });
  }
  return targets;
}

/** Restore-control status for tabs tucked away by a minimized split. */
export function hiddenSplitStatus(
  view: WorkspaceView,
  tabs: ReadonlyArray<Pick<Tab, "id" | "needsInput" | "busyHarnesses">>,
): "attention" | "working" | undefined {
  const hidden = new Set(Object.values(view.hiddenGroups ?? {}).flat());
  const tucked = tabs.filter((tab) => hidden.has(tab.id));
  if (tucked.some((tab) => tab.needsInput)) return "attention";
  if (tucked.some((tab) => tab.busyHarnesses.length > 0)) return "working";
  return undefined;
}

/**
 * What a chord forwarded by a focused page does in a window that has no
 * workspace shortcuts of its own (a detached window): step the focused
 * pane's tabs or the panes, expand the pane, or close its tab. Null for
 * anything else, or nothing to do.
 */
export function pageShortcutOutcome(
  view: WorkspaceView,
  action: unknown,
):
  | { type: "select"; id: string }
  | { type: "zoom"; group: string }
  | { type: "close"; id: string }
  | null {
  const focused = view.focusedId;
  if (!focused || !view.layout) return null;
  if (action === "next-tab" || action === "prev-tab") {
    const stack = view.groups[focused] ?? [focused];
    const next = stepPane(stack, focused, action === "next-tab" ? 1 : -1);
    return next && next !== focused ? { type: "select", id: next } : null;
  }
  if (action === "next-pane" || action === "prev-pane") {
    const next = stepPane(
      leafIds(view.layout),
      focused,
      action === "next-pane" ? 1 : -1,
    );
    return next ? { type: "select", id: next } : null;
  }
  if (action === "zoom-pane")
    return workspaceIsSpace(view) ? { type: "zoom", group: focused } : null;
  if (action === "close-pane") return { type: "close", id: focused };
  return null;
}
