import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import { sessionNeedsInput, type Session } from "./session";

/**
 * Latest sessions, including streamed transcript changes that the workspace
 * has not committed to React state yet. A visible chat pane subscribes to its
 * own session so streaming re-renders only that pane, not the whole app.
 */
export type LiveSessionStore = {
  list(): Session[];
  session(id: string): Session | undefined;
  set(next: Session[]): void;
  subscribe(id: string, listener: () => void): () => void;
};

export function createLiveSessionStore(initial: Session[]): LiveSessionStore {
  let list = initial;
  let byId: Map<string, Session> | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const index = () =>
    (byId ??= new Map(list.map((session) => [session.id, session])));
  const notify = (id: string) => {
    for (const listener of [...(listeners.get(id) ?? [])]) listener();
  };
  return {
    list: () => list,
    session: (id) => index().get(id),
    set(next) {
      if (next === list) return;
      const previous = index();
      list = next;
      byId = null;
      const current = index();
      for (const [id, session] of current) {
        if (previous.get(id) !== session) notify(id);
      }
      for (const id of previous.keys()) {
        if (!current.has(id)) notify(id);
      }
    },
    subscribe(id, listener) {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(id) === set) listeners.delete(id);
      };
    },
  };
}

/**
 * True when streaming changed only a transcript: no field other than `blocks`
 * differs and the need for user input is unchanged. Such changes can reach the
 * visible pane through the live store before the workspace commits them.
 */
export function isTranscriptOnlyChange(
  previous: Session,
  next: Session,
): boolean {
  if (previous === next) return true;
  if (previous.blocks === next.blocks) return false;
  for (const key of new Set([
    ...Object.keys(previous),
    ...Object.keys(next),
  ]) as Set<keyof Session>) {
    if (key !== "blocks" && previous[key] !== next[key]) return false;
  }
  return sessionNeedsInput(previous) === sessionNeedsInput(next);
}

/**
 * Whether a streamed update may skip the workspace commit: every changed
 * session changed only its transcript and is rendered by this window alone.
 * Pop-out and detached windows sync from committed state.
 */
export function canDeferStreamCommit(
  previous: readonly Session[],
  next: readonly Session[],
  externallyRendered: ReadonlySet<string>,
): boolean {
  return (
    previous.length === next.length &&
    next.every(
      (session, index) =>
        session === previous[index] ||
        (session.id === previous[index].id &&
          !externallyRendered.has(session.id) &&
          isTranscriptOnlyChange(previous[index], session)),
    )
  );
}

export const LiveSessionsContext = createContext<LiveSessionStore | null>(null);

const noSubscription = () => () => {};

/**
 * The newest version of `session` while `live` is true. Hidden panes keep the
 * committed prop, so background streams do not re-render them.
 */
export function useLiveSession<S extends Session | undefined>(
  session: S,
  live: boolean,
): S {
  const store = useContext(LiveSessionsContext);
  const id = session?.id;
  const active = !!store && live && id !== undefined;
  const subscribe = useCallback(
    (listener: () => void) =>
      active ? store.subscribe(id, listener) : noSubscription(),
    [store, active, id],
  );
  const latest = useSyncExternalStore(subscribe, () =>
    active ? store.session(id) : undefined,
  );
  return (latest ?? session) as S;
}
