import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { defaultRect, type PanelRect } from "../lib/discussionPanel";
import { discussionStore } from "../lib/discussions";
import { racesSnapshot, subscribeRaces } from "../lib/race";
import {
  closeInPanel,
  loadTeamPanel,
  markSeen,
  openInPanel,
  poppedBack,
  popIn,
  popOut,
  pruneTeamPanel,
  saveTeamPanel,
  shrinkPanel,
  watchStarted,
  type TeamPanelState,
} from "../lib/teamWatch";
import { teamIdOf, type TeamKind } from "../lib/teamRuns";
import { useDiscussionList } from "./useDiscussions";

/** What the workspace and the panel do with this window's team panel. */
export type TeamWatchControls = {
  state: TeamPanelState;
  /** A team started here: open it as the panel or a pill. */
  started: (id: string) => void;
  /** Watch, Open, the connector, a pill: show it as the panel. */
  open: (id: string) => void;
  /** – : shrink the panel to a pill. */
  shrink: () => void;
  /** A pill was pressed: open it as the panel. */
  restore: (id: string) => void;
  /** × : stop showing it here. */
  close: (id: string) => void;
  /** ↗ : show it in a window of its own. */
  popOut: (id: string) => void;
  /** ↙ in its own window: back here as the panel. */
  popIn: (id: string) => void;
  /** Its own window closed, or could not open: a pill here again. */
  poppedBack: (id: string) => void;
  /** The panel was dragged or resized. */
  move: (rect: PanelRect) => void;
  /** The user has seen this many of a discussion's replies in the panel. */
  seen: (id: string, count: number) => void;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Stores that hold every record from the start; runs load per lead later. */
const LOADED: ReadonlySet<TeamKind> = new Set(["discuss", "race"]);

/**
 * This window's team panel, remembered under `aven.teamPanel.<window>`:
 * what it watches, which one is open as the panel, what the user closed,
 * where it sits, and what the user has seen. Popped-out teams are this
 * page's alone and are not remembered.
 */
export function useTeamWatch(
  window = discussionStore().owner,
  storage: Storage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): TeamWatchControls {
  const [state, setState] = useState(() => loadTeamPanel(storage, window));
  const discussions = useDiscussionList();
  const races = useSyncExternalStore(
    subscribeRaces,
    racesSnapshot,
    racesSnapshot,
  );
  const known = useMemo(
    () =>
      new Set([
        ...discussions.map((entry) => teamIdOf("discuss", entry.id)),
        ...races.map((entry) => teamIdOf("race", entry.id)),
      ]),
    [discussions, races],
  );
  // Teams that are gone (their chat was deleted) leave the panel.
  useEffect(() => {
    setState((current) => pruneTeamPanel(current, known, LOADED));
  }, [known]);
  useEffect(() => {
    saveTeamPanel(storage, window, state);
  }, [state, storage, window]);

  /** The panel opens where it was, or in the corner the first time. */
  const placed = (next: TeamPanelState) =>
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
  const poppedOut = useCallback(
    (id: string) =>
      setState((current) =>
        popOut(
          current.rect
            ? current
            : { ...current, rect: defaultRect(viewport()) },
          id,
        ),
      ),
    [],
  );
  const into = useCallback(
    (id: string) => setState((current) => placed(popIn(current, id))),
    [],
  );
  const back = useCallback(
    (id: string) => setState((current) => poppedBack(current, id)),
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
      popOut: poppedOut,
      popIn: into,
      poppedBack: back,
      move,
      seen,
    }),
    [state, started, open, shrink, close, poppedOut, into, back, move, seen],
  );
}
