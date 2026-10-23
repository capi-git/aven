import { useEffect, useRef } from "react";
import type { Session } from "../lib/session";
import { endedTurns, tidyTurnShots, type TurnShotTidy } from "../lib/turnShots";

/**
 * When a chat stops working, delete the page screenshots its turn took that
 * are neither labelled nor shown in its messages. Never while it works:
 * only the chats that left `workingIds` are tidied, with their newest
 * messages from `sessionsRef`.
 */
export function useTurnShotTidy(
  workingIds: ReadonlySet<string>,
  sessionsRef: { readonly current: readonly Session[] },
  tidy: (request: TurnShotTidy) => Promise<void> = tidyTurnShots,
) {
  const working = useRef(new Map<string, number>());
  useEffect(() => {
    const next = endedTurns(
      working.current,
      workingIds,
      sessionsRef.current,
      Date.now(),
    );
    working.current = next.working;
    for (const request of next.ended) void tidy(request).catch(() => {});
  }, [workingIds, sessionsRef, tidy]);
}
