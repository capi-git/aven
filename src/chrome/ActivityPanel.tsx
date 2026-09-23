import { useMemo, useState } from "react";
import {
  clearActivityHistory,
  isPendingActivity,
  markActivityRead,
  markAllActivityRead,
  useActivity,
  type ActivityEntry,
} from "../lib/activity";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionNeedsInput,
  type Session,
} from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import {
  ToolbarPanel,
  ToolbarPanelHeader,
  type ToolbarPanelTheme,
} from "./ToolbarPanel";
import "./ActivityPanel.css";

export type ActivityPanelProps = {
  sessions: readonly Session[];
  /** Return true only after restoring/revealing the destination successfully. */
  onOpen: (entry: ActivityEntry) => boolean | Promise<boolean>;
  onOpenSession: (sessionId: string) => boolean | Promise<boolean>;
  theme?: ToolbarPanelTheme;
  onClose?: () => void;
};
export function activitySections(entries: readonly ActivityEntry[]) {
  const needsYou: ActivityEntry[] = [];
  const finished: ActivityEntry[] = [];
  for (const entry of entries) {
    if (
      isPendingActivity(entry) ||
      (entry.outcome === "failed" && entry.readAt === null)
    )
      needsYou.push(entry);
    else finished.push(entry);
  }
  return { needsYou, finished };
}
export function activityOutcomeLabel(entry: ActivityEntry): string {
  switch (entry.outcome) {
    case "completed":
      return "Finished";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "approval":
      return entry.resolvedAt === null ? "Needs approval" : "Approval resolved";
    case "question":
      return entry.resolvedAt === null ? "Has a question" : "Question resolved";
  }
}
function projectName(cwd: string): string {
  if (isProjectlessCwd(cwd)) return "No project";
  return cwd.replace(/\/$/, "").split("/").pop() || "No project";
}
function eventTime(timestamp: number): string {
  const sameDay =
    new Date(timestamp).toDateString() === new Date().toDateString();
  return new Date(timestamp).toLocaleString(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

/** Content for the existing anchored popover; mounted only while Activity is open. */
export function ActivityPanel({
  sessions,
  onOpen,
  onOpenSession,
  theme,
  onClose,
}: ActivityPanelProps) {
  const entries = useActivity();
  const { needsYou, finished } = useMemo(
    () => activitySections(entries),
    [entries],
  );
  const running = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !session.inboxAsk &&
          !sessionNeedsInput(session) &&
          (session.busy || session.queuedMessages?.length),
      ),
    [sessions],
  );
  const unread = entries.filter((entry) => entry.readAt === null).length;
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const open = async (
    id: string,
    action: () => boolean | Promise<boolean>,
    entry?: ActivityEntry,
  ) => {
    if (opening !== null) return;
    setOpening(id);
    setError("");
    try {
      if (await action()) {
        if (entry) markActivityRead(entry.id);
      } else
        setError("This task could not be opened. Its activity is still saved.");
    } catch {
      setError("This task could not be opened. Its activity is still saved.");
    } finally {
      setOpening(null);
    }
  };
  const section = (label: string, rows: readonly ActivityEntry[]) =>
    rows.length ? (
      <section className="activity-section" aria-label={label}>
        <h3>
          {label}
          <span>{rows.length}</span>
        </h3>
        {rows.map((entry) => (
          <div
            className="toolbar-panel-row activity-row"
            key={entry.id}
            data-unread={entry.readAt === null || undefined}
          >
            <button
              className="activity-destination"
              disabled={opening !== null}
              onClick={() => void open(entry.id, () => onOpen(entry), entry)}
              aria-label={`Open ${entry.title}: ${activityOutcomeLabel(entry)}`}
            >
              <span className="activity-provider">
                <HarnessIcon harness={entry.harness} />
              </span>
              <span className="activity-copy">
                <span className="activity-title">
                  {entry.title || "New task"}
                </span>
                <span className="activity-detail">
                  {activityOutcomeLabel(entry)} · {projectName(entry.cwd)} ·{" "}
                  {HARNESS_TITLE[entry.harness]}
                </span>
                <span className="activity-summary">{entry.summary}</span>
              </span>
              <time
                className="activity-time"
                dateTime={new Date(entry.createdAt).toISOString()}
                title={new Date(entry.createdAt).toLocaleString()}
              >
                {eventTime(entry.createdAt)}
              </time>
            </button>
            {entry.readAt === null ? (
              <button
                className="activity-read"
                aria-label={`Mark ${entry.title} as read`}
                title="Mark as read"
                onClick={() => markActivityRead(entry.id)}
              >
                <span />
              </button>
            ) : null}
          </div>
        ))}
      </section>
    ) : null;
  return (
    <ToolbarPanel
      className="activity-panel"
      aria-label="Activity"
      theme={theme}
    >
      <ToolbarPanelHeader
        title="Activity"
        onClose={onClose}
        closeLabel="Close activity"
        actions={
          <span className="activity-unread toolbar-panel-secondary">
            {unread ? `${unread} unread` : "All caught up"}
          </span>
        }
      />
      <div className="activity-actions">
        <button disabled={!unread} onClick={markAllActivityRead}>
          Mark all read
        </button>
        <button
          disabled={!entries.some((entry) => !isPendingActivity(entry))}
          onClick={() => clearActivityHistory({ keepPending: true })}
        >
          Clear finished
        </button>
      </div>
      {error ? (
        <p className="activity-error" role="status">
          {error}
        </p>
      ) : null}
      <div className="activity-list">
        {section("Needs you", needsYou)}
        {running.length ? (
          <section className="activity-section" aria-label="Running">
            <h3>
              Running<span>{running.length}</span>
            </h3>
            {running.map((session) => (
              <div className="toolbar-panel-row activity-row" key={session.id}>
                <button
                  className="activity-destination"
                  disabled={opening !== null}
                  onClick={() =>
                    void open(session.id, () => onOpenSession(session.id))
                  }
                  aria-label={`Open ${sessionDisplayTitle(session.title, session.harness)}`}
                >
                  <span className="activity-provider">
                    <HarnessIcon harness={session.harness} />
                  </span>
                  <span className="activity-copy">
                    <span className="activity-title">
                      {sessionDisplayTitle(session.title, session.harness)}
                    </span>
                    <span className="activity-detail">
                      {session.busy
                        ? "Working"
                        : session.queueStatus === "paused"
                          ? "Queue paused"
                          : "Queued"}
                      {session.queuedMessages?.length
                        ? ` · ${session.queuedMessages.length} queued`
                        : ""}{" "}
                      · {projectName(session.cwd)}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </section>
        ) : null}
        {section("Finished", finished)}
        {!entries.length && !running.length ? (
          <p className="activity-empty">
            Nothing here yet. Finished tasks and requests for your input will
            appear here.
          </p>
        ) : null}
      </div>
      <footer className="activity-footer">
        Recent activity stays here even when notifications are off.
      </footer>
    </ToolbarPanel>
  );
}
