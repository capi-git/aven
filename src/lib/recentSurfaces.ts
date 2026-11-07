/**
 * The recent switcher (⌃⇥): a project's strip entries in the order they
 * were last in front, newest first, and where each card of the cascade sits.
 *
 * Holding ⌃ and tapping ⇥ steps back through them; letting go of ⌃ opens
 * the one picked. A quick tap opens the one before at once, without the
 * switcher, so two taps flip between the last two.
 */

/** Entries remembered per project; older ones fall back to strip order. */
const MAX_RECENT = 40;

/** `key` is in front now: it moves to the head of the list. */
export function touchRecent(list: readonly string[], key: string): string[] {
  if (!key) return [...list];
  return [key, ...list.filter((k) => k !== key)].slice(0, MAX_RECENT);
}

/**
 * The entries to offer, newest first: the one in front, then those used
 * before it, then any never in front, in strip order. Entries no longer on
 * the strip are left out.
 */
export function recentOrder(
  list: readonly string[],
  present: readonly string[],
  front: string,
): string[] {
  const has = new Set(present);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (!has.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  add(front);
  list.forEach(add);
  present.forEach(add);
  return out;
}

/** The index `step` places on, wrapping round. */
export function stepRecent(index: number, step: number, count: number): number {
  if (count < 1) return 0;
  return (((index + step) % count) + count) % count;
}

/** Where a hold starts: the one before the front, or the oldest with ⇧. */
export function firstRecentPick(step: number, count: number): number {
  if (count < 2) return 0;
  return step > 0 ? 1 : count - 1;
}

/** How long ⌃ must stay down after ⇥ before the switcher shows (ms). */
export const RECENT_SHOW_DELAY_MS = 140;
/** The picked card growing into the workspace (ms). */
export const RECENT_OPEN_MS = 300;
/** Cards shown deep in the cascade; the rest wait out of sight. */
export const RECENT_DEPTH = 5;

export type CascadePlace = {
  /** Offset from the front card's place, in px. */
  x: number;
  y: number;
  /** Depth toward the viewer (positive) or away from it. */
  z: number;
  /** Black laid over the card for depth, 0 to 1. */
  dim: number;
  opacity: number;
  zIndex: number;
};

/**
 * A card's place in the cascade, by how far behind the picked one it is.
 * The picked card is at the front; each one behind sits up and to the
 * right, smaller and darker. The card just stepped past (the last depth)
 * leaves toward the viewer and fades, so the stack visibly moves on.
 */
export function cascadePlace(
  depth: number,
  count: number,
  card: { width: number; height: number },
): CascadePlace {
  const dx = Math.round(card.width * 0.085);
  const dy = Math.round(card.height * 0.1);
  if (count > 2 && depth === count - 1) {
    return {
      x: -dx,
      y: Math.round(card.height * 0.2),
      z: 240,
      dim: 0,
      opacity: 0,
      zIndex: 200,
    };
  }
  const shown = depth < RECENT_DEPTH;
  return {
    x: depth * dx,
    y: depth ? -depth * dy : 0,
    z: depth ? -depth * 110 : 0,
    dim: Math.min(depth * 0.16, 0.64),
    opacity: shown ? 1 : 0,
    zIndex: 100 - depth,
  };
}

/** How far behind the picked card each card is, 0 for the picked one. */
export function cascadeDepth(index: number, picked: number, count: number) {
  return stepRecent(index, -picked, count);
}

/**
 * The front card's size: half the window wide at most, leaving room above
 * for the stack and below for its name, in the workspace's proportions.
 */
export function cascadeCardSize(
  viewport: { width: number; height: number },
  aspect: number,
): { width: number; height: number } {
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.5;
  const width = Math.max(
    160,
    Math.min(viewport.width * 0.5, 600, (viewport.height - 220) * ratio),
  );
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

export type RecentChatLine = { role: "user" | "assistant"; text: string };

/**
 * A chat's last few turns as plain text for its card, oldest first: what
 * was asked and answered, without code, markup or Aven's own notes.
 */
export function recentChatLines(
  blocks: readonly { role: string; text: string; internal?: boolean }[],
  max = 6,
): RecentChatLine[] {
  const out: RecentChatLine[] = [];
  for (let i = blocks.length - 1; i >= 0 && out.length < max; i--) {
    const block = blocks[i];
    if (block.internal) continue;
    if (block.role !== "user" && block.role !== "assistant") continue;
    const text = plainPreview(block.text);
    if (text) out.unshift({ role: block.role, text });
  }
  return out;
}

function plainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}
