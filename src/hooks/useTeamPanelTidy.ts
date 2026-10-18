import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { racesSnapshot, subscribeRaces } from "../lib/race";
import {
  endedRacePills,
  finishedPanelLook,
  finishedPanelShrinks,
  type FinishedPanelLook,
} from "../lib/teamPanelTidy";
import { useDiscussionList } from "./useDiscussions";
import type { TeamWatchControls } from "./useTeamWatch";

/**
 * Keeps this window's floating team panel to live work (see
 * `teamPanelTidy`): a kept or discarded race's pill says so briefly, then
 * goes, and a finished discussion's panel shrinks to its pill once its plan
 * is sent or the user moves to a view without its chats. `view` is the
 * chats on screen, one id per line.
 */
export function useTeamPanelTidy(panel: TeamWatchControls, view: string) {
  const { state, close, shrink } = panel;
  const races = useSyncExternalStore(
    subscribeRaces,
    racesSnapshot,
    racesSnapshot,
  );
  const discussions = useDiscussionList();

  // When each ended race first showed as a pill here.
  const shownSince = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const { ended, due, next } = endedRacePills(
      state,
      races,
      shownSince.current,
      now,
    );
    for (const id of [...shownSince.current.keys()])
      if (!ended.includes(id)) shownSince.current.delete(id);
    for (const id of ended)
      if (!shownSince.current.has(id)) shownSince.current.set(id, now);
    for (const id of due) close(id);
    if (next === null) return;
    const timer = setTimeout(() => setTick((count) => count + 1), next - now);
    return () => clearTimeout(timer);
  }, [state, races, close, tick]);

  // The open panel as last looked at; undefined until the first look.
  const look = useRef<FinishedPanelLook | null | undefined>(undefined);
  useEffect(() => {
    const now = finishedPanelLook(state.expanded, discussions, view);
    const shrinks = finishedPanelShrinks(look.current, now);
    look.current = now
      ? { id: now.id, ended: now.ended, built: now.built, view: now.view }
      : null;
    if (shrinks) shrink();
  }, [state.expanded, discussions, view, shrink]);
}
