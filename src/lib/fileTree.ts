import { listDir, type FsEntry } from "./fs";
import { pathSegments } from "./fileName";
import { joinPath, parentPath } from "./paths";
import { afterSidePanelOpens, SIDE_PANEL_FRESH_MS } from "./sidePanel";

const expandedByProject = new Map<string, Set<string>>();
const selectedByProject = new Map<string, string | null>();
const dirs = new Map<string, FsEntry[]>();
const listeners = new Set<() => void>();
/** Open explorers, each with the folder it shows when it names one. */
const refreshSubscribers = new Map<() => void, string | undefined>();
let cacheEpoch = 0;

const REFRESH_MS = 150;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshAgain = false;
/**
 * A closed explorer keeps its folders, so opening it again draws them at
 * once. When the last one closed (null while one is open), and whether a
 * change was reported since that nobody re-read.
 */
let closedAt: number | null = null;
let changedWhileClosed = false;
let cancelReopenCheck: (() => void) | null = null;

export function loadExpanded(cwd: string): Set<string> {
  const saved = expandedByProject.get(cwd);
  return saved ? new Set(saved) : new Set([cwd]);
}

export function saveExpanded(cwd: string, expanded: Set<string>) {
  expandedByProject.set(cwd, new Set(expanded));
}

export function loadSelected(cwd: string): string | null {
  return selectedByProject.get(cwd) ?? null;
}

export function saveSelected(cwd: string, path: string | null) {
  selectedByProject.set(cwd, path);
}

/** Cached `listDir` — same path stays instant when the tree remounts. */
export function peekDir(path: string): FsEntry[] | null {
  return dirs.get(path) ?? null;
}

export function listCachedDir(path: string): Promise<FsEntry[]> {
  const hit = dirs.get(path);
  if (hit) return Promise.resolve(hit);
  const epoch = cacheEpoch;
  return listDir(path).then((entries) => {
    if (epoch === cacheEpoch) dirs.set(path, entries);
    return entries;
  });
}

export function refreshDir(path: string): Promise<FsEntry[]> {
  dirs.delete(path);
  return listCachedDir(path);
}

export function forgetDir(path: string) {
  for (const key of [...dirs.keys()]) {
    if (key === path || key.startsWith(`${path}/`)) dirs.delete(key);
  }
}

/** Re-list every cached folder. Agent writes and window focus use this. */
export async function refreshCachedDirs(): Promise<void> {
  const paths = [...dirs.keys()];
  if (paths.length === 0) return;
  await Promise.all(
    paths.map((path) =>
      refreshDir(path).catch(() => {
        forgetDir(path);
      }),
    ),
  );
}

export function subscribeDirsChanged(
  listener: () => void,
  {
    refreshCache = true,
    root,
  }: {
    refreshCache?: boolean;
    /**
     * The folder an explorer shows. Folders kept from other projects are
     * then let go on its next refresh rather than read again.
     */
    root?: string;
  } = {},
): () => void {
  listeners.add(listener);
  if (refreshCache) {
    refreshSubscribers.set(listener, root);
    if (refreshSubscribers.size === 1) explorerOpened();
  }
  return () => {
    listeners.delete(listener);
    const removedExplorer = refreshSubscribers.delete(listener);
    if (removedExplorer && refreshSubscribers.size === 0) {
      const hadPendingChange = refreshTimer !== null;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshAgain = false;
      closedAt = Date.now();
      // A check still waiting for the panel's slide is owed next time.
      if (cancelReopenCheck) {
        cancelReopenCheck();
        cancelReopenCheck = null;
        changedWhileClosed = true;
      }
      if (hadPendingChange) {
        changedWhileClosed = true;
        for (const subscriber of listeners) subscriber();
      }
    }
  };
}

/**
 * The first explorer opened. Its folders show as they were; if they may
 * have changed while it was closed (a change was reported, or it was closed
 * a while: changes made outside Aven are only seen by reading), the open
 * folders are read again once the side panel has slid in.
 */
function explorerOpened() {
  const changed =
    changedWhileClosed ||
    (closedAt !== null && Date.now() - closedAt >= SIDE_PANEL_FRESH_MS);
  closedAt = null;
  changedWhileClosed = false;
  if (!changed || dirs.size === 0) return;
  cancelReopenCheck = afterSidePanelOpens(() => {
    cancelReopenCheck = null;
    if (refreshSubscribers.size > 0) invalidateAndNotify();
  });
}

function canRefresh() {
  return (
    refreshSubscribers.size > 0 &&
    (typeof document === "undefined" || !document.hidden)
  );
}

function invalidateCachedDirs() {
  // Drop stale snapshots synchronously so the next list request cannot
  // reuse pre-write directory contents. Open rows keep what they show until
  // their folder's new listing arrives.
  cacheEpoch += 1;
  dirs.clear();
  refreshAgain = false;
}

function invalidateAndNotify() {
  invalidateCachedDirs();
  for (const listener of listeners) listener();
}

/**
 * A change nobody can re-read now. With no explorer open, its folders are
 * kept and read again when one opens; a hidden window drops them.
 */
function changeUnread() {
  if (refreshSubscribers.size > 0) {
    invalidateAndNotify();
    return;
  }
  changedWhileClosed = true;
  for (const listener of listeners) listener();
}

/** Reload the explorer cache after an agent/shell write (debounced). */
export function notifyDirsChanged() {
  if (!canRefresh()) {
    changeUnread();
    return;
  }
  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void runRefresh();
  }, REFRESH_MS);
}

async function runRefresh() {
  if (!canRefresh()) {
    changeUnread();
    return;
  }
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    forgetDirsOutsideExplorers();
    await refreshCachedDirs();
    for (const listener of listeners) listener();
  } finally {
    refreshing = false;
    const pending = refreshAgain;
    refreshAgain = false;
    if (pending && canRefresh()) scheduleRefresh();
  }
}

/**
 * Kept folders outside every open explorer's own folder are dropped, not
 * read again: a closed panel keeps its folders, so they would otherwise
 * pile up across projects and each be re-read on every refresh.
 */
function forgetDirsOutsideExplorers() {
  const roots = [...refreshSubscribers.values()];
  if (!roots.length || roots.some((root) => root === undefined)) return;
  for (const path of [...dirs.keys()]) {
    const shown = roots.some(
      (root) => path === root || path.startsWith(`${root}/`),
    );
    if (!shown) dirs.delete(path);
  }
}

/** Only for tests: forget every folder and what happened while closed. */
export function resetFileTreeForTest() {
  cancelReopenCheck?.();
  cancelReopenCheck = null;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
  closedAt = null;
  changedWhileClosed = false;
  invalidateCachedDirs();
  listeners.clear();
  refreshSubscribers.clear();
}

/** Folder to create into, given the explorer selection. */
export function createParentOf(
  cwd: string,
  selectedPath: string | null,
): string {
  if (!selectedPath || selectedPath === cwd) return cwd;
  const parent = parentPath(selectedPath);
  const entry = peekDir(parent)?.find((e) => e.path === selectedPath);
  if (entry?.isDir) return selectedPath;
  if (entry && !entry.isDir) return parent;
  if (peekDir(selectedPath)) return selectedPath;
  return parent;
}

/** Directories whose children change when creating `name` under `parent`. */
export function dirsTouchedByCreate(parent: string, name: string): string[] {
  const segments = pathSegments(name);
  const out = [parent];
  let cur = parent;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = joinPath(cur, segments[i]);
    out.push(cur);
  }
  return out;
}

export function dirsTouchedByMove(from: string, to: string): string[] {
  const fromParent = parentPath(from);
  const toParent = parentPath(to);
  return fromParent === toParent ? [fromParent] : [fromParent, toParent];
}
