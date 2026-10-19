/**
 * Answering an agent's question card. The reply goes to whichever of the
 * chat's agents still waits on it. When none does, the card is stale: it is
 * closed and the answers go to the chat as an ordinary message instead, so
 * neither a dead card nor the user's answer is left behind.
 */
import { sessionChildHarnesses } from "./handoff";
import {
  respondHarnessApproval,
  respondHarnessQuestion,
} from "./harness/registry";
import type { ApprovalDecision } from "./harness/types";
import type { HarnessId, Session } from "./session";
import { questionReplyText, type UserQuestionReply } from "./userQuestion";

export const EXPIRED_QUESTION_SENT =
  "That question had expired, so your answers were sent as a message.";
export const EXPIRED_QUESTION_UNSENT =
  "That question had expired. Send your answer as a message.";

type ReplyTarget = Pick<Session, "id" | "harness" | "pendingSwitch" | "blocks">;

/**
 * The chat's agents, earlier ones first: after a switch of agent the earlier
 * one still runs the turn that asked, while the chat already names the next.
 */
function replyHarnesses(session: ReplyTarget): HarnessId[] {
  const all = sessionChildHarnesses(session);
  return [...all.filter((id) => id !== session.harness), session.harness];
}

/** True when one of the chat's agents was still waiting and took the reply. */
export function deliverQuestionReply(
  session: ReplyTarget,
  requestId: number,
  reply: UserQuestionReply,
): boolean {
  return replyHarnesses(session).some((harness) =>
    respondHarnessQuestion(harness, session.id, requestId, reply),
  );
}

/** An agent ignores approval ids it never asked about. */
export function deliverApproval(
  session: ReplyTarget,
  requestId: number,
  decision: ApprovalDecision,
): void {
  for (const harness of replyHarnesses(session))
    respondHarnessApproval(harness, session.id, requestId, decision);
}

export type QuestionReplyOutcome =
  /** The agent took the reply. */
  | "delivered"
  /** The card was stale; the answers went to the chat as a message. */
  | "sent"
  /** The card was stale and closed; nothing was sent. */
  | "expired";

/**
 * Deliver a card's reply. When no agent waits on it any more, close the card
 * and send the answers as a message (`send` queues it behind a running turn
 * and returns false when the chat refuses it), with a note saying so.
 */
export function answerQuestion(
  session: ReplyTarget & Pick<Session, "pendingQuestion">,
  requestId: number,
  reply: UserQuestionReply,
  effects: {
    close(requestId: number): void;
    send(text: string): boolean;
    note(text: string): void;
  },
): QuestionReplyOutcome {
  if (deliverQuestionReply(session, requestId, reply)) return "delivered";
  const shown =
    session.pendingQuestion?.requestId === requestId
      ? session.pendingQuestion
      : undefined;
  effects.close(requestId);
  const text = shown ? questionReplyText(shown.questions, reply) : "";
  if (!text) return "expired";
  const sent = effects.send(text);
  effects.note(sent ? EXPIRED_QUESTION_SENT : EXPIRED_QUESTION_UNSENT);
  return sent ? "sent" : "expired";
}
