import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
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

/** What a chat's wrap-up card reads from its discussion. */
export type DiscussionWrapUpView = Pick<
  Discussion,
  "id" | "status" | "settled" | "ended" | "summary" | "a" | "b"
>;

function wrapUpView(discussion: Discussion | undefined) {
  if (!discussion) return null;
  const { id, status, settled, ended, summary, a, b } = discussion;
  return { id, status, settled, ended, summary, a, b };
}

function sameWrapUp(
  left: DiscussionWrapUpView | null,
  right: DiscussionWrapUpView | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.settled === right.settled &&
    left.ended === right.ended &&
    left.summary === right.summary &&
    left.a === right.a &&
    left.b === right.b
  );
}

/**
 * One discussion's ending and wrap-up, by id, or null once it is no longer
 * kept. Its value changes only when those change, so a chat's card does not
 * re-render as the discussion's other fields or other discussions change.
 */
export function useDiscussionWrapUp(id: string): DiscussionWrapUpView | null {
  const store = discussionStore();
  const last = useRef<DiscussionWrapUpView | null>(null);
  const read = useCallback(() => {
    const next = wrapUpView(store.get(id));
    if (sameWrapUp(last.current, next)) return last.current;
    last.current = next;
    return next;
  }, [id, store]);
  return useSyncExternalStore(store.subscribe, read, read);
}
