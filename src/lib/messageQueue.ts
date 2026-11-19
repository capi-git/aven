import { canSteerHarness } from "./harness/registry";
import { isPreparingHandoff } from "./handoff";
import type { HarnessId, QueuedMessage, Session, UsageHold } from "./session";

/** What Aven sends at reset when "Continue at" is on and nothing is queued. */
export const CONTINUE_AT_RESET_TEXT = "Continue where you left off.";

/**
 * The usage limit that holds this chat's messages back at `now`: one its
 * current provider reported, with a reset still to come. A limit with no
 * reset time holds nothing back, so the user can still send by hand.
 */
export function activeUsageHold(
  session: Pick<Session, "harness" | "usageHold">,
  now = Date.now(),
): (UsageHold & { resetsAt: number }) | undefined {
  const hold = session.usageHold;
  if (!hold || hold.reset || hold.harness !== session.harness) return undefined;
  const { resetsAt } = hold;
  if (resetsAt === undefined || now >= resetsAt) return undefined;
  return { ...hold, resetsAt };
}

/**
 * The chat once its usage limit has reset: the hold is gone, and when
 * "Continue at" was on and nothing is queued, a short continue waits in the
 * queue to send. Unchanged (the same object) while the limit still holds or
 * there is no hold.
 */
export function releaseUsageHold(session: Session, now = Date.now()): Session {
  const hold = session.usageHold;
  if (!hold || hold.reset || hold.resetsAt === undefined || now < hold.resetsAt)
    return session;
  const { usageHold: _released, ...rest } = session;
  if (
    !hold.continueAtReset ||
    session.busy ||
    session.queuedMessages?.length ||
    hold.harness !== session.harness
  )
    // A cut-off turn still says its limit has reset, until the next message.
    return hold.cutOff && !session.busy
      ? { ...rest, usageHold: { ...withoutContinue(hold), reset: true } }
      : rest;
  return {
    ...rest,
    queuedMessages: [
      {
        id: crypto.randomUUID(),
        text: CONTINUE_AT_RESET_TEXT,
        attachments: [],
      },
    ],
    queueStatus: "active",
  };
}

/**
 * "Continue at" turned on or off: offered only for a turn the limit cut off,
 * with a reset time still to come.
 */
export function setContinueAtReset(session: Session, on: boolean): Session {
  const hold = session.usageHold;
  if (!hold?.cutOff || hold.reset || hold.resetsAt === undefined)
    return session;
  if (!!hold.continueAtReset === on) return session;
  return {
    ...session,
    usageHold: on ? { ...hold, continueAtReset: true } : withoutContinue(hold),
  };
}

function withoutContinue(hold: UsageHold): UsageHold {
  const { continueAtReset: _off, ...rest } = hold;
  return rest;
}

/** The earliest reset still to come among `sessions`' holds, for a timer. */
export function nextUsageReset(
  sessions: readonly Pick<Session, "usageHold">[],
): number | undefined {
  let next: number | undefined;
  for (const session of sessions) {
    if (session.usageHold?.reset) continue;
    const at = session.usageHold?.resetsAt;
    if (at !== undefined && (next === undefined || at < next)) next = at;
  }
  return next;
}

/** A busy provider without steering support must retain follow-ups in its queue. */
export function shouldQueueFollowUp(
  harness: HarnessId,
  behavior: "queue" | "steer",
): boolean {
  return behavior === "queue" || !canSteerHarness(harness);
}

/** Queue intent survives provider switches and keeps new work behind the queue. */
export function shouldEnqueueSubmission(
  session: Pick<Session, "harness" | "busy" | "queuedMessages" | "usageHold">,
  behavior: "queue" | "steer",
  queuedMessageId?: string,
  now = Date.now(),
): boolean {
  if (session.busy) return shouldQueueFollowUp(session.harness, behavior);
  // A new message waits for the usage limit to reset instead of running
  // into it; a queued row sent by hand ("Send now") goes anyway.
  if (!queuedMessageId && activeUsageHold(session, now)) return true;
  return (
    !queuedMessageId &&
    behavior === "queue" &&
    Boolean(session.queuedMessages?.length)
  );
}

export function queuedHead(session: Session): QueuedMessage | undefined {
  return session.queuedMessages?.[0];
}

/** Hold auto-dispatch only while the item about to send is being edited. */
export function isEditingQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return Boolean(head && session.editingQueuedMessageId === head.id);
}

export function dequeueQueuedMessage(
  session: Session,
  messageId: string,
): Session {
  const queuedMessages = (session.queuedMessages ?? []).filter(
    (message) => message.id !== messageId,
  );
  return {
    ...session,
    queuedMessages: queuedMessages.length > 0 ? queuedMessages : undefined,
    queueStatus: queuedMessages.length > 0 ? session.queueStatus : undefined,
    editingQueuedMessageId:
      session.editingQueuedMessageId === messageId
        ? undefined
        : session.editingQueuedMessageId,
  };
}

/**
 * True when the idle session can send its queued head as a new turn.
 * Busy / paused / resuming / preparing-handoff / editing-the-head / held by
 * the usage limit all wait.
 */
export function canDispatchQueuedHead(
  session: Session,
  now = Date.now(),
): boolean {
  if (session.busy) return false;
  if (activeUsageHold(session, now)) return false;
  if (session.queueStatus === "paused" || session.queueStatus === "resuming") {
    return false;
  }
  const head = queuedHead(session);
  if (!head) return false;
  if (isEditingQueuedHead(session)) return false;
  if (isPreparingHandoff(session)) return false;
  return true;
}

/** What sending a queued row passes on, as the message was first sent. */
export function queuedSubmitOptions(message: QueuedMessage) {
  return {
    queuedMessageId: message.id,
    noteCard: message.noteCard,
    handoffCard: message.handoffCard,
    intent: message.intent,
    ...(message.displayText !== undefined
      ? { displayText: message.displayText }
      : {}),
    ...(message.verbatim ? { verbatim: true as const } : {}),
    ...(message.typed ? { typed: true as const } : {}),
  };
}

/** Resolve a queued row for auto-dispatch (head, idle) or an explicit Steer. */
export function queuedMessageForSubmit(
  session: Session,
  messageId: string,
  mode: "dispatch" | "steer",
): QueuedMessage | undefined {
  const message = session.queuedMessages?.find(
    (entry) => entry.id === messageId,
  );
  if (!message) return undefined;
  if (mode === "steer") return message;
  if (queuedHead(session)?.id !== messageId) return undefined;
  if (!canDispatchQueuedHead(session)) return undefined;
  return message;
}
