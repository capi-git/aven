/**
 * A project's board of features: the cards you wrote down (see
 * `featureCards`) in four columns, Ideas, Building, Review and Shipped. A
 * card links to the chats that build it and moves by itself from their real
 * state, worked out from summary data only (status words, team runs, review
 * and ship records, dev previews), never from transcripts:
 *
 * - any of its chats at work, alone or in a race, discussion or run it
 *   started: **Building**;
 * - work stopped with changes to review (or a race ready to compare):
 *   **Review**;
 * - its changes went out through Ship it: **Shipped**;
 * - a chat that waits on you leaves the card where it is, with an amber
 *   "Needs you" saying what is needed.
 *
 * A move by hand wins until the next real change in one of its chats: each
 * card remembers its chats' state when its column was last decided (its
 * `basis`), and only follows them again once that changes. Work in the
 * project that no card links to is summed up on one line, so nothing that
 * needs you is hidden.
 */
import { appName } from "./agentNames";
import type { CrewBoardInfo } from "./crewView";
import { chatStage, type ChatStatusWord } from "./chatStatus";
import type { ChatReview } from "./chatReview";
import type { DevPreview } from "./devPreviews";
import {
  boardProjectFor,
  type FeatureCard,
  type FeatureCardDraft,
  type FeatureCardSettle,
  type FeatureColumn,
} from "./featureCards";
import { pendingRequestKey, type LeadDecided } from "./teamAttention";
import { isEqualOrInside } from "./paths";
import { requestText } from "./requestText";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type HarnessId,
  type Session,
} from "./session";
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

export type BoardColumnId = FeatureColumn;

export const BOARD_COLUMNS: readonly {
  id: BoardColumnId;
  title: string;
  /** What an empty column says. */
  empty: string;
}[] = [
  { id: "idea", title: "Ideas", empty: "No ideas waiting" },
  { id: "building", title: "Building", empty: "Nothing building" },
  { id: "review", title: "Review", empty: "Nothing to review" },
  { id: "shipped", title: "Shipped", empty: "Nothing shipped this week" },
];

/** What the Ideas column says while the board has no cards at all. */
export const BOARD_EMPTY_INVITATION = "Write down what you want built next.";

export type BoardAction =
  | { kind: "build" }
  | { kind: "allow"; sessionId: string; requestId: number }
  | { kind: "answer"; sessionId: string }
  | { kind: "open"; sessionId: string }
  | { kind: "watch"; teamId: string }
  | { kind: "compare"; raceId: string }
  | { kind: "preview"; previewKey: string }
  | { kind: "review"; sessionId: string; cwd: string }
  | { kind: "ship"; sessionId: string; cwd: string }
  | {
      kind: "commit";
      sessionId: string;
      cwd: string;
      commit: { sha: string; shortSha: string; subject: string };
    }
  | { kind: "pr"; number: number; url: string };

export type BoardFace = { sessionId: string; harness: HarnessId };

/** One card as drawn. */
export type BoardCard = {
  /** The feature card's id. */
  id: string;
  column: BoardColumnId;
  title: string;
  note?: string;
  /** Where it came from: "#12" for a GitHub issue, else the link's site. */
  source?: { url: string; label: string };
  /** The chats it links. */
  chatIds: readonly string[];
  /** The chat a click opens: the one that needs you or works, else the newest. */
  sessionId?: string;
  /** Its mascots: the chat's, or each team member's. */
  faces: BoardFace[];
  /** Its mascots move: one of its chats is at work. */
  working: boolean;
  /** One plain line on where it stands. */
  line?: string;
  /** While working: when it started, shown as elapsed time after `line`. */
  since?: number;
  /** What one of its chats waits on you for, in the amber badge. */
  needsYou?: string;
  actions: BoardAction[];
  /** The kind of team at work on it, for a team's card. */
  team?: TeamKind;
  /** For order within its column. */
  at: number;
  /** Its chats' state now, saved with a move by hand. */
  basis: string;
  /** How it looks while the project's crew has it, or offers to (see `crewBoardColumns`). */
  crew?: CrewBoardInfo;
};

/** Work in the project that no card links to. */
export type OutsideWork = {
  /** `chat:<id>` or `team:<id>`. */
  id: string;
  /** The chat a card for it links, and a click opens. */
  sessionId: string;
  title: string;
  stage: "needs-you" | "working" | "review";
  /** Where a card for it starts. */
  column: FeatureColumn;
  faces: BoardFace[];
  at: number;
};

export type WorkBoardModel = {
  columns: Readonly<Record<BoardColumnId, BoardCard[]>>;
  /** Shipped cards older than the recent window, left out until asked. */
  olderShipped: number;
  /** Today's ships and the cards under way, for the header. */
  today: { shipped: number; inProgress: number };
  outside: OutsideWork[];
  /**
   * Cards whose chats really changed since their column was decided, and
   * where they go now: the board saves these.
   */
  settles: FeatureCardSettle[];
  /** No cards at all yet. */
  empty: boolean;
};

/** Shipped cards shown without Show older. */
export const BOARD_SHIPPED_DAYS = 7;
const DAY_MS = 86_400_000;

export type WorkBoardInput = {
  project: string;
  cards: readonly FeatureCard[];
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
  /**
   * The workspace has told the board its chats. Until then nothing moves by
   * itself: an empty feed would read as every chat gone quiet.
   */
  live?: boolean;
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
  // Lines another chat also changed can't be split between them; show none
  // rather than a misleading "+0 −0".
  if (!review.additions && !review.deletions) return what;
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

/** "Shipped Oct 12 · PR #42", "Shipped 11:20 · Commit 4c19b02". */
export function cardShippedLine(
  at: number,
  ship: ShipEvent | undefined,
  now: number,
): string {
  const time = shippedTime(at, now);
  const what = ship?.pr
    ? `PR #${ship.pr.number}`
    : ship?.commit
      ? `Commit ${ship.commit.shortSha}`
      : "";
  return [time ? `Shipped ${time}` : "Shipped", what]
    .filter(Boolean)
    .join(" · ");
}

/** "#12" for a GitHub issue or pull request, else the link's site. */
export function sourceLabel(url: string): string {
  const issue = /github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/i.exec(url);
  if (issue) return `#${issue[1]}`;
  try {
    return new URL(url).host || "Link";
  } catch {
    return "Link";
  }
}

/**
 * A card's chats' state, compared with the one saved when its column was
 * last decided: each chat's word, and when its changes were last seen and
 * shipped. What an agent is doing, or a streamed reply, is not a change.
 */
export function cardBasis(
  chatIds: readonly string[],
  statuses: Readonly<Record<string, ChatStatusWord>>,
  reviews: Readonly<Record<string, Pick<ChatReview, "at">>>,
  shipped: Readonly<Record<string, Pick<ShippedChat, "at">>>,
): string {
  return [...chatIds]
    .sort()
    .map(
      (id) =>
        `${id}:${statuses[id] ?? ""}:${reviews[id]?.at ?? ""}:${shipped[id]?.at ?? ""}`,
    )
    .join("|");
}

/**
 * Where a card's chats put it, or null to leave it where it is: any at
 * work, Building; else any with changes, Review; else any shipped, Shipped.
 * A chat that waits on you, or one gone quiet, moves nothing.
 */
export function cardColumnFor(
  words: readonly (ChatStatusWord | undefined)[],
): FeatureColumn | null {
  const stages = words.map((word) => (word ? chatStage(word) : undefined));
  if (stages.includes("working")) return "building";
  if (stages.includes("review")) return "review";
  if (stages.includes("shipped")) return "shipped";
  return null;
}

/** Where a card for a chat starts when you add it to the board. */
export function chatBoardColumn(
  word: ChatStatusWord | undefined,
): FeatureColumn {
  return cardColumnFor([word]) ?? "building";
}

/**
 * Add to board: a card for each chat, titled from it, linked to it and in
 * the column its state implies, grouped by the project whose board it goes
 * on. Scratch chats have no board.
 */
export function chatCardDrafts(
  chats: readonly Pick<Session, "id" | "cwd" | "title" | "harness">[],
  statuses: Readonly<Record<string, ChatStatusWord>>,
): Map<string, FeatureCardDraft[]> {
  const drafts = new Map<string, FeatureCardDraft[]>();
  for (const chat of chats) {
    const project = boardProjectFor(chat.cwd);
    if (!project) continue;
    drafts.set(project, [
      ...(drafts.get(project) ?? []),
      {
        title: sessionDisplayTitle(chat.title, chat.harness),
        chatIds: [chat.id],
        column: chatBoardColumn(statuses[chat.id]),
      },
    ]);
  }
  return drafts;
}

function teamTouches(team: TeamRun, ids: ReadonlySet<string>): boolean {
  return (
    (!!team.origin.sessionId && ids.has(team.origin.sessionId)) ||
    team.members.some((member) => ids.has(member.sessionId))
  );
}

function teamChatIds(team: TeamRun): string[] {
  return [
    ...(team.origin.sessionId ? [team.origin.sessionId] : []),
    ...team.members.map((member) => member.sessionId),
  ];
}

/** A team still going: running, ready to compare, or waiting on you. */
function teamLive(team: TeamRun): boolean {
  return (
    team.status === "running" ||
    team.status === "ready" ||
    (team.status === "needs-you" && !team.need?.quiet)
  );
}

function teamFaces(team: TeamRun): BoardFace[] {
  return team.members.map((member) => ({
    sessionId: member.sessionId,
    harness: member.harness,
  }));
}

/** The newest ship of any of the chats, and which chat it was. */
function newestShip(
  ids: readonly string[],
  shipped: WorkBoardInput["shipped"],
): { event: ShipEvent; sessionId: string } | undefined {
  let newest: { event: ShipEvent; sessionId: string } | undefined;
  for (const id of ids) {
    const ship = shipped[id];
    if (!ship) continue;
    for (const event of shipEvents(ship))
      if (!newest || event.at > newest.event.at)
        newest = { event, sessionId: id };
  }
  return newest;
}

/** One card's look, and where it goes by itself if its chats changed. */
function boardCard(
  card: FeatureCard,
  input: WorkBoardInput,
  chats: ReadonlyMap<string, BoardChat>,
): { card: BoardCard; settle?: FeatureCardSettle } {
  const { statuses, reviews, shipped, now } = input;
  const linked = card.chatIds;
  const ids = new Set(linked);
  const basis = cardBasis(linked, statuses, reviews, shipped);
  const auto = cardColumnFor(linked.map((id) => statuses[id]));
  const changed = !!input.live && basis !== (card.basis ?? "");
  const column = changed ? (auto ?? card.column) : card.column;
  const ship = newestShip(linked, shipped);
  const shippedAt =
    column !== "shipped"
      ? undefined
      : card.column === "shipped"
        ? (card.shippedAt ?? card.movedAt)
        : (ship?.event.at ?? now);
  const settle: FeatureCardSettle | undefined = changed
    ? {
        id: card.id,
        from: card.basis,
        basis,
        column,
        ...(column === "shipped" && card.column !== "shipped" && ship
          ? { shippedAt: ship.event.at }
          : {}),
      }
    : undefined;

  const teams = input.teams.filter(
    (team) => teamLive(team) && teamTouches(team, ids),
  );
  const harnessOf = (id: string): HarnessId | undefined =>
    chats.get(id)?.harness ?? reviews[id]?.harness ?? shipped[id]?.harness;
  const face = (id: string): BoardFace[] => {
    const harness = harnessOf(id);
    return harness ? [{ sessionId: id, harness }] : [];
  };
  const newest = linked[linked.length - 1];
  const actions: BoardAction[] = [];
  let sessionId: string | undefined = newest;
  let faces = newest ? face(newest) : [];
  let working = false;
  let line: string | undefined;
  let since: number | undefined;
  let needsYou: string | undefined;
  let team: TeamKind | undefined;

  // What waits on you: a chat's approval or question, or its team paused.
  const waitingChat = linked.find((id) => statuses[id] === "needs-you");
  const waitingTeam = teams.find((entry) => entry.status === "needs-you");
  if (waitingChat) {
    const waiting = chats.get(waitingChat)?.waiting;
    const harness = harnessOf(waitingChat);
    sessionId = waitingChat;
    faces = face(waitingChat);
    needsYou = waiting
      ? requestText(harness ? appName(harness) : "This chat", {
          kind: waiting.kind,
          what: waiting.detail,
        })
      : "Waiting on you";
    if (waiting?.kind === "approval" && waiting.requestId !== undefined)
      actions.push(
        {
          kind: "allow",
          sessionId: waitingChat,
          requestId: waiting.requestId,
        },
        { kind: "open", sessionId: waitingChat },
      );
    else if (waiting?.kind === "question")
      actions.push({ kind: "answer", sessionId: waitingChat });
    else actions.push({ kind: "open", sessionId: waitingChat });
  } else if (waitingTeam) {
    const need = waitingTeam.need;
    sessionId = need?.sessionId || teamAnchor(waitingTeam) || sessionId;
    faces = teamFaces(waitingTeam);
    team = waitingTeam.kind;
    needsYou = !need
      ? "Waiting on you"
      : need.kind === "paused"
        ? `Paused · ${need.text}`
        : need.text;
    if (sessionId) actions.push({ kind: "open", sessionId });
    actions.push({ kind: "watch", teamId: waitingTeam.id });
  }

  const running = teams.find((entry) => entry.status === "running");
  const ready = teams.find(
    (entry) => entry.status === "ready" && entry.kind === "race",
  );
  const workingChat = [...linked]
    .reverse()
    .find((id) => !!statuses[id] && chatStage(statuses[id]) === "working");
  const reviewed = linked
    .filter((id) => statuses[id] === "review" && reviews[id])
    .sort((a, b) => reviews[b].at - reviews[a].at);

  if (column === "idea") {
    if (!needsYou) {
      actions.push({ kind: "build" });
      if (newest) actions.push({ kind: "open", sessionId: newest });
    }
  } else if (running) {
    working = true;
    team = running.kind;
    if (!needsYou) {
      faces = teamFaces(running);
      sessionId = teamAnchor(running) || sessionId;
    }
    line = `${TEAM_KIND_LABEL[running.kind]} · ${running.progress}`;
    if (!actions.some((action) => action.kind === "watch"))
      actions.push({ kind: "watch", teamId: running.id });
  } else if (workingChat) {
    const chat = chats.get(workingChat);
    working = true;
    if (!needsYou) {
      sessionId = workingChat;
      faces = face(workingChat);
    }
    line = chat?.doing ?? "Working";
    if (chat?.startedAt !== undefined) since = chat.startedAt;
  } else if (ready) {
    team = ready.kind;
    if (!needsYou) {
      faces = teamFaces(ready);
      sessionId = teamAnchor(ready) || sessionId;
    }
    line = ready.progress.startsWith("Ready to compare")
      ? ready.progress
      : `Ready to compare · ${ready.progress}`;
    actions.push(
      { kind: "compare", raceId: teamKeyOf(ready.id) },
      { kind: "watch", teamId: ready.id },
    );
  } else if (reviewed.length && column !== "shipped") {
    const id = reviewed[0];
    const all = reviewed.map((entry) => reviews[entry]);
    const cwd = chats.get(id)?.workCwd ?? all[0].cwd;
    const preview = input.previews.find(
      (entry) =>
        entry.status === "live" &&
        (reviewed.includes(entry.sessionId ?? "") ||
          (!entry.sessionId && inProject(entry.cwd, all[0].cwd))),
    );
    if (!needsYou) {
      sessionId = id;
      faces = face(id);
    }
    line = `${reviewLine({
      files: all.reduce((sum, entry) => sum + entry.files, 0),
      additions: all.reduce((sum, entry) => sum + entry.additions, 0),
      deletions: all.reduce((sum, entry) => sum + entry.deletions, 0),
      names: all.flatMap((entry) => entry.names),
    })}${preview ? " · preview running" : ""}`;
    actions.push(
      ...(preview
        ? [{ kind: "preview" as const, previewKey: preview.key }]
        : []),
      { kind: "review", sessionId: id, cwd },
      { kind: "ship", sessionId: id, cwd },
    );
  } else if (column === "shipped") {
    line = cardShippedLine(shippedAt ?? card.movedAt, ship?.event, now);
    if (ship?.event.pr)
      actions.push({
        kind: "pr",
        number: ship.event.pr.number,
        url: ship.event.pr.url,
      });
    else if (ship?.event.commit)
      actions.push({
        kind: "commit",
        sessionId: ship.sessionId,
        cwd: shipped[ship.sessionId]?.cwd ?? input.project,
        commit: ship.event.commit,
      });
    // Moved here by hand while its changes are still waiting: say so, and
    // offer to look at them rather than a Ship it that reads as undone.
    if (!ship && reviewed.length) {
      const id = reviewed[0];
      line = `${line} · changes not shipped yet`;
      actions.push({
        kind: "review",
        sessionId: id,
        cwd: chats.get(id)?.workCwd ?? reviews[id].cwd,
      });
    }
  } else if (!needsYou) {
    line = !newest
      ? "No chat yet"
      : column === "building"
        ? "Agent stopped · nothing to review yet"
        : "No changes waiting";
    actions.push(
      newest ? { kind: "open", sessionId: newest } : { kind: "build" },
    );
  }

  const at =
    column === "idea"
      ? card.createdAt
      : column === "shipped"
        ? (shippedAt ?? card.movedAt)
        : column !== card.column
          ? now
          : card.movedAt;
  const drawn: BoardCard = {
    id: card.id,
    column,
    title: card.title,
    ...(card.note ? { note: card.note } : {}),
    ...(card.sourceUrl
      ? { source: { url: card.sourceUrl, label: sourceLabel(card.sourceUrl) } }
      : {}),
    chatIds: linked,
    ...(sessionId ? { sessionId } : {}),
    faces,
    working,
    ...(line ? { line } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(needsYou ? { needsYou } : {}),
    actions,
    ...(team ? { team } : {}),
    at,
    basis,
  };
  return settle ? { card: drawn, settle } : { card: drawn };
}

/** Teams and chats in the project at work, waiting or with changes, with no card. */
function outsideWork(
  input: WorkBoardInput,
  chats: ReadonlyMap<string, BoardChat>,
  covered: Set<string>,
): OutsideWork[] {
  const { project, statuses, reviews } = input;
  const found: OutsideWork[] = [];
  for (const team of input.teams) {
    if (!inProject(team.project, project) || !teamLive(team)) continue;
    if (teamTouches(team, covered)) continue;
    for (const id of teamChatIds(team)) covered.add(id);
    const stage =
      team.status === "running"
        ? "working"
        : team.status === "ready"
          ? "review"
          : "needs-you";
    found.push({
      id: `team:${team.id}`,
      sessionId: teamAnchor(team),
      title: team.title,
      stage,
      column: stage === "review" ? "review" : "building",
      faces: teamFaces(team),
      at: team.updatedAt,
    });
  }
  for (const [id, word] of Object.entries(statuses)) {
    if (covered.has(id)) continue;
    const stage = chatStage(word);
    if (stage === "shipped") continue;
    const chat = chats.get(id);
    const review = reviews[id];
    if (!inProject(chat?.cwd ?? review?.project ?? "", project)) continue;
    // A chat at work or waiting is listed while it is loaded, and one with
    // changes while they are recorded, as its card would show them.
    if (stage === "review" ? !review : !chat) continue;
    const harness = chat?.harness ?? review?.harness;
    found.push({
      id: `chat:${id}`,
      sessionId: id,
      title: chat?.title || review?.title || "Chat",
      stage,
      column: stage === "review" ? "review" : "building",
      faces: harness ? [{ sessionId: id, harness }] : [],
      at: chat?.at ?? review?.at ?? 0,
    });
  }
  const order = { "needs-you": 0, working: 1, review: 2 } as const;
  return found.sort(
    (a, b) =>
      order[a.stage] - order[b.stage] ||
      b.at - a.at ||
      a.id.localeCompare(b.id),
  );
}

/**
 * "2 chats working outside the board", "3 chats outside the board: 1 needs
 * you · 2 working".
 */
export function outsideText(outside: readonly OutsideWork[]): string {
  const count = (stage: OutsideWork["stage"]) =>
    outside.filter((entry) => entry.stage === stage).length;
  const needs = count("needs-you");
  const working = count("working");
  const changes = count("review");
  const total = outside.length;
  const chats = plural(total, "chat");
  if (needs === total)
    return `${chats} ${total === 1 ? "needs" : "need"} you outside the board`;
  if (working === total) return `${chats} working outside the board`;
  if (changes === total) return `${chats} with changes outside the board`;
  const parts = [
    needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : "",
    working ? `${working} working` : "",
    changes ? `${changes} with changes` : "",
  ].filter(Boolean);
  return `${chats} outside the board: ${parts.join(" · ")}`;
}

/** The board for one project. */
export function workBoard(input: WorkBoardInput): WorkBoardModel {
  const { now } = input;
  const columns: Record<BoardColumnId, BoardCard[]> = {
    idea: [],
    building: [],
    review: [],
    shipped: [],
  };
  const chats = new Map(input.chats.map((chat) => [chat.id, chat]));
  const settles: FeatureCardSettle[] = [];
  const covered = new Set<string>();
  const today = startOfDay(now);
  const recentSince = now - BOARD_SHIPPED_DAYS * DAY_MS;
  let olderShipped = 0;
  let shippedToday = 0;

  for (const feature of input.cards) {
    for (const id of feature.chatIds) covered.add(id);
    const { card, settle } = boardCard(feature, input, chats);
    if (settle) settles.push(settle);
    if (card.column === "shipped") {
      if (card.at >= today) shippedToday += 1;
      if (card.at < recentSince && !input.showOlder) {
        olderShipped += 1;
        continue;
      }
    }
    columns[card.column].push(card);
  }
  // A race, discussion or run a card's chat started is that card's work.
  for (const team of input.teams)
    if (teamTouches(team, covered))
      for (const id of teamChatIds(team)) covered.add(id);

  columns.idea.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (const id of ["building", "review", "shipped"] as const)
    columns[id].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return {
    columns,
    olderShipped,
    today: {
      shipped: shippedToday,
      inProgress: columns.building.length + columns.review.length,
    },
    outside: outsideWork(input, chats, covered),
    settles,
    empty: input.cards.length === 0,
  };
}

/** "Today: 3 shipped · 5 in progress". */
export function boardTodayText(today: WorkBoardModel["today"]): string {
  return `Today: ${today.shipped} shipped · ${today.inProgress} in progress`;
}
