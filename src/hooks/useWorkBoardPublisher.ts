import { useEffect, useMemo, useRef } from "react";
import type { ChatStatusWord } from "../lib/chatStatus";
import type { Session } from "../lib/session";
import type { LeadDecided } from "../lib/teamAttention";
import type { TeamRun } from "../lib/teamRuns";
import { boardChats, type BoardChat } from "../lib/workBoard";
import { publishWorkBoardFeed } from "../lib/workBoardFeed";
import { equalChromeData } from "./useChromeProps";

const NO_CHATS: readonly BoardChat[] = Object.freeze([]);

/**
 * Publish what the project boards show while one is on screen (see
 * `workBoardFeed`). The loaded chats are first reduced to small rows that
 * keep their identity until something a card shows changes, so a streamed
 * reply publishes nothing. While no board is on screen nothing is read.
 */
export function useWorkBoardPublisher({
  enabled,
  sessions,
  inFlightIds,
  leadDecided,
  statuses,
  teams,
}: {
  enabled: boolean;
  sessions: readonly Session[];
  /** The workspace's busy set (stable identity). */
  inFlightIds: ReadonlySet<string>;
  leadDecided: LeadDecided;
  statuses: Readonly<Record<string, ChatStatusWord>>;
  teams: readonly TeamRun[];
}): void {
  const next = useMemo(
    () => (enabled ? boardChats(sessions, inFlightIds, leadDecided) : NO_CHATS),
    [enabled, sessions, inFlightIds, leadDecided],
  );
  const stable = useRef(next);
  if (stable.current !== next && !equalChromeData(stable.current, next))
    stable.current = next;
  const chats = stable.current;
  useEffect(() => {
    if (enabled) publishWorkBoardFeed({ chats, statuses, teams });
  }, [enabled, chats, statuses, teams]);
}
