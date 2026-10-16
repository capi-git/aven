import { useEffect, useRef } from "react";
import {
  discussionStore,
  keptDiscussionChats,
  type DiscussionStore,
} from "../lib/discussions";

/**
 * Brings back, once when the window opens, the chats of the discussions it
 * drives that are not loaded: a discussion's partner has no tab, so a
 * reload would otherwise leave it out and the discussion could not resume.
 * Once loaded, they stay so while the discussion lasts (the keep-alive in
 * the workspace's "Tabs are views").
 */
export function useDiscussionChatsLoaded(
  ensureOpen: (sessionId: string) => Promise<unknown>,
  loadedIds: () => Iterable<string>,
  store: DiscussionStore = discussionStore(),
) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const loaded = new Set(loadedIds());
    for (const id of new Set(
      keptDiscussionChats(store.snapshot(), store.owner),
    ))
      if (!loaded.has(id)) void ensureOpen(id).catch(() => undefined);
  }, [ensureOpen, loadedIds, store]);
}
