import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { discussionStore, type Discussion } from "../lib/discussions";

/** Every window's discussions; changes only when one starts, moves on or ends. */
export function useDiscussionList(): readonly Discussion[] {
  const store = discussionStore();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
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

/**
 * Some fields of one discussion, by id, or null once it is gone. The value
 * changes only when one of `fields` does, so a component that reads a few
 * of them does not re-render as the rest of that discussion, or any other
 * discussion, changes. `fields` must be a constant.
 */
function useDiscussionFields(
  id: string,
  fields: readonly (keyof Discussion)[],
): Discussion | null {
  const store = discussionStore();
  const last = useRef<Discussion | null>(null);
  const read = useCallback(() => {
    const next = store.get(id) ?? null;
    const previous = last.current;
    if (
      previous === next ||
      (previous &&
        next &&
        previous.id === next.id &&
        fields.every((field) => previous[field] === next[field]))
    )
      return previous;
    last.current = next;
    return next;
  }, [fields, id, store]);
  return useSyncExternalStore(store.subscribe, read, read);
}

const CARD_FIELDS = [
  "status",
  "settled",
  "rounds",
  "relay",
  "reason",
  "blockedBy",
  "ended",
  "a",
  "b",
] as const;

/**
 * One discussion as its card in the chat that started it shows it: the
 * round, the latest reply, why it waits, and how it ended.
 */
export function useDiscussionCard(id: string): Discussion | null {
  return useDiscussionFields(id, CARD_FIELDS);
}

/**
 * The running or paused discussion this chat started, by id, or null: while
 * there is one, what the user sends from this chat goes to both chats. A
 * string, so the chat re-renders only when it starts or ends.
 */
export function useStartedDiscussionId(sessionId?: string): string | null {
  const store = discussionStore();
  const read = useCallback(
    () =>
      (sessionId &&
        store
          .snapshot()
          .find(
            (discussion) =>
              discussion.a.sessionId === sessionId &&
              discussion.status !== "ended" &&
              !discussion.preview,
          )?.id) ||
      null,
    [sessionId, store],
  );
  return useSyncExternalStore(store.subscribe, read, read);
}
