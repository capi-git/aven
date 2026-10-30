import {
  entryKey,
  spacePanes,
  stripEntryKeyOf,
  viewMembers,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import type { WorkspaceView } from "./workspaceViews";
import { layoutLeaves } from "./layout";
import { railedLeafIds } from "./paneRails";

/**
 * What a move on the window's strip did, in words, and where it landed: the
 * short notice that follows a tab into or out of a split, or a split coming
 * apart, so nothing seems to vanish.
 */
export type StripChange = {
  text: string;
  /**
   * Where the eye should go: the strip entry (a key) and, in a split, the
   * pane the tab is in (named by the tab in front of it, as its segment is).
   */
  landed?: { entry: string; pane?: string };
};

/** A title as a notice quotes it, short enough to read at a glance. */
export function quoteTitle(title: string, limit = 36): string {
  const clean = title.replace(/\s+/g, " ").trim() || "Untitled";
  const short =
    clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
  return `“${short}”`;
}

/** “A”, “A” and “B”, or “A” and 2 more. */
export function quoteList(titles: readonly string[]): string {
  const quoted = titles.map((title) => quoteTitle(title));
  if (quoted.length <= 1) return quoted[0] ?? "";
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted[0]} and ${quoted.length - 1} more`;
}

function entryOf(strip: WorkspaceStrip, id: string): StripEntry | undefined {
  const key = stripEntryKeyOf(strip, id);
  return strip.entries.find((entry) => entryKey(entry) === key);
}

/** The pane of `view` that holds `id`, named by its tab in front. */
export function paneHolding(
  view: WorkspaceView,
  id: string,
): string | undefined {
  return spacePanes(view).find((pane) => pane.tabs.includes(id))?.id;
}

/** The panes of a split other than the one holding `id`, by their fronts. */
function partners(view: WorkspaceView, id: string | null): string[] {
  const own = id ? paneHolding(view, id) : undefined;
  return spacePanes(view)
    .map((pane) => pane.id)
    .filter((pane) => pane !== own);
}

const ids = (strip: WorkspaceStrip) =>
  new Set(
    strip.entries.flatMap((entry) =>
      entry.kind === "item" ? [entry.id] : viewMembers(entry.view),
    ),
  );

/**
 * Describe how the strip went from `before` to `after`. `moved` is the tab
 * a person moved, when the change was a move; without it, only a split
 * that came apart (its other tabs closed, or separated) is described. Null
 * when nothing worth saying changed: a reorder, a focus change, a new tab.
 * `exists` says whether a tab gone from the strip still exists elsewhere
 * (in another window, say): only a tab that does not is called closed.
 */
export function describeStripChange(
  before: WorkspaceStrip,
  after: WorkspaceStrip,
  moved: string | null,
  name: (id: string) => string,
  exists: (id: string) => boolean = () => false,
): StripChange | null {
  const was = ids(before);
  const now = ids(after);
  const gone = new Set([...was].filter((id) => !now.has(id)));
  const sentences: string[] = [];
  let landed: StripChange["landed"];

  const from = moved ? entryOf(before, moved) : undefined;
  const to = moved ? entryOf(after, moved) : undefined;
  if (moved && to && from && entryKey(from) !== entryKey(to)) {
    if (to.kind === "space") {
      const others = partners(to.view, moved);
      const fresh = !before.entries.some(
        (entry) => entryKey(entry) === entryKey(to),
      );
      sentences.push(
        `Moved ${quoteTitle(name(moved))} into ${fresh ? "a" : "the"} split with ${quoteList(others.map(name))}`,
      );
      landed = { entry: entryKey(to), pane: paneHolding(to.view, moved) };
    } else if (from.kind === "space") {
      const others = partners(from.view, moved);
      sentences.push(
        `Moved ${quoteTitle(name(moved))} out of the split with ${quoteList(others.map(name))}`,
      );
      landed = { entry: entryKey(to) };
    }
  } else if (
    moved &&
    to?.kind === "space" &&
    from &&
    entryKey(from) === entryKey(to)
  ) {
    // Moved within its own split: the panes show where it went.
    return null;
  }

  // Splits that are gone: taken apart, or come apart when a pane left.
  const keys = new Set(after.entries.map(entryKey));
  for (const entry of before.entries) {
    if (entry.kind !== "space" || keys.has(entryKey(entry))) continue;
    const members = viewMembers(entry.view);
    const standing = spacePanes(entry.view)
      .map((pane) => pane.id)
      .filter((id) => id !== moved && now.has(id));
    const alone = standing.filter((id) => entryOf(after, id)?.kind === "item");
    if (!alone.length) continue;
    const left = members.filter((id) => gone.has(id));
    const closed = left.filter((id) => !exists(id));
    if (!moved && !left.length && alone.length > 1) {
      sentences.push(`Separated ${quoteList(alone.map(name))}`);
      landed ??= { entry: alone[0] };
      continue;
    }
    if (!moved && closed.length)
      sentences.push(`Closed ${quoteList(closed.map(name))}`);
    sentences.push(
      alone.length === 1
        ? `${quoteTitle(name(alone[0]))} stays on its own, where the split was`
        : `${quoteList(alone.map(name))} stand on their own, where the split was`,
    );
    landed ??= { entry: alone[0] };
  }
  if (!sentences.length) return null;
  return { text: `${sentences.join(". ")}.`, ...(landed ? { landed } : {}) };
}

/** Where a pane sits in its split: "left pane", "top-right pane", … */
export function panePlace(view: WorkspaceView, pane: string): string {
  const layout = view.restoreView?.layout ?? view.layout;
  const owners = spacePanes(view);
  const leaves = layout ? layoutLeaves(layout) : [];
  // A pane's place: the leaf holding any of its tabs.
  const tabs = owners.find((entry) => entry.id === pane)?.tabs ?? [pane];
  const groups = view.restoreView?.groups ?? view.groups;
  const leaf = leaves.find((candidate) =>
    (groups[candidate.id] ?? [candidate.id]).some((id) => tabs.includes(id)),
  );
  if (!leaf) {
    const at = owners.findIndex((entry) => entry.id === pane);
    return `pane ${at + 1} of ${owners.length}`;
  }
  const { x, y, w, h } = leaf.rect;
  const across =
    w >= 0.999
      ? ""
      : x + w / 2 < 0.34
        ? "left"
        : x + w / 2 > 0.66
          ? "right"
          : "middle";
  const down = h >= 0.999 ? "" : y + h / 2 < 0.5 ? "top" : "bottom";
  const place = [down, across].filter(Boolean).join("-");
  return `${place || "only"} pane`;
}

/**
 * Where a tab lives, for search: "In the split with “Add sign-up flow” ·
 * right pane", with "behind “X”" when another tab is in front of its pane,
 * and "collapsed" when its pane is on a rail. Null for a tab standing on
 * the strip on its own, or one the strip does not hold.
 */
export function stripTabLocation(
  strip: WorkspaceStrip,
  id: string,
  name: (id: string) => string,
): string | null {
  const entry = entryOf(strip, id);
  if (!entry || entry.kind === "item") return null;
  const view = entry.view;
  const pane = paneHolding(view, id) ?? id;
  const others = partners(view, id);
  const railed = view.layout
    ? railedLeafIds(view.layout).includes(pane)
    : false;
  const hidden = Object.values(view.hiddenGroups ?? {}).some((members) =>
    members.includes(id),
  );
  const where = `${railed ? "collapsed " : hidden ? "hidden " : ""}${panePlace(view, pane)}`;
  const behind = pane !== id ? `, behind ${quoteTitle(name(pane), 24)}` : "";
  const split = others.length
    ? `In the split with ${quoteList(others.map(name))}`
    : "In a split";
  return `${split} · ${where}${behind}`;
}
