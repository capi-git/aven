import { memo, useState, type CSSProperties } from "react";
import {
  discussionBuildSent,
  type Discussion,
  type DiscussionSide,
} from "../lib/discussions";
import type { DiscussionVoice } from "../lib/discussionVoices";
import { Check, Eye, RotateCcw } from "./icons";
import { ProjectMascot } from "./ProjectMascot";
import { TeamCardButton } from "./TeamCard";
import "./DiscussionWrapUp.css";

/** What the wrap-up reads from a discussion. */
export type WrapUpSource = Pick<
  Discussion,
  "id" | "ended" | "summary" | "a" | "b" | "built" | "settled"
>;

/**
 * Where a finished discussion landed, after its closing note: what the two
 * agreed on and what is still open, and a button to have either chat build
 * it. Only a discussion that used up its rounds is summed up; a stopped one
 * shows just the buttons. The discussion's panel shows it in full; the chat
 * that started it shows it compact, with a link back to the panel.
 */
export const DiscussionWrapUpCard = memo(function DiscussionWrapUpCard({
  discussion,
  voices,
  build,
  as: Tag = "li",
  compact = false,
  onOpen,
  onRetry,
}: {
  discussion: WrapUpSource;
  voices: Record<DiscussionSide, DiscussionVoice>;
  /**
   * Sends one side the plan; returns why it could not, or null. A panel in
   * a window of its own answers once the window that drives it has.
   */
  build?: (
    id: string,
    side: DiscussionSide,
  ) => string | null | Promise<string | null>;
  /** A list item on the page; a block of its own in a transcript. */
  as?: "li" | "div";
  compact?: boolean;
  /** Opens the discussion's panel. */
  onOpen?: () => void;
  /** Asks for the summary again, after it failed. */
  onRetry?: () => void;
}) {
  // Sent or not is the discussion's, so this card and the panel agree.
  const sentTo = (side: DiscussionSide) =>
    discussionBuildSent(discussion, side);
  const [sending, setSending] = useState<DiscussionSide | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const completed = discussion.ended?.kind === "completed";
  if (!completed && !build) return null;
  const { summary } = discussion;
  const summing =
    summary?.status === "pending" || summary?.status === "running";
  const done = summary?.status === "done" ? summary : null;
  const failed = completed && summary?.status === "failed";
  const state = !completed
    ? "stopped"
    : summing
      ? "summing"
      : done
        ? "done"
        : failed
          ? "failed"
          : "plain";
  return (
    <Tag
      className={`discussion-wrapup${compact ? " discussion-wrapup-compact" : ""}`}
      data-discussion-wrapup={state}
      aria-label="Where they landed"
    >
      {completed ? (
        <div className="discussion-wrapup-head">
          <h3 className="discussion-wrapup-title">Where they landed</h3>
          {done?.model ? (
            <span
              className="discussion-wrapup-model"
              title={`Summed up by ${done.model}`}
            >
              Summed up by {done.model}
            </span>
          ) : null}
          {onOpen ? (
            <button
              type="button"
              className="discussion-wrapup-open"
              data-discussion-wrapup-open
              title="Watch the discussion in a floating panel"
              onClick={onOpen}
            >
              <Eye className="size-3 shrink-0" />
              Watch
            </button>
          ) : null}
        </div>
      ) : null}
      {summing ? (
        <p className="discussion-wrapup-wait" role="status">
          Summing up…
        </p>
      ) : null}
      {failed ? (
        <div className="discussion-wrapup-failed">
          <p className="discussion-wrapup-wait" role="status">
            Couldn't sum this up.
          </p>
          {onRetry ? (
            <TeamCardButton
              size="compact"
              variant="ghost"
              data-discussion-wrapup-retry
              title="Ask for the summary again"
              onClick={onRetry}
            >
              <RotateCcw className="size-3" />
              Try again
            </TeamCardButton>
          ) : null}
        </div>
      ) : null}
      {done ? <WrapUpLists agreed={done.agreed} open={done.open} /> : null}
      {build ? (
        <div className="discussion-wrapup-actions">
          {(["a", "b"] as const).map((side) => {
            const voice = voices[side];
            const sent = sentTo(side);
            return (
              <button
                key={side}
                type="button"
                className="discussion-build"
                data-discussion-build={side}
                data-sent={sent || undefined}
                // Once sent, or while either is sending, it can't go twice.
                disabled={sent || sending !== null}
                style={{ "--discussion-voice": voice.color } as CSSProperties}
                title={
                  sent
                    ? `The plan was sent to “${voice.title}”`
                    : `Send the plan to “${voice.title}”`
                }
                onClick={() => {
                  if (sending !== null || sent) return;
                  const settle = (refused: string | null) => {
                    setSending(null);
                    setProblem(refused);
                  };
                  setSending(side);
                  setProblem(null);
                  let result: ReturnType<NonNullable<typeof build>>;
                  try {
                    result = build(discussion.id, side);
                  } catch {
                    settle("Couldn't send the plan. Try again.");
                    return;
                  }
                  if (result instanceof Promise)
                    void result.then(settle, () =>
                      settle("Couldn't send the plan. Try again."),
                    );
                  else settle(result);
                }}
              >
                {sent ? (
                  <Check className="size-3 shrink-0" strokeWidth={2.5} />
                ) : (
                  <ProjectMascot
                    project={voice.sessionId}
                    name={voice.mascot}
                    color={voice.color}
                    className="discussion-build-sprite"
                  />
                )}
                <span className="truncate">
                  {sent
                    ? `Sent to ${voice.name}`
                    : sending === side
                      ? "Sending…"
                      : `Have ${voice.name} build it`}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {problem ? (
        <p className="discussion-wrapup-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </Tag>
  );
});

/** Agreed and Still open, side by side (stacked when narrow). */
export function WrapUpLists({
  agreed,
  open,
}: {
  agreed: readonly string[];
  open: readonly string[];
}) {
  return (
    <div className="discussion-wrapup-lists">
      <WrapUpList
        kind="agreed"
        title="Agreed"
        items={agreed}
        empty="Nothing settled."
      />
      <WrapUpList
        kind="open"
        title="Still open"
        items={open}
        empty="Nothing left open."
      />
    </div>
  );
}

function WrapUpList({
  kind,
  title,
  items,
  empty,
}: {
  kind: "agreed" | "open";
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <section className="discussion-wrapup-list" data-discussion-list={kind}>
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="discussion-wrapup-empty">{empty}</p>
      )}
    </section>
  );
}
