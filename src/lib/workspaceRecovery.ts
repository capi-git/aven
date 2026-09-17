import { browserFavicon } from "./browserIcons";
import {
  editorTabKey,
  leaf,
  leafIds,
  replaceLeafId,
  type EditorPane,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import type { BrowserTab } from "./personalWorkspace";
import {
  parseWorkspaceSnapshot,
  type WorkspaceSessionStub,
} from "./workspaceSnapshot";
import {
  pruneViewLayout,
  resolveWorkspaceView,
  type WorkspaceView,
  type WorkspaceViewSnapshot,
} from "./workspaceViews";

export const WORKSPACE_RECOVERY_KEY = "covecode.workspaceRecovery.v1";
export const WORKSPACE_RECOVERY_LIMIT = 20;
const MAX_STORAGE_LENGTH = 1_000_000;

type ClosedBase = { cwd: string; closedAt: number };
export type ClosedWorkspaceEntry = ClosedBase &
  (
    | {
        kind: "tab";
        tab: WorkspaceTab;
        /** References/settings only. Drafts stay in the existing draft store. */
        sessionStubs?: WorkspaceSessionStub[];
      }
    | { kind: "browser"; browser: BrowserTab }
    | {
        kind: "file";
        tabId: string;
        paneId: string;
        file: FilePaneTab;
      }
  );
export type WorkspaceRecoveryState = {
  version: 1;
  /** Oldest first; each stack is independently bounded. */
  closed: ClosedWorkspaceEntry[];
  layouts: { cwd: string; view: WorkspaceViewSnapshot }[];
};

export function emptyWorkspaceRecovery(): WorkspaceRecoveryState {
  return { version: 1, closed: [], layouts: [] };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown, max = 8192): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}

/** Bound corrupted storage before passing it to the shared snapshot parser. */
function boundedCopy(value: unknown, depth = 0): unknown {
  if (depth > 22) throw new Error("Recovery metadata is too deep");
  if (typeof value === "string") {
    if (value.length > 16384) throw new Error("Recovery text is too long");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error("Too many recovery items");
    return value.map((item) => boundedCopy(item, depth + 1));
  }
  const object = record(value);
  if (object) {
    const entries = Object.entries(object).filter(
      ([, item]) => item !== undefined,
    );
    if (entries.length > 256) throw new Error("Too much recovery metadata");
    return Object.fromEntries(
      entries.map(([key, item]) => [key, boundedCopy(item, depth + 1)]),
    );
  }
  return value;
}

function fileMetadata(raw: unknown): unknown {
  const file = record(raw);
  if (!file) return null;
  // Never copy text buffers, foreground commands, or future runtime fields.
  const {
    id,
    path,
    cwd,
    plan,
    releaseNotes,
    review,
    changes,
    changeKind,
    sessionChanges,
    commit,
    terminal,
  } = file;
  return {
    id,
    path,
    cwd,
    plan,
    releaseNotes,
    review,
    changes,
    changeKind,
    sessionChanges,
    commit,
    terminal,
  };
}
function paneMetadata(raw: unknown): unknown {
  const pane = record(raw);
  if (!pane || !Array.isArray(pane.files) || pane.files.length > 256)
    return null;
  return {
    id: pane.id,
    activeFileId: pane.activeFileId,
    files: pane.files.map(fileMetadata),
  };
}
function stubMetadata(raw: unknown): unknown {
  const stub = record(raw);
  if (!stub || stub.inboxAsk) return null;
  const {
    id,
    cwd,
    harness,
    model,
    modelSettings,
    runtimeMode,
    title,
    providerSessionId,
    branch,
    worktreeCwd,
  } = stub;
  return {
    id,
    cwd,
    harness,
    model,
    modelSettings,
    runtimeMode,
    title,
    providerSessionId,
    branch,
    worktreeCwd,
  };
}
function cleanTab(raw: unknown, rawStubs: unknown = []) {
  const tab = record(raw);
  if (!tab || !text(tab.id, 200)) return null;
  const panes = (value: unknown) =>
    Array.isArray(value) && value.length <= 256 ? value.map(paneMetadata) : [];
  const { id, layout, focusedId, diffOpen, diffFocused, groupId } = tab;
  const snapshot = parseWorkspaceSnapshot(
    boundedCopy({
      tabs: [
        {
          kind: "session",
          id,
          layout,
          focusedId,
          diffOpen,
          diffFocused,
          groupId,
          editorPanes: panes(tab.editorPanes),
          terminalPanes: panes(tab.terminalPanes),
        },
      ],
      sessions:
        Array.isArray(rawStubs) && rawStubs.length <= 256
          ? rawStubs.map(stubMetadata)
          : [],
      activeTabId: id,
      projectCwd: "~",
    }),
  );
  if (!snapshot) return null;
  const clean = snapshot.tabs[0];
  const layoutIds = new Set(leafIds(clean.layout));
  const validLayout = pruneViewLayout(clean.layout, layoutIds);
  if (!validLayout) return null;
  clean.layout = validLayout;
  if (!layoutIds.has(clean.focusedId))
    clean.focusedId = leafIds(validLayout)[0];
  // Keep one metadata record per file in each pane, using the editor's identity.
  const dedupePane = (pane: EditorPane): EditorPane => {
    const seen = new Set<string>();
    const files = pane.files.filter((file) => {
      const key = `${file.cwd}\0${editorTabKey(file)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    };
  };
  clean.editorPanes = clean.editorPanes.map(dedupePane);
  clean.terminalPanes = clean.terminalPanes.map(dedupePane);
  const leaves = new Set(leafIds(clean.layout));
  const panesInTab = new Set(
    [...clean.editorPanes, ...clean.terminalPanes].map((p) => p.id),
  );
  const seen = new Set<string>();
  const sessionStubs = snapshot.sessions.filter((stub) => {
    if (!leaves.has(stub.id) || panesInTab.has(stub.id) || seen.has(stub.id))
      return false;
    seen.add(stub.id);
    return true;
  });
  return { tab: clean, sessionStubs };
}

function cleanEntry(raw: unknown): ClosedWorkspaceEntry | null {
  try {
    const entry = record(raw);
    if (
      !entry ||
      !text(entry.cwd) ||
      typeof entry.closedAt !== "number" ||
      !Number.isFinite(entry.closedAt) ||
      entry.closedAt < 0
    )
      return null;
    const base = { cwd: entry.cwd, closedAt: entry.closedAt };
    if (entry.kind === "tab") {
      const result = cleanTab(entry.tab, entry.sessionStubs);
      return result
        ? {
            ...base,
            kind: "tab",
            tab: result.tab,
            ...(result.sessionStubs.length
              ? { sessionStubs: result.sessionStubs }
              : {}),
          }
        : null;
    }
    if (entry.kind === "browser") {
      const browser = record(entry.browser);
      if (
        !browser ||
        !text(browser.id, 200) ||
        typeof browser.url !== "string" ||
        browser.url.length > 16384
      )
        return null;
      const favicon = browserFavicon(browser.favicon);
      return {
        ...base,
        kind: "browser",
        browser: {
          id: browser.id,
          url: browser.url,
          ...(text(browser.title, 2048) ? { title: browser.title } : {}),
          ...(favicon && favicon.length <= 16384 ? { favicon } : {}),
        },
      };
    }
    if (
      entry.kind === "file" &&
      text(entry.tabId, 200) &&
      text(entry.paneId, 200)
    ) {
      const file = record(entry.file);
      if (!file || file.terminal === true) return null;
      const parsed = cleanTab({
        id: "recovery-file",
        layout: leaf("recovery-pane"),
        focusedId: "recovery-pane",
        editorPanes: [
          { id: "recovery-pane", activeFileId: file.id, files: [file] },
        ],
        terminalPanes: [],
      });
      const clean = parsed?.tab.editorPanes[0]?.files[0];
      return clean
        ? {
            ...base,
            kind: "file",
            tabId: entry.tabId,
            paneId: entry.paneId,
            file: clean,
          }
        : null;
    }
    return null;
  } catch {
    return null;
  }
}
function entryKey(entry: ClosedWorkspaceEntry): string {
  const id =
    entry.kind === "tab"
      ? entry.tab.id
      : entry.kind === "browser"
        ? entry.browser.id
        : `${entry.tabId}\0${entry.file.cwd}\0${editorTabKey(entry.file)}`;
  return `${entry.cwd}\0${entry.kind}\0${id}`;
}
export function pushClosedWorkspaceEntry(
  state: WorkspaceRecoveryState,
  entry: ClosedWorkspaceEntry,
): WorkspaceRecoveryState {
  const clean = cleanEntry(entry);
  if (!clean) return state;
  const key = entryKey(clean);
  return {
    ...state,
    closed: [
      ...state.closed.filter((item) => entryKey(item) !== key),
      clean,
    ].slice(-WORKSPACE_RECOVERY_LIMIT),
  };
}
export function peekClosedWorkspaceEntry(
  state: WorkspaceRecoveryState,
  cwd: string,
): ClosedWorkspaceEntry | null {
  return [...state.closed].reverse().find((entry) => entry.cwd === cwd) ?? null;
}
export function popClosedWorkspaceEntry(
  state: WorkspaceRecoveryState,
  cwd: string,
): {
  state: WorkspaceRecoveryState;
  entry: ClosedWorkspaceEntry | null;
} {
  const entry = peekClosedWorkspaceEntry(state, cwd);
  if (!entry) return { state, entry: null };
  return {
    state: { ...state, closed: state.closed.filter((item) => item !== entry) },
    entry,
  };
}

function cleanView(raw: unknown): WorkspaceViewSnapshot | null {
  try {
    const value = record(raw);
    if (
      !value ||
      !Array.isArray(value.order) ||
      value.order.length > 256 ||
      !value.order.every((id) => text(id, 200))
    )
      return null;
    const copy = boundedCopy({
      layout: value.layout,
      focusedId: value.focusedId,
      order: value.order,
      groups: value.groups,
    }) as WorkspaceViewSnapshot;
    return resolveWorkspaceView(
      copy,
      copy.order,
      text(copy.focusedId, 200) ? copy.focusedId : "",
    );
  } catch {
    return null;
  }
}
export function pushWorkspaceLayoutUndo(
  state: WorkspaceRecoveryState,
  cwd: string,
  view: WorkspaceViewSnapshot,
): WorkspaceRecoveryState {
  if (!text(cwd)) return state;
  const clean = cleanView(view);
  if (!clean) return state;
  const previous = [...state.layouts]
    .reverse()
    .find((entry) => entry.cwd === cwd);
  if (previous && JSON.stringify(previous.view) === JSON.stringify(clean))
    return state;
  return {
    ...state,
    layouts: [...state.layouts, { cwd, view: clean }].slice(
      -WORKSPACE_RECOVERY_LIMIT,
    ),
  };
}
/** Undo arranges currently open tabs; closed tabs stay closed and newcomers survive. */
export function popWorkspaceLayoutUndo(
  state: WorkspaceRecoveryState,
  cwd: string,
  openIds: readonly string[],
  fallback: string,
): {
  state: WorkspaceRecoveryState;
  view: WorkspaceView | null;
} {
  const entry = [...state.layouts].reverse().find((entry) => entry.cwd === cwd);
  if (!entry) return { state, view: null };
  return {
    state: {
      ...state,
      layouts: state.layouts.filter((item) => item !== entry),
    },
    view: resolveWorkspaceView(entry.view, openIds, fallback),
  };
}

/** Retain session references, but reopening terminals always starts fresh shells. */
export function prepareRecoveredWorkspaceTab(
  tab: WorkspaceTab,
  makeId: () => string = () => crypto.randomUUID(),
): WorkspaceTab {
  const clean = cleanTab(tab)?.tab;
  if (!clean) throw new Error("Invalid recovered tab");
  const renewPane = (pane: EditorPane): EditorPane => {
    if (!pane.files.some((file) => file.terminal)) return pane;
    const id = makeId();
    clean.layout = replaceLeafId(clean.layout, pane.id, id);
    if (clean.focusedId === pane.id) clean.focusedId = id;
    const ids = new Map<string, string>();
    const files = pane.files.map((file) => {
      if (!file.terminal) return file;
      const fresh = makeId();
      ids.set(file.id, fresh);
      return { ...file, id: fresh };
    });
    return {
      id,
      files,
      activeFileId: ids.get(pane.activeFileId) ?? pane.activeFileId,
    };
  };
  clean.editorPanes = clean.editorPanes.map(renewPane);
  clean.terminalPanes = clean.terminalPanes.map(renewPane);
  return clean;
}

export function parseWorkspaceRecovery(raw: unknown): WorkspaceRecoveryState {
  const value = record(raw);
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.closed) ||
    !Array.isArray(value.layouts)
  )
    return emptyWorkspaceRecovery();
  let state = emptyWorkspaceRecovery();
  for (const entry of value.closed.slice(-WORKSPACE_RECOVERY_LIMIT)) {
    const clean = cleanEntry(entry);
    if (clean) state = pushClosedWorkspaceEntry(state, clean);
  }
  for (const entry of value.layouts.slice(-WORKSPACE_RECOVERY_LIMIT)) {
    const item = record(entry);
    const view = item && cleanView(item.view);
    if (item && text(item.cwd) && view)
      state = pushWorkspaceLayoutUndo(state, item.cwd, view);
  }
  return state;
}

type RecoveryStorage = Pick<Storage, "getItem" | "setItem">;
export function loadWorkspaceRecovery(
  storage?: RecoveryStorage,
  key = WORKSPACE_RECOVERY_KEY,
): WorkspaceRecoveryState {
  try {
    const raw = (storage ?? localStorage).getItem(key);
    return raw && raw.length <= MAX_STORAGE_LENGTH
      ? parseWorkspaceRecovery(JSON.parse(raw))
      : emptyWorkspaceRecovery();
  } catch {
    return emptyWorkspaceRecovery();
  }
}
export function saveWorkspaceRecovery(
  state: WorkspaceRecoveryState,
  storage?: RecoveryStorage,
  key = WORKSPACE_RECOVERY_KEY,
): boolean {
  try {
    const clean = parseWorkspaceRecovery(state);
    let raw = JSON.stringify(clean);
    // Retain the newest records when an unusually large layout fills storage.
    while (
      raw.length > MAX_STORAGE_LENGTH &&
      (clean.closed.length || clean.layouts.length)
    ) {
      if (clean.closed.length) clean.closed.shift();
      else clean.layouts.shift();
      raw = JSON.stringify(clean);
    }
    (storage ?? localStorage).setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
