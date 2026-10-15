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

/**
 * The unfinished discussion `sessionId` is in, if any. Shown wherever the chat
 * is open; stopping or resuming it there moves it to that window.
 */
export function useSessionDiscussion(sessionId?: string): Discussion | null {
  const list = useDiscussionList();
  return useMemo(
    () =>
      (sessionId &&
        list.find(
          (discussion) =>
            discussion.status !== "ended" &&
            discussionSideOf(discussion, sessionId) !== null,
        )) ||
      null,
    [list, sessionId],
  );
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
