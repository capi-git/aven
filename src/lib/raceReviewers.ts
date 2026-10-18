import { agentFullName, agentNameWithModel } from "./agentNames";
import { orchestrator } from "./orchestration";
import type { LiveSessionStore } from "./liveSessions";
import { modelDisplayName } from "./sessionLabels";
import { raceLaneFor, type RaceRecord } from "./race";
import { sameProjectPath } from "./recents";
import {
  sessionDisplayTitle,
  sessionIsWaitingForInput,
  type HarnessId,
} from "./session";

/** A chat that could review the race, and why it can't now, if so. */
export type ReviewerChoice = {
  sessionId: string;
  harness: HarnessId;
  /** "Claude Opus 4.6". */
  label: string;
  /** "Claude Code · Opus 4.6", for tooltips. */
  fullName: string;
  title: string;
  busy?: "Working" | "Needs you";
};

/**
 * Chats in the race's project that could review it: the chat it was sent
 * from first, then the others, newest first. Never a lane of any race, an
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
      return {
        sessionId: session.id,
        harness: session.harness,
        label: agentNameWithModel(agent),
        fullName: agentFullName(agent),
        title: sessionDisplayTitle(session.title, session.harness) || "Chat",
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
        Number(a.sessionId === race.origin?.sessionId),
    );
}
