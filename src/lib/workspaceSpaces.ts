import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  closeWorkspaceViews,
  resolveWorkspaceView,
  restoreWorkspaceSplit,
  selectWorkspaceView,
  workspaceGroupOwner,
  workspaceIsSpace,
  type WorkspaceView,
} from "./workspaceViews";

/**
 * The window's strip, as in Cydonia: each entry is a single tab or a space,
 * an arrangement of panes (each pane a stack of tabs) that the window shows
 * whole. Switching entries changes the whole arrangement. A project's tabs
 * each belong to exactly one entry.
 *
 * The workspace code keeps working on one view: the entry in front. A space
 * in front is its own view. A single tab in front is shown as one pane whose
 * stack is every single tab, so selecting, reordering and closing them work
 * as they always have; splitting it makes a space of the two panes, and a
 * space reduced to one pane comes back apart as single tabs.
 *
 * Portions adapted from Cydonia (github.com/crabtalk/cydonia), Copyright (c)
 * 2026 clearloop, MIT.
 */

/** Stored under its own versioned key; the former views stay readable. */
export const WORKSPACE_SPACES_KEY = "aven.workspaceSpaces.v1";
/**
 * The strip of a chat that belongs to no project. It is kept apart from the
 * project left behind, whose strip must not be written from the one chat.
 */
export const NO_PROJECT_STRIP_KEY = "~";
/** Space entries are keyed apart from tab ids, which never start so. */
export const SPACE_KEY_PREFIX = "aven-space:";

export type StripItem = { kind: "item"; id: string };
export type StripSpace = { kind: "space"; id: string; view: WorkspaceView };
export type StripEntry = StripItem | StripSpace;
/** A project's strip: its entries in order and the one in front. */
export type WorkspaceStrip = { entries: StripEntry[]; front: string };

export const EMPTY_STRIP: WorkspaceStrip = { entries: [], front: "" };

export function entryKey(entry: StripEntry): string {
  return entry.kind === "item" ? entry.id : `${SPACE_KEY_PREFIX}${entry.id}`;
}

export function isSpaceKey(key: string): boolean {
  return key.startsWith(SPACE_KEY_PREFIX);
}

function newSpaceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function unique(ids: Iterable<string>): string[] {
  return [...new Set(ids)];
}

/** Every tab a view arranges, shown or tucked behind an expanded pane. */
export function viewMembers(view: WorkspaceView): string[] {
  return unique([
    ...Object.values(view.groups ?? {}).flat(),
    ...Object.values(view.hiddenGroups ?? {}).flat(),
  ]);
}

/** Whatever a stored space names, before checking it against open tabs. */
function storedMembers(view: Partial<WorkspaceView>): string[] {
  const lists: unknown[] = [
    view.order,
    ...Object.values(view.groups ?? {}),
    ...Object.values(view.hiddenGroups ?? {}),
  ];
  return unique(
    lists.flatMap((list) =>
      Array.isArray(list)
        ? list.filter((id): id is string => typeof id === "string")
        : [],
    ),
  );
}

/** The tabs a stored strip records, for a project not open right now. */
export function recordedStripIds(strip: WorkspaceStrip | undefined): string[] {
  return unique(
    (strip?.entries ?? []).flatMap((entry) =>
      entry.kind === "item" ? [entry.id] : storedMembers(entry.view),
    ),
  );
}

/** The single tabs of a pane, in its stack's order. */
function paneItems(view: WorkspaceView): string[] {
  const owner = view.layout ? leafIds(view.layout)[0] : undefined;
  return owner ? [...(view.groups[owner] ?? [owner])] : [];
}

/**
 * A view becomes a strip: a split is one space; one pane, its tabs. A
 * project's former arrangement migrates with a fixed id, so its key holds
 * steady until the strip is first written.
 */
export function stripFromView(
  view: WorkspaceView,
  id = newSpaceId(),
): WorkspaceStrip {
  if (workspaceIsSpace(view)) {
    return {
      entries: [{ kind: "space", id, view }],
      front: `${SPACE_KEY_PREFIX}${id}`,
    };
  }
  const items = paneItems(view);
  return {
    entries: items.map((id) => ({ kind: "item", id })),
    front: items.includes(view.focusedId) ? view.focusedId : (items[0] ?? ""),
  };
}

function parseEntries(value: unknown): {
  entries: StripEntry[];
  front: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { entries?: unknown; front?: unknown };
  if (!Array.isArray(raw.entries)) return null;
  const entries: StripEntry[] = [];
  for (const entry of raw.entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      kind?: unknown;
      id?: unknown;
      view?: WorkspaceView;
    };
    if (candidate.kind === "item" && typeof candidate.id === "string")
      entries.push({ kind: "item", id: candidate.id });
    else if (
      candidate.kind === "space" &&
      typeof candidate.id === "string" &&
      candidate.view &&
      typeof candidate.view === "object" &&
      !Array.isArray(candidate.view)
    )
      entries.push({ kind: "space", id: candidate.id, view: candidate.view });
  }
  return {
    entries,
    front: typeof raw.front === "string" ? raw.front : "",
  };
}

/**
 * Check a stored strip against the tabs that are open: closed tabs leave,
 * each tab is in one entry, a space down to one pane comes apart into
 * single tabs, and tabs the strip has never seen join the entry in front
 * (the focused pane of a space, or beside the single tab in front). With
 * nothing stored, `fallback` is the arrangement to start from.
 */
export function resolveWorkspaceStrip(
  value: unknown,
  ids: readonly string[],
  requestedFocus: string,
  fallback: () => WorkspaceView,
  /** New tabs go on the strip even with a space in front (its + button). */
  { newcomersOnStrip = false }: { newcomersOnStrip?: boolean } = {},
): WorkspaceStrip {
  const parsed = parseEntries(value);
  if (!parsed)
    return resolveWorkspaceStrip(
      stripFromView(fallback(), "former"),
      ids,
      requestedFocus,
      fallback,
      { newcomersOnStrip },
    );
  const allowed = new Set(ids);
  const claimed = new Set<string>();
  const entries: StripEntry[] = [];
  let front = parsed.front;
  for (const entry of parsed.entries) {
    if (entry.kind === "item") {
      if (!allowed.has(entry.id) || claimed.has(entry.id)) continue;
      claimed.add(entry.id);
      entries.push(entry);
      continue;
    }
    const members = storedMembers(entry.view).filter(
      (id) => allowed.has(id) && !claimed.has(id),
    );
    if (!members.length) continue;
    const view = resolveWorkspaceView(
      entry.view,
      members,
      entry.view.focusedId ?? members[0],
    );
    viewMembers(view).forEach((id) => claimed.add(id));
    if (workspaceIsSpace(view)) {
      entries.push({ kind: "space", id: entry.id, view });
      continue;
    }
    // Down to one pane: its tabs stand on the strip again.
    const items = paneItems(view);
    if (front === entryKey(entry)) front = view.focusedId || items[0] || "";
    entries.push(...items.map((id): StripItem => ({ kind: "item", id })));
  }
  const newcomers = ids.filter((id) => !claimed.has(id));
  if (newcomers.length) {
    const at = entries.findIndex((entry) => entryKey(entry) === front);
    const host = entries[at];
    if (host?.kind === "space" && !newcomersOnStrip) {
      const view = resolveWorkspaceView(
        host.view,
        [...viewMembers(host.view), ...newcomers],
        host.view.focusedId,
      );
      entries[at] = { ...host, view };
    } else {
      entries.splice(
        at < 0 ? entries.length : at + 1,
        0,
        ...newcomers.map((id): StripItem => ({ kind: "item", id })),
      );
    }
  }
  if (!entries.some((entry) => entryKey(entry) === front))
    front =
      (requestedFocus &&
        stripEntryKeyOf({ entries, front: "" }, requestedFocus)) ||
      (entries[0] ? entryKey(entries[0]) : "");
  return { entries, front };
}

/** The entry holding a tab, by key. */
export function stripEntryKeyOf(
  strip: WorkspaceStrip,
  id: string,
): string | undefined {
  const entry = strip.entries.find((candidate) =>
    candidate.kind === "item"
      ? candidate.id === id
      : viewMembers(candidate.view).includes(id),
  );
  return entry ? entryKey(entry) : undefined;
}

export function frontEntry(strip: WorkspaceStrip): StripEntry | undefined {
  return strip.entries.find((entry) => entryKey(entry) === strip.front);
}

/** The tab an entry shows in front: a single tab, or its space's focus. */
export function entryFocus(entry: StripEntry): string {
  return entry.kind === "item" ? entry.id : entry.view.focusedId;
}

/** The single tabs, in strip order. */
export function stripItems(strip: WorkspaceStrip): string[] {
  return strip.entries.flatMap((entry) =>
    entry.kind === "item" ? [entry.id] : [],
  );
}

/** The view the workspace works on: the entry in front. */
export function stripView(strip: WorkspaceStrip): WorkspaceView {
  const front = frontEntry(strip);
  if (front?.kind === "space") return front.view;
  const items = stripItems(strip);
  const id = front?.kind === "item" ? front.id : items[0];
  if (!id) return { layout: null, focusedId: "", order: [], groups: {} };
  return {
    layout: leaf(id),
    focusedId: id,
    order: items,
    groups: { [id]: items },
  };
}

/** Take tabs out of an entry; a space left with one pane comes apart. */
function withoutTabs(
  entry: StripEntry,
  ids: ReadonlySet<string>,
): StripEntry[] {
  if (entry.kind === "item") return ids.has(entry.id) ? [] : [entry];
  const members = viewMembers(entry.view);
  if (!members.some((id) => ids.has(id))) return [entry];
  const view = closeWorkspaceViews(
    entry.view,
    members.filter((id) => ids.has(id)),
    entry.view.focusedId,
  );
  if (!view.layout) return [];
  if (workspaceIsSpace(view)) return [{ ...entry, view }];
  return paneItems(view).map((id): StripItem => ({ kind: "item", id }));
}

/**
 * Write the entry in front back after the workspace changed it. A single
 * tab split beside another becomes a space of those panes, one tab each,
 * in the single tab's place; a space down to one pane comes apart into
 * single tabs in its place. Tabs the front now holds leave the entries they
 * were in (a drop brought them over).
 */
export function applyStripView(
  strip: WorkspaceStrip,
  next: WorkspaceView,
): WorkspaceStrip {
  const at = strip.entries.findIndex(
    (entry) => entryKey(entry) === strip.front,
  );
  const current = strip.entries[at];
  const holds = new Set(viewMembers(next));
  if (current?.kind === "space") {
    const placed: StripEntry[] = [];
    let frontAt = 0;
    strip.entries.forEach((entry, index) => {
      if (index !== at) {
        placed.push(...withoutTabs(entry, holds));
        return;
      }
      frontAt = placed.length;
      if (workspaceIsSpace(next)) placed.push({ ...current, view: next });
      else
        placed.push(
          ...paneItems(next).map((id): StripItem => ({ kind: "item", id })),
        );
    });
    if (workspaceIsSpace(next)) return { entries: placed, front: strip.front };
    const items = paneItems(next);
    const front = items.includes(next.focusedId)
      ? next.focusedId
      : (items[0] ?? neighbourKey(placed, frontAt));
    return { entries: placed, front };
  }
  // A single tab was in front: its pane's stack is every single tab, so the
  // single tabs take their new order in the places single tabs held.
  let space: StripSpace | undefined;
  let queue: string[];
  if (workspaceIsSpace(next) && next.layout) {
    // Each pane keeps just its own tab; the rest stay single tabs.
    const owners = leafIds(next.layout);
    space = {
      kind: "space",
      id: newSpaceId(),
      view: {
        layout: next.layout,
        focusedId: owners.includes(next.focusedId) ? next.focusedId : owners[0],
        order: owners,
        groups: Object.fromEntries(owners.map((owner) => [owner, [owner]])),
      },
    };
    const panes = new Set(owners);
    queue = unique(owners.flatMap((owner) => next.groups[owner] ?? [])).filter(
      (id) => !panes.has(id),
    );
  } else queue = [...paneItems(next)];
  const placed: StripEntry[] = [];
  let frontAt = -1;
  strip.entries.forEach((entry, index) => {
    if (index === at && space) {
      frontAt = placed.length;
      placed.push(space);
      return;
    }
    if (entry.kind === "space") {
      placed.push(...withoutTabs(entry, holds));
      return;
    }
    const id = queue.shift();
    if (index === at) frontAt = placed.length;
    if (id !== undefined) placed.push({ kind: "item", id });
  });
  // Tabs beyond the places single tabs held follow the entry in front.
  if (queue.length)
    placed.splice(
      frontAt < 0 ? placed.length : frontAt + 1,
      0,
      ...queue.map((id): StripItem => ({ kind: "item", id })),
    );
  if (space) return { entries: placed, front: entryKey(space) };
  const items = paneItems(next);
  const front = items.includes(next.focusedId)
    ? next.focusedId
    : (items[0] ?? neighbourKey(placed, Math.max(frontAt, 0)));
  return { entries: placed, front };
}

function neighbourKey(entries: readonly StripEntry[], at: number): string {
  const entry = entries[Math.min(at, entries.length - 1)];
  return entry ? entryKey(entry) : "";
}

/** Bring a tab to the front: its entry, and the tab within its space. */
export function focusStripTab(
  strip: WorkspaceStrip,
  id: string,
): WorkspaceStrip {
  const key = stripEntryKeyOf(strip, id);
  if (!key) return strip;
  const entries = strip.entries.map((entry) =>
    entry.kind === "space" && entryKey(entry) === key
      ? { ...entry, view: selectWorkspaceView(entry.view, id) }
      : entry,
  );
  return { entries, front: key };
}

/** The next or previous entry, wrapping round, as ⌃⇥ steps the strip. */
export function stepStripEntry(strip: WorkspaceStrip, step: number): string {
  const keys = strip.entries.map(entryKey);
  if (!keys.length) return "";
  const at = keys.indexOf(strip.front);
  const next =
    ((at < 0 ? 0 : at) + step + keys.length * Math.abs(step)) % keys.length;
  return keys[next];
}

/** ⌘1 to ⌘8 pick an entry by place; ⌘9 (slot -1) the last. */
export function stripEntryAt(
  strip: WorkspaceStrip,
  slot: number,
): string | undefined {
  const keys = strip.entries.map(entryKey);
  return keys[slot < 0 ? keys.length - 1 : slot];
}

/** The tab to select to bring an entry to the front. */
export function stripEntryFocus(
  strip: WorkspaceStrip,
  key: string,
): string | undefined {
  const entry = strip.entries.find((candidate) => entryKey(candidate) === key);
  return entry ? entryFocus(entry) : undefined;
}

/** The panes an entry shows when it comes to the front. */
export function stripEntryShown(strip: WorkspaceStrip, key: string): string[] {
  const entry = strip.entries.find((candidate) => entryKey(candidate) === key);
  if (!entry) return [];
  if (entry.kind === "item") return [entry.id];
  return entry.view.layout ? leafIds(entry.view.layout) : [];
}

/** Reorder the strip; keys it does not name keep their order after it. */
export function reorderStripEntries(
  strip: WorkspaceStrip,
  keys: readonly string[],
): WorkspaceStrip {
  const byKey = new Map(strip.entries.map((entry) => [entryKey(entry), entry]));
  const ordered = unique(keys).flatMap((key) => {
    const entry = byKey.get(key);
    if (!entry) return [];
    byKey.delete(key);
    return [entry];
  });
  return { ...strip, entries: [...ordered, ...byKey.values()] };
}

/** A split's pane: the tab in front of it, then every tab it holds. */
export type SpacePane = { id: string; tabs: string[] };

/**
 * A split's panes in arrangement order (left to right, each column top to
 * bottom), each named by the tab in front of it. Panes tucked behind an
 * expanded one are listed in the places they will return to.
 */
export function spacePanes(view: WorkspaceView): SpacePane[] {
  const live = view.layout ? leafIds(view.layout) : [];
  const owners = unique([...live, ...Object.keys(view.hiddenGroups ?? {})]);
  const tabsOf = (owner: string) =>
    view.groups[owner] ?? view.hiddenGroups?.[owner] ?? [owner];
  const snapshot = view.restoreView;
  const order = snapshot?.layout ? leafIds(snapshot.layout) : live;
  // A pane's place: the place of the pane in the arrangement that held any
  // of its tabs (its tab in front may have changed since).
  const place = (owner: string) => {
    const members = new Set(tabsOf(owner));
    const at = order.findIndex((id) =>
      (snapshot?.groups[id] ?? view.groups[id] ?? [id]).some((member) =>
        members.has(member),
      ),
    );
    return at < 0 ? order.length : at;
  };
  return owners
    .map((id, index) => ({ id, tabs: tabsOf(id), at: place(id), index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ id, tabs }) => ({ id, tabs: [...tabs] }));
}

/** A new pane at the arrangement's right, as tall as the arrangement. */
function appendPaneRight(layout: LayoutNode, id: string): LayoutNode {
  if (layout.type === "split" && layout.dir === "right") {
    const count = layout.children.length;
    return {
      ...layout,
      children: [...layout.children, leaf(id)],
      sizes: [
        ...layout.sizes.map((size) => (size * count) / (count + 1)),
        1 / (count + 1),
      ],
    };
  }
  return {
    type: "split",
    id: newSpaceId(),
    dir: "right",
    children: [layout, leaf(id)],
    sizes: [0.5, 0.5],
  };
}

/**
 * A tab dropped on a split's entry: it leaves its own entry and joins the
 * split as a new pane at its right, and the split comes to the front with
 * that pane focused. An expanded pane gives its split back first.
 */
export function addStripPane(
  strip: WorkspaceStrip,
  key: string,
  id: string,
): WorkspaceStrip {
  const target = strip.entries.find((entry) => entryKey(entry) === key);
  if (target?.kind !== "space") return strip;
  if (viewMembers(target.view).includes(id)) return strip;
  if (stripEntryKeyOf(strip, id) === undefined) return strip;
  const leaving = new Set([id]);
  const entries = strip.entries.flatMap((entry): StripEntry[] => {
    if (entry !== target) return withoutTabs(entry, leaving);
    const base = restoreWorkspaceSplit(entry.view);
    if (!base.layout) return [entry];
    return [
      {
        ...entry,
        view: {
          ...base,
          layout: appendPaneRight(base.layout, id),
          focusedId: id,
          order: unique([...base.order, id]),
          groups: { ...base.groups, [id]: [id] },
        },
      },
    ];
  });
  return { entries, front: key };
}

/**
 * A tab let go on the middle of a single tab: the two become a split in the
 * single tab's place, it on the left and the tab let go on the right, half
 * each. The tab let go leaves the entry it was in (a split left with one
 * pane comes apart), and the new split comes to the front with its pane
 * focused.
 */
export function combineStripTabs(
  strip: WorkspaceStrip,
  target: string,
  id: string,
): WorkspaceStrip {
  if (target === id) return strip;
  const host = strip.entries.find(
    (entry) => entry.kind === "item" && entry.id === target,
  );
  if (!host || stripEntryKeyOf(strip, id) === undefined) return strip;
  const space: StripSpace = {
    kind: "space",
    id: newSpaceId(),
    view: {
      layout: appendPaneRight(leaf(target), id),
      focusedId: id,
      order: [target, id],
      groups: { [target]: [target], [id]: [id] },
    },
  };
  const leaving = new Set([id]);
  const entries = strip.entries.flatMap((entry): StripEntry[] =>
    entry === host ? [space] : withoutTabs(entry, leaving),
  );
  return { entries, front: entryKey(space) };
}

/**
 * Pages a drop on the strip's entry `target` brings together, to keep open
 * as a page moved into a pane is: a deliberate move must not leave one as
 * the preview the next opened link replaces. A tab let go on a split is
 * kept; a tab let go on a single tab, and that tab; a split let go on a
 * single tab, that tab (the split's own tabs are kept by it).
 */
export function stripDropKeeps(target: string, dragged: string): string[] {
  if (isSpaceKey(target)) return isSpaceKey(dragged) ? [] : [dragged];
  return isSpaceKey(dragged) ? [target] : [target, dragged];
}

/**
 * What Undo layout needs to take a split made on the strip apart again: the
 * single tab's view, as if in front, with the tab let go brought into it,
 * taken in the single tab's entry. Null when the drop makes no new split (a
 * split taking a pane, as a tab let go on a split does, is not undone).
 */
export function stripCombineUndo(
  strip: WorkspaceStrip,
  target: string,
  id: string,
): { view: WorkspaceView; entry: string } | null {
  if (isSpaceKey(id) || combineStripTabs(strip, target, id) === strip)
    return null;
  return {
    view: stripViewWith(focusStripTab(strip, target), [id]),
    entry: target,
  };
}

/**
 * A split let go on the middle of a single tab: the tab joins it as a new
 * pane at its right, and the split stands in the tab's place, in front,
 * still focused where it was.
 */
export function joinStripSplit(
  strip: WorkspaceStrip,
  key: string,
  target: string,
): WorkspaceStrip {
  const source = strip.entries.find((entry) => entryKey(entry) === key);
  const host = strip.entries.find(
    (entry) => entry.kind === "item" && entry.id === target,
  );
  if (source?.kind !== "space" || !host) return strip;
  const joined = addStripPane(strip, key, target).entries.find(
    (entry) => entryKey(entry) === key,
  );
  if (joined?.kind !== "space" || joined === source) return strip;
  const entry: StripSpace = {
    ...joined,
    view: selectWorkspaceView(joined.view, source.view.focusedId),
  };
  const entries = strip.entries.flatMap((candidate): StripEntry[] =>
    candidate === host ? [entry] : candidate === source ? [] : [candidate],
  );
  return { entries, front: key };
}

/**
 * A tab pulled out of its split and let go on the strip: it stands on its
 * own before the entry `before` (or at the end). Focus stays with the tab
 * that had it: a tab that had focus in the split in front comes to the
 * front alone; a split in front that comes apart leaves its focused tab
 * in front.
 */
export function detachStripTab(
  strip: WorkspaceStrip,
  id: string,
  before: string | null,
): WorkspaceStrip {
  const key = stripEntryKeyOf(strip, id);
  const source = strip.entries.find((entry) => entryKey(entry) === key);
  if (source?.kind !== "space") return strip;
  const rest = withoutTabs(source, new Set([id]));
  const entries = strip.entries.flatMap((entry) =>
    entry === source ? rest : [entry],
  );
  // Let go on its own split's chip, the tab stands where the split stood.
  const at =
    before === key
      ? strip.entries.indexOf(source)
      : before
        ? entries.findIndex((entry) => entryKey(entry) === before)
        : -1;
  entries.splice(at < 0 ? entries.length : at, 0, { kind: "item", id });
  let front = strip.front;
  if (front === key) {
    const focus = source.view.focusedId;
    if (focus === id) front = id;
    else if (!rest.some((entry) => entry.kind === "space"))
      front = rest.some((entry) => entryKey(entry) === focus)
        ? focus
        : rest[0]
          ? entryKey(rest[0])
          : id;
  }
  return { entries, front };
}

/**
 * Separate a split: its tabs stand on the strip as single tabs in its place,
 * pane by pane. A split in front leaves its focused tab in front.
 */
export function separateStripSpace(
  strip: WorkspaceStrip,
  key: string,
): WorkspaceStrip {
  const at = strip.entries.findIndex((entry) => entryKey(entry) === key);
  const entry = strip.entries[at];
  if (entry?.kind !== "space") return strip;
  const ids = unique([
    ...spacePanes(entry.view).flatMap((pane) => pane.tabs),
    ...viewMembers(entry.view),
  ]);
  const entries = [...strip.entries];
  entries.splice(at, 1, ...ids.map((id): StripItem => ({ kind: "item", id })));
  const front =
    strip.front === key
      ? ids.includes(entry.view.focusedId)
        ? entry.view.focusedId
        : (ids[0] ?? "")
      : strip.front;
  return { entries, front };
}

/**
 * The view in front with other entries' tabs brought into it, for a drop or
 * split that takes a tab from elsewhere on the strip. They join the focused
 * pane's stack; `applyStripView` then takes them out of their old entries.
 */
export function stripViewWith(
  strip: WorkspaceStrip,
  ids: readonly string[],
): WorkspaceView {
  const view = stripView(strip);
  const members = new Set(viewMembers(view));
  const incoming = unique(ids).filter(
    (id) => !members.has(id) && stripEntryKeyOf(strip, id) !== undefined,
  );
  if (!incoming.length || !view.layout) return view;
  const owner = workspaceGroupOwner(view, view.focusedId) ?? view.focusedId;
  return {
    ...view,
    order: unique([...view.order, ...incoming]),
    groups: {
      ...view.groups,
      [owner]: [...(view.groups[owner] ?? []), ...incoming],
    },
  };
}

/**
 * A write resolved against only some of a project's tabs (a chat of no
 * project in front, pages put away) must not lose the rest: stored entries
 * none of whose tabs the write could see stay in their places while any of
 * their tabs still exist.
 */
export function keepUnseenStripEntries(
  stored: unknown,
  next: WorkspaceStrip,
  seen: ReadonlySet<string>,
  exists: (id: string) => boolean,
): WorkspaceStrip {
  const parsed = parseEntries(stored);
  if (!parsed) return next;
  const held = new Set(recordedStripIds(next));
  const entries = [...next.entries];
  const keys = new Set(entries.map(entryKey));
  let after: string | null = null;
  let kept = false;
  for (const entry of parsed.entries) {
    const key = entryKey(entry);
    if (keys.has(key)) {
      after = key;
      continue;
    }
    const members =
      entry.kind === "item" ? [entry.id] : storedMembers(entry.view);
    if (
      !members.length ||
      members.some((id) => seen.has(id) || held.has(id)) ||
      !members.some(exists)
    )
      continue;
    const at =
      after === null
        ? 0
        : entries.findIndex((candidate) => entryKey(candidate) === after) + 1;
    entries.splice(at, 0, entry);
    keys.add(key);
    members.forEach((id) => held.add(id));
    after = key;
    kept = true;
  }
  return kept ? { ...next, entries } : next;
}

/**
 * Undo a layout change on the entry it was made in, not whichever entry is
 * in front now: that entry comes to the front and takes the arrangement
 * back. An entry that has since been split or come apart is found by the
 * tab that was focused in it, then by any of its tabs. Null when none of
 * them is on the strip any more.
 */
export function undoStripLayout(
  strip: WorkspaceStrip,
  snapshot: WorkspaceView,
  entry?: string,
): WorkspaceStrip | null {
  const members = storedMembers(snapshot);
  const target =
    (entry && strip.entries.some((candidate) => entryKey(candidate) === entry)
      ? entry
      : undefined) ??
    stripEntryKeyOf(strip, snapshot.focusedId) ??
    members.map((id) => stripEntryKeyOf(strip, id)).find(Boolean);
  if (!target) return null;
  const focus = stripEntryFocus(strip, target);
  const front = focus ? focusStripTab(strip, focus) : strip;
  const current = stripView(front);
  const restored = resolveWorkspaceView(
    snapshot,
    current.order,
    current.focusedId,
  );
  return applyStripView(front, restored);
}
