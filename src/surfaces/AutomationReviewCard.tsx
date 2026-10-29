import "./AutomationReviewCard.css";
import { useState } from "react";
import { Clock, ExternalLink } from "../chrome/icons";
import { ProjectMark } from "../chrome/ProjectMark";
import { isNoProject, NO_PROJECT_NAME } from "../lib/automationFolders";
import { reviewHeading } from "../lib/automationReview";
import { formatRelativeTime } from "../lib/githubTasks";
import { openInAppUrl } from "../lib/inAppLinks";
import { projectName } from "../lib/paths";
import { resolveRunReview, type ScheduledRun } from "../lib/scheduledAgents";

// The Inbox detail's action row.
const ACTION =
  "aven-press inline-flex items-center gap-1.5 rounded-md px-3 text-ui-label";
const ACTION_FILLED = `${ACTION} h-7 bg-content text-background-base hover:bg-(--aven-inverse-hover)`;
const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-(--aven-control-bg) hover:text-content`;

// The card a run leaves when it has something for you: in the Inbox, and at
// the top of the run.

export function AutomationReviewCard({
  run,
  onAction,
  onOpenRun,
}: {
  run: ScheduledRun;
  /** Sends the card's message to the run's conversation. */
  onAction?: (run: ScheduledRun) => unknown;
  onOpenRun?: (run: ScheduledRun) => void;
}) {
  const review = run.review;
  const [error, setError] = useState("");
  if (!review) return null;
  const open = (url: string) => {
    setError("");
    void openInAppUrl(url).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  const action = review.action;
  const sends = !!action?.message && !!onAction && !!run.sessionId;
  const project = isNoProject(run.project)
    ? NO_PROJECT_NAME
    : projectName(run.project);
  return (
    <section
      className="automation-review"
      data-review-detail={run.id}
      aria-label={`${reviewHeading(review)}: ${review.title}`}
    >
      <p className="automation-review-kind">
        {!isNoProject(run.project) ? (
          <ProjectMark path={run.project} className="automation-review-mark" />
        ) : null}
        <span>
          {reviewHeading(review)} · {run.name} · {project}
        </span>
      </p>
      <h2>{review.title}</h2>
      {review.summary ? <p>{review.summary}</p> : null}
      {review.url ? (
        <button
          type="button"
          className="automation-review-link"
          title={review.url}
          onClick={() => open(review.url!)}
        >
          <ExternalLink className="size-3" strokeWidth={1.75} />
          <span>{review.url.replace(/^https?:\/\//, "")}</span>
        </button>
      ) : null}
      <div className="automation-review-actions">
        {action && (sends || review.url) ? (
          <button
            type="button"
            className={ACTION_FILLED}
            onClick={() => {
              if (sends) void onAction?.(run);
              else if (review.url) open(review.url);
            }}
          >
            {action.label}
          </button>
        ) : null}
        {onOpenRun ? (
          <button
            type="button"
            className={ACTION_GHOST}
            onClick={() => onOpenRun(run)}
          >
            Open run
          </button>
        ) : null}
        <button
          type="button"
          className={ACTION_GHOST}
          title="Take this card out of the Inbox"
          onClick={() => resolveRunReview(run.id, "done")}
        >
          Done
        </button>
      </div>
      {error ? (
        <p className="automation-review-error" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The card in the Inbox's list, above the issues and pull requests. */
export function InboxReviewCard({
  run,
  active,
  onSelect,
}: {
  run: ScheduledRun;
  active: boolean;
  onSelect: () => void;
}) {
  const review = run.review;
  if (!review) return null;
  const time = formatRelativeTime(new Date(review.postedAt).toISOString());
  const none = isNoProject(run.project);
  return (
    <button
      type="button"
      title={review.title}
      data-utility-card
      data-review-card={run.id}
      aria-current={active ? "true" : undefined}
      aria-label={`${reviewHeading(review)}: ${review.title}, from ${run.name}`}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border border-transparent px-2.5 py-2 text-left ${
        active
          ? "bg-(--aven-selected) text-content"
          : "text-content/80 hover:bg-(--aven-hover) hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Clock
            className="size-3 shrink-0 text-content/50"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-ui-caption text-content/50">
            {reviewHeading(review)} · {run.name}
          </span>
        </span>
        {time ? (
          <span className="shrink-0 text-ui-caption tabular-nums text-content/45">
            {time}
          </span>
        ) : null}
      </span>
      <span className="mt-1 line-clamp-1 text-ui-body font-semibold leading-snug text-content">
        {review.title}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-caption text-content/45">
        {none ? null : (
          <ProjectMark path={run.project} className="automation-review-mark" />
        )}
        <span className="min-w-0 truncate">
          {none ? NO_PROJECT_NAME : projectName(run.project)}
        </span>
      </span>
    </button>
  );
}
