import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutNode } from "../lib/layout";
import {
  addStripPane,
  applyStripView,
  combineStripTabs,
  detachStripTab,
  focusStripTab,
  isSpaceKey,
  joinStripSplit,
  keepUnseenStripEntries,
  recordedStripIds,
  reorderStripEntries,
  resolveWorkspaceStrip,
  separateStripSpace,
  stripView,
  stripViewWith,
  undoStripLayout,
  viewMembers,
  WORKSPACE_SPACES_KEY,
  type WorkspaceStrip,
} from "../lib/workspaceSpaces";
import {
  resolveWorkspaceView,
  type WorkspaceView,
} from "../lib/workspaceViews";

/**
 * Each project's arrangement before spaces. Read once to migrate a project
 * to a strip, and still written with the entry in front, so an older Aven
 * opens on the arrangement the user last saw.
 */
export const LEGACY_WORKSPACE_VIEWS_KEY = "supermono.workspaceViews.v1";

type Store = {
  strips: Record<string, WorkspaceStrip>;
  legacy: Record<string, WorkspaceView>;
};

function readRecord(key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function loadStore(): Store {
  const stored = readRecord(WORKSPACE_SPACES_KEY) as {
    version?: unknown;
    projects?: unknown;
  };
  const projects =
    stored.version === 1 &&
    stored.projects &&
    typeof stored.projects === "object" &&
    !Array.isArray(stored.projects)
      ? (stored.projects as Record<string, WorkspaceStrip>)
      : {};
  return {
    strips: projects,
    legacy: readRecord(LEGACY_WORKSPACE_VIEWS_KEY) as Record<
      string,
      WorkspaceView
    >,
  };
}

/** How long a + on the strip waits for its new tab to arrive. */
const STRIP_NEWCOMER_MS = 3000;

function resolveStrip(
  store: Store,
  key: string,
  ids: readonly string[],
  requestedFocus: string,
  initialLayout?: LayoutNode,
  newcomersOnStrip = false,
): WorkspaceStrip {
  return resolveWorkspaceStrip(
    store.strips[key],
    ids,
    requestedFocus,
    () =>
      resolveWorkspaceView(
        store.legacy[key],
        ids,
        requestedFocus,
        initialLayout,
      ),
    { newcomersOnStrip },
  );
}

/**
 * The project's strip (Cydonia's window tabs: single tabs and spaces) and
 * the view in front, which the workspace edits as it always has.
 */
export function useWorkspaceViews(
  key: string,
  ids: string[],
  requestedFocus: string,
  initialLayout?: LayoutNode,
  /**
   * Every tab that still exists, shown here or not. A write keeps stored
   * entries of tabs `ids` leaves out while they are in this list.
   */
  existing: readonly string[] = [],
) {
  const [store, setStore] = useState(loadStore);
  const storeRef = useRef(store);
  storeRef.current = store;
  const idsKey = ids.join("\0");
  // A + on the strip asked for its next new tab to stand on the strip.
  const stripNext = useRef(0);
  const newcomersOnStrip = () =>
    Date.now() - stripNext.current < STRIP_NEWCOMER_MS;
  const strip = useMemo(
    () =>
      resolveStrip(
        store,
        key,
        ids,
        requestedFocus,
        initialLayout,
        newcomersOnStrip(),
      ),
    // `ids` is compared by content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, key, idsKey, requestedFocus],
  );
  const stripRef = useRef(strip);
  stripRef.current = strip;
  const view = useMemo(() => stripView(strip), [strip]);
  const current = useRef({ key, ids, requestedFocus, initialLayout });
  current.current = { key, ids, requestedFocus, initialLayout };
  const existingRef = useRef(existing);
  existingRef.current = existing;

  /** Change one project's strip, resolved against the tabs it can see. */
  const mutate = useCallback(
    (
      target: string,
      update: (strip: WorkspaceStrip) => WorkspaceStrip,
      extraIds: readonly string[] = [],
    ) => {
      const onStrip = Date.now() - stripNext.current < STRIP_NEWCOMER_MS;
      setStore((all) => {
        const context = current.current;
        const here = target === context.key;
        const known = here
          ? context.ids
          : all.strips[target]
            ? recordedStripIds(all.strips[target])
            : (all.legacy[target]?.order ?? []);
        const seen = new Set([...known, ...extraIds]);
        const before = resolveStrip(
          all,
          target,
          [...seen],
          here ? context.requestedFocus : "",
          here ? context.initialLayout : undefined,
          here && onStrip,
        );
        const exists = new Set(existingRef.current);
        const next = keepUnseenStripEntries(
          all.strips[target],
          update(before),
          seen,
          (id) => exists.has(id),
        );
        if (JSON.stringify(next) === JSON.stringify(all.strips[target]))
          return all;
        return { ...all, strips: { ...all.strips, [target]: next } };
      });
    },
    [],
  );
  /** Edit the view in front; a split or a lone pane reshapes the strip. */
  const change = useCallback(
    (update: (view: WorkspaceView) => WorkspaceView) =>
      mutate(current.current.key, (strip) =>
        applyStripView(strip, update(stripView(strip))),
      ),
    [mutate],
  );
  /** Bring a tab to the front of a project, opening it there if new. */
  const focus = useCallback(
    (target: string, id: string) =>
      mutate(target, (strip) => focusStripTab(strip, id), [id]),
    [mutate],
  );
  /** Bring a tab of this project to the front: its entry, then the tab. */
  const select = useCallback(
    (id: string) =>
      mutate(current.current.key, (strip) => focusStripTab(strip, id), [id]),
    [mutate],
  );
  /** Replace the view in front of a project (closing, returning windows). */
  const restore = useCallback(
    (target: string, value: WorkspaceView) =>
      mutate(
        target,
        (strip) => applyStripView(strip, value),
        viewMembers(value),
      ),
    [mutate],
  );
  /** The view in front of any project. */
  const get = useCallback((target: string) => {
    const all = storeRef.current;
    const context = current.current;
    const here = target === context.key;
    const ids = here
      ? context.ids
      : all.strips[target]
        ? recordedStripIds(all.strips[target])
        : (all.legacy[target]?.order ?? []);
    return stripView(
      resolveStrip(all, target, ids, here ? context.requestedFocus : ""),
    );
  }, []);
  /** Put the strip's entries in this order (a drag along the strip). */
  const reorderEntries = useCallback(
    (keys: readonly string[]) =>
      mutate(current.current.key, (strip) => reorderStripEntries(strip, keys)),
    [mutate],
  );
  /** A tab dropped on a split's entry joins it as a pane at its right. */
  const addPane = useCallback(
    (spaceKey: string, id: string) =>
      mutate(current.current.key, (strip) => addStripPane(strip, spaceKey, id)),
    [mutate],
  );
  /**
   * Something let go on the middle of a single tab `target`: a tab (single,
   * or pulled out of a split) makes a new split with it in its place; a
   * split takes it as a pane at its right, standing in its place.
   */
  const combine = useCallback(
    (target: string, dragged: string) =>
      mutate(current.current.key, (strip) =>
        isSpaceKey(dragged)
          ? joinStripSplit(strip, dragged, target)
          : combineStripTabs(strip, target, dragged),
      ),
    [mutate],
  );
  /** A tab pulled out of its split stands on the strip before `before`. */
  const detach = useCallback(
    (id: string, before: string | null) =>
      mutate(current.current.key, (strip) => detachStripTab(strip, id, before)),
    [mutate],
  );
  /** A split's tabs stand on the strip as single tabs again. */
  const separate = useCallback(
    (spaceKey: string) =>
      mutate(current.current.key, (strip) =>
        separateStripSpace(strip, spaceKey),
      ),
    [mutate],
  );
  /**
   * Put back a layout snapshot in the entry it was taken in. False when
   * none of that entry's tabs is on the strip any more.
   */
  const undoLayout = useCallback(
    (snapshot: WorkspaceView, entry?: string) => {
      if (!undoStripLayout(stripRef.current, snapshot, entry)) return false;
      mutate(
        current.current.key,
        (strip) => undoStripLayout(strip, snapshot, entry) ?? strip,
      );
      return true;
    },
    [mutate],
  );
  /** The next new tab stands on the strip, even with a space in front. */
  const openOnStrip = useCallback(() => {
    stripNext.current = Date.now();
  }, []);
  /** The view in front with tabs from other entries brought into it. */
  const viewWith = useCallback(
    (ids: readonly string[]) => stripViewWith(stripRef.current, ids),
    [],
  );
  const requested = useRef({
    key,
    focus: requestedFocus,
    actual: view.focusedId,
  });
  useEffect(() => {
    const previous = requested.current;
    requested.current = { key, focus: requestedFocus, actual: view.focusedId };
    // Opening another workspace restores its own arrangement instead of
    // overwriting it with whichever session happened to be active before.
    // Explicit pane selection also wins over an older session/browser hint.
    // App mirrors actual focus into that hint; replaying both directions in
    // one commit would repeatedly swap focus between the two surfaces.
    if (
      previous.key === key &&
      previous.actual === view.focusedId &&
      previous.focus !== requestedFocus &&
      requestedFocus
    )
      mutate(key, (strip) => focusStripTab(strip, requestedFocus));
  }, [key, requestedFocus, view.focusedId, mutate]);
  // Write a project's strip the first time it opens (migrating it), and
  // whenever new tabs join it, so where they went holds steady.
  useEffect(() => {
    const stored = store.strips[key];
    const recorded = new Set(stored ? recordedStripIds(stored) : []);
    const fresh = strip.entries.some((entry) =>
      (entry.kind === "item" ? [entry.id] : viewMembers(entry.view)).some(
        (id) => !recorded.has(id),
      ),
    );
    if (!stored || fresh) {
      mutate(key, (resolved) => resolved);
      if (fresh) stripNext.current = 0;
    }
  }, [key, store, strip, mutate]);
  useEffect(() => {
    try {
      localStorage.setItem(
        WORKSPACE_SPACES_KEY,
        JSON.stringify({ version: 1, projects: store.strips }),
      );
      const legacy: Record<string, WorkspaceView> = { ...store.legacy };
      for (const [project, saved] of Object.entries(store.strips))
        legacy[project] = stripView(saved);
      localStorage.setItem(LEGACY_WORKSPACE_VIEWS_KEY, JSON.stringify(legacy));
    } catch {
      /* Keep the in-memory arrangement usable. */
    }
  }, [store]);
  return {
    view,
    strip,
    change,
    focus,
    select,
    restore,
    get,
    reorderEntries,
    addPane,
    combine,
    detach,
    separate,
    viewWith,
    openOnStrip,
    undoLayout,
  };
}
