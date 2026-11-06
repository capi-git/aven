import { useCallback, useSyncExternalStore } from "react";
import { crewLiveReply, subscribeCrewLiveReplies } from "../lib/crewLiveReply";

/** What this teammate is writing to you right now, or null. */
export function useCrewLiveReply(
  path: string,
  memberId: string,
): string | null {
  const read = useCallback(
    () => crewLiveReply(path, memberId),
    [path, memberId],
  );
  return useSyncExternalStore(subscribeCrewLiveReplies, read, read);
}
