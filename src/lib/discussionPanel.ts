/**
 * The floating discussion panel: which discussions a window watches, which
 * one is open as the panel (the rest are pills), where the panel sits and
 * how big it is, and how many replies the user has seen in each. Remembered
 * per window under `aven.discussionPanel.<window>`. Also the pure parts of
 * reading a long thread in the panel: its rounds, which of them fold away,
 * the round rail and the "new since you looked" mark.
 */
import type { DiscussionStance } from "./discussionStance";
import type { DiscussionThreadItem } from "./discussionThread";

export const PANEL_STATE_PREFIX = "aven.discussionPanel.";
/** The panel's smallest size, in CSS pixels. */
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 360;
/** Its first size. */
export const PANEL_WIDTH = 430;
export const PANEL_HEIGHT = 590;
/** Kept clear of the window's top edge, where the title bar and its traffic lights are. */
export const PANEL_TOP_INSET = 44;
/** Kept clear of the window's other edges. */
export const PANEL_MARGIN = 8;
/** Rounds always shown; older ones fold away. */
export const PANEL_RECENT_ROUNDS = 2;
/** Discussions whose seen counts are remembered, newest first. */
const SEEN_LIMIT = 50;

export type PanelRect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

export type DiscussionPanelState = {
  /** Where the panel sits; absent until it first opens. */
  rect?: PanelRect;
  /** How the user last left it: open as the panel, or shrunk to a pill. */
  mode: "open" | "pill";
  /** The discussions shown in this window, as the panel or as pills. */
  watching: string[];
  /** The one open as the panel; the others are pills. */
  expanded: string | null;
  /** Replies the user has seen, per discussion. */
  seen: Record<string, number>;
};

export const EMPTY_PANEL_STATE: DiscussionPanelState = {
  mode: "open",
  watching: [],
  expanded: null,
  seen: {},
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

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0 && id.length <= 200,
      )
    : [];
}

/** This window's panel as it was left, or the empty state. */
export function loadPanelState(
  storage: Storage | undefined,
  window: string,
): DiscussionPanelState {
  try {
    const raw = storage?.getItem(PANEL_STATE_PREFIX + window);
    if (!raw) return EMPTY_PANEL_STATE;
    const record = JSON.parse(raw) as Record<string, unknown>;
    const watching = [...new Set(ids(record.watching))];
    const expanded =
      typeof record.expanded === "string" && watching.includes(record.expanded)
        ? record.expanded
        : null;
    const seen: Record<string, number> = {};
    if (record.seen && typeof record.seen === "object")
      for (const [id, count] of Object.entries(record.seen))
        if (finite(count) && count >= 0) seen[id] = Math.floor(count);
    return {
      ...(readRect(record.rect) ? { rect: readRect(record.rect) } : {}),
      mode: record.mode === "pill" ? "pill" : "open",
      watching,
      expanded,
      seen,
    };
  } catch {
    return EMPTY_PANEL_STATE;
  }
}

export function savePanelState(
  storage: Storage | undefined,
  window: string,
  state: DiscussionPanelState,
) {
  try {
    storage?.setItem(PANEL_STATE_PREFIX + window, JSON.stringify(state));
  } catch {
    // Unavailable storage only forgets where the panel was.
  }
}

/** Whether this window has ever shown the panel. */
export function panelUsed(state: DiscussionPanelState): boolean {
  return !!state.rect;
}

/**
 * A discussion this window started: watched, and open as the panel the
 * first time, then in whatever state the user last left the panel.
 */
export function watchStarted(
  state: DiscussionPanelState,
  id: string,
): DiscussionPanelState {
  const watching = [id, ...state.watching.filter((entry) => entry !== id)];
  const open = !panelUsed(state) || state.mode === "open";
  return {
    ...state,
    watching,
    expanded: open ? id : state.expanded,
    mode: open ? "open" : state.mode,
  };
}

/** Watch, Open, the sidebar connector: show it as the panel. */
export function openInPanel(
  state: DiscussionPanelState,
  id: string,
): DiscussionPanelState {
  return {
    ...state,
    watching: state.watching.includes(id)
      ? state.watching
      : [id, ...state.watching],
    expanded: id,
    mode: "open",
  };
}

/** – : the panel becomes a pill. */
export function shrinkPanel(state: DiscussionPanelState): DiscussionPanelState {
  return state.expanded ? { ...state, expanded: null, mode: "pill" } : state;
}

/** × : stop showing it here. The discussion itself goes on. */
export function closeInPanel(
  state: DiscussionPanelState,
  id: string,
): DiscussionPanelState {
  if (!state.watching.includes(id)) return state;
  return {
    ...state,
    watching: state.watching.filter((entry) => entry !== id),
    expanded: state.expanded === id ? null : state.expanded,
  };
}

/** Forget discussions that no longer exist. */
export function prunePanel(
  state: DiscussionPanelState,
  known: ReadonlySet<string>,
): DiscussionPanelState {
  const watching = state.watching.filter((id) => known.has(id));
  const seenIds = Object.keys(state.seen);
  if (
    watching.length === state.watching.length &&
    seenIds.every((id) => known.has(id))
  )
    return state;
  const seen = Object.fromEntries(
    Object.entries(state.seen).filter(([id]) => known.has(id)),
  );
  return {
    ...state,
    watching,
    expanded:
      state.expanded && watching.includes(state.expanded)
        ? state.expanded
        : null,
    seen,
  };
}

/** The user has seen `count` replies of `id` in the panel. */
export function markSeen(
  state: DiscussionPanelState,
  id: string,
  count: number,
): DiscussionPanelState {
  if (state.seen[id] === count) return state;
  const entries = [
    [id, count] as const,
    ...Object.entries(state.seen).filter(([entry]) => entry !== id),
  ].slice(0, SEEN_LIMIT);
  return { ...state, seen: Object.fromEntries(entries) };
}

// --- Geometry ------------------------------------------------------------------

/** Where the panel first opens: the window's bottom-right corner. */
export function defaultRect(viewport: Viewport): PanelRect {
  const width = Math.min(PANEL_WIDTH, viewport.width - PANEL_MARGIN * 2);
  const height = Math.min(
    PANEL_HEIGHT,
    viewport.height - PANEL_TOP_INSET - PANEL_MARGIN - 40,
  );
  return clampRect(
    {
      x: viewport.width - width - 24,
      y: viewport.height - height - 40,
      width,
      height,
    },
    viewport,
  );
}

/**
 * Keep the panel inside the window, below its title bar so it never covers
 * the traffic lights, and at least its smallest size where the window
 * allows.
 */
export function clampRect(rect: PanelRect, viewport: Viewport): PanelRect {
  const maxWidth = Math.max(0, viewport.width - PANEL_MARGIN * 2);
  const maxHeight = Math.max(
    0,
    viewport.height - PANEL_TOP_INSET - PANEL_MARGIN,
  );
  const width = Math.min(Math.max(rect.width, PANEL_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(rect.height, PANEL_MIN_HEIGHT), maxHeight);
  const x = Math.min(
    Math.max(rect.x, PANEL_MARGIN),
    viewport.width - PANEL_MARGIN - width,
  );
  const y = Math.min(
    Math.max(rect.y, PANEL_TOP_INSET),
    viewport.height - PANEL_MARGIN - height,
  );
  return {
    x: Math.round(Math.max(x, PANEL_MARGIN)),
    y: Math.round(Math.max(y, PANEL_TOP_INSET)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** A resize handle: which edges it moves. */
export type PanelEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The panel after dragging `edge` by (dx, dy) from `start`. */
export function resizeRect(
  start: PanelRect,
  edge: PanelEdge,
  dx: number,
  dy: number,
  viewport: Viewport,
): PanelRect {
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = Math.max(PANEL_MIN_WIDTH, start.width + dx);
  if (edge.includes("s"))
    height = Math.max(PANEL_MIN_HEIGHT, start.height + dy);
  if (edge.includes("w")) {
    width = Math.max(PANEL_MIN_WIDTH, start.width - dx);
    x = start.x + start.width - width;
  }
  if (edge.includes("n")) {
    height = Math.max(PANEL_MIN_HEIGHT, start.height - dy);
    y = start.y + start.height - height;
  }
  // Keep the edge opposite the one dragged in place.
  const clamped = clampRect({ x, y, width, height }, viewport);
  if (edge.includes("w"))
    clamped.x = Math.max(
      PANEL_MARGIN,
      Math.min(clamped.x, start.x + start.width - clamped.width),
    );
  if (edge.includes("n"))
    clamped.y = Math.max(
      PANEL_TOP_INSET,
      Math.min(clamped.y, start.y + start.height - clamped.height),
    );
  return clamped;
}

// --- A long thread ---------------------------------------------------------------

/** One round of the thread: its divider and what follows it. */
export type ThreadRound = {
  round: number;
  items: DiscussionThreadItem[];
  /** How the round's last reply answered the one before it. */
  stance: DiscussionStance | null;
};

/** The thread split into the topic and each round. */
export function threadRounds(items: readonly DiscussionThreadItem[]): {
  head: DiscussionThreadItem[];
  rounds: ThreadRound[];
} {
  const head: DiscussionThreadItem[] = [];
  const rounds: ThreadRound[] = [];
  for (const item of items) {
    if (item.kind === "round") {
      rounds.push({ round: item.round, items: [item], stance: null });
      continue;
    }
    const current = rounds.at(-1);
    if (!current) {
      head.push(item);
      continue;
    }
    current.items.push(item);
    if (item.kind === "reply") current.stance = item.stance;
  }
  return { head, rounds };
}

/** Replies in the thread, in order. */
export function replyCount(items: readonly DiscussionThreadItem[]): number {
  return items.reduce(
    (count, item) => count + (item.kind === "reply" ? 1 : 0),
    0,
  );
}

/**
 * How many of the oldest rounds fold behind "Rounds 1–N · Show": all but
 * the last two, and never one holding a reply the user has not seen.
 */
export function foldedRoundCount(
  rounds: readonly ThreadRound[],
  firstNew: number | null,
): number {
  let folded = Math.max(0, rounds.length - PANEL_RECENT_ROUNDS);
  if (firstNew === null) return folded;
  let replies = 0;
  for (let index = 0; index < folded; index += 1) {
    const inRound = rounds[index].items.filter(
      (item) => item.kind === "reply",
    ).length;
    if (replies + inRound > firstNew) {
      folded = index;
      break;
    }
    replies += inRound;
  }
  return folded;
}

/** "Rounds 1–5 · Show" (or one round). */
export function foldLabel(folded: number): string {
  return folded === 1 ? "Round 1 · Show" : `Rounds 1–${folded} · Show`;
}

/**
 * Where the "N new since you looked" mark goes: before the first reply the
 * user had not seen when they opened the panel, or null when nothing is new
 * or they never opened it before.
 */
export function firstNewReply(
  total: number,
  seen: number | undefined,
): number | null {
  if (seen === undefined || seen >= total) return null;
  return seen;
}

export function newSinceLabel(count: number): string {
  return `${count} new since you looked`;
}
