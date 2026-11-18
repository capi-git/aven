import { useState } from "react";
import { MessageSquarePlus, X } from "../chrome/icons";
import { Popover, type PopoverAnchor } from "../chrome/Popover";
import { diffCommentLocation, formatDiffComment } from "../lib/diffComment";
import { MOD } from "../lib/platform";
import { requestAddToChat } from "../lib/quoteDraft";
import {
  addReviewComment,
  markReviewSent,
  reviewProject,
} from "../lib/reviewQueue";
import type { UnifiedLine } from "../lib/unifiedDiff";

export type DiffCommentComposerTarget = {
  line: UnifiedLine;
  anchor: PopoverAnchor;
};

export function DiffCommentComposer({
  path,
  target,
  onDismiss,
}: {
  path: string;
  target: DiffCommentComposerTarget;
  onDismiss: () => void;
}) {
  const [comment, setComment] = useState("");
  const location = diffCommentLocation({ path, line: target.line });
  // With a project open, comments wait in its Review tab until sent.
  const canQueue = !!reviewProject();
  /** Files the comment in Review; `send` also puts it in the chat now. */
  const submit = (send: boolean) => {
    const message = formatDiffComment({ path, line: target.line }, comment);
    if (!message) return;
    const { line } = target;
    const number = line.kind === "del" ? line.oldNumber : line.newNumber;
    const queued = addReviewComment({
      path,
      ...(number != null ? { startLine: number, endLine: number } : {}),
      quote: line.text,
      marker: line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ",
      text: comment.replace(/\r\n?/g, "\n").trim(),
      message,
    });
    if (send || !queued) {
      requestAddToChat(message, "plain");
      if (queued) markReviewSent(queued.id);
    }
    onDismiss();
  };

  return (
    <Popover
      anchor={target.anchor}
      side="right"
      align="start"
      gap={6}
      width={320}
      onDismiss={onDismiss}
      role="dialog"
      aria-label={`Comment on ${location}`}
      className="p-2"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(!canQueue);
        }}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-ui-caption text-content/55"
            title={location}
          >
            {location}
          </span>
          <button
            type="button"
            title="Cancel comment"
            aria-label="Cancel comment"
            onClick={onDismiss}
            className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
        <textarea
          autoFocus
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              comment.trim()
            ) {
              event.preventDefault();
              submit(!canQueue);
            }
          }}
          placeholder="Leave a comment…"
          className="aven-field max-h-40 min-h-18 w-full resize-y px-2.5 py-2 text-ui-body leading-5"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-ui-micro text-content/35">
            {MOD}↩ to add
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {canQueue ? (
              <button
                type="button"
                disabled={!comment.trim()}
                onClick={() => submit(true)}
                title="Add it to the chat's message box now"
                className="inline-flex h-7 items-center rounded-md px-2 text-ui-label font-medium text-content/70 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-40"
              >
                Add to chat
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!comment.trim()}
              title={
                canQueue
                  ? "Keep it in Review with your other comments, to send together"
                  : undefined
              }
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-ui-label font-medium text-background-base hover:bg-(--aven-inverse-hover) disabled:cursor-default disabled:opacity-40"
            >
              <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
              {canQueue ? "Add to review" : "Add to chat"}
            </button>
          </div>
        </div>
      </form>
    </Popover>
  );
}
