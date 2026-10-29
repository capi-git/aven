import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWakeAt } from "../hooks/useWakeAt";
import { useActivity } from "../lib/activity";
import {
  doneWords,
  HELM_DONE_MS,
  HELM_STOPPED_MS,
  helmClock,
  turnChangedFiles,
  type HelmOutcome,
} from "../lib/composerHelm";
import type { Session } from "../lib/session";
import { sessionAgentSummary } from "../lib/sessionAgents";
import {
  sessionRunStatus,
  type SessionRunStatus,
} from "../lib/sessionRunStatus";
import { visibleInterval } from "../lib/visibleInterval";
import { Check, X } from "./icons";
import { Popover } from "./Popover";
import { SessionAgentList } from "./SessionAgentList";

/**
 * What the chat's turn is doing, for the helm's speech bubble. The chat's
 * pane provides it around its message box (as it provides the team bar's
 * run status), so only the bubble re-renders while a reply streams; the
 * message box itself does not.
 */
export type HelmRun = {
  session: Session;
  visible: boolean;
  /**
   * `attention`: the team bar (or a bot's transcript) already says what the
   * turn is doing, so the bubble says only "Working" and the time.
   */
  placement: "row" | "attention";
  onStop: (sessionId: string) => void;
  onOpenTerminal?: (sessionId: string) => void;
};

export const HelmRunContext = createContext<HelmRun | null>(null);

/** A fix the error bubble offers in one click. */
export type HelmFix = { label: string; run: () => void; detail?: string };

/** What the bubble says now; null when it says nothing. */
export type HelmSay =
  | {
      kind: "running";
      text: string;
      startedAt?: number;
      queued: number;
      agents: number;
      waiting: boolean;
    }
  | { kind: "queued"; text: string; detail: string }
  | { kind: "done"; headline: string; detail: string | null }
  | { kind: "stopped" }
  | { kind: "error"; text: string; detail?: string; recovery?: "claude-login" };

/**
 * The status the bubble shows, and the outcome the critter acts out. The
 * end of a turn this helm watched happen says so briefly ("Done in 1:12 ·
 * 3 files changed", "Stopped"); a failure stays until the next message.
 */
export function useHelmSay(
  run: HelmRun | null,
  busy: boolean,
): {
  say: HelmSay | null;
  status: SessionRunStatus | null;
  dismiss: () => void;
} {
  const visible = !!run?.visible;
  const entries = useActivity();
  const status = run && visible ? sessionRunStatus(run.session, entries) : null;
  // A countdown or a threshold changes the words with no new event.
  useWakeAt(status?.wakeAt);
  const [ended, setEnded] = useState<{
    kind: "done" | "stopped";
    until: number;
    headline?: string;
    detail?: string | null;
  } | null>(null);
  const wasBusy = useRef(busy);
  const session = run?.session;
  useEffect(() => {
    const before = wasBusy.current;
    wasBusy.current = busy;
    if (busy) {
      setEnded(null);
      return;
    }
    if (!before || !status || !session) return;
    if (status.kind === "finished") {
      const words = doneWords(
        status.durationMs,
        turnChangedFiles(session.blocks),
      );
      setEnded({ kind: "done", until: Date.now() + HELM_DONE_MS, ...words });
    } else if (status.kind === "stopped") {
      setEnded({ kind: "stopped", until: Date.now() + HELM_STOPPED_MS });
    }
  }, [busy, status, session]);
  useWakeAt(ended?.until);
  // A failure stays until the next message, or until it is dismissed.
  const [dismissedFailure, setDismissedFailure] = useState<
    number | string | null
  >(null);
  const failure =
    status?.kind === "failed" ? (status.startedAt ?? "untimed") : null;
  const dismiss = () => {
    setEnded(null);
    if (failure !== null) setDismissedFailure(failure);
  };
  const live = ended && Date.now() < ended.until ? ended : null;

  if (!status) {
    return {
      say: busy
        ? {
            kind: "running",
            text: "Working…",
            queued: 0,
            agents: 0,
            waiting: false,
          }
        : null,
      status: null,
      dismiss,
    };
  }
  const queued = run?.session.queuedMessages?.length ?? 0;
  const agents = run?.session.liveAgents?.length ?? 0;
  if (
    busy ||
    status.kind === "working" ||
    (status.kind === "waiting" && status.canStop)
  ) {
    const waiting = status.kind === "waiting";
    // A hold-up (a retry, the usage limit, a long command) says what holds
    // the turn and its countdown, as the Working row did.
    const text =
      waiting || status.holdUp
        ? [status.label, status.detail].filter(Boolean).join(" · ")
        : run?.placement === "attention"
          ? status.label
          : (status.doing ?? status.label);
    return {
      say: {
        kind: "running",
        text,
        startedAt: status.startedAt,
        queued,
        agents,
        waiting,
      },
      status,
      dismiss,
    };
  }
  if (status.recovery === "claude-login")
    return {
      say: {
        kind: "error",
        text: status.label,
        detail: "Run claude auth login in Aven’s terminal, then retry.",
        recovery: "claude-login",
      },
      status,
      dismiss,
    };
  if (failure !== null && dismissedFailure !== failure)
    return {
      say: { kind: "error", text: status.label, detail: status.detail },
      status,
      dismiss,
    };
  if (status.kind === "queued")
    return {
      say: { kind: "queued", text: status.label, detail: status.detail },
      status,
      dismiss,
    };
  if (live?.kind === "done")
    return {
      say: {
        kind: "done",
        headline: live.headline ?? "Done",
        detail: live.detail ?? null,
      },
      status,
      dismiss,
    };
  if (live?.kind === "stopped")
    return { say: { kind: "stopped" }, status, dismiss };
  return { say: null, status, dismiss };
}

/** The outcome the critter acts out for what the bubble says. */
export function helmOutcome(say: HelmSay | null): HelmOutcome {
  if (!say) return null;
  if (say.kind === "done") return "done";
  if (say.kind === "stopped") return "stopped";
  if (say.kind === "error") return "error";
  return null;
}

/** Only this leaf re-renders each second while the agent works. */
function RunClock({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt == null) return;
    // Wall time catches up on its own once the window is shown again.
    return visibleInterval(() => setNow(Date.now()), 1000);
  }, [startedAt]);
  const time = startedAt == null ? null : helmClock(now - startedAt);
  if (!time) return null;
  return (
    <span
      className="helm-say-clock"
      role="timer"
      aria-live="off"
      aria-label={`Elapsed time: ${time}`}
    >
      {time}
    </span>
  );
}

/** "Agents" in the bubble: the chat's helpers and how each is doing. */
function AgentsButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const agents = session.liveAgents ?? [];
  if (!agents.length) return null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="helm-say-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-helm-agents
      >
        {sessionAgentSummary(agents)}
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={300}
          role="dialog"
          aria-label="Agents"
          onDismiss={() => setOpen(false)}
          className="helm-agents p-2"
        >
          <SessionAgentList agents={agents} />
        </Popover>
      ) : null}
    </>
  );
}

/**
 * The critter's speech bubble: what the agent is doing and for how long,
 * with the one Stop; then how it went; or what went wrong and its fix.
 */
export function HelmBubble({
  say,
  run,
  stopInBar,
  onStop,
  fixes,
  onDismiss,
  hint,
}: {
  say: HelmSay | null;
  run: HelmRun | null;
  /** The team bar's Stop stops what this one would (a lead's run). */
  stopInBar: boolean;
  onStop?: () => void;
  fixes: readonly HelmFix[];
  onDismiss: () => void;
  /** Said once, when there is nothing else to say. */
  hint?: ReactNode;
}) {
  if (!say) {
    if (!hint) return null;
    return (
      <div className="helm-say" data-helm-say="hint" role="status">
        <span className="helm-say-text">{hint}</span>
      </div>
    );
  }
  if (say.kind === "running") {
    const canStop = !stopInBar;
    return (
      <div
        className="helm-say"
        data-helm-say={say.waiting ? "waiting" : "running"}
      >
        <span className="helm-say-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span
          className="helm-say-text"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={say.text}
        >
          {say.text}
        </span>
        <RunClock key={say.startedAt ?? "untimed"} startedAt={say.startedAt} />
        {say.queued ? (
          <span className="helm-say-quiet">{say.queued} queued</span>
        ) : null}
        {run && say.agents ? <AgentsButton session={run.session} /> : null}
        {canStop ? (
          <button
            type="button"
            className="helm-stop"
            aria-label="Stop"
            title="Stop"
            data-helm-stop
            onClick={() => (run ? run.onStop(run.session.id) : onStop?.())}
          >
            <i aria-hidden />
          </button>
        ) : null}
      </div>
    );
  }
  if (say.kind === "queued")
    return (
      <div className="helm-say" data-helm-say="queued" role="status">
        <span className="helm-say-text" title={say.detail}>
          {say.text}
        </span>
        <span className="helm-say-quiet">{say.detail}</span>
      </div>
    );
  if (say.kind === "done")
    return (
      <div className="helm-say" data-helm-say="done" role="status">
        <Check className="helm-say-check" aria-hidden />
        <span className="helm-say-text">{say.headline}</span>
        {say.detail ? (
          <span className="helm-say-quiet">{say.detail}</span>
        ) : null}
      </div>
    );
  if (say.kind === "stopped")
    return (
      <div className="helm-say" data-helm-say="stopped" role="status">
        <span className="helm-say-text">Stopped</span>
      </div>
    );
  return (
    <div className="helm-say" data-helm-say="error" role="alert">
      <span className="helm-say-mark" aria-hidden />
      <span className="helm-say-text" title={say.detail}>
        {say.text}
      </span>
      {say.detail && !fixes.length ? (
        <span className="helm-say-quiet">{say.detail}</span>
      ) : null}
      {fixes.map((fix) => (
        <button
          key={fix.label}
          type="button"
          className="helm-say-button"
          title={fix.detail}
          onClick={fix.run}
          data-helm-fix
        >
          {fix.label}
        </button>
      ))}
      <button
        type="button"
        className="helm-say-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X aria-hidden />
      </button>
    </div>
  );
}

/** The run the chat's pane provides, if any. */
export function useHelmRun(): HelmRun | null {
  return useContext(HelmRunContext);
}
