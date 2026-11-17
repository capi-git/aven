import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AgentMark } from "../chrome/AgentMark";
import { OrchestrationActions } from "../chrome/OrchestrationActions";
import { ArrowUpRight } from "../chrome/icons";
import { useOrchestrationRun } from "../hooks/useOrchestrationRun";
import {
  changeBar,
  helperClock,
  helperFiles,
  helperLastLine,
  helpersOfTurn,
} from "../lib/helperAgents";
import {
  sessionCheckpointStatus,
  subscribeReviewChanged,
  type CheckpointFile,
} from "../lib/checkpoint";
import { LiveSessionsContext } from "../lib/liveSessions";
import { pathKey } from "../lib/paths";
import {
  isHelperRun,
  orchestrator,
  type OrchestrationTask,
} from "../lib/orchestration";
import type { Session } from "../lib/session";
import { CrewFenceSource } from "./CrewFenceCard";
import "./HelperCards.css";

const noSubscription = () => () => {};

/** A chat by id, as it streams. */
function useSessionById(id: string): Session | undefined {
  const store = useContext(LiveSessionsContext);
  const subscribe = useCallback(
    (listener: () => void) =>
      store ? store.subscribe(id, listener) : noSubscription(),
    [store, id],
  );
  return useSyncExternalStore(subscribe, () => store?.session(id));
}

/** A clock that moves once a second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * The lines each file gained and lost, from the lead's own record of its
 * turns' changes, which its helpers' edits land in (see `turnChangeOwner`).
 * Read again whenever that record changes, or `key` does.
 */
function useChangeCounts(
  leadId: string,
  cwd: string,
  key: string,
): ReadonlyMap<string, CheckpointFile> {
  const [counts, setCounts] = useState<ReadonlyMap<string, CheckpointFile>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    const read = () =>
      void sessionCheckpointStatus(leadId, cwd)
        .then((status) => {
          if (!alive) return;
          setCounts(
            new Map(
              (status?.files ?? []).map((file) => [pathKey(file.path), file]),
            ),
          );
        })
        .catch(() => undefined);
    read();
    const off = subscribeReviewChanged((sessionId) => {
      if (!sessionId || sessionId === leadId) read();
    });
    return () => {
      alive = false;
      off();
    };
  }, [leadId, cwd, key]);
  return counts;
}

const working = (task: OrchestrationTask) =>
  task.status === "running" || task.status === "cancelling";

/**
 * The helpers a chat started in this turn, one card each: its mark, its
 * name, the last line it wrote, how long it has worked, and the way to its
 * pane; then a row per file it changed, with the lines added and removed and
 * Open diff. Under them, when it is so, that another chat worked in the
 * project while this turn ran.
 */
export const HelperCards = memo(function HelperCards({
  turnId,
  othersWorked,
  cwd,
  onOpenDiff,
}: {
  /** The message whose turn started the helpers. */
  turnId?: string;
  othersWorked?: boolean;
  cwd?: string;
  onOpenDiff?: (path: string) => void;
}) {
  const { chatId } = useContext(CrewFenceSource);
  const run = useOrchestrationRun(chatId ?? "");
  const tasks = isHelperRun(run) ? helpersOfTurn(run, turnId) : [];
  const projectCwd = run?.cwd ?? cwd ?? "";
  const counts = useChangeCounts(
    chatId ?? "",
    tasks.length ? projectCwd : "",
    tasks.map((task) => `${task.id}:${task.status}`).join(),
  );
  if (!chatId || !tasks.length) return null;
  return (
    <div className="helper-cards" data-helper-cards={turnId}>
      {run?.held && tasks.some((task) => task.status === "queued") ? (
        <div className="helper-cards-held" role="status">
          <span>
            {tasks.length === 1
              ? "This helper waits for you."
              : "These helpers wait for you."}
          </span>
          <button
            type="button"
            className="helper-card-button"
            data-helper-start
            onClick={() => void orchestrator.startHelpers(chatId)}
          >
            Start
          </button>
        </div>
      ) : null}
      {tasks.map((task) => (
        <HelperCard
          key={task.id}
          leadId={chatId}
          task={task}
          cwd={projectCwd}
          counts={counts}
          onOpenDiff={onOpenDiff}
        />
      ))}
      {othersWorked ? (
        <p className="helper-cards-note">
          Another chat was working in this project during this turn.
        </p>
      ) : null}
    </div>
  );
});

function HelperCard({
  leadId,
  task,
  cwd,
  counts,
  onOpenDiff,
}: {
  leadId: string;
  task: OrchestrationTask;
  cwd: string;
  counts: ReadonlyMap<string, CheckpointFile>;
  onOpenDiff?: (path: string) => void;
}) {
  const actions = useContext(OrchestrationActions);
  const helper = useSessionById(task.sessionId);
  const running = working(task);
  const now = useNow(running);
  // The record's counts where it has the file; the transcript's otherwise.
  const files = (helper ? helperFiles(helper.blocks, cwd) : []).map((file) => {
    const recorded = counts.get(pathKey(file.path));
    return recorded
      ? {
          ...file,
          additions: recorded.additions,
          deletions: recorded.deletions,
        }
      : file;
  });
  const line =
    (helper && helperLastLine(helper.blocks)) ||
    (task.status === "queued"
      ? "Waiting to start…"
      : task.error || (running ? "Starting…" : ""));
  const elapsed =
    task.startedAt !== undefined
      ? helperClock(
          (task.endedAt ?? (running ? now : task.startedAt)) - task.startedAt,
        )
      : undefined;
  const state = running
    ? "working"
    : task.status === "failed"
      ? "needs"
      : task.status === "completed"
        ? "ready"
        : "still";
  const open = actions?.openHelper
    ? () => actions.openHelper?.(leadId, task.sessionId)
    : undefined;
  return (
    <div
      className="helper-card"
      data-helper-card={task.sessionId}
      data-helper-status={task.status}
    >
      <div className="helper-card-head">
        <AgentMark state={state} className="helper-card-mark" />
        <span className="helper-card-name">{task.title}</span>
        <span className="helper-card-line" title={line}>
          {line}
        </span>
        {elapsed ? (
          <span className="helper-card-time" data-helper-time>
            {elapsed}
          </span>
        ) : null}
        {open ? (
          <button
            type="button"
            className="helper-card-icon"
            title={`Open ${task.title}`}
            aria-label={`Open ${task.title}`}
            onClick={open}
          >
            <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {files.map((file) => {
        const lit = changeBar(file.additions, file.deletions);
        const red = file.deletions ? 5 - lit : 0;
        return (
          <div
            key={file.path}
            className="helper-card-file"
            data-helper-file={file.label}
          >
            <span className="helper-card-file-name" title={file.label}>
              {file.label}
            </span>
            <span className="helper-card-counts">
              {file.additions ? (
                <span className="helper-card-added">+{file.additions}</span>
              ) : null}
              {file.deletions ? (
                <span className="helper-card-removed">−{file.deletions}</span>
              ) : null}
            </span>
            <span className="helper-card-bar" aria-hidden>
              {[0, 1, 2, 3, 4].map((index) => (
                <i
                  key={index}
                  data-kind={
                    index < lit ? "add" : index < lit + red ? "del" : undefined
                  }
                />
              ))}
            </span>
            {onOpenDiff ? (
              <button
                type="button"
                className="helper-card-button"
                onClick={() => onOpenDiff(file.path)}
              >
                Open diff
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
