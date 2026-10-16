import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { installDuplicateServerMessenger } from "../lib/devServerDuplicates";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type Block,
  type Session,
} from "../lib/session";
import {
  editOverlapsSnapshot,
  forgetSharedWorkSession,
  installSharedWorkSessions,
  subscribeSharedWork,
  type EditOverlap,
} from "../lib/sharedWork";
import {
  subscribeWorkConflicts,
  workConflictsSnapshot,
  type WorkConflictMap,
} from "../lib/workConflicts";

/**
 * The other working chats editing this chat's files. Renders only when that
 * changes, never for streamed text.
 */
export function useSessionOverlap(
  sessionId: string | undefined,
): readonly EditOverlap[] | undefined {
  const overlaps = useSyncExternalStore(
    subscribeSharedWork,
    editOverlapsSnapshot,
    editOverlapsSnapshot,
  );
  return sessionId ? overlaps[sessionId] : undefined;
}

/** Per chat, whether it bumps into another chat's work; for the sidebar. */
export function useWorkConflicts(): WorkConflictMap {
  return useSyncExternalStore(
    subscribeWorkConflicts,
    workConflictsSnapshot,
    workConflictsSnapshot,
  );
}

/** First line of the user's latest request; relays and app turns skipped. */
export function latestRequest(blocks: readonly Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role !== "user" || block.internal || block.discussion) continue;
    const line = block.text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean);
    if (line) return line;
  }
  return undefined;
}

/**
 * Tell the shared-work store about this window's chats, read when a note is
 * built; and forget chats once they close.
 */
export function useSharedWorkSessions(
  sessionsRef: RefObject<readonly Session[]>,
  openIds: string,
): void {
  useEffect(
    () =>
      installSharedWorkSessions((id) => {
        const session = sessionsRef.current?.find((entry) => entry.id === id);
        if (!session) return undefined;
        const request = latestRequest(session.blocks);
        return {
          harness: session.harness,
          title: sessionDisplayTitle(session.title, session.harness),
          project: session.cwd,
          cwd: sessionWorkCwd(session),
          runtimeMode: session.runtimeMode,
          ...(request ? { request } : {}),
        };
      }),
    [sessionsRef],
  );
  const previous = useRef<Set<string>>(new Set());
  useEffect(() => {
    const open = new Set(openIds ? openIds.split("\n") : []);
    for (const id of previous.current)
      if (!open.has(id)) forgetSharedWorkSession(id);
    previous.current = open;
  }, [openIds]);
}

/** "Ask Codex to stop it" queues its message through the normal send path. */
export function useDuplicateServerMessenger(
  send: (sessionId: string, text: string) => boolean | void,
): void {
  const latest = useRef(send);
  latest.current = send;
  useEffect(
    () =>
      installDuplicateServerMessenger((sessionId, text) =>
        latest.current(sessionId, text),
      ),
    [],
  );
}
