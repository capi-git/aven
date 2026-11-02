import { useCallback, useSyncExternalStore } from "react";
import {
  setTeamView,
  subscribeTeamView,
  teamView,
  type TeamView,
} from "../lib/teamView";

/** A project's team screen view, Board or Chat, and a way to switch it. */
export function useTeamView(
  path: string,
): [TeamView, (view: TeamView) => void] {
  const get = useCallback(() => teamView(path), [path]);
  const view = useSyncExternalStore(subscribeTeamView, get, get);
  const set = useCallback((next: TeamView) => setTeamView(path, next), [path]);
  return [view, set];
}
