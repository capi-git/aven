import { memo, useEffect, useState } from "react";
import { AlertCircle, Check, LoaderCircle, Pause, Square } from "../chrome/icons";
import { useActivity } from "../lib/activity";
import type { Session } from "../lib/session";
import { sessionRunStatus } from "../lib/sessionRunStatus";
import "./SessionRunStatus.css";

type Props = {
  session: Session;
  visible: boolean;
  onStop: (sessionId: string) => void;
  onOpenTerminal?: (sessionId: string) => void;
};

/** Outside the transcript scroller, so long responses cannot hide the state. */
export const SessionRunStatus = memo(function SessionRunStatus(props: Props) {
  // Parked panes need neither a ledger subscription nor a ticking clock.
  return props.visible ? <VisibleRunStatus {...props} /> : null;
});

function VisibleRunStatus({ session, onStop, onOpenTerminal }: Props) {
  const entries = useActivity();
  const status = sessionRunStatus(session, entries);
  if (!status) return null;
  const running = status.kind === "working";
  const Icon = running
    ? LoaderCircle
    : status.kind === "finished"
      ? Check
      : status.kind === "failed"
        ? AlertCircle
        : status.kind === "waiting" || status.kind === "queued"
          ? Pause
          : Square;
  const queued = session.queuedMessages?.length ?? 0;
  return (
    <div className="session-run-status" data-run-state={status.kind}>
      <span className="session-run-mark" aria-hidden="true">
        <span className={running ? "session-run-spinner" : undefined}>
          <Icon className="size-3.5" />
        </span>
      </span>
      <div className="session-run-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{status.label}</strong>
        <span className="session-run-detail" title={status.detail}>{status.detail}</span>
      </div>
      {queued > 0 && status.canStop ? (
        <span className="session-run-queued" title={`${queued} messages queued`}>
          {queued} queued
        </span>
      ) : null}
      <RunClock
        key={`${session.id}:${status.startedAt ?? "untimed"}`}
        startedAt={status.startedAt}
        durationMs={status.durationMs}
        running={running}
      />
      {status.canStop ? (
        <button type="button" className="session-run-stop" onClick={() => onStop(session.id)} aria-label="Stop agent">
          <Square className="size-2.5" aria-hidden="true" />
          Stop
        </button>
      ) : null}
      {status.recovery === "claude-login" ? (
        <div className="session-run-recovery">
          <span>Run <code>claude auth login</code> in Aven’s terminal, then retry.</span>
          {onOpenTerminal ? (
            <button type="button" className="session-run-stop" onClick={() => onOpenTerminal(session.id)}>
              Open terminal
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Only this small leaf re-renders each second; the transcript never ticks. */
function RunClock({ startedAt, durationMs, running }: {
  startedAt?: number;
  durationMs?: number;
  running: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || startedAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);
  const elapsed = running && startedAt != null ? now - startedAt : durationMs;
  if (elapsed == null || !Number.isFinite(elapsed)) return null;
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  const minutes = Math.floor(seconds / 60);
  const time = minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  return <span className="session-run-clock" role="timer" aria-live="off" aria-label={`Elapsed time: ${time}`}>{time}</span>;
}
