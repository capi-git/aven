import { useState } from "react";
import { CrewCritters } from "../chrome/CrewCritter";
import { ProjectMark } from "../chrome/ProjectMark";
import {
  applyCrewCard,
  dismissCrewInbox,
  useCrewWorkspace,
} from "../lib/crewActions";
import {
  CREW_INBOX_ACTIONS,
  crewInboxHeading,
  type CrewInboxAction,
  type CrewInboxItem,
} from "../lib/crewInbox";
import { errorText } from "../lib/errors";
import { formatRelativeTime } from "../lib/githubTasks";
import { projectName } from "../lib/paths";
import "./AutomationReviewCard.css";

// A crew card in the Inbox: Ready (Apply, Open board) or Needs you (Open
// board, Done). Its buttons are Aven's, fixed for its state; the bots only
// wrote words in its summary, and nothing here sends those anywhere.

const ACTION =
  "aven-press inline-flex items-center gap-1.5 rounded-md px-3 text-ui-label";
const ACTION_FILLED = `${ACTION} h-7 bg-content text-background-base hover:bg-(--aven-inverse-hover)`;
const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-(--aven-control-bg) hover:text-content`;

export function CrewInboxDetail({ item }: { item: CrewInboxItem }) {
  const workspace = useCrewWorkspace();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const state = item.card.stage === "ready" ? "ready" : "stuck";
  const act = async (id: CrewInboxAction) => {
    setProblem(null);
    if (id === "open-board") return workspace?.openCrew(item.project);
    if (id === "done") return dismissCrewInbox(item.project, item.card.id);
    setBusy(true);
    const error = await applyCrewCard(item.project, item.card.id).catch(
      (reason) => errorText(reason),
    );
    setBusy(false);
    if (error) setProblem(error);
  };
  return (
    <section
      className="automation-review"
      data-crew-inbox-detail={item.key}
      aria-label={`${crewInboxHeading(item.card)}: ${item.review.title}`}
    >
      <p className="automation-review-kind">
        <ProjectMark path={item.project} className="automation-review-mark" />
        <span>
          {crewInboxHeading(item.card)} · {projectName(item.project)} crew
        </span>
      </p>
      <h2>{item.review.title}</h2>
      {item.review.summary ? <p>{item.review.summary}</p> : null}
      <div className="automation-review-actions">
        {CREW_INBOX_ACTIONS[state].map((action, index) => (
          <button
            key={action.id}
            type="button"
            className={`${index === 0 ? ACTION_FILLED : ACTION_GHOST} disabled:cursor-default disabled:opacity-40`}
            disabled={busy || (action.id === "open-board" && !workspace)}
            onClick={() => void act(action.id)}
          >
            {action.id === "apply" && busy ? "Applying…" : action.label}
          </button>
        ))}
      </div>
      {problem ? (
        <p className="automation-review-error" role="status">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** The card in the Inbox's list, above the automations' cards. */
export function InboxCrewCard({
  item,
  active,
  onSelect,
}: {
  item: CrewInboxItem;
  active: boolean;
  onSelect: () => void;
}) {
  const time = formatRelativeTime(new Date(item.review.postedAt).toISOString());
  const ready = item.card.stage === "ready";
  return (
    <button
      type="button"
      title={item.review.title}
      data-utility-card
      data-crew-inbox-card={item.key}
      aria-current={active ? "true" : undefined}
      aria-label={`${crewInboxHeading(item.card)}: ${item.review.title}, from ${projectName(item.project)}'s crew`}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border border-transparent px-2.5 py-2 text-left ${
        active
          ? "bg-(--aven-selected) text-content"
          : "text-content/80 hover:bg-(--aven-hover) hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <CrewCritters path={item.project} roles={["builder", "checker"]} />
          <span
            className={`min-w-0 truncate text-ui-caption ${
              ready ? "text-(--aven-review)" : "text-(--aven-needs-you)"
            }`}
          >
            {crewInboxHeading(item.card)}
          </span>
        </span>
        {time ? (
          <span className="shrink-0 text-ui-caption tabular-nums text-content/45">
            {time}
          </span>
        ) : null}
      </span>
      <span className="mt-1 line-clamp-1 text-ui-body font-semibold leading-snug text-content">
        {item.review.title}
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-caption text-content/45">
        <ProjectMark path={item.project} className="automation-review-mark" />
        <span className="min-w-0 truncate">
          {projectName(item.project)} crew
        </span>
      </span>
    </button>
  );
}
