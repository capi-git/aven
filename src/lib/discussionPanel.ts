/**
 * The floating team panel's geometry (where it sits, how big it is, how it
 * is dragged and resized inside the window) and the pure parts of reading a
 * long discussion thread in it: its rounds, which of them fold away, the
 * round rail and the "new since you looked" mark. Which teams the panel
 * shows is `teamWatch`'s.
 */
import type { DiscussionStance } from "./discussionStance";
import type { DiscussionThreadItem } from "./discussionThread";

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

export type PanelRect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

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
