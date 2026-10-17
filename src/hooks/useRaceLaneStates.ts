import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { getActivitySnapshot, subscribeActivity } from "../lib/activity";
import { LiveSessionsContext } from "../lib/liveSessions";
import type { RaceRecord } from "../lib/race";
import { raceLaneState, type RaceLaneState } from "../lib/raceLanes";

const NONE = "[]";

/**
 * Each lane's state, re-rendering only when one changes: streaming in a lane
 * notifies its session many times a second, but its state rarely moves.
 */
export function useRaceLaneStates(
  race: RaceRecord | undefined,
): RaceLaneState[] {
  const live = useContext(LiveSessionsContext);
  const ids = race?.lanes.map((lane) => lane.sessionId).join("\n") ?? "";
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = ids
        ? ids.split("\n").map((id) => live?.subscribe(id, listener))
        : [];
      const stopActivity = subscribeActivity(listener);
      return () => {
        for (const stop of stops) stop?.();
        stopActivity();
      };
    },
    [live, ids],
  );
  const read = useCallback(() => {
    if (!ids) return NONE;
    const entries = getActivitySnapshot();
    return JSON.stringify(
      ids
        .split("\n")
        .map((id) => raceLaneState(id, live?.session(id), entries)),
    );
  }, [live, ids]);
  const key = useSyncExternalStore(subscribe, read, () => NONE);
  return useMemo(() => JSON.parse(key) as RaceLaneState[], [key]);
}
