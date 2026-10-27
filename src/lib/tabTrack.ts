/**
 * A tab strip on a track, after Cydonia's window strip: the tabs share the
 * strip's width equally, down to a minimum past which the strip scrolls; ONE
 * highlight is drawn under the tabs and slides to the tab in front; and a
 * hairline parts two resting neighbours, but never the tab in front.
 *
 * Portions adapted from Cydonia (github.com/crabtalk/cydonia) and bezel
 * (github.com/crabtalk/bezel), Copyright (c) 2026 clearloop (bezel also
 * Wing), MIT. See NOTICE.
 */

/** The narrowest a tab on a track gets before its strip scrolls. */
export const TAB_TRACK_MIN_WIDTH = 120;
/** The gap between two tabs; a separator stands in its middle. */
export const TAB_TRACK_GAP = 2;
/** The highlight's slide: 150ms, eased out. Keep in step with TitleBar.css. */
export const TAB_SLIDE_MS = 150;
export const TAB_SLIDE_EASE = "cubic-bezier(0, 0, 0.58, 1)";

/**
 * A pane's title row lays its tabs on a track too, but folds the ones that
 * no longer fit into a "+N" rather than scrolling, so every tab it shows is
 * one click away. A pane is a share of the window, so its tabs may get
 * narrower than the window strip's before they fold: at 96px a tab still
 * shows its icon and the start of its name (the rest is in its tooltip),
 * and a half-width pane beside the file panel keeps three tabs.
 */
export const TITLE_ROW_TAB_MIN_WIDTH = 96;
/** The room a title row keeps for its "+N", with the gap before it. */
export const TITLE_ROW_MORE_WIDTH = 36;
/** A title row's strip padding, both sides together (TitleBar.css). */
export const TITLE_ROW_PADDING = 8;

/**
 * How many of a title row's `count` tabs it shows side by side in `width`
 * CSS pixels of strip: all of them while they fit at the minimum width, and
 * otherwise as many as fit beside the "+N" (never fewer than one). With
 * `folding`, other tabs are folded away regardless (a folded group's), so
 * the "+N" is drawn and its room kept even when these would all fit. A
 * strip that is not laid out yet (no width) shows them all.
 */
export function titleRowCapacity(
  width: number,
  count: number,
  folding = false,
): number {
  if (!(width > 0) || count <= 1) return count;
  const slot = TITLE_ROW_TAB_MIN_WIDTH + TAB_TRACK_GAP;
  const room = width - TITLE_ROW_PADDING;
  if (!folding && count * slot - TAB_TRACK_GAP <= room) return count;
  const beside = Math.floor((room - TITLE_ROW_MORE_WIDTH) / slot);
  return Math.max(1, Math.min(count - (folding ? 0 : 1), beside));
}

/**
 * Which of a title row's tabs it shows and which fold into its "+N", both in
 * the pane's order. The first `capacity` tabs show; the tab in front always
 * shows, taking the last place when it would not otherwise, so a tab picked
 * from the "+N" comes into the row. Tabs in `folded` (a folded group's)
 * stay in the "+N" unless they are in front.
 */
export function titleRowTabs(
  ids: readonly string[],
  frontId: string | null | undefined,
  capacity: number,
  folded: ReadonlySet<string> = new Set(),
): { shown: string[]; hidden: string[] } {
  const candidates = ids.filter((id) => id === frontId || !folded.has(id));
  const take = Math.max(1, Math.min(capacity, candidates.length));
  let picked = candidates.slice(0, take);
  if (frontId && candidates.includes(frontId) && !picked.includes(frontId))
    picked = [...picked.slice(0, take - 1), frontId];
  const shown = new Set(picked);
  return {
    shown: ids.filter((id) => shown.has(id)),
    hidden: ids.filter((id) => !shown.has(id)),
  };
}

/** One item in a strip's order: a tab, or something else (a group label). */
export type TrackEntry = { id: string; tab: boolean };

/**
 * The tabs that draw a line before them: every tab but the first, unless the
 * tab in front is on either side of the line. A group's label is not a tab,
 * so no line stands beside it.
 *
 * Adapted from bezel's `tabs::reorder` (`parted`).
 */
export function trackSeparators(
  entries: readonly TrackEntry[],
  frontId: string | null | undefined,
): Set<string> {
  const parted = new Set<string>();
  entries.forEach((entry, index) => {
    const before = entries[index - 1];
    if (
      index > 0 &&
      entry.tab &&
      before?.tab &&
      entry.id !== frontId &&
      before.id !== frontId
    )
      parted.add(entry.id);
  });
  return parted;
}

/** A tab's place along its strip's scrolled content, in CSS pixels. */
export type TrackBox = { x: number; width: number };

export function sameTrackBox(a: TrackBox | null, b: TrackBox | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      Math.abs(a.x - b.x) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5)
  );
}

/**
 * Where the highlight goes now, and where it slides from. It slides only
 * when another tab comes to the front, from wherever it is drawn (even part
 * way through a slide). A strip that only changed shape (a tab opened, the
 * window resized) puts it straight at its place, as does reduced motion.
 *
 * Adapted from bezel's `tabs::reorder` (`Pill::place`).
 */
export function planHighlight(input: {
  /** The tab in front when the highlight was last placed. */
  previousFront: string | null;
  /** The box the highlight is drawn in now, if it is drawn. */
  drawn: TrackBox | null;
  front: string | null;
  /** The front tab's box, or null when it is not in the strip. */
  target: TrackBox | null;
  reduced: boolean;
}): { to: TrackBox | null; from: TrackBox | null } {
  const { previousFront, drawn, front, target, reduced } = input;
  if (!target) return { to: null, from: null };
  const changed = front !== previousFront;
  const from =
    changed && drawn && !reduced && !sameTrackBox(drawn, target) ? drawn : null;
  return { to: target, from };
}

/**
 * The keyframes of a slide from `from` to `to`, drawn with transforms only:
 * the highlight is laid out at `to` and starts scaled to `from`'s width.
 */
export function highlightKeyframes(from: TrackBox, to: TrackBox): Keyframe[] {
  const scale = to.width > 0 ? from.width / to.width : 1;
  return [
    {
      transform: `translateX(${from.x}px) scaleX(${scale})`,
    },
    { transform: `translateX(${to.x}px) scaleX(1)` },
  ];
}
