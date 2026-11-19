import { CircleAlert } from "./icons";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ApprovalDecision } from "../lib/harness";
import {
  toastAnswerReply,
  toastAnswers,
  type PendingApprovalNotice,
} from "../lib/approvalToast";
import {
  optionDisplayLabel,
  optionIsRecommended,
  type UserQuestionReply,
} from "../lib/userQuestion";
import { LAYER } from "../lib/layers";
import { displayAppData } from "../lib/paths";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type Session,
} from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { QUESTION_REPLY_TIMEOUT_MS } from "./QuestionForm";

type Notice = PendingApprovalNotice & { session: Session };

type Props = {
  notices: Notice[];
  /** Other notices in the same column, below these. */
  extra?: ReactNode;
  onFocusSession: (sessionId: string) => void;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  /** Answers a simple question from the notice, as its card would. */
  onAnswer?: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
};

export function ApprovalToasts({
  notices,
  extra,
  onFocusSession,
  onApproval,
  onAnswer,
}: Props) {
  if (notices.length === 0 && !extra) return null;

  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast }}
      className="pointer-events-none fixed right-3 top-3 flex w-[min(360px,calc(100vw-24px))] flex-col gap-2"
    >
      {notices.map((notice) => (
        <ApprovalToastCard
          key={`${notice.sessionId}:${notice.requestId}`}
          notice={notice}
          onFocusSession={onFocusSession}
          onApproval={onApproval}
          onAnswer={onAnswer}
        />
      ))}
      {extra}
    </div>,
    document.body,
  );
}

function ApprovalToastCard({
  notice,
  onFocusSession,
  onApproval,
  onAnswer,
}: {
  notice: Notice;
  onFocusSession: (sessionId: string) => void;
  onApproval: Props["onApproval"];
  onAnswer?: Props["onAnswer"];
}) {
  const { session, requestId } = notice;
  const pending =
    notice.kind === "question" &&
    session.pendingQuestion?.requestId === requestId
      ? session.pendingQuestion
      : undefined;
  const quick = onAnswer ? toastAnswers(pending) : null;
  // Hold after a pick until the question closes or the agent says no.
  const [picked, setPicked] = useState<string | null>(null);
  const error = pending?.error;
  useEffect(() => {
    if (error) setPicked(null);
  }, [error]);
  // Never a dead notice: without the question closing, give the answers back.
  useEffect(() => {
    if (picked == null) return;
    const timer = setTimeout(() => setPicked(null), QUESTION_REPLY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [picked]);
  const busy = picked != null || !!pending?.submitting;
  const label = quick ? quick.question.prompt : notice.label;
  const title = sessionDisplayTitle(session.title, session.harness);
  const harness = HARNESS_TITLE[session.harness];

  const openSession = () => onFocusSession(session.id);

  return (
    <article
      className="approval-toast pointer-events-auto overflow-hidden aven-glass-overlay [--aven-radius-overlay:var(--aven-radius-bubble)]"
      role="status"
      data-native-browser-occluded="true"
    >
      <button
        type="button"
        onClick={openSession}
        className="flex w-full flex-col gap-2 px-3.5 py-3 text-left hover:bg-(--aven-hover)"
      >
        <span className="flex items-center gap-2">
          <HarnessIcon harness={session.harness} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-ui-body font-semibold leading-snug text-content">
            {title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-ui-caption text-amber-400">
            <CircleAlert className="size-3.5" strokeWidth={1.75} />
            <span>{notice.kind === "question" ? "Question" : "Approval"}</span>
          </span>
        </span>
        <span className="line-clamp-3 text-ui-label leading-relaxed text-content/70">
          {displayAppData(label)}
        </span>
        <span className="text-ui-caption text-content/40">{harness}</span>
      </button>
      {quick ? (
        <div
          className="flex flex-wrap gap-2 border-t border-content/10 px-3.5 py-2.5"
          role="group"
          aria-label="Answers"
        >
          {quick.options.map((option, index) => {
            const suggested = index === 0 && optionIsRecommended(option);
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                title={option.description}
                className={`min-w-0 max-w-full flex-1 basis-[calc(50%-4px)] truncate rounded-md px-2.5 py-1 text-ui-caption font-medium disabled:opacity-40 ${
                  suggested
                    ? "bg-content font-semibold text-background-base hover:bg-(--aven-inverse-hover)"
                    : "bg-(--aven-control-bg) text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
                }`}
                onClick={() => {
                  if (busy) return;
                  setPicked(option.id);
                  onAnswer?.(
                    session.id,
                    requestId,
                    toastAnswerReply(quick.question, option),
                  );
                }}
              >
                {picked === option.id ? "Sending…" : optionDisplayLabel(option)}
              </button>
            );
          })}
        </div>
      ) : notice.kind === "question" ? null : (
        <div className="flex gap-2 border-t border-content/10 px-3.5 py-2.5">
          <button
            type="button"
            className="flex-1 rounded-md bg-content px-2.5 py-1 text-ui-caption font-semibold text-background-base hover:bg-(--aven-inverse-hover)"
            onClick={() => onApproval(session.id, requestId, "allow")}
          >
            Allow
          </button>
          <button
            type="button"
            className="flex-1 rounded-md bg-(--aven-control-bg) px-2.5 py-1 text-ui-caption font-medium text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
            onClick={() => onApproval(session.id, requestId, "deny")}
          >
            Deny
          </button>
        </div>
      )}
    </article>
  );
}
