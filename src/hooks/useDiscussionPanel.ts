import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closeInPanel,
  defaultRect,
  loadPanelState,
  markSeen,
  openInPanel,
  prunePanel,
  savePanelState,
  shrinkPanel,
  watchStarted,
  type DiscussionPanelState,
  type PanelRect,
} from "../lib/discussionPanel";
import { discussionStore } from "../lib/discussions";
import { useDiscussionList } from "./useDiscussions";

/** What the workspace and the panel do with this window's discussion panel. */
export type DiscussionPanelControls = {
  state: DiscussionPanelState;
  /** A discussion started here: open it as the panel or a pill. */
  started: (id: string) => void;
  /** Watch, Open, the connector: show it as the panel. */
  open: (id: string) => void;
  /** – : shrink the panel to a pill. */
  shrink: () => void;
  /** A pill was pressed: open it as the panel. */
  restore: (id: string) => void;
  /** × : stop showing it here. */
  close: (id: string) => void;
  /** The panel was dragged or resized. */
  move: (rect: PanelRect) => void;
  /** The user has seen this many of its replies in the panel. */
  seen: (id: string, count: number) => void;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * This window's discussion panel, remembered under
 * `aven.discussionPanel.<window>`: what it watches, which one is open as
 * the panel, where it sits, and what the user has seen.
 */
export function useDiscussionPanel(
  window = discussionStore().owner,
  storage: Storage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): DiscussionPanelControls {
  const [state, setState] = useState(() => loadPanelState(storage, window));
  const list = useDiscussionList();
  const known = useMemo(
    () => new Set(list.map((discussion) => discussion.id)),
    [list],
  );
  // Discussions that are gone (their chat was deleted) leave the panel.
  useEffect(() => {
    setState((current) => prunePanel(current, known));
  }, [known]);
  useEffect(() => {
    savePanelState(storage, window, state);
  }, [state, storage, window]);

  /** The panel opens where it was, or in the corner the first time. */
  const placed = (next: DiscussionPanelState) =>
    next.expanded && !next.rect
      ? { ...next, rect: defaultRect(viewport()) }
      : next;
  const started = useCallback(
    (id: string) => setState((current) => placed(watchStarted(current, id))),
    [],
  );
  const open = useCallback(
    (id: string) => setState((current) => placed(openInPanel(current, id))),
    [],
  );
  const shrink = useCallback(() => setState(shrinkPanel), []);
  const close = useCallback(
    (id: string) => setState((current) => closeInPanel(current, id)),
    [],
  );
  const move = useCallback(
    (rect: PanelRect) => setState((current) => ({ ...current, rect })),
    [],
  );
  const seen = useCallback(
    (id: string, count: number) =>
      setState((current) => markSeen(current, id, count)),
    [],
  );
  return useMemo(
    () => ({
      state,
      started,
      open,
      shrink,
      restore: open,
      close,
      move,
      seen,
    }),
    [state, started, open, shrink, close, move, seen],
  );
}
