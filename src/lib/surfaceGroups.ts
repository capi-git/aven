import { TAB_GROUP_COLORS } from "./tabGroups";

/**
 * User-made tab groups for the workspace strip. Membership is keyed by surface
 * id so conversation, file and browser tabs group the same way. Groups live
 * beside the workspace snapshot rather than inside it: a group is how the
 * strip is organised, not how panes sit on screen.
 */
export type SurfaceGroup = {
  id: string;
  name: string;
  /** Index into SURFACE_GROUP_COLORS. */
  color: number;
  collapsed: boolean;
};

export type SurfaceGroupState = {
  groups: Record<string, SurfaceGroup>;
  /** Surface id → group id. */
  members: Record<string, string>;
};

export const SURFACE_GROUP_COLORS: ReadonlyArray<{
  name: string;
  value: string;
}> = [
  { name: "Grey", value: TAB_GROUP_COLORS[0] },
  { name: "Blue", value: TAB_GROUP_COLORS[1] },
  { name: "Red", value: TAB_GROUP_COLORS[2] },
  { name: "Yellow", value: TAB_GROUP_COLORS[3] },
  { name: "Green", value: TAB_GROUP_COLORS[4] },
  { name: "Pink", value: TAB_GROUP_COLORS[5] },
  { name: "Purple", value: TAB_GROUP_COLORS[6] },
  { name: "Cyan", value: TAB_GROUP_COLORS[7] },
  { name: "Orange", value: TAB_GROUP_COLORS[8] },
];

export function surfaceGroupColor(group: SurfaceGroup): string {
  return (SURFACE_GROUP_COLORS[group.color] ?? SURFACE_GROUP_COLORS[1]).value;
}

const STORAGE_KEY = "aven.tabGroups.v1";
const CHANGED = "aven:tab-groups-changed";
/** Closed tabs are not always seen by the strip; bound what they leave behind. */
const MAX_MEMBERS = 1000;
const EMPTY: SurfaceGroupState = { groups: {}, members: {} };

function validState(value: unknown): SurfaceGroupState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  const raw = value as { groups?: unknown; members?: unknown };
  const groups: Record<string, SurfaceGroup> = {};
  if (raw.groups && typeof raw.groups === "object") {
    for (const [id, group] of Object.entries(raw.groups)) {
      if (!group || typeof group !== "object") continue;
      const entry = group as Partial<SurfaceGroup>;
      groups[id] = {
        id,
        name: typeof entry.name === "string" ? entry.name.slice(0, 60) : "",
        color:
          typeof entry.color === "number" &&
          Number.isInteger(entry.color) &&
          entry.color >= 0 &&
          entry.color < SURFACE_GROUP_COLORS.length
            ? entry.color
            : 1,
        collapsed: entry.collapsed === true,
      };
    }
  }
  const members: Record<string, string> = {};
  if (raw.members && typeof raw.members === "object") {
    for (const [surfaceId, groupId] of Object.entries(raw.members)) {
      if (typeof groupId === "string" && groups[groupId])
        members[surfaceId] = groupId;
    }
  }
  return normalize({ groups, members });
}

/** Drop groups nobody belongs to and cap remembered memberships. */
function normalize(state: SurfaceGroupState): SurfaceGroupState {
  let entries = Object.entries(state.members).filter(
    ([, groupId]) => state.groups[groupId],
  );
  if (entries.length > MAX_MEMBERS)
    entries = entries.slice(entries.length - MAX_MEMBERS);
  const members = Object.fromEntries(entries);
  const used = new Set(Object.values(members));
  const groups = Object.fromEntries(
    Object.entries(state.groups).filter(([id]) => used.has(id)),
  );
  return { groups, members };
}

let cache: { raw: string | null; state: SurfaceGroupState } | null = null;

export function loadSurfaceGroups(): SurfaceGroupState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cache?.state ?? EMPTY;
  }
  if (cache && cache.raw === raw) return cache.state;
  let state = EMPTY;
  try {
    state = raw ? validState(JSON.parse(raw)) : EMPTY;
  } catch {
    state = EMPTY;
  }
  cache = { raw, state };
  return state;
}

export function subscribeSurfaceGroups(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, listener);
  };
}

function update(change: (state: SurfaceGroupState) => SurfaceGroupState) {
  const next = normalize(change(loadSurfaceGroups()));
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Grouping is presentation; a full store must not break the strip.
  }
  cache = { raw, state: next };
  window.dispatchEvent(new Event(CHANGED));
}

function newGroupId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** First colour (after grey) not already used by a group in view. */
export function nextSurfaceGroupColor(inUse: SurfaceGroup[]): number {
  const taken = new Set(inUse.map((group) => group.color));
  for (let index = 1; index < SURFACE_GROUP_COLORS.length; index++)
    if (!taken.has(index)) return index;
  return (inUse.length % (SURFACE_GROUP_COLORS.length - 1)) + 1;
}

export function createSurfaceGroup(
  ids: string[],
  color: number,
  name = "",
): string {
  const id = newGroupId();
  update((state) => {
    const members = { ...state.members };
    for (const surfaceId of ids) {
      delete members[surfaceId];
      members[surfaceId] = id;
    }
    return {
      groups: { ...state.groups, [id]: { id, name, color, collapsed: false } },
      members,
    };
  });
  return id;
}

/** Set (or clear, with null) the group of each surface. */
export function setSurfaceGroupMembership(
  changes: Record<string, string | null>,
) {
  update((state) => {
    const members = { ...state.members };
    for (const [surfaceId, groupId] of Object.entries(changes)) {
      delete members[surfaceId];
      if (groupId && state.groups[groupId]) members[surfaceId] = groupId;
    }
    return { ...state, members };
  });
}

export function changeSurfaceGroup(
  id: string,
  patch: Partial<Pick<SurfaceGroup, "name" | "color" | "collapsed">>,
) {
  update((state) => {
    const group = state.groups[id];
    if (!group) return state;
    const next = { ...group, ...patch };
    next.name = next.name.trim().slice(0, 60);
    return { ...state, groups: { ...state.groups, [id]: next } };
  });
}

export function setSurfaceGroupsCollapsed(
  ids: readonly string[],
  collapsed: boolean,
) {
  update((state) => {
    const groups = { ...state.groups };
    for (const id of ids)
      if (groups[id]) groups[id] = { ...groups[id], collapsed };
    return { ...state, groups };
  });
}

export function ungroupSurfaceGroup(id: string) {
  update((state) => ({
    ...state,
    members: Object.fromEntries(
      Object.entries(state.members).filter(([, groupId]) => groupId !== id),
    ),
  }));
}

export const GROUP_CHIP_PREFIX = "tab-group:";

export function groupChipId(groupId: string): string {
  return `${GROUP_CHIP_PREFIX}${groupId}`;
}

export function chipGroupId(id: string): string | null {
  return id.startsWith(GROUP_CHIP_PREFIX)
    ? id.slice(GROUP_CHIP_PREFIX.length)
    : null;
}

export type StripSegment =
  | { kind: "tab"; id: string }
  | {
      kind: "group";
      group: SurfaceGroup;
      /** Every member in this strip, in strip order. */
      members: string[];
      /** Members drawn after the label: all of them, or none when folded. */
      shown: string[];
    };

/**
 * A group draws at the position of its first member with every member after
 * its label, so a group always reads as one run even if the saved order drifted.
 */
export function stripSegments(
  orderedIds: string[],
  state: SurfaceGroupState,
): StripSegment[] {
  const byGroup = new Map<string, string[]>();
  for (const id of orderedIds) {
    const groupId = state.members[id];
    if (!groupId || !state.groups[groupId]) continue;
    const list = byGroup.get(groupId) ?? [];
    list.push(id);
    byGroup.set(groupId, list);
  }
  const segments: StripSegment[] = [];
  const placed = new Set<string>();
  for (const id of orderedIds) {
    const groupId = state.members[id];
    const members = groupId ? byGroup.get(groupId) : undefined;
    if (!groupId || !members) {
      segments.push({ kind: "tab", id });
      continue;
    }
    if (placed.has(groupId)) continue;
    placed.add(groupId);
    const group = state.groups[groupId];
    segments.push({
      kind: "group",
      group,
      members,
      // Like Brave, a folded group is just its label.
      shown: group.collapsed ? [] : members,
    });
  }
  return segments;
}

/** The sortable sequence: labels and the tabs drawn after them. */
export function stripDisplayIds(segments: StripSegment[]): string[] {
  return segments.flatMap((segment) =>
    segment.kind === "tab"
      ? [segment.id]
      : [groupChipId(segment.group.id), ...segment.shown],
  );
}

/**
 * Where a dragged tab lands decides its group: right after a label or between
 * two members joins that group; the end of its own group keeps it; anywhere
 * else leaves. Returns undefined when membership does not change.
 */
export function groupAfterDrop(
  display: string[],
  movedId: string,
  members: Record<string, string>,
): string | null | undefined {
  const index = display.indexOf(movedId);
  if (index < 0 || chipGroupId(movedId)) return undefined;
  const current = members[movedId] ?? null;
  const prev = display[index - 1];
  const next = display[index + 1];
  const groupOf = (id: string | undefined) =>
    id === undefined ? null : (chipGroupId(id) ?? members[id] ?? null);
  const prevGroup = groupOf(prev);
  const nextGroup = next && !chipGroupId(next) ? (members[next] ?? null) : null;
  let target: string | null = null;
  if (prev && chipGroupId(prev)) target = chipGroupId(prev);
  else if (prevGroup && prevGroup === nextGroup) target = prevGroup;
  else if (prevGroup && prevGroup === current) target = current;
  return target === current ? undefined : target;
}

/**
 * Turn a reordered display sequence back into a surface order. Each label
 * brings every member of its group, including the ones folded out of view.
 */
export function orderFromDisplay(
  display: string[],
  members: Record<string, string>,
  previousOrder: string[],
): string[] {
  const shown = new Set(display);
  const out: string[] = [];
  const emitted = new Set<string>();
  const emit = (id: string) => {
    if (emitted.has(id)) return;
    emitted.add(id);
    out.push(id);
  };
  for (const id of display) {
    const groupId = chipGroupId(id);
    if (groupId) {
      for (const member of display)
        if (!chipGroupId(member) && members[member] === groupId) emit(member);
      for (const member of previousOrder)
        if (!shown.has(member) && members[member] === groupId) emit(member);
      continue;
    }
    if (members[id] && display.includes(groupChipId(members[id]))) continue;
    emit(id);
  }
  // Anything not drawn and not claimed by a label keeps its place at the end.
  for (const id of previousOrder) emit(id);
  return out;
}
