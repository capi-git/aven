import { memo } from "react";
import { useSessionDiscussion } from "../hooks/useDiscussions";
import {
  discussionParty,
  discussionRound,
  discussionSideOf,
  discussionStore,
  otherSide,
  speakingSide,
} from "../lib/discussions";
import { HarnessIcon } from "./HarnessIcon";
import { Play, Square } from "./icons";
import "./ProviderMarks.css";
import "./SidebarDiscussions.css";

/**
 * The slim bar above the composer of each chat in a discussion: who it is
 * talking with, the round, and Stop (Resume while paused). It reads the
 * discussion store directly, so streaming in either chat never renders it.
 */
export const DiscussionBar = memo(function DiscussionBar({
  sessionId,
}: {
  sessionId?: string;
}) {
  const discussion = useSessionDiscussion(sessionId);
  if (!discussion || !sessionId) return null;
  const side = discussionSideOf(discussion, sessionId);
  if (!side) return null;
  const partner = discussionParty(discussion, otherSide(side));
  const paused = discussion.status === "paused";
  const answering = speakingSide(discussion) !== side;
  const store = discussionStore();
  const preview = discussion.preview ? "Preview · " : "";
  return (
    <div className="px-2 pb-1" data-discussion-bar={discussion.id}>
      <div
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-content/10 bg-content/3 pl-2 pr-0.5 text-ui-label text-content/60"
        data-paused={paused || undefined}
      >
        <span
          className="discussion-talk-mark"
          data-provider={partner.harness}
          data-talking={(!paused && answering) || undefined}
          aria-hidden
        >
          <HarnessIcon harness={partner.harness} className="size-3.5" />
        </span>
        {paused ? (
          <span
            className="min-w-0 flex-1 truncate"
            title={discussion.reason}
            role="status"
          >
            {preview}Paused
            {discussion.reason ? ` · ${discussion.reason}` : ""}
          </span>
        ) : (
          <span
            className="min-w-0 flex-1 truncate"
            title={`${partner.model} in “${partner.title}”`}
          >
            {preview}Discussing with{" "}
            <span className="text-content/85">{partner.model}</span> in “
            {partner.title}”
          </span>
        )}
        <span className="shrink-0 tabular-nums text-content/45">
          round {discussionRound(discussion)} of {discussion.rounds}
        </span>
        {paused ? (
          <button
            type="button"
            onClick={() => store.resume(discussion.id)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-content/70 hover:bg-content/10 hover:text-content"
          >
            <Play className="size-3" />
            Resume
          </button>
        ) : null}
        <button
          type="button"
          title="Stop discussion"
          aria-label="Stop discussion"
          onClick={() => store.stop(discussion.id)}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-content/70 hover:bg-content/10 hover:text-content"
        >
          <Square className="size-2.5" />
          Stop
        </button>
      </div>
    </div>
  );
});
