import type { ExplorerMenuItem } from "../chrome/ExplorerMenu";

/**
 * One header per pane. A workspace pane's title row is its only header: a
 * pane holding one tab that has a toolbar of its own (a browser page, an
 * iPhone, a tab of files) lends that toolbar the row, and the content's
 * secondary actions join the pane's one "…" menu. This is the meeting point,
 * keyed by the surface in front of a pane: the title row offers its row and
 * hosts the menu; the content fills the row and lists its actions.
 */

/** Where a pane's content draws its toolbar: in place of the pane's name. */
export type PaneHeaderSlot = {
  element: HTMLElement;
  /**
   * Nothing else names the tab (no tab row above it, no window strip tab),
   * so its toolbar names it: a page's address shows the page's title.
   */
  names: boolean;
};

/** A content's secondary actions, listed in its pane's "…". */
export type PaneHeaderMenu = {
  /** Read when the menu opens, so labels and disabled states are current. */
  items: () => ExplorerMenuItem[];
  /** Pages an item opens with the id `page:<name>` (Zoom, say). */
  pages?: () => Record<string, ExplorerMenuItem[]>;
  pick: (id: string) => void;
};

type Entry = {
  slot?: PaneHeaderSlot;
  /** Title rows hosting this surface's "…" (one, normally). */
  hosts: number;
  menu?: PaneHeaderMenu;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entry(id: string): Entry {
  let found = entries.get(id);
  if (!found) {
    found = { hosts: 0 };
    entries.set(id, found);
  }
  return found;
}

function changed(id: string) {
  const found = entries.get(id);
  if (found && !found.slot && !found.hosts && !found.menu) entries.delete(id);
  for (const listener of listeners) listener();
}

export function subscribePaneHeaders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The title row offers its row to the content of `id`; null withdraws it. */
export function setPaneHeaderSlot(id: string, slot: PaneHeaderSlot | null) {
  const current = entries.get(id)?.slot;
  if (current?.element === slot?.element && current?.names === slot?.names)
    return;
  entry(id).slot = slot ?? undefined;
  changed(id);
}

export function paneHeaderSlot(id: string): PaneHeaderSlot | null {
  return entries.get(id)?.slot ?? null;
}

/**
 * A title row hosts the "…" for the surface `id` in front of it, so the
 * content draws no "…" of its own. Returns the release.
 */
export function hostPaneHeaderMenu(id: string): () => void {
  entry(id).hosts++;
  changed(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(id);
    if (current) current.hosts = Math.max(0, current.hosts - 1);
    changed(id);
  };
}

export function paneHeaderMenuHosted(id: string): boolean {
  return (entries.get(id)?.hosts ?? 0) > 0;
}

/** The content of `id` lists its secondary actions; null withdraws them. */
export function setPaneHeaderMenu(id: string, menu: PaneHeaderMenu | null) {
  if ((entries.get(id)?.menu ?? null) === menu) return;
  entry(id).menu = menu ?? undefined;
  changed(id);
}

export function paneHeaderMenu(id: string): PaneHeaderMenu | null {
  return entries.get(id)?.menu ?? null;
}

/** For tests. */
export function resetPaneHeaders() {
  entries.clear();
  for (const listener of listeners) listener();
}
