import { ask } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronLeft,
  MessageSquare,
  Pencil,
  Play,
  Square,
  Trash2,
} from "../chrome/icons";
import {
  automationTiming,
  isNoProject,
  runStatusWord,
  type AutomationItem,
} from "../lib/automationFolders";
import { reviewHeading } from "../lib/automationReview";
import { stopUnattendedRun } from "../lib/automationRuns";
import type { ApprovalDecision } from "../lib/harness";
import { isInboxEntryUnread, markInboxItemSeen } from "../lib/inboxSeen";
import { LiveSessionsContext } from "../lib/liveSessions";
import { projectName } from "../lib/paths";
import {
  deleteScheduledAgent,
  formatRunTime,
  holdsChat,
  scheduledRunSeenEntry,
  setScheduledAgentEnabled,
  updateScheduledAgent,
  type ScheduledAgent,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { sessionWorkCwd, type Session } from "../lib/session";
import { getSession } from "../lib/sessionStore";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentTranscript } from "./AgentTranscript";
import { AutomationReviewCard } from "./AutomationReviewCard";
import { ACTION_GHOST, agentLabel, ICON_BUTTON } from "./ScheduledInbox";
import { Toggle } from "./SettingsControls";

/** "2 minutes", how long a finished run took. */
function runLength(run: ScheduledRun): string | null {
  if (run.finishedAt == null || !run.sessionId) return null;
  const minutes = Math.max(
    1,
    Math.round((run.finishedAt - run.startedAt) / 60_000),
  );
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

export function AutomationDot({
  tone,
  label,
}: {
  tone: string;
  label?: string;
}) {
  return (
    <span
      className="automation-dot"
      data-tone={tone}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    />
  );
}

// ---------------------------------------------------------------------------
// One automation: what it does, its controls, and its runs.

export function AutomationDetail({
  item,
  onSelectRun,
  onEdit,
  onDeleted,
  onRunNow,
}: {
  item: AutomationItem;
  onSelectRun: (run: ScheduledRun) => void;
  onEdit: (agent: ScheduledAgent) => void;
  onDeleted: () => void;
  onRunNow?: (agent: ScheduledAgent) => void;
}) {
  const agent = item.agent;
  const [started, setStarted] = useState(false);
  const running = item.runs[0]?.status === "running";
  const remove = async () => {
    if (!agent) return;
    const ok = await ask(
      `Delete the automation “${agent.name}”? Its past runs stay here.`,
      { title: "Aven", kind: "warning", okLabel: "Delete" },
    );
    if (!ok) return;
    deleteScheduledAgent(agent.id);
    onDeleted();
  };
  const project = agent?.project ?? item.runs[0]?.project ?? "";
  const meta = [
    automationTiming(item),
    agent ? agentLabel(agent.harness, agent.model) : null,
  ].filter(Boolean);

  return (
    <div className="automation-detail" data-automation-detail={item.id}>
      <header className="automation-detail-head">
        <div className="automation-detail-heading">
          <h1>{item.name}</h1>
          <p className="automation-detail-meta">{meta.join(" · ")}</p>
        </div>
        {agent ? (
          <div className="automation-detail-actions">
            <Toggle
              label={`Run ${agent.name} on schedule`}
              on={agent.enabled}
              onChange={(on) => setScheduledAgentEnabled(agent.id, on)}
            />
            <button
              type="button"
              disabled={!onRunNow || running}
              onClick={() => {
                updateScheduledAgent(agent.id, { lastRunAt: Date.now() });
                onRunNow?.(agent);
                setStarted(true);
              }}
              className={ACTION_GHOST}
              aria-label={`Run ${agent.name} now`}
            >
              <Play className="size-3.5" strokeWidth={1.75} />
              {running ? "Running" : started ? "Started" : "Run now"}
            </button>
            <button
              type="button"
              title="Edit"
              aria-label={`Edit ${agent.name}`}
              onClick={() => onEdit(agent)}
              className={ICON_BUTTON}
            >
              <Pencil className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title="Delete"
              aria-label={`Delete ${agent.name}`}
              onClick={() => void remove()}
              className={ICON_BUTTON}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </header>
      {agent ? (
        <p className="automation-detail-prompt" title={agent.prompt}>
          {agent.prompt}
        </p>
      ) : (
        <p className="automation-detail-prompt">
          This automation was deleted. Its runs stay here so you can still open
          them.
        </p>
      )}
      <section
        className="automation-runs"
        data-automation-runs
        aria-label={`Runs of ${item.name}`}
      >
        <h2 className="automation-section-title">
          Runs
          {item.runs.length ? <span>{item.runs.length}</span> : null}
        </h2>
        {item.runs.length === 0 ? (
          <p className="automation-empty-note">
            No runs yet.{" "}
            {agent?.enabled && agent.nextRunAt != null
              ? `The first is ${formatRunTime(agent.nextRunAt)}${
                  isNoProject(project) ? "" : `, in ${projectName(project)}`
                }.`
              : ""}
          </p>
        ) : (
          <ul className="aven-menu automation-run-list">
            {item.runs.map((run) => (
              <li key={run.id}>
                <RunRow run={run} onSelect={() => onSelectRun(run)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunRow({
  run,
  onSelect,
}: {
  run: ScheduledRun;
  onSelect: () => void;
}) {
  const unread =
    run.status !== "running" && isInboxEntryUnread(scheduledRunSeenEntry(run));
  const status = runStatusWord(run.status);
  const when = formatRunTime(run.startedAt);
  const line =
    run.review?.status === "open"
      ? `${reviewHeading(run.review)}: ${run.review.title}`
      : (run.error || run.summary).split("\n")[0]?.trim() ||
        (run.status === "running" ? "Working…" : "");
  const length = runLength(run);
  return (
    <button
      type="button"
      data-automation-run={run.id}
      data-unread={unread || undefined}
      // Its summary or card line is part of what the row says, as it shows.
      aria-label={`${when}: ${status.toLowerCase()}${unread ? ", new" : ""}${
        line ? `. ${line}` : ""
      }${length ? `. ${length}` : ""}`}
      className="aven-menu-item aven-menu-item-rich automation-run-row"
      onClick={onSelect}
    >
      <AutomationDot tone={run.status} />
      <span className="aven-menu-text">
        <span>
          {when}
          <span className="automation-run-status"> · {status}</span>
        </span>
        {line ? <span className="aven-menu-description">{line}</span> : null}
      </span>
      {length ? <span className="aven-menu-detail">{length}</span> : null}
      {unread ? <span className="automation-unread" aria-hidden /> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// One run: its conversation, read-only, with Open as chat to continue it.

/**
 * The run's chat: live while the workspace has it loaded (a run still
 * working streams here), otherwise as it was saved.
 */
function useRunSession(
  sessionId: string | undefined,
  revision: string,
): { session: Session | null | undefined } {
  const store = useContext(LiveSessionsContext);
  const subscribe = useCallback(
    (listener: () => void) =>
      store && sessionId ? store.subscribe(sessionId, listener) : () => {},
    [store, sessionId],
  );
  const live = useSyncExternalStore(subscribe, () =>
    store && sessionId ? store.session(sessionId) : undefined,
  );
  const [saved, setSaved] = useState<{
    key: string;
    session: Session | null;
  } | null>(null);
  const key = `${sessionId ?? ""}|${revision}`;
  const isLive = !!live;
  useEffect(() => {
    if (isLive || !sessionId) return;
    let cancelled = false;
    getSession(sessionId)
      .then((session) => {
        if (!cancelled) setSaved({ key, session });
      })
      .catch(() => {
        if (!cancelled) setSaved({ key, session: null });
      });
    return () => {
      cancelled = true;
    };
  }, [isLive, sessionId, key]);
  if (live) return { session: live };
  if (!sessionId) return { session: null };
  return { session: saved?.key === key ? saved.session : undefined };
}

export function AutomationRunView({
  run,
  item,
  onBack,
  onOpenAsChat,
  onApproval,
  onStop,
  onReviewAction,
}: {
  run: ScheduledRun;
  item?: AutomationItem;
  onBack: () => void;
  onOpenAsChat?: (run: ScheduledRun) => unknown;
  onApproval?: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  onStop?: (sessionId: string) => void;
  onReviewAction?: (run: ScheduledRun) => unknown;
}) {
  const [opening, setOpening] = useState(false);
  const { session } = useRunSession(
    run.sessionId,
    `${run.status}:${run.finishedAt ?? ""}`,
  );
  // Opening a finished run reads it.
  useEffect(() => {
    if (run.status !== "running") markInboxItemSeen(scheduledRunSeenEntry(run));
  }, [run]);
  const length = runLength(run);
  const name = item?.name ?? run.name;
  const sessionId = run.sessionId;
  // A run from before runs stayed here already has an ordinary chat.
  const ownChat = holdsChat(run);
  return (
    <div className="automation-run-view" data-automation-run-view={run.id}>
      <header className="automation-run-head">
        <button
          type="button"
          className="automation-back"
          onClick={onBack}
          aria-label={`Back to ${name}`}
          title={`Back to ${name}`}
        >
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
          <span>{name}</span>
        </button>
        <span className="automation-run-when">
          <AutomationDot tone={run.status} />
          {runStatusWord(run.status)} · {formatRunTime(run.startedAt)}
          {length ? ` · ${length}` : ""}
        </span>
        <span className="automation-run-actions">
          {run.status === "running" && sessionId && onStop ? (
            <button
              type="button"
              className={ACTION_GHOST}
              onClick={() => {
                onStop(sessionId);
                // A run Aven quit during has no turn here to stop.
                stopUnattendedRun(run.id);
              }}
            >
              <Square className="size-3" strokeWidth={1.75} /> Stop
            </button>
          ) : null}
          {sessionId && onOpenAsChat ? (
            <button
              type="button"
              disabled={opening}
              className={ACTION_GHOST}
              title={
                ownChat
                  ? "Continue this run as an ordinary chat, listed with the project's chats"
                  : "Open this run's chat, which is already among the project's chats"
              }
              onClick={() => {
                setOpening(true);
                void Promise.resolve(onOpenAsChat(run)).finally(() =>
                  setOpening(false),
                );
              }}
            >
              <MessageSquare className="size-3.5" strokeWidth={1.75} />
              {ownChat ? "Open as chat" : "Open chat"}
            </button>
          ) : null}
        </span>
      </header>
      {run.review?.status === "open" ? (
        <div className="automation-run-card">
          <AutomationReviewCard run={run} onAction={onReviewAction} />
        </div>
      ) : null}
      {run.error ? (
        <p className="automation-run-error" role="status">
          {run.error}
        </p>
      ) : null}
      <div className="automation-run-transcript" data-run-transcript>
        {session && session.blocks.length ? (
          <AgentTranscript
            blocks={session.blocks}
            busy={session.busy}
            cwd={sessionWorkCwd(session)}
            harness={session.harness}
            model={session.model}
            pendingQuestion={!!session.pendingQuestion}
            onApproval={
              onApproval
                ? (requestId, decision) =>
                    onApproval(session.id, requestId, decision)
                : undefined
            }
          />
        ) : session === undefined ? null : (
          <div className="automation-run-summary">
            {run.summary ? (
              <AgentMarkdown text={run.summary} cwd={run.project} />
            ) : run.error ? null : (
              <p className="automation-empty-note">
                {run.status === "running"
                  ? "The agent is still working."
                  : "The agent did not reply."}
              </p>
            )}
          </div>
        )}
      </div>
      {session?.pendingQuestion ? (
        <p className="automation-run-note" role="status">
          The agent asked a question. Open it as a chat to answer.
        </p>
      ) : null}
    </div>
  );
}
