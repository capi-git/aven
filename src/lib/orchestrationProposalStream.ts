import type { HarnessEvent } from "./harness/types";
import {
  completeOrchestrationProposal,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "./orchestrationPlan";
import { isProviderFailureText } from "./plan";
import type { Session } from "./session";

const MAX_PROPOSAL_TEXT = 200_000;

/** Keep the original callback's proposal stream alive until its final message. */
export function createOrchestrationProposalStream(
  blockId: string,
  draft: OrchestrationProposal,
) {
  let text = "";
  let nativeText = "";
  let failure: string | undefined;
  let completed: OrchestrationProposal | undefined;
  let recovered: OrchestrationProposal | undefined;
  let rejected: OrchestrationProposal | undefined;

  const bound = (value: string) => {
    if (value.length > MAX_PROPOSAL_TEXT)
      failure ??=
        "The assignment response was too large. Generate the assignments again.";
    return value.slice(0, MAX_PROPOSAL_TEXT);
  };
  const finish = (error?: string) => {
    failure ??= error ?? [nativeText, text].find(isProviderFailureText);
    completed = completeOrchestrationProposal(
      draft,
      [nativeText, text],
      failure,
    );
    return completed;
  };

  return {
    consume(event: HarnessEvent): boolean {
      switch (event.type) {
        case "session.error":
          failure ??= event.message || "The lead could not finish planning.";
          return false;
        case "message.delta":
          text = bound(text + event.text);
          return true;
        case "message.completed":
          text = bound(text + "\n");
          failure ??= [nativeText, text].find(isProviderFailureText);
          return true;
        case "plan":
          nativeText = bound(
            event.append ? nativeText + event.text : event.text,
          );
          if (!event.streaming)
            failure ??= [nativeText, text].find(isProviderFailureText);
          return true;
        default:
          return false;
      }
    },
    finish,
    recover(session: Session, event: HarnessEvent): Session {
      if (
        !completed ||
        (event.type !== "session.error" &&
          event.type !== "message.completed" &&
          !(event.type === "plan" && !event.streaming))
      )
        return session;

      const index = session.blocks.findIndex((block) => block.id === blockId);
      const card = session.blocks[index];
      // The caller also checks turn generation and runtime ownership. Within
      // the transcript, never replace an edited, approved, or newer proposal.
      if (
        !card ||
        session.blocks
          .slice(index + 1)
          .some(
            (block) => block.role === "user" || Boolean(block.orchestration),
          )
      )
        return session;

      // A completed message can precede a provider failure. Revoke only the
      // exact ready card we just recovered, before the user edits or starts it.
      if (failure) {
        if (!recovered || card.orchestration !== recovered) return session;
        rejected ??= completeOrchestrationProposal(draft, "", failure);
        return withOrchestrationProposal(session, blockId, rejected);
      }
      if (completed.status !== "invalid" || card.orchestration !== completed)
        return session;
      if (!recovered) {
        const candidate = completeOrchestrationProposal(draft, [
          nativeText,
          text,
        ]);
        if (candidate.status !== "ready") return session;
        recovered = candidate;
      }
      return withOrchestrationProposal(session, blockId, recovered);
    },
  };
}
