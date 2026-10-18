import { agentFullName, agentNameWithModel } from "./agentNames";
import { chatChoiceTitle, chatLastUsedAt } from "./chatChoice";
import { orchestrator } from "./orchestration";
import type { LiveSessionStore } from "./liveSessions";
import { modelDisplayName } from "./sessionLabels";
import { raceLaneFor, type RaceRecord } from "./race";
import { sameProjectPath } from "./recents";
import { sessionIsWaitingForInput, type HarnessId } from "./session";

/** A chat that could review the race, and why it can't now, if so. */
export type ReviewerChoice = {
  sessionId: string;
  harness: HarnessId;
  /** "Claude Opus 4.6". */
  label: string;
  /** "Claude Code · Opus 4.6", for tooltips. */
  fullName: string;
  /** Its title, or its first message while it has none, or "Empty chat". */
  title: string;
  /** When it was last used, if known. */
  lastUsedAt?: number;
  busy?: "Working" | "Needs you";
};

/**
 * Chats in the race's project that could review it: the chat it was sent
 * from first, then the others, most recently used first. Never a lane of any race, an
 * orchestration's worker, a lead whose run is open (the comparison would
 * land in its run as an instruction), or a chat a run keeps from working.
 */
export function reviewerChoices(
  race: RaceRecord,
  live: Pick<LiveSessionStore, "list">,
  runs: Pick<typeof orchestrator, "run" | "blockingRun"> = orchestrator,
): ReviewerChoice[] {
  return live
    .list()
    .filter((session) => {
      if (
        !sameProjectPath(session.cwd, race.project) ||
        session.inboxAsk ||
        session.orchestrationLeadId ||
        raceLaneFor(session.id)
      )
        return false;
      const own = runs.run(session.id);
      if (own && (own.status === "active" || own.status === "paused"))
        return false;
      return !runs.blockingRun(session.id);
    })
    .map((session): ReviewerChoice => {
      // Its own model's name: an unknown id keeps its identity rather than
      // borrowing the provider default's name.
      const agent = {
        harness: session.harness,
        model: modelDisplayName(session.harness, session.model),
      };
      const lastUsedAt = chatLastUsedAt(session);
      return {
        sessionId: session.id,
        harness: session.harness,
        label: agentNameWithModel(agent),
        fullName: agentFullName(agent),
        title: chatChoiceTitle(session),
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
        ...(sessionIsWaitingForInput(session)
          ? { busy: "Needs you" as const }
          : session.busy
            ? { busy: "Working" as const }
            : {}),
      };
    })
    .reverse()
    .sort(
      (a, b) =>
        Number(b.sessionId === race.origin?.sessionId) -
          Number(a.sessionId === race.origin?.sessionId) ||
        (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1),
    );
}
