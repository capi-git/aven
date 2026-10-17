import {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  getActivitySnapshot,
  subscribeActivity,
  type ActivityEntry,
} from "../lib/activity";
import { discussionSideOf, discussionStore } from "../lib/discussions";
import { LiveSessionsContext } from "../lib/liveSessions";
import { orchestrator } from "../lib/orchestration";
import { racesSnapshot, subscribeRaces } from "../lib/race";
import type { Session } from "../lib/session";
import {
  teamOf,
  teamRunsFrom,
  teamSessionIds,
  type TeamRun,
  type TeamStores,
} from "../lib/teamRuns";
import { equalChromeData } from "./useChromeProps";

const NO_ENTRIES: readonly ActivityEntry[] = [];
const NO_TEAMS: readonly TeamRun[] = Object.freeze([]);

/** The three stores' records; each list keeps its identity until it changes. */
export function useTeamStores(): TeamStores {
  const store = discussionStore();
  const discussions = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const races = useSyncExternalStore(
    subscribeRaces,
    racesSnapshot,
    racesSnapshot,
  );
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  return useMemo(
    () => ({ discussions, races, runs }),
    [discussions, races, runs],
  );
}

type Options = {
  /** Fill in each working member's `doing` line (see `TeamLookup.detail`). */
  detail?: boolean;
};

/**
 * The teams of `stores`, from the members' latest sessions. Subscribes only
 * to those members (and the activity ledger, for race lanes), and returns
 * the same array until something a `TeamRun` holds changes: a streamed
 * reply in a member chat re-renders nothing here.
 */
function useTeamsFor(
  stores: TeamStores,
  { detail = false }: Options,
): readonly TeamRun[] {
  const live = useContext(LiveSessionsContext);
  const ids = useMemo(() => teamSessionIds(stores).join("\n"), [stores]);
  const ledger = stores.races.length > 0;
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = ids
        ? ids.split("\n").map((id) => live?.subscribe(id, listener))
        : [];
      const stopLedger = ledger ? subscribeActivity(listener) : undefined;
      return () => {
        for (const stop of stops) stop?.();
        stopLedger?.();
      };
    },
    [ids, ledger, live],
  );
  const cache = useRef<{
    stores: TeamStores;
    sessions: (Session | undefined)[];
    activity: readonly ActivityEntry[];
    teams: readonly TeamRun[];
  } | null>(null);
  const read = useCallback(() => {
    const list = ids ? ids.split("\n") : [];
    const sessions = list.map((id) => live?.session(id));
    const activity = ledger ? getActivitySnapshot() : NO_ENTRIES;
    const previous = cache.current;
    if (
      previous &&
      previous.stores === stores &&
      previous.activity === activity &&
      previous.sessions.length === sessions.length &&
      previous.sessions.every((session, index) => session === sessions[index])
    )
      return previous.teams;
    const byId = new Map(list.map((id, index) => [id, sessions[index]]));
    const next = teamRunsFrom(stores, {
      session: (id) => byId.get(id),
      activity,
      detail,
    });
    const teams = !next.length
      ? NO_TEAMS
      : previous && equalChromeData(previous.teams, next)
        ? previous.teams
        : next;
    cache.current = { stores, sessions, activity, teams };
    return teams;
  }, [detail, ids, ledger, live, stores]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Every team in the three stores. */
export function useTeamRuns(options: Options = {}): readonly TeamRun[] {
  return useTeamsFor(useTeamStores(), options);
}

const EMPTY_STORES: TeamStores = Object.freeze({
  discussions: [],
  races: [],
  runs: [],
});

/** The one record behind a team id (`<kind>:<key>`), found in the stores. */
function recordFor(stores: TeamStores, id: string | undefined) {
  if (!id) return undefined;
  const at = id.indexOf(":");
  const kind = id.slice(0, at);
  const key = id.slice(at + 1);
  if (kind === "discuss")
    return stores.discussions.find((entry) => entry.id === key);
  if (kind === "race") return stores.races.find((entry) => entry.id === key);
  if (kind === "orchestrate")
    return stores.runs.find((entry) => entry.leadId === key);
  return undefined;
}

/** One team, by id; it re-renders only when that team changes. */
export function useTeamRun(
  id: string | undefined,
  options: Options = {},
): TeamRun | null {
  const stores = useTeamStores();
  const record = recordFor(stores, id);
  const kind = id?.slice(0, id.indexOf(":"));
  const narrowed = useMemo<TeamStores>(() => {
    if (!record) return EMPTY_STORES;
    return {
      discussions: kind === "discuss" ? [record as never] : [],
      races: kind === "race" ? [record as never] : [],
      runs: kind === "orchestrate" ? [record as never] : [],
    };
  }, [kind, record]);
  return useTeamsFor(narrowed, options)[0] ?? null;
}

/**
 * The team this chat started or belongs to (see `teamOf`), read only from
 * the records that involve it: other teams' changes re-render nothing.
 */
export function useTeamOf(
  sessionId: string | undefined,
  options: Options = {},
): TeamRun | null {
  const all = useTeamStores();
  const discussions = useStableList(
    useMemo(
      () =>
        sessionId
          ? all.discussions.filter(
              (entry) => discussionSideOf(entry, sessionId) !== null,
            )
          : [],
      [all.discussions, sessionId],
    ),
  );
  const races = useStableList(
    useMemo(
      () =>
        sessionId
          ? all.races.filter(
              (entry) =>
                entry.origin?.sessionId === sessionId ||
                entry.lanes.some((lane) => lane.sessionId === sessionId),
            )
          : [],
      [all.races, sessionId],
    ),
  );
  const runs = useStableList(
    useMemo(
      () =>
        sessionId
          ? all.runs.filter(
              (entry) =>
                entry.leadId === sessionId ||
                entry.tasks.some((task) => task.sessionId === sessionId),
            )
          : [],
      [all.runs, sessionId],
    ),
  );
  const narrowed = useMemo(
    () => ({ discussions, races, runs }),
    [discussions, races, runs],
  );
  const teams = useTeamsFor(narrowed, options);
  return useMemo(
    () => (sessionId ? (teamOf(sessionId, teams) ?? null) : null),
    [sessionId, teams],
  );
}

/** The previous list while it holds the same records, in the same order. */
function useStableList<T>(list: readonly T[]): readonly T[] {
  const stable = useRef(list);
  if (
    stable.current !== list &&
    (stable.current.length !== list.length ||
      stable.current.some((entry, index) => entry !== list[index]))
  )
    stable.current = list;
  return stable.current;
}
