import { useEffect, useMemo, useState } from "react";
import { gitPrStatus, type GitFileDiffKind } from "../lib/fs";
import {
  githubWorkItemThread,
  type GithubWorkItemComment,
} from "../lib/githubTasks";
import { openInAppUrl } from "../lib/inAppLinks";
import { reviewReplyInstruction } from "../lib/mergeLine";
import { requestAddToChat } from "../lib/quoteDraft";
import {
  markReviewSent,
  removeReviewComment,
  useReviewComments,
  type ReviewComment,
} from "../lib/reviewQueue";
import { MessageSquarePlus, X } from "./icons";
import "./ReviewPanel.css";

type Props = {
  cwd: string;
  enabled: boolean;
  onOpenDiff: (path: string, kind?: GitFileDiffKind) => void;
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
};

type View = "open" | "done";
/** The last view, kept while Aven runs, as the other tabs keep theirs. */
let lastView: View = "open";

/** "src/app.ts:12" or "src/app.ts:12–14". */
export function reviewLocation(
  comment: Pick<ReviewComment, "path" | "startLine" | "endLine">,
): string {
  const { path, startLine, endLine } = comment;
  if (startLine == null) return path;
  return endLine != null && endLine !== startLine
    ? `${path}:${startLine}–${endLine}`
    : `${path}:${startLine}`;
}

function absolutePath(cwd: string, path: string): string {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
    ? path
    : `${cwd.replace(/\/+$/, "")}/${path}`;
}

/**
 * The open pull request's review threads, read once each time the tab is
 * shown (nothing polls). Empty without a pull request or GitHub access.
 */
function usePrThreads(cwd: string, enabled: boolean) {
  const [threads, setThreads] = useState<GithubWorkItemComment[]>([]);
  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") return;
    let cancelled = false;
    void gitPrStatus(cwd)
      .then((pr) =>
        pr?.state === "open"
          ? githubWorkItemThread(cwd, "pr", pr.number)
          : null,
      )
      .then((thread) => {
        if (cancelled) return;
        setThreads(
          (thread?.comments ?? []).filter(
            (comment) => comment.kind === "review_comment",
          ),
        );
      })
      .catch(() => {
        // No GitHub, no pull request: the tab lists your own comments only.
        if (!cancelled) setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, enabled]);
  return threads;
}

/** The Review tab: comments left on a diff, and the pull request's threads. */
export function ReviewPanel({
  cwd,
  enabled,
  onOpenDiff,
  onOpenAllChanges,
}: Props) {
  const [view, setView] = useState<View>(lastView);
  const comments = useReviewComments(cwd);
  const threads = usePrThreads(cwd, enabled);
  const open = useMemo(
    () => comments.filter((comment) => !comment.sentAt),
    [comments],
  );
  const done = useMemo(
    () =>
      comments
        .filter((comment) => comment.sentAt)
        .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
    [comments],
  );
  const openThreads = threads.filter((thread) => !thread.resolved);
  const doneThreads = threads.filter((thread) => thread.resolved);
  const show = (next: View) => {
    lastView = next;
    setView(next);
  };
  const send = (list: readonly ReviewComment[]) => {
    if (list.length === 0) return;
    requestAddToChat(
      list.map((comment) => comment.message).join("\n\n"),
      "plain",
    );
    for (const comment of list) markReviewSent(comment.id);
  };
  const openComment = (comment: ReviewComment) =>
    onOpenDiff(absolutePath(cwd, comment.path));

  const nothingOpen = open.length === 0 && openThreads.length === 0;
  const nothingDone = done.length === 0 && doneThreads.length === 0;

  return (
    <div className="review-panel">
      <div className="inspector-switch" role="tablist" aria-label="Review">
        {(["open", "done"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className="inspector-pill"
            onClick={() => show(value)}
          >
            {value === "open" ? "Open" : "Done"}
          </button>
        ))}
      </div>
      {view === "open" ? (
        nothingOpen ? (
          nothingDone ? (
            <div className="inspector-empty" role="status">
              <p className="inspector-empty-title">Nothing to review</p>
              <p className="inspector-empty-detail">
                Comments you leave on a diff, and your pull request’s review
                threads, show up here.
              </p>
              <button
                type="button"
                className="inspector-empty-action"
                onClick={() => onOpenAllChanges()}
              >
                Review changes
              </button>
              <p className="inspector-empty-hint">
                or select lines in any diff to comment
              </p>
            </div>
          ) : (
            <div className="inspector-empty" role="status">
              <p className="inspector-empty-title">All caught up</p>
              <button
                type="button"
                className="inspector-empty-link"
                onClick={() => show("done")}
              >
                See what’s done
              </button>
            </div>
          )
        ) : (
          <div className="review-list">
            {open.length > 0 ? (
              <section aria-label="Your comments">
                <header className="review-section-head">
                  <span>Your comments</span>
                  {open.length > 1 ? (
                    <button
                      type="button"
                      className="review-section-action"
                      onClick={() => send(open)}
                    >
                      Send all to chat
                    </button>
                  ) : null}
                </header>
                <ul>
                  {open.map((comment) => (
                    <CommentRow
                      key={comment.id}
                      comment={comment}
                      onOpen={() => openComment(comment)}
                      onSend={() => send([comment])}
                      onRemove={() => removeReviewComment(comment.id)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {openThreads.length > 0 ? (
              <ThreadSection
                title="Pull request"
                threads={openThreads}
                onReply={(thread) =>
                  requestAddToChat(reviewReplyInstruction(thread), "plain")
                }
              />
            ) : null}
          </div>
        )
      ) : nothingDone ? (
        <div className="inspector-empty" role="status">
          <p className="inspector-empty-title">Nothing done yet</p>
          <p className="inspector-empty-detail">
            Comments you send and threads that get resolved show up here.
          </p>
        </div>
      ) : (
        <div className="review-list">
          {done.length > 0 ? (
            <section aria-label="Sent comments">
              <header className="review-section-head">
                <span>Sent to chat</span>
              </header>
              <ul>
                {done.map((comment) => (
                  <CommentRow
                    key={comment.id}
                    comment={comment}
                    onOpen={() => openComment(comment)}
                    onRemove={() => removeReviewComment(comment.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {doneThreads.length > 0 ? (
            <ThreadSection title="Resolved threads" threads={doneThreads} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  onOpen,
  onSend,
  onRemove,
}: {
  comment: ReviewComment;
  onOpen: () => void;
  /** Absent once the comment has been sent. */
  onSend?: () => void;
  onRemove: () => void;
}) {
  const location = reviewLocation(comment);
  return (
    <li className="review-item" data-done={comment.sentAt ? true : undefined}>
      <button
        type="button"
        className="review-item-main"
        title={`Open ${location}`}
        onClick={onOpen}
      >
        <span className="review-item-location">{location}</span>
        {comment.quote ? (
          <span className="review-item-quote">
            {comment.marker?.trim() ? `${comment.marker} ` : ""}
            {comment.quote}
          </span>
        ) : null}
        <span className="review-item-text">{comment.text}</span>
      </button>
      <div className="review-item-actions">
        {onSend ? (
          <button
            type="button"
            className="review-item-send"
            onClick={onSend}
            title="Add this comment to the chat's message box"
          >
            <MessageSquarePlus className="size-3" strokeWidth={1.75} />
            Send to chat
          </button>
        ) : null}
        <button
          type="button"
          className="review-item-icon"
          aria-label={`Remove comment on ${location}`}
          title="Remove"
          onClick={onRemove}
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function ThreadSection({
  title,
  threads,
  onReply,
}: {
  title: string;
  threads: GithubWorkItemComment[];
  /** Puts the thread in the chat's message box to fix and answer. */
  onReply?: (thread: GithubWorkItemComment) => void;
}) {
  return (
    <section aria-label={title}>
      <header className="review-section-head">
        <span>{title}</span>
      </header>
      <ul>
        {threads.map((thread) => {
          const location = reviewLocation({
            path: thread.path,
            startLine: thread.line ?? undefined,
          });
          const replies = thread.replies.length;
          return (
            <li
              key={thread.threadId || thread.id}
              className="review-item"
              data-done={thread.resolved || undefined}
            >
              <button
                type="button"
                className="review-item-main"
                title={thread.url || location}
                disabled={!thread.url}
                onClick={() => void openInAppUrl(thread.url)}
              >
                <span className="review-item-location">{location}</span>
                <span className="review-item-text">{thread.body}</span>
                <span className="review-item-meta">
                  {thread.author}
                  {replies > 0
                    ? ` · ${replies} ${replies === 1 ? "reply" : "replies"}`
                    : ""}
                </span>
              </button>
              {onReply ? (
                <div className="review-item-actions">
                  <button
                    type="button"
                    className="review-item-send"
                    onClick={() => onReply(thread)}
                    title="Put this thread in the chat's message box, asking the agent to fix it and draft a reply"
                  >
                    <MessageSquarePlus className="size-3" strokeWidth={1.75} />
                    Fix and reply
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
