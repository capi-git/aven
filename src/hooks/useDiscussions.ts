import { useMemo, useSyncExternalStore } from "react";
import {
  discussionSideOf,
  discussionStore,
  type Discussion,
} from "../lib/discussions";

/** Every window's discussions; changes only when one starts, moves on or ends. */
export function useDiscussionList(): readonly Discussion[] {
  const store = discussionStore();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** The unfinished discussion this window drives for `sessionId`, if any. */
export function useSessionDiscussion(sessionId?: string): Discussion | null {
  const list = useDiscussionList();
  return useMemo(() => {
    if (!sessionId) return null;
    const store = discussionStore();
    return (
      list.find(
        (discussion) =>
          discussion.status !== "ended" &&
          store.owns(discussion) &&
          discussionSideOf(discussion, sessionId) !== null,
      ) ?? null
    );
  }, [list, sessionId]);
}

/** Chats in an unfinished discussion, in any window. */
export function useDiscussingSessionIds(): ReadonlySet<string> {
  const list = useDiscussionList();
  return useMemo(
    () =>
      new Set(
        list
          .filter((discussion) => discussion.status !== "ended")
          .flatMap((discussion) => [
            discussion.a.sessionId,
            discussion.b.sessionId,
          ]),
      ),
    [list],
  );
}
