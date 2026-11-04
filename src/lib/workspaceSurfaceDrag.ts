import { useSyncExternalStore } from "react";
import type { WorkspaceSurfaceDropTarget } from "../surfaces/WorkspaceStage";

/**
 * The tab being dragged over the main window's panes, and the drop it would
 * make. Kept outside the app's state: it changes as the pointer crosses a
 * pane's zones, and only the stage draws it, so a drag never re-renders the
 * whole workspace.
 */
export type WorkspaceSurfaceDrag = {
  dragging: boolean;
  target: WorkspaceSurfaceDropTarget | null;
};

const IDLE: WorkspaceSurfaceDrag = { dragging: false, target: null };

let drag = IDLE;
const listeners = new Set<() => void>();

export function setWorkspaceSurfaceDrag(next: WorkspaceSurfaceDrag) {
  if (
    drag.dragging === next.dragging &&
    JSON.stringify(drag.target) === JSON.stringify(next.target)
  )
    return;
  drag = next.dragging || next.target ? next : IDLE;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceSurfaceDrag(): WorkspaceSurfaceDrag {
  return useSyncExternalStore(
    subscribe,
    () => drag,
    () => IDLE,
  );
}
