import { isDiskFileTab, type WorkspaceTab } from "./layout";
import { pathKey } from "./paths";

/**
 * Files `@` knows besides the project listing: the files open in this
 * window's tabs, which the picker offers first, and files mentioned from them
 * this run, so a mention still reaches the agent after its tab closes.
 */
export type OpenFilesSnapshot = {
  /** Open in a tab now, the active tab's first. */
  open: readonly string[];
  /** Open files, then earlier mentions: every path an `@` label resolves to. */
  known: readonly string[];
};

const MAX_REMEMBERED = 100;
export const NO_OPEN_FILES: OpenFilesSnapshot = { open: [], known: [] };

let open: readonly string[] = [];
/** Path key → path, oldest first. */
const remembered = new Map<string, string>();
let snapshot = NO_OPEN_FILES;
const listeners = new Set<() => void>();

function publish() {
  const seen = new Set<string>();
  const known: string[] = [];
  for (const path of [...open, ...[...remembered.values()].reverse()]) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    known.push(path);
  }
  snapshot =
    open.length === 0 && known.length === 0 ? NO_OPEN_FILES : { open, known };
  for (const listener of listeners) listener();
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path.trim()) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

/** Called by the window as its tabs change. */
export function setOpenFiles(paths: readonly string[]): void {
  const next = uniquePaths(paths);
  if (next.length === open.length && next.every((path, i) => path === open[i]))
    return;
  open = next;
  publish();
}

/** Keep `path` resolvable for `@` after its tab closes. */
export function rememberMentionedFile(path: string): void {
  if (!path.trim()) return;
  const key = pathKey(path);
  if (remembered.has(key)) return;
  remembered.set(key, path);
  for (const oldest of remembered.keys()) {
    if (remembered.size <= MAX_REMEMBERED) break;
    remembered.delete(oldest);
  }
  publish();
}

export function openFilesSnapshot(): OpenFilesSnapshot {
  return snapshot;
}

export function subscribeOpenFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetOpenFiles(): void {
  open = [];
  remembered.clear();
  publish();
}

/**
 * Files on disk open in `tabs`: the active tab's first, and in each tab the
 * file each pane shows before the rest.
 */
export function filesOpenInTabs(
  tabs: readonly WorkspaceTab[],
  activeTabId?: string,
): string[] {
  const ordered = [
    ...tabs.filter((tab) => tab.id === activeTabId),
    ...tabs.filter((tab) => tab.id !== activeTabId),
  ];
  const paths: string[] = [];
  for (const tab of ordered) {
    const shown = tab.editorPanes.map((pane) =>
      pane.files.find((file) => file.id === pane.activeFileId),
    );
    for (const file of [
      ...shown,
      ...tab.editorPanes.flatMap((pane) => pane.files),
    ]) {
      if (file && isDiskFileTab(file)) paths.push(file.path);
    }
  }
  return uniquePaths(paths);
}
