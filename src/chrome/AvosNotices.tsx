import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { reviewAction } from "../lib/automationReview";
import type { AvosNotice } from "../lib/avos";
import { projectName } from "../lib/paths";
import type { ScheduledRun } from "../lib/scheduledAgents";
import { CrewCritter } from "./CrewCritter";
import { X } from "./icons";
import "./AvosNotices.css";

/**
 * When a project's Avos needs you and its screen isn't in front: one card,
 * Avos's Bot (amber), its project, the one line, and what to do about it
 * (Look at it, and Publish or Approve for a job's run). It stays until you
 * act on it or close it, and goes by itself once it's sorted elsewhere.
 */
export function AvosNoticeCard({
  notice,
  run,
  onOpen,
  onAnswer,
  onDismiss,
}: {
  notice: AvosNotice;
  /** The job's run it's about, while its card waits for you. */
  run?: ScheduledRun;
  /** Show Avos (and what it's about). */
  onOpen: (notice: AvosNotice) => void;
  /** Answer a job's run card: Publish, Approve. */
  onAnswer: (run: ScheduledRun) => void;
  onDismiss: (id: string) => void;
}) {
  const appearance = useProjectAppearance(notice.path);
  const project = appearance?.label || projectName(notice.path);
  const action =
    run?.review?.status === "open" && run.review.kind !== "needs-you"
      ? reviewAction(run.review)
      : null;
  return (
    <article
      className="avos-notice pointer-events-auto overflow-hidden aven-glass-overlay [--aven-radius-overlay:var(--aven-radius-bubble)]"
      role="status"
      data-avos-notice={notice.id}
    >
      <div className="flex gap-2.5 px-3.5 pt-3">
        <CrewCritter
          path={notice.path}
          role="lead"
          state="needs"
          className="avos-notice-mark"
        />
        <p className="min-w-0 flex-1 text-ui-label leading-snug text-content/80">
          <span className="font-semibold text-content">Avos</span>
          <span className="text-content/55"> · {project}</span>
          <br />
          {notice.text}
        </p>
        <button
          type="button"
          className="avos-notice-close"
          aria-label="Close"
          onClick={() => onDismiss(notice.id)}
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
      <div className="flex justify-end gap-1.5 px-3.5 pb-3 pt-2.5">
        <button
          type="button"
          className="rounded-md bg-(--aven-control-bg) px-2.5 py-1 text-ui-caption font-medium text-content/80 hover:bg-(--aven-control-hover)"
          onClick={() => {
            onOpen(notice);
            onDismiss(notice.id);
          }}
        >
          {notice.open?.kind === "review" && /\d+ finished/.test(notice.text)
            ? "Look at them"
            : "Look at it"}
        </button>
        {action && run ? (
          <button
            type="button"
            className="rounded-md bg-content px-2.5 py-1 text-ui-caption font-semibold text-background-base hover:bg-(--aven-inverse-hover)"
            data-avos-notice-answer
            onClick={() => {
              onAnswer(run);
              onDismiss(notice.id);
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </article>
  );
}
