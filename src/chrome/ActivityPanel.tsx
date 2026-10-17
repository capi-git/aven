import { useMemo, useState } from "react";
import {
  clearActivityHistory,
  isMemberActivity,
  isPendingActivity,
  markActivityRead,
  markAllActivityRead,
  useActivity,
  type ActivityEntry,
} from "../lib/activity";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionIsWaitingForInput,
  type Session,
} from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { TeamMiniFaces } from "./TeamCard";
import { useTeamRuns } from "../hooks/useTeamRuns";
import { groupRunningChats, teamRowInfo } from "../lib/teamGrouping";
import { teamsNeedingYou } from "../lib/teamAttention";
import type { TeamNeed, TeamRun } from "../lib/teamRuns";
import { isRunPausedActivity } from "../lib/orchestrationActivity";
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
/**
 * A team waiting on you as a row of its own, for a need with no entry to
 * show (one already there when Aven started, or whose entry was read).
 */
function liveNeedRow(team: TeamRun, need: TeamNeed): ActivityEntry {
  return {
    id: `live:${team.id}`,
    sessionId: need.sessionId,
    outcome: "failed",
    title: team.title,
    summary: need.text,
    cwd: team.project,
    harness:
      team.members.find((member) => member.sessionId === need.sessionId)
        ?.harness ??
      team.members[0]?.harness ??
      "claude",
    model: "",
    createdAt: need.since,
    // Nothing to mark read: it stays while the team waits on you.
    readAt: need.since,
    resolvedAt: null,
    team: { id: team.id, kind: team.kind, need: true },
  };
}

/**
 * Activity's two lists. "Needs you" holds pending requests, unread
 * failures, and every team that waits on you itself (paused, stalled, a
 * race no agent finished) for as long as it waits, read or not, as the
 * Dock, the sidebar and Home count it.
 */
export function activitySections(
  entries: readonly ActivityEntry[],
  teams: readonly TeamRun[] = [],
) {
  const needsYou: ActivityEntry[] = [];
  const finished: ActivityEntry[] = [];
  const waiting = new Map<string, { team: TeamRun; need: TeamNeed }>();
  for (const team of teamsNeedingYou(teams))
    if (
      team.need &&
      team.need.kind !== "approval" &&
      team.need.kind !== "question"
    )
      waiting.set(team.id, { team, need: team.need });
  const shown = new Set<string>();
  for (const entry of entries) {
    // A team member's own turn is its team's: the team posts its own entry.
    if (isMemberActivity(entry)) continue;
    const team = entry.team?.need ? entry.team.id : undefined;
    if (team && waiting.has(team) && entry.resolvedAt === null) {
      // Its newest entry, read or not, stands for it while it waits.
      if (shown.has(team)) finished.push(entry);
      else {
        shown.add(team);
        needsYou.push(entry);
      }
      continue;
    }
    if (
      isPendingActivity(entry) ||
      (entry.outcome === "failed" &&
        entry.readAt === null &&
        entry.resolvedAt === null)
    )
      needsYou.push(entry);
    else finished.push(entry);
  }
  for (const [id, { team, need }] of waiting)
    if (!shown.has(id)) needsYou.push(liveNeedRow(team, need));
  needsYou.sort((a, b) => b.createdAt - a.createdAt);
  return { needsYou, finished };
}
export function activityOutcomeLabel(entry: ActivityEntry): string {
  // A team waiting on you (paused, stalled, a race no agent finished) reads
  // as Home and the sidebar word it; the summary says why.
  if (isRunPausedActivity(entry))
    return entry.resolvedAt === null ? "Needs you" : "Was waiting on you";
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
  // A team runs as one row: its chats fold into the one it started from.
  const teams = useTeamRuns();
  const { needsYou, finished } = useMemo(
    () => activitySections(entries, teams),
    [entries, teams],
  );
  const running = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !session.inboxAsk &&
          !sessionIsWaitingForInput(session) &&
          (session.busy || session.queuedMessages?.length),
      ),
    [sessions],
  );
  const runningRows = useMemo(
    () => groupRunningChats(running, teams),
    [running, teams],
  );
  const unread = entries.filter(
    (entry) => entry.readAt === null && !isMemberActivity(entry),
  ).length;
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
              Running<span>{runningRows.length}</span>
            </h3>
            {runningRows.map((row) => {
              if (row.kind === "team") {
                const info = teamRowInfo(row.team);
                const origin = row.team.origin.sessionId;
                return (
                  <div
                    className="toolbar-panel-row activity-row"
                    key={row.team.id}
                    data-activity-team={row.team.id}
                  >
                    <button
                      className="activity-destination"
                      disabled={opening !== null}
                      onClick={() =>
                        void open(origin, () => onOpenSession(origin))
                      }
                      aria-label={`Open ${row.team.title}`}
                    >
                      <span className="activity-provider">
                        <TeamMiniFaces members={info.members} active />
                      </span>
                      <span className="activity-copy">
                        <span className="activity-title">{row.team.title}</span>
                        <span className="activity-detail">
                          {info.status} · {info.count} agents ·{" "}
                          {projectName(row.team.project)}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              }
              const session = row.item;
              return (
                <div
                  className="toolbar-panel-row activity-row"
                  key={session.id}
                >
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
              );
            })}
          </section>
        ) : null}
        {section("Finished", finished)}
        {!needsYou.length && !finished.length && !running.length ? (
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
