import { projectKey } from "./paths";
import type { ScheduledRun } from "./scheduledAgents";
import {
  isWaitingAttention,
  startOfDay,
  type HomeAttention,
  type HomeFinished,
} from "./workspaceHome";

/**
 * Home's "While you were away" card. Aven remembers when the user was last
 * here; coming back on a new day or after six hours away opens a briefing of
 * what happened in between, kept until it is dismissed or grows stale.
 */
export const HOME_VISIT_KEY = "aven.home.visit.v1";
const HOUR = 60 * 60_000;
/** Away at least this long (or into a new day) earns a briefing. */
export const AWAY_MS = 6 * HOUR;
/** An undismissed briefing stays on Home this long after it opened. */
export const BRIEFING_KEEP_MS = 6 * HOUR;

/** What happened between `since` (last seen) and `at` (back again). */
export type HomeBriefingWindow = { since: number; at: number };

export type HomeVisit = {
  /** When the user was last here. */
  seenAt: number;
  briefing: HomeBriefingWindow | null;
};

function time(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function readHomeVisitRaw(): string | null {
  try {
    return localStorage.getItem(HOME_VISIT_KEY);
  } catch {
    return null;
  }
}

export function loadHomeVisit(): HomeVisit | null {
  return parseHomeVisit(readHomeVisitRaw());
}

export function parseHomeVisit(raw: string | null): HomeVisit | null {
  try {
    const parsed = JSON.parse(raw ?? "null");
    if (!parsed || !time(parsed.seenAt)) return null;
    const briefing = parsed.briefing;
    return {
      seenAt: parsed.seenAt,
      briefing:
        briefing && time(briefing.since) && time(briefing.at)
          ? { since: briefing.since, at: briefing.at }
          : null,
    };
  } catch {
    return null;
  }
}

export function saveHomeVisit(visit: HomeVisit) {
  try {
    localStorage.setItem(
      HOME_VISIT_KEY,
      JSON.stringify({ version: 1, ...visit }),
    );
  } catch {
    // Without storage every return looks like the first; no briefing shows.
  }
}

/** Gone six hours, or since before today began. */
export function wasAway(seenAt: number, now: number): boolean {
  return now - seenAt >= AWAY_MS || seenAt < startOfDay(now);
}

/** The briefing still worth showing at `now`, if any. */
export function currentBriefing(
  visit: HomeVisit | null,
  now: number,
): HomeBriefingWindow | null {
  const briefing = visit?.briefing;
  return briefing && now - briefing.at < BRIEFING_KEEP_MS ? briefing : null;
}

/** The user is back (or still here): opens a briefing if they were away. */
export function arriveHome(prev: HomeVisit | null, now: number): HomeVisit {
  if (prev && prev.seenAt < now && wasAway(prev.seenAt, now))
    return { seenAt: now, briefing: { since: prev.seenAt, at: now } };
  return {
    seenAt: Math.max(prev?.seenAt ?? 0, now),
    briefing: currentBriefing(prev, now),
  };
}

/** The user is leaving: remember when, keeping any briefing. */
export function leaveHome(prev: HomeVisit | null, now: number): HomeVisit {
  return {
    seenAt: Math.max(prev?.seenAt ?? 0, now),
    briefing: currentBriefing(prev, now),
  };
}

export function dismissHomeBriefing(
  prev: HomeVisit | null,
  now: number,
): HomeVisit {
  return { seenAt: Math.max(prev?.seenAt ?? 0, now), briefing: null };
}

export type HomeBriefing = {
  since: number;
  /** Completed and failed turns in the window, newest first. */
  finished: HomeFinished[];
  done: number;
  failed: number;
  /** Approvals and questions waiting now. */
  waiting: number;
  /** Automation runs that started in the window, newest first. */
  runs: ScheduledRun[];
  runsFailed: number;
};

/** What the card says, from data Home already has. */
export function homeBriefing({
  window,
  finished,
  needsYou,
  runs,
  projects,
}: {
  window: HomeBriefingWindow;
  finished: readonly HomeFinished[];
  needsYou: readonly HomeAttention[];
  runs: readonly ScheduledRun[];
  /** The workspace's project folders; automations elsewhere are left out. */
  projects: readonly { path: string }[];
}): HomeBriefing {
  const inWindow = (at: number) => at > window.since && at <= window.at;
  const turns = finished.filter(
    (row) => row.kind !== "stopped" && inWindow(row.at),
  );
  const keys = new Set(projects.map((project) => projectKey(project.path)));
  const ran = runs.filter(
    (run) => inWindow(run.startedAt) && keys.has(projectKey(run.project)),
  );
  return {
    since: window.since,
    finished: turns,
    done: turns.filter((row) => row.kind === "completed").length,
    failed: turns.filter((row) => row.kind === "failed").length,
    waiting: needsYou.filter(isWaitingAttention).length,
    runs: ran,
    runsFailed: ran.filter((run) => run.status === "failed").length,
  };
}

export function briefingHasNews(
  briefing: HomeBriefing,
  reviewRequests: number,
): boolean {
  return (
    briefing.finished.length > 0 ||
    briefing.waiting > 0 ||
    briefing.runs.length > 0 ||
    reviewRequests > 0
  );
}

/** "since 9:40", "since yesterday 18:40", "since Mon 18:40", "since 3 Oct". */
export function briefingSince(since: number, now: number): string {
  const today = startOfDay(now);
  const day = 24 * HOUR;
  try {
    const clock = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(since));
    if (since >= today) return `since ${clock}`;
    if (since >= today - day) return `since yesterday ${clock}`;
    if (since >= today - 6 * day) {
      const weekday = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
      }).format(new Date(since));
      return `since ${weekday} ${clock}`;
    }
    return `since ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(since))}`;
  } catch {
    return "";
  }
}
