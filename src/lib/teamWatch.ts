/**
 * The window's team panel: one floating panel and a stack of pills for any
 * team (a discussion, a race or an orchestration), as plain data.
 *
 * - Which teams the window watches, which one is open as the panel, which
 *   are popped out into windows of their own, which the user closed, where
 *   the panel sits and what the user has seen. Remembered per window under
 *   `aven.teamPanel.<window>`.
 * - What a pill and the panel's header say about a team.
 * - The snapshot a popped-out panel draws (`TeamWatchView`) and the actions
 *   it may send back to the window that owns the team.
 *
 * Everything here reads `TeamRun`s, never transcripts; a discussion's thread
 * travels already built, as the panel shows it.
 */
import type { PanelRect } from "./discussionPanel";
import {
  INTERJECTION_CHAR_LIMIT,
  type Discussion,
  type DiscussionSide,
} from "./discussions";
import type { DiscussionThreadItem } from "./discussionThread";
import { providerShortName } from "./discussionVoices";
import { raceShortNames } from "./raceNames";
import type { ReviewerChoice } from "./raceReviewers";
import {
  teamIsOpen,
  teamKindOf,
  type TeamKind,
  type TeamMember,
  type TeamRun,
} from "./teamRuns";

export const TEAM_PANEL_PREFIX = "aven.teamPanel.";
/** Teams whose seen counts are remembered, newest first. */
const SEEN_LIMIT = 50;
/** Teams a window remembers watching or having closed. */
const WATCH_LIMIT = 30;
const DISMISSED_LIMIT = 60;

export type TeamPanelState = {
  /** Where the panel sits; absent until it first opens. */
  rect?: PanelRect;
  /** How the user last left it: open as the panel, or shrunk to a pill. */
  mode: "open" | "pill";
  /** Teams shown in this window as the panel or a pill, by team id. */
  watching: string[];
  /** The one open as the panel; the others are pills. */
  expanded: string | null;
  /**
   * Teams the user closed here (×): a running team then gets no pill of its
   * own until the user watches it again.
   */
  dismissed: string[];
  /** Discussion replies the user has seen, by team id. */
  seen: Record<string, number>;
  /**
   * Teams shown in a window of their own. Not remembered: a pop-out does
   * not outlive the page that owns it.
   */
  popped: string[];
  /** A popped-out team asked to come forward (Watch while it is out). */
  raised?: { id: string; at: number };
};

export const EMPTY_TEAM_PANEL: TeamPanelState = {
  mode: "open",
  watching: [],
  expanded: null,
  dismissed: [],
  seen: {},
  popped: [],
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readRect(value: unknown): PanelRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  return finite(x) && finite(y) && finite(width) && finite(height)
    ? { x, y, width, height }
    : undefined;
}

/** A stored id, when it is a team id. */
function teamId(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 240) return null;
  return teamKindOf(value) ? value : null;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const entry of value) {
    const id = teamId(entry);
    if (id && !list.includes(id)) list.push(id);
  }
  return list;
}

function readState(raw: string): TeamPanelState {
  const record = JSON.parse(raw) as Record<string, unknown>;
  const watching = ids(record.watching).slice(0, WATCH_LIMIT);
  const expanded = teamId(record.expanded);
  const seen: Record<string, number> = {};
  if (record.seen && typeof record.seen === "object")
    for (const [key, count] of Object.entries(record.seen)) {
      const id = teamId(key);
      if (id && finite(count) && count >= 0) seen[id] = Math.floor(count);
    }
  const rect = readRect(record.rect);
  return {
    ...(rect ? { rect } : {}),
    mode: record.mode === "pill" ? "pill" : "open",
    watching,
    expanded: expanded && watching.includes(expanded) ? expanded : null,
    dismissed: ids(record.dismissed).slice(0, DISMISSED_LIMIT),
    seen,
    popped: [],
  };
}

/** This window's panel as it was left, or the empty state. */
export function loadTeamPanel(
  storage: Storage | undefined,
  window: string,
): TeamPanelState {
  try {
    const raw = storage?.getItem(TEAM_PANEL_PREFIX + window);
    return raw ? readState(raw) : EMPTY_TEAM_PANEL;
  } catch {
    return EMPTY_TEAM_PANEL;
  }
}

export function saveTeamPanel(
  storage: Storage | undefined,
  window: string,
  state: TeamPanelState,
) {
  try {
    // A popped-out team is shown here again after a reload.
    const { popped: _popped, raised: _raised, ...kept } = state;
    storage?.setItem(TEAM_PANEL_PREFIX + window, JSON.stringify(kept));
  } catch {
    // Unavailable storage only forgets where the panel was.
  }
}

/** Whether this window has ever shown the panel. */
export function panelUsed(state: TeamPanelState): boolean {
  return !!state.rect;
}

function without(list: readonly string[], id: string): string[] {
  return list.filter((entry) => entry !== id);
}

/**
 * A team this window started (a discussion): watched, and open as the panel
 * the first time, then in whatever state the user last left the panel.
 */
export function watchStarted(
  state: TeamPanelState,
  id: string,
): TeamPanelState {
  const watching = [id, ...without(state.watching, id)].slice(0, WATCH_LIMIT);
  const open = !panelUsed(state) || state.mode === "open";
  return {
    ...state,
    watching,
    dismissed: without(state.dismissed, id),
    expanded: open && !state.popped.includes(id) ? id : state.expanded,
    mode: open ? "open" : state.mode,
  };
}

/**
 * Watch, Open, the sidebar connector, a pill: show it as the panel. A team
 * shown in a window of its own stays there and comes forward instead.
 */
export function openInPanel(
  state: TeamPanelState,
  id: string,
  now = Date.now(),
): TeamPanelState {
  if (state.popped.includes(id)) return { ...state, raised: { id, at: now } };
  return {
    ...state,
    watching: state.watching.includes(id)
      ? state.watching
      : [id, ...state.watching].slice(0, WATCH_LIMIT),
    dismissed: without(state.dismissed, id),
    popped: without(state.popped, id),
    expanded: id,
    mode: "open",
  };
}

/** – : the panel becomes a pill. */
export function shrinkPanel(state: TeamPanelState): TeamPanelState {
  return state.expanded ? { ...state, expanded: null, mode: "pill" } : state;
}

/** × : stop showing it here. The team itself goes on. */
export function closeInPanel(
  state: TeamPanelState,
  id: string,
): TeamPanelState {
  if (state.dismissed.includes(id) && !state.watching.includes(id))
    return state;
  return {
    ...state,
    watching: without(state.watching, id),
    dismissed: [id, ...without(state.dismissed, id)].slice(0, DISMISSED_LIMIT),
    popped: without(state.popped, id),
    expanded: state.expanded === id ? null : state.expanded,
  };
}

/** ↗ : the team leaves the window for a window of its own. */
export function popOut(state: TeamPanelState, id: string): TeamPanelState {
  if (state.popped.includes(id)) return state;
  return {
    ...state,
    watching: state.watching.includes(id)
      ? state.watching
      : [id, ...state.watching].slice(0, WATCH_LIMIT),
    dismissed: without(state.dismissed, id),
    popped: [...state.popped, id],
    expanded: state.expanded === id ? null : state.expanded,
  };
}

/** ↙ in its own window: back here, open as the panel. */
export function popIn(state: TeamPanelState, id: string): TeamPanelState {
  return openInPanel({ ...state, popped: without(state.popped, id) }, id);
}

/** Its pop-out closed (or could not open): back here, shrunk to a pill. */
export function poppedBack(state: TeamPanelState, id: string): TeamPanelState {
  if (!state.popped.includes(id)) return state;
  return { ...state, popped: without(state.popped, id) };
}

/**
 * Forget teams that no longer exist. Only the kinds in `loaded` are judged:
 * a store that loads its records later (an orchestration's runs) keeps its
 * ids until it can say.
 */
export function pruneTeamPanel(
  state: TeamPanelState,
  known: ReadonlySet<string>,
  loaded: ReadonlySet<TeamKind>,
): TeamPanelState {
  const keep = (id: string) => {
    const kind = teamKindOf(id);
    return !kind || !loaded.has(kind) || known.has(id);
  };
  const watching = state.watching.filter(keep);
  const dismissed = state.dismissed.filter(keep);
  const seenIds = Object.keys(state.seen);
  if (
    watching.length === state.watching.length &&
    dismissed.length === state.dismissed.length &&
    seenIds.every(keep)
  )
    return state;
  return {
    ...state,
    watching,
    dismissed,
    expanded:
      state.expanded && watching.includes(state.expanded)
        ? state.expanded
        : null,
    popped: state.popped.filter(keep),
    seen: Object.fromEntries(
      Object.entries(state.seen).filter(([id]) => keep(id)),
    ),
  };
}

/** The user has seen `count` replies of `id` in the panel. */
export function markSeen(
  state: TeamPanelState,
  id: string,
  count: number,
): TeamPanelState {
  if (state.seen[id] === count) return state;
  const entries = [
    [id, count] as const,
    ...Object.entries(state.seen).filter(([entry]) => entry !== id),
  ].slice(0, SEEN_LIMIT);
  return { ...state, seen: Object.fromEntries(entries) };
}

/**
 * The pills, top to bottom: the teams the window watches that are not the
 * open panel or popped out, then every other team started here that is
 * still open (running, waiting on you or ready to compare), unless the
 * user closed it. A team that ended stays only while watched.
 */
export function teamPills(
  state: TeamPanelState,
  teams: readonly Pick<TeamRun, "id" | "status" | "origin" | "preview">[],
  here: ReadonlySet<string>,
): string[] {
  const shown = (id: string) =>
    id !== state.expanded && !state.popped.includes(id);
  const known = new Set(teams.map((team) => team.id));
  const pills = state.watching.filter((id) => shown(id) && known.has(id));
  for (const team of teams)
    if (
      !team.preview &&
      teamIsOpen(team) &&
      here.has(team.origin.sessionId) &&
      shown(team.id) &&
      !pills.includes(team.id) &&
      !state.dismissed.includes(team.id)
    )
      pills.push(team.id);
  return pills;
}

// --- What a pill and the header say -------------------------------------------

export type TeamTone = "live" | "needs-you" | "ready" | "done" | "stopped";

export function teamTone(team: Pick<TeamRun, "status">): TeamTone {
  switch (team.status) {
    case "running":
      return "live";
    case "needs-you":
      return "needs-you";
    case "ready":
      return "ready";
    case "finished":
      return "done";
    case "stopped":
      return "stopped";
  }
}

const KIND_NAME: Record<TeamKind, string> = {
  discuss: "Discussion",
  race: "Race",
  orchestrate: "Orchestration",
};

/** "Race · “Fix the redirect loop”": the panel's title. */
export function teamWatchTitle(team: Pick<TeamRun, "kind" | "title">): string {
  const line = team.title.trim();
  const short = line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
  return short ? `${KIND_NAME[team.kind]} · “${short}”` : KIND_NAME[team.kind];
}

/**
 * "Claude, Codex and Grok", or "Claude Opus 4.6 and Claude Sonnet 5" when
 * two members share a provider.
 */
export function memberNames(
  members: readonly Pick<TeamMember, "harness" | "label" | "model">[],
) {
  const names = raceShortNames(members);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The member the team waits on now: the one replying or working. */
export function activeMembers(team: Pick<TeamRun, "members">): string[] {
  return team.members
    .filter((member) => member.state === "working")
    .map((member) => member.sessionId);
}

/**
 * A pill's two parts: where the team stands ("Round 2 of 4", "1 of 2
 * done", "2 working · 1 waiting") and what is happening ("Codex is
 * replying…", "Needs you", "Ready to compare", "Done").
 */
export function teamPillText(team: TeamRun): {
  progress: string;
  status: string;
} {
  const tone = teamTone(team);
  const working = team.members.find((member) => member.state === "working");
  if (team.kind === "discuss") {
    const status =
      tone === "needs-you"
        ? "Needs you"
        : tone === "done"
          ? "Done"
          : tone === "stopped"
            ? "Stopped"
            : working
              ? `${providerShortName(working.harness)} is replying…`
              : "Waiting";
    return { progress: team.progress, status };
  }
  if (team.kind === "race") {
    // Once kept or discarded, its progress is how it ended.
    if (tone === "done" || tone === "stopped")
      return { progress: "Race", status: team.progress };
    const status =
      tone === "needs-you"
        ? "Needs you"
        : tone === "ready"
          ? "Ready to compare"
          : "Racing";
    return {
      progress: team.progress.replace(/^Ready to compare · /, ""),
      status,
    };
  }
  const lead = team.members[0];
  const status =
    tone === "needs-you"
      ? "Needs you"
      : tone === "done"
        ? "Finished"
        : tone === "stopped"
          ? "Stopped"
          : lead?.state === "working"
            ? "Lead reviewing"
            : "Running";
  return {
    progress:
      tone === "done" || tone === "stopped"
        ? team.progress.replace(/^(Finished|Stopped) · /, "")
        : team.progress,
    status,
  };
}

// --- A popped-out panel ----------------------------------------------------------

/**
 * A race's suggested winner, as the panel shows it. `by` names the chat
 * that picked it as a Reviewer, when the cheap model did not.
 */
export type TeamWatchSuggestion =
  | { status: "running" }
  | { status: "done"; lane: number; why: string; by?: string }
  | { status: "failed" };

/** A chat asked to review a race, as the panel shows it. */
export type TeamWatchReview = {
  sessionId: string;
  harness: ReviewerChoice["harness"];
  label: string;
  status: "running" | "done" | "failed";
  /** Why it failed, when nothing reached the chat. */
  error?: string;
};

/**
 * Everything one team's panel draws: the team, plus what its kind adds.
 * The window that owns the team builds it; a popped-out panel receives it.
 */
export type TeamWatchView = {
  team: TeamRun;
  race?: {
    suggestion?: TeamWatchSuggestion;
    /** The lane that was kept, once the race is over. */
    kept?: number;
    /** The chat asked to review it as a Reviewer, if one was. */
    review?: TeamWatchReview;
    /** Chats that could review it, once it is ready to compare. */
    reviewers?: ReviewerChoice[];
  };
  run?: {
    /** The lead has stopped without finishing, and nothing else will move. */
    stalled: boolean;
  };
  /** A discussion's record and its thread, built as the panel shows it. */
  discussion?: {
    record: Discussion;
    items: readonly DiscussionThreadItem[];
    cwd: Record<DiscussionSide, string>;
  };
  /** What the owning window can do for it. */
  can: {
    jumpIn: boolean;
    build: boolean;
    openChat: boolean;
    openAgents: boolean;
    compare: boolean;
  };
};

/** What a panel asks of the window that owns the team. */
export type TeamWatchAction =
  | { kind: "stop" }
  | { kind: "resume" }
  | { kind: "finish" }
  | { kind: "compare" }
  | { kind: "suggest" }
  /** Ask this chat to review the race as a Reviewer. */
  | { kind: "review"; sessionId: string }
  | { kind: "open-agents" }
  | { kind: "open-chat"; sessionId: string }
  | { kind: "jump-in"; text: string }
  | { kind: "build"; side: DiscussionSide }
  | { kind: "watch" };

export type TeamWatchActionKind = TeamWatchAction["kind"];

/**
 * Does what a panel's button asks. In the window that owns the team it acts
 * at once and returns its refusal or null; from a popped-out panel it
 * resolves once that window has answered.
 */
export type TeamWatchAct = (
  action: TeamWatchAction,
) => string | null | Promise<string | null>;

/** The actions each kind of team takes; anything else is refused. */
export const TEAM_ACTIONS: Record<TeamKind, readonly TeamWatchActionKind[]> = {
  discuss: ["stop", "resume", "open-chat", "jump-in", "build", "watch"],
  race: ["stop", "compare", "suggest", "review", "open-chat", "watch"],
  orchestrate: [
    "stop",
    "resume",
    "finish",
    "open-agents",
    "open-chat",
    "watch",
  ],
};

/**
 * Every action kind a pop-out may send. The host passes on exactly this
 * list (a native test reads it from here), and it is every kind some team
 * takes (a test checks that too).
 */
export const TEAM_WATCH_ACTION_KINDS: readonly TeamWatchActionKind[] = [
  "stop",
  "resume",
  "finish",
  "compare",
  "suggest",
  "review",
  "open-agents",
  "open-chat",
  "jump-in",
  "build",
  "watch",
];

/**
 * An action a popped-out panel sent, checked against the team it shows: a
 * kind this team takes, a chat that belongs to it, a message of a sane
 * size. Anything else is null and is never performed.
 */
export function parseTeamWatchAction(
  raw: unknown,
  team: Pick<TeamRun, "kind" | "origin" | "members"> | null,
): TeamWatchAction | null {
  if (!team || !raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (
    typeof kind !== "string" ||
    !TEAM_ACTIONS[team.kind].includes(kind as TeamWatchActionKind)
  )
    return null;
  switch (kind as TeamWatchActionKind) {
    case "open-chat": {
      const id = record.sessionId;
      if (
        typeof id !== "string" ||
        (id !== team.origin.sessionId &&
          !team.members.some((member) => member.sessionId === id))
      )
        return null;
      return { kind: "open-chat", sessionId: id };
    }
    case "review": {
      // Never one of the race's own agents; the window that owns the race
      // checks again that the chat may review it.
      const id = record.sessionId;
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 200 ||
        team.members.some((member) => member.sessionId === id)
      )
        return null;
      return { kind: "review", sessionId: id };
    }
    case "jump-in": {
      const text = record.text;
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.length > INTERJECTION_CHAR_LIMIT
      )
        return null;
      return { kind: "jump-in", text };
    }
    case "build": {
      const side = record.side;
      return side === "a" || side === "b" ? { kind: "build", side } : null;
    }
    default:
      return { kind } as TeamWatchAction;
  }
}

/** A popped-out panel's request: which team, which action, which reply. */
export type TeamWatchRequest = {
  team: string;
  requestId: string;
  action: unknown;
};

export function readTeamWatchRequest(raw: unknown): TeamWatchRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const { team, requestId, action } = raw as Record<string, unknown>;
  if (
    typeof team !== "string" ||
    !teamKindOf(team) ||
    typeof requestId !== "string" ||
    !requestId ||
    requestId.length > 80
  )
    return null;
  return { team, requestId, action };
}

/** The longest reply text a discussion's pop-out carries. */
export const POP_OUT_REPLY_CHARS = 12_000;

/**
 * A view made ready to cross into another window: the discussion's relay
 * (the text in flight, never shown) left out and very long replies cut,
 * so a long thread stays a small message.
 */
export function popOutView(view: TeamWatchView): TeamWatchView {
  if (!view.discussion) return view;
  const { record, items, cwd } = view.discussion;
  return {
    ...view,
    discussion: {
      record: { ...record, relay: "" },
      cwd,
      items: items.map((item) =>
        (item.kind === "reply" || item.kind === "topic") &&
        item.text &&
        item.text.length > POP_OUT_REPLY_CHARS
          ? { ...item, text: `${item.text.slice(0, POP_OUT_REPLY_CHARS)}…` }
          : item,
      ),
    },
  };
}
