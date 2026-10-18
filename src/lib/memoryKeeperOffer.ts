import type { Session } from "./session";

/** Where a chat stands in a team, as far as the offer needs to know. */
export type MemoryOfferTeamContext = {
  /** The chat races in a lane of its own. */
  lane: boolean;
  /** It started its team, or was brought into one (partner, worker). */
  teamRole: "origin" | "member" | null;
  /** That team is still running. */
  teamOpen: boolean;
};

/**
 * Whether a chat may carry the memory keeper's offer: one the user started
 * and works in themselves. Never a race lane, a discussion's partner, an
 * orchestration's worker or reviewer, or an Inbox conversation, and not
 * while a team it started is running, when the stack above its message box
 * already says enough.
 */
export function chatMayOfferMemoryKeeper(
  session: Pick<Session, "inboxAsk" | "orchestrationLeadId">,
  context: MemoryOfferTeamContext,
): boolean {
  if (session.inboxAsk || session.orchestrationLeadId || context.lane)
    return false;
  if (context.teamRole === "member") return false;
  return !(context.teamRole === "origin" && context.teamOpen);
}
