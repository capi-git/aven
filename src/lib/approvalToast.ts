import { leafIds, type WorkspaceTab } from "./layout";
import type { Block, Session } from "./session";
import { toolCallLabel } from "../surfaces/transcriptActivity";
import { requestsAreUsers, type LeadDecided } from "./teamAttention";
import {
  isOtherOption,
  optionIsRecommended,
  type UserQuestion,
  type UserQuestionOption,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "./userQuestion";

/** Most answers a notice offers before it asks you to open the chat. */
export const TOAST_ANSWER_LIMIT = 4;

export type ToastAnswers = {
  question: UserQuestion;
  /** The suggested option first. */
  options: UserQuestionOption[];
};

/**
 * Answers a notice can offer itself: one single-choice question with a few
 * fixed options. Anything else (several questions, multi-select, previews to
 * compare, only a typed answer) opens the chat instead.
 */
export function toastAnswers(
  prompt: UserQuestionPrompt | undefined,
): ToastAnswers | null {
  if (!prompt || prompt.questions.length !== 1) return null;
  const question = prompt.questions[0];
  if (question.multiSelect) return null;
  const options = question.options.filter((option) => !isOtherOption(option));
  if (options.length === 0 || options.length > TOAST_ANSWER_LIMIT) return null;
  if (options.some((option) => option.preview)) return null;
  const suggested = options.filter(optionIsRecommended);
  return {
    question,
    options: [
      ...suggested,
      ...options.filter((option) => !suggested.includes(option)),
    ],
  };
}

/** The reply a notice sends for one picked option. */
export function toastAnswerReply(
  question: UserQuestion,
  option: UserQuestionOption,
): UserQuestionReply {
  return { kind: "answered", answers: { [question.id]: [option.id] } };
}

export type PendingApprovalNotice = {
  sessionId: string;
  requestId: number;
  label: string;
  kind: "approval" | "question";
  block?: Block;
};

/** Latest undecided approval or clarifying question in a session, if any. */
export function pendingApprovalForSession(
  session: Session,
): PendingApprovalNotice | null {
  if (session.pendingQuestion) {
    return {
      sessionId: session.id,
      requestId: session.pendingQuestion.requestId,
      label:
        session.pendingQuestion.title ||
        session.pendingQuestion.questions[0]?.prompt ||
        "Question",
      kind: "question",
    };
  }
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (!block.approval || block.approval.decided) continue;
    return {
      sessionId: session.id,
      requestId: block.approval.requestId,
      label: toolCallLabel(block, session.cwd),
      kind: "approval",
      block,
    };
  }
  return null;
}

/** True when the conversation pane for this session is focused and active. */
export function isSessionConversationFocused(
  sessionId: string,
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
): boolean {
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab) return false;
  if (!leafIds(tab.layout).includes(sessionId)) return false;
  if (tab.focusedId !== sessionId) return false;
  return composerFocused;
}

export function hiddenApprovalNotices(
  sessions: Session[],
  activeTabId: string,
  tabs: WorkspaceTab[],
  composerFocused: boolean,
  leadDecided: LeadDecided,
): Array<PendingApprovalNotice & { session: Session }> {
  const notices: Array<PendingApprovalNotice & { session: Session }> = [];
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    // An orchestration worker answers to its lead while its run is open,
    // unless the lead left the request to you (see teamAttention).
    if (!requestsAreUsers(session, leadDecided)) continue;
    const pending = pendingApprovalForSession(session);
    if (!pending) continue;
    if (
      isSessionConversationFocused(
        session.id,
        activeTabId,
        tabs,
        composerFocused,
      )
    ) {
      continue;
    }
    notices.push({ ...pending, session });
  }
  return notices;
}
