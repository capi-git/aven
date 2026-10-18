/**
 * A project's board: its chats in four columns by their one-word status
 * (see `chatStatus`), Needs you, Working and Ready to review, and its ships
 * in Shipped. Built from summary data only (status words, team runs, review
 * and ship records, dev previews), never from transcripts. Teams show as one
 * card each, their chats folded in. A ship is an event: it stays in Shipped
 * for the week even once its chat has new changes to review.
 */
import { appName } from "./agentNames";
import { chatStage, type ChatStatusWord } from "./chatStatus";
import type { ChatReview } from "./chatReview";
import type { DevPreview } from "./devPreviews";
import { pendingRequestKey, type LeadDecided } from "./teamAttention";
import { isEqualOrInside, pathKey } from "./paths";
import { requestText } from "./requestText";
import { sessionWorkCwd, type HarnessId, type Session } from "./session";
import { shipEvents, type ShipEvent, type ShippedChat } from "./shippedChats";
import {
  TEAM_KIND_LABEL,
  teamAnchor,
  teamKeyOf,
  type TeamKind,
  type TeamRun,
} from "./teamRuns";
import { plural } from "./words";
import { homeLiveSessions, startOfDay } from "./workspaceHome";

/** A loaded chat as the board needs it: small, data-only, safe to compare. */
export type BoardChat = {
  id: string;
  /** Its project folder. */
  cwd: string;
  /** The working copy its changes and Ship it are in. */
  workCwd: string;
  title: string;
  harness: HarnessId;
  /** When its latest turn moved, for ordering. */
  at: number;
  /** While working: when its turn started, and what it is doing. */
  startedAt?: number;
  doing?: string;
  /** What it waits on you for. */
  waiting?: {
    kind: "approval" | "question";
    detail: string;
    /** The approval's request, for Allow. */
    requestId?: number;
  };
};

/**
 * The loaded chats as board rows. `inFlight` is the workspace's busy set;
 * only those chats are read for what they do or ask (see
 * `homeLiveSessions`).
 */
export function boardChats(
  sessions: readonly Session[],
  inFlight: ReadonlySet<string>,
  leadDecided: LeadDecided,
): BoardChat[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return homeLiveSessions(sessions, inFlight, leadDecided).map((row) => {
    const session = byId.get(row.id);
    const key =
      row.waiting?.kind === "approval" && session
        ? pendingRequestKey(session)
        : undefined;
    const requestId = key?.startsWith("approval:")
      ? Number(key.slice("approval:".length))
      : undefined;
    return {
      id: row.id,
      cwd: row.cwd,
      workCwd: session ? sessionWorkCwd(session) : row.cwd,
      title: row.title,
      harness: row.harness,
      at: row.activeAt ?? row.updatedAt,
      ...(row.running && row.startedAt !== undefined
        ? { startedAt: row.startedAt }
        : {}),
      ...(row.running && row.doing ? { doing: row.doing } : {}),
      ...(row.waiting
        ? {
            waiting: {
              ...row.waiting,
              ...(requestId !== undefined && Number.isFinite(requestId)
                ? { requestId }
                : {}),
            },
          }
        : {}),
    };
  });
}

export type BoardColumnId = "needs-you" | "working" | "review" | "shipped";

export const BOARD_COLUMNS: readonly {
  id: BoardColumnId;
  title: string;
  /** What an empty column says. */
  empty: string;
}[] = [
  { id: "needs-you", title: "Needs you", empty: "Nothing needs you" },
  { id: "working", title: "Working", empty: "Nothing running" },
  { id: "review", title: "Ready to review", empty: "Nothing to review" },
  { id: "shipped", title: "Shipped", empty: "Nothing shipped this week" },
];

export type BoardAction =
  | { kind: "allow"; requestId: number }
  | { kind: "open" }
  | { kind: "answer" }
  | { kind: "watch"; teamId: string }
  | { kind: "compare"; raceId: string }
  | { kind: "preview"; previewKey: string }
  | { kind: "review" }
  | { kind: "ship" }
  | {
      kind: "commit";
      commit: { sha: string; shortSha: string; subject: string };
    }
  | { kind: "pr"; number: number; url: string };

export type BoardCard = {
  /** `chat:<session id>`, `team:<team id>` or `ship:<commit or moment>`. */
  id: string;
  column: BoardColumnId;
  /** The chat a click opens. */
  sessionId: string;
  /** Where its changes are, for Review and Ship it. */
  cwd: string;
  title: string;
  /** Its mascots: the chat's, or each team member's. */
  faces: { sessionId: string; harness: HarnessId }[];
  /** One plain line on where it stands. */
  line: string;
  /** While working: when it started, shown as elapsed time after `line`. */
  since?: number;
  /** For order, newest first. */
  at: number;
  actions: BoardAction[];
  /** The team's kind, for a team card. */
  team?: TeamKind;
};

export type WorkBoardModel = {
  columns: Readonly<Record<BoardColumnId, BoardCard[]>>;
  /** Shipped cards older than the recent window, left out until asked. */
  olderShipped: number;
  /** Today's ships, counted from the Shipped cards, and what is under way. */
  today: { shipped: number; inProgress: number };
};

/** Shipped cards shown without Show older. */
export const BOARD_SHIPPED_DAYS = 7;
const DAY_MS = 86_400_000;

export type WorkBoardInput = {
  project: string;
  chats: readonly BoardChat[];
  statuses: Readonly<Record<string, ChatStatusWord>>;
  teams: readonly TeamRun[];
  reviews: Readonly<Record<string, ChatReview>>;
  shipped: Readonly<Record<string, ShippedChat>>;
  previews: readonly Pick<
    DevPreview,
    "key" | "project" | "cwd" | "sessionId" | "status"
  >[];
  now: number;
  /** Show every shipped card, not only this week's. */
  showOlder?: boolean;
};

function inProject(path: string, project: string): boolean {
  return !!path && isEqualOrInside(path, project);
}

/** "ReminderRow.js · +40 −6", "3 files · +48 −12". */
export function reviewLine(
  review: Pick<ChatReview, "files" | "additions" | "deletions" | "names">,
): string {
  const what =
    review.files === 1 && review.names[0]
      ? review.names[0]
      : plural(review.files, "file");
  return `${what} · +${review.additions} −${review.deletions}`;
}

/** "11:20" today, "Oct 12" before. */
export function shippedTime(at: number, now: number): string {
  try {
    return new Intl.DateTimeFormat(
      undefined,
      at >= startOfDay(now)
        ? { hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric" },
    ).format(new Date(at));
  } catch {
    return "";
  }
}

/** "PR #42 · 09:05", "Commit 4c19b02 · 11:20". */
export function shippedLine(ship: ShipEvent, now: number): string {
  const time = shippedTime(ship.at, now);
  const what = ship.pr
    ? `PR #${ship.pr.number}`
    : ship.commit
      ? `Commit ${ship.commit.shortSha}`
      : ship.pushed
        ? "Pushed"
        : "Shipped";
  return time ? `${what} · ${time}` : what;
}

function teamColumn(team: TeamRun): BoardColumnId | null {
  if (team.status === "running") return "working";
  if (team.status === "ready") return "review";
  if (team.status === "needs-you")
    // A run paused long ago waits quietly: it shows nowhere as needing you.
    return team.need?.quiet ? null : "needs-you";
  return null;
}

function teamCard(team: TeamRun, column: BoardColumnId): BoardCard {
  const faces = team.members.map((member) => ({
    sessionId: member.sessionId,
    harness: member.harness,
  }));
  const watch: BoardAction = { kind: "watch", teamId: team.id };
  const anchor = teamAnchor(team);
  const kind = TEAM_KIND_LABEL[team.kind];
  if (column === "needs-you")
    return {
      id: `team:${team.id}`,
      column,
      sessionId: team.need?.sessionId || anchor,
      cwd: team.project,
      title: team.title,
      faces,
      line: !team.need
        ? `${kind} · Needs you`
        : team.need.kind === "paused"
          ? `${kind} · Paused · ${team.need.text}`
          : `${kind} · ${team.need.text}`,
      at: team.need?.since ?? team.updatedAt,
      actions: [{ kind: "open" }, watch],
      team: team.kind,
    };
  if (column === "review")
    return {
      id: `team:${team.id}`,
      column,
      sessionId: anchor,
      cwd: team.project,
      title: team.title,
      faces,
      // "Ready to compare · 3 of 3 done", as its card and bar say it.
      line: team.progress.startsWith("Ready to compare")
        ? team.progress
        : `Ready to compare · ${team.progress}`,
      at: team.updatedAt,
      actions:
        team.kind === "race"
          ? [{ kind: "compare", raceId: teamKeyOf(team.id) }, watch]
          : [watch],
      team: team.kind,
    };
  return {
    id: `team:${team.id}`,
    column,
    sessionId: anchor,
    cwd: team.project,
    title: team.title,
    faces,
    line: `${kind} · ${team.progress}`,
    at: team.startedAt,
    actions: [watch],
    team: team.kind,
  };
}

/**
 * Every ship in the project, each its own card: one per commit, or per Ship
 * it without one, carrying the faces of every chat it took. Named by its
 * commit's subject, else by its chat. Newest first.
 */
function shipCards(
  input: WorkBoardInput,
  chats: ReadonlyMap<string, BoardChat>,
): BoardCard[] {
  const cards = new Map<string, BoardCard>();
  for (const ship of Object.values(input.shipped)) {
    const id = ship.sessionId;
    const chat = chats.get(id);
    const review = input.reviews[id];
    if (!inProject(chat?.cwd ?? ship.project, input.project)) continue;
    const harness = chat?.harness ?? ship.harness ?? review?.harness;
    const face = harness ? [{ sessionId: id, harness }] : [];
    const chatTitle = chat?.title || ship.title || review?.title || "Chat";
    for (const event of shipEvents(ship)) {
      const key = event.commit?.sha ?? `${pathKey(ship.cwd)}@${event.at}`;
      const same = cards.get(key);
      if (same) {
        if (!same.faces.some((entry) => entry.sessionId === id))
          same.faces.push(...face);
        continue;
      }
      cards.set(key, {
        id: `ship:${key}`,
        column: "shipped",
        sessionId: id,
        cwd: ship.cwd,
        title: event.commit?.subject || chatTitle,
        faces: [...face],
        line: shippedLine(event, input.now),
        at: event.at,
        actions: event.pr
          ? [{ kind: "pr", number: event.pr.number, url: event.pr.url }]
          : event.commit
            ? [{ kind: "commit", commit: event.commit }]
            : [],
      });
    }
  }
  return [...cards.values()];
}

/** The board's columns for one project. */
export function workBoard(input: WorkBoardInput): WorkBoardModel {
  const { project, statuses, reviews, shipped, now } = input;
  const columns: Record<BoardColumnId, BoardCard[]> = {
    "needs-you": [],
    working: [],
    review: [],
    shipped: [],
  };
  const covered = new Set<string>();

  for (const team of input.teams) {
    if (!inProject(team.project, project)) continue;
    const column = teamColumn(team);
    if (!column) continue;
    for (const id of [
      team.origin.sessionId,
      ...team.members.map((member) => member.sessionId),
    ])
      if (id) covered.add(id);
    columns[column].push(teamCard(team, column));
  }

  const chats = new Map(input.chats.map((chat) => [chat.id, chat]));
  const ids = new Set<string>([...chats.keys(), ...Object.keys(reviews)]);
  let olderShipped = 0;
  let shippedToday = 0;
  const today = startOfDay(now);
  const recentSince = now - BOARD_SHIPPED_DAYS * DAY_MS;

  // Shipped holds ships, not chats, and the header counts the same cards.
  for (const card of shipCards(input, chats)) {
    if (card.at >= today) shippedToday += 1;
    if (card.at < recentSince && !input.showOlder) olderShipped += 1;
    else columns.shipped.push(card);
  }

  for (const id of ids) {
    if (covered.has(id)) continue;
    const chat = chats.get(id);
    const review = reviews[id];
    const ship = shipped[id];
    const where = chat?.cwd ?? review?.project ?? "";
    if (!inProject(where, project)) continue;
    const word = statuses[id];
    if (!word) continue;
    const stage = chatStage(word);
    // A shipped chat shows as its ships' cards.
    if (stage === "shipped") continue;
    const title = chat?.title || review?.title || ship?.title || "Chat";
    const harness = chat?.harness ?? review?.harness ?? ship?.harness;
    const base = {
      id: `chat:${id}`,
      column: stage,
      sessionId: id,
      cwd: chat?.workCwd ?? review?.cwd ?? ship?.cwd ?? where,
      title,
      faces: harness ? [{ sessionId: id, harness }] : [],
    };
    if (stage === "needs-you") {
      // Its team's card stands for a chat that waits on its team.
      if (!chat) continue;
      const waiting = chat.waiting;
      columns["needs-you"].push({
        ...base,
        line: !waiting
          ? "Needs you"
          : requestText(harness ? appName(harness) : "This chat", {
              kind: waiting.kind,
              what: waiting.detail,
            }),
        at: chat.at,
        actions:
          waiting?.kind === "approval" && waiting.requestId !== undefined
            ? [
                { kind: "allow", requestId: waiting.requestId },
                { kind: "open" },
              ]
            : waiting?.kind === "question"
              ? [{ kind: "answer" }]
              : [{ kind: "open" }],
      });
    } else if (stage === "working") {
      if (!chat) continue;
      columns.working.push({
        ...base,
        line: chat.doing ?? "Working",
        ...(chat.startedAt !== undefined ? { since: chat.startedAt } : {}),
        at: chat.startedAt ?? chat.at,
        actions: [],
      });
    } else if (stage === "review") {
      if (!review) continue;
      const preview = input.previews.find(
        (entry) =>
          entry.status === "live" &&
          (entry.sessionId === id ||
            (!entry.sessionId && inProject(entry.cwd, review.cwd))),
      );
      columns.review.push({
        ...base,
        line: `${reviewLine(review)}${preview ? " · preview running" : ""}`,
        at: review.at,
        actions: [
          ...(preview
            ? [{ kind: "preview" as const, previewKey: preview.key }]
            : []),
          { kind: "review" },
          { kind: "ship" },
        ],
      });
    }
  }

  for (const column of Object.values(columns))
    column.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return {
    columns,
    olderShipped,
    today: {
      shipped: shippedToday,
      inProgress: columns["needs-you"].length + columns.working.length,
    },
  };
}

/** "Today: 3 shipped · 5 in progress". */
export function boardTodayText(today: WorkBoardModel["today"]): string {
  return `Today: ${today.shipped} shipped · ${today.inProgress} in progress`;
}
