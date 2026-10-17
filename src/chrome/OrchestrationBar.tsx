import { memo, useContext, useEffect, useState, type ReactNode } from "react";
import {
  useOrchestrationRun,
  useOrchestrationSelector,
} from "../hooks/useOrchestrationRun";
import {
  blockingRunFor,
  busyProjectMessage,
  orchestrator,
  runWaitsOnLead,
  type OrchestrationRun,
} from "../lib/orchestration";
import { OrchestrationActions } from "./OrchestrationActions";
import {
  Check,
  ExternalLink,
  MessageMultiple,
  MessageSquare,
  Pause,
  Play,
  Square,
} from "./icons";

/** What "Ask the lead to wrap up" sends, as your own message to the lead. */
export const WRAP_UP_REQUEST =
  "Please wrap up this run: review each finished task, cancel anything that is no longer needed, then call finish. If something still needs my decision, ask me here.";

/**
 * How long a run must have nothing to do before the bar says the lead
 * stopped. Results reach the lead a moment after a worker finishes, so a
 * shorter wait would flash the message between turns.
 */
export const STALLED_AFTER_MS = 1_500;

const BUTTON =
  "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40";

/** "2 working · 1 waiting", or the lead's part when no agent is busy. */
export function runningSummary(
  run: OrchestrationRun,
  leadIdle: boolean,
): string {
  const working = run.tasks.filter(
    (task) => task.status === "running" || task.status === "cancelling",
  ).length;
  const waiting = run.tasks.filter((task) => task.status === "queued").length;
  const parts = [
    working ? `${working} working` : "",
    waiting ? `${waiting} waiting` : "",
  ].filter(Boolean);
  if (!parts.length && !leadIdle) parts.push("the lead is reviewing");
  return ["Orchestrating", ...parts].join(" · ");
}

type Props = {
  sessionId: string;
  /** The folder this chat works in, to tell when another chat's run holds it. */
  cwd: string;
  /** The chat is not working, has nothing queued and is not asking you. */
  idle: boolean;
  /** Sends your own message to this chat. */
  onSubmit: (sessionId: string, text: string) => void;
  /** Stops this chat's turn; for a lead, the whole run. */
  onStop: (sessionId: string) => void;
};

/**
 * The slim bar above the lead's message box while its run is open: what the
 * run is doing, Resume when paused, Stop run and Open agents, and Finish run
 * when the lead stopped without finishing. Another chat in the same project
 * gets the reason it cannot work there and a way to the lead. It matches the
 * discussion bar; both read their store directly, so streaming in the chat
 * never renders them.
 */
export const OrchestrationBar = memo(function OrchestrationBar(props: Props) {
  const own = useOrchestrationRun(props.sessionId);
  if (own && (own.status === "active" || own.status === "paused"))
    return <LeadBar run={own} {...props} />;
  return <BusyBar {...props} />;
});

function Frame({
  run,
  state,
  children,
}: {
  run: OrchestrationRun;
  state: string;
  children: ReactNode;
}) {
  return (
    <div className="px-2 pb-1" data-orchestration-bar={run.leadId}>
      <div
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-content/10 bg-content/3 pl-2 pr-0.5 text-ui-label text-content/60"
        data-state={state}
      >
        {children}
      </div>
    </div>
  );
}

function LeadBar({
  run,
  sessionId,
  idle,
  onSubmit,
  onStop,
}: Props & { run: OrchestrationRun }) {
  const actions = useContext(OrchestrationActions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const waitsOnLead = idle && runWaitsOnLead(run);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!waitsOnLead) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waitsOnLead]);
  const perform = async (operation: () => Promise<unknown> | unknown) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };
  const paused = run.status === "paused";
  const state = paused
    ? "paused"
    : stalled && waitsOnLead
      ? "stalled"
      : "running";
  const text = error
    ? error
    : paused
      ? `Paused${run.error ? ` · ${run.error}` : ""}`
      : state === "stalled"
        ? "The lead stopped without finishing"
        : runningSummary(run, idle);
  const openAgents =
    actions?.openAgents && run.tasks.length
      ? () =>
          actions.openAgents?.(
            run.tasks.map((task) => ({
              sessionId: task.sessionId,
              leadId: run.leadId,
              title: task.title,
              harness: task.harness,
            })),
          )
      : undefined;
  return (
    <Frame run={run} state={state}>
      <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
        {paused ? (
          <Pause className="size-3.5" />
        ) : (
          <MessageMultiple className="size-3.5" strokeWidth={1.75} />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${error ? "text-red-400" : ""}`}
        title={text}
        role="status"
      >
        {text}
      </span>
      {state === "stalled" ? (
        <>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            title="End the run as it is. Tasks that never started are cancelled."
            onClick={() =>
              void perform(() => orchestrator.finishRun(run.leadId))
            }
          >
            <Check className="size-3" strokeWidth={2} />
            Finish run
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            title={WRAP_UP_REQUEST}
            onClick={() => onSubmit(sessionId, WRAP_UP_REQUEST)}
          >
            <MessageSquare className="size-3" />
            Ask the lead to wrap up
          </button>
        </>
      ) : null}
      {paused ? (
        <button
          type="button"
          className={BUTTON}
          disabled={pending || !idle}
          onClick={() =>
            void perform(() =>
              orchestrator.start(
                run.leadId,
                run.allowedHarnesses,
                run.maxWorkers,
              ),
            )
          }
        >
          <Play className="size-3" />
          Resume
        </button>
      ) : null}
      {openAgents && state !== "stalled" ? (
        <button
          type="button"
          className={BUTTON}
          title="Open the agents' chats beside the lead"
          onClick={openAgents}
        >
          <ExternalLink className="size-3" />
          Open agents
        </button>
      ) : null}
      <button
        type="button"
        className={BUTTON}
        disabled={pending}
        title="Stop the lead and every agent in this run"
        onClick={() => onStop(sessionId)}
      >
        <Square className="size-2.5" />
        Stop run
      </button>
    </Frame>
  );
}

/** Another chat's run holds this project: say so, and offer the way there. */
function BusyBar({ sessionId, cwd }: Props) {
  const actions = useContext(OrchestrationActions);
  const run = useOrchestrationSelector((runs) =>
    blockingRunFor(runs, sessionId, cwd),
  );
  if (!run) return null;
  const message = busyProjectMessage(run, actions?.title?.(run.leadId));
  return (
    <Frame run={run} state="busy">
      <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
        <MessageMultiple className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={message} role="status">
        {message}
      </span>
      {actions ? (
        <button
          type="button"
          className={BUTTON}
          onClick={() => actions.open(run.leadId)}
        >
          <ExternalLink className="size-3" />
          Go to lead
        </button>
      ) : null}
    </Frame>
  );
}
