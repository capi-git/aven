import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { reviewAction } from "../lib/automationReview";
import type { AvosNotice } from "../lib/avos";
import { projectName } from "../lib/paths";
import type { ScheduledRun } from "../lib/scheduledAgents";
import { plural } from "../lib/words";
import { CrewCritter } from "./CrewCritter";
import { X } from "./icons";
import "./AvosNotices.css";

/**
 * When a project's Avos needs you and its screen isn't in front: one card
 * per project, with Avos's Bot (amber), its project, and each thing that
 * needs you with what to do about it (Look at it, and Publish or Approve
 * for a job's run). Something new for the same project joins its card
 * ("2 things need you") rather than adding another. Each thing goes once
 * you act on it, or by itself once it's sorted elsewhere; closing the card
 * hides it until something new arrives.
 */
export function AvosNoticeCard({
  path,
  notices,
  runs,
  onOpen,
  onAnswer,
  onDismiss,
}: {
  path: string;
  /** What needs you in this project's Avos, oldest first. */
  notices: readonly AvosNotice[];
  /** The job runs they're about, while their cards wait for you. */
  runs?: ReadonlyMap<string, ScheduledRun>;
  /** Show Avos (and what it's about). */
  onOpen: (notice: AvosNotice) => void;
  /** Answer a job's run card: Publish, Approve. */
  onAnswer: (run: ScheduledRun) => void;
  /** Take these off the card (all of them when it's closed). */
  onDismiss: (ids: readonly string[]) => void;
}) {
  const appearance = useProjectAppearance(path);
  const project = appearance?.label || projectName(path);
  const many = notices.length > 1;
  return (
    <article
      className="avos-notice pointer-events-auto overflow-hidden aven-glass-overlay [--aven-radius-overlay:var(--aven-radius-bubble)]"
      role="status"
      data-avos-notice={path}
    >
      <div className="flex gap-2.5 px-3.5 pt-3">
        <CrewCritter
          path={path}
          role="lead"
          state="needs"
          className="avos-notice-mark"
        />
        <p className="min-w-0 flex-1 text-ui-label leading-snug text-content/80">
          <span className="font-semibold text-content">Avos</span>
          <span className="text-content/55">
            {" "}
            · {project}
            {many ? ` · ${plural(notices.length, "thing")} need you` : null}
          </span>
          {many ? null : (
            <>
              <br />
              {notices[0]?.text}
            </>
          )}
        </p>
        <button
          type="button"
          className="avos-notice-close"
          aria-label="Close"
          onClick={() => onDismiss(notices.map((notice) => notice.id))}
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
      <ul className="avos-notice-items" data-many={many || undefined}>
        {notices.map((notice) => {
          const run = notice.runId ? runs?.get(notice.runId) : undefined;
          const action =
            run?.review?.status === "open" && run.review.kind !== "needs-you"
              ? reviewAction(run.review)
              : null;
          return (
            <li key={notice.id} data-avos-notice-item={notice.id}>
              {many ? (
                <span
                  className="min-w-0 flex-1 truncate text-ui-caption text-content/80"
                  title={notice.text}
                >
                  {notice.text}
                </span>
              ) : null}
              <button
                type="button"
                className="rounded-md bg-(--aven-control-bg) px-2.5 py-1 text-ui-caption font-medium text-content/80 hover:bg-(--aven-control-hover)"
                onClick={() => {
                  onOpen(notice);
                  onDismiss([notice.id]);
                }}
              >
                {notice.open?.kind === "review" &&
                /\d+ finished/.test(notice.text)
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
                    onDismiss([notice.id]);
                  }}
                >
                  {action.label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
