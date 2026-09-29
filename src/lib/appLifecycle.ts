import { invoke } from "@tauri-apps/api/core";
import { flushSync } from "react-dom";
import type { BrowserState } from "./browser";
import { applyBrowserUpdateStates } from "./browserUpdateState";
import { flushWorkspaceDrafts } from "./workspaceDraftFlush";
import { ask, message } from "@tauri-apps/plugin-dialog";
import {
  bindHarnessSession,
  forgetHarnessSession,
  isLiveHarness,
  killAllChildren,
} from "./harness";
import {
  hasInFlightSessions,
  inFlightRefs,
  markTurnInterrupted,
  quitWhileBusyMessage,
  wasTurnInterrupted,
  workspaceFromResumed,
  type ResumedWorkspace,
} from "./inFlight";
import { leafIds, type WorkspaceTab } from "./layout";
import { killPty } from "./pty";
import {
  projectTerminalFileIds,
  type ProjectTerminalDock,
} from "./projectTerminal";
import { sessionWorkCwd, type Session } from "./session";
import { restoreSessionCheckout } from "./fs";
import { sessionChildHarnesses } from "./handoff";
import {
  getSession,
  listInFlightSessions,
  listSessionsByProject,
  loadWorkspaceSnapshot,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
  persistedMetadataKey,
} from "./sessionStore";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";
import { loadWindowTransfer } from "./windowTransferBootstrap";
import { registerBuiltinHarnesses } from "./harness/register";
import type { WindowTransferPayload } from "./windowTransfer";
import {
  lastProjectPath,
  normalizeProjectPath,
  sameProjectPath,
} from "./recents";

export type { ResumedWorkspace };
export { hasInFlightSessions };

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
  /** Sidebar rows listed before first paint, so the rail is not empty. */
  history: SessionSummary[];
  historyCwd: string | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let quitDialogOpen = false;
let quitSaveFailureOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  flush: () => void;
  saveBrowserState: () => void;
} | null = null;

export function isAppQuitting(): boolean {
  return quitting;
}

export function setQuitWorkspace(
  sessions: () => Session[],
  tabs: () => WorkspaceTab[],
  activeTabId: () => string,
  projectCwd: () => string,
  projectTerminals: () => ProjectTerminalDock[],
  flush: () => void,
  saveBrowserState: () => void = () => {},
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    flush,
    saveBrowserState,
  };
  bootingResumed = null;
  return () => {
    if (liveWorkspace?.sessions === sessions) liveWorkspace = null;
  };
}

type UpdateRestartPreparation = {
  browserStates: BrowserState[];
  openTerminals: number;
};

/** Save the workspace before installing; false means the user cancelled. */
export async function prepareUpdateRestart(): Promise<boolean> {
  const workspace = liveWorkspace;
  if (!workspace)
    throw new Error("Wait for Aven to finish opening before restarting.");
  workspace.flush();
  if (hasInFlightSessions(workspace.sessions())) {
    throw new Error(
      "Your tasks are still working or waiting for input. Finish them before restarting to update.",
    );
  }
  const preparation = await invoke<UpdateRestartPreparation>(
    "prepare_update_restart",
  );
  try {
    const { browserStates, openTerminals } = preparation;
    flushSync(() => applyBrowserUpdateStates(browserStates));
    let closeTerminals = false;
    if (openTerminals > 0) {
      closeTerminals = await ask(
        `Restarting will close ${openTerminals === 1 ? "your open terminal" : `your ${openTerminals} open terminals`} and stop any commands running in them. Terminal tabs will reopen with fresh shells; terminal output and unfinished input will not be restored.\n\nContinue restarting to update?`,
        {
          title: "Close terminals and restart?",
          kind: "warning",
          okLabel: "Close terminals and restart",
          cancelLabel: "Keep working",
        },
      );
      if (!closeTerminals) {
        await invoke("cancel_update_restart");
        return false;
      }
    }
    await flushWorkspaceDrafts();
    workspace.flush();
    if (
      liveWorkspace !== workspace ||
      hasInFlightSessions(workspace.sessions())
    ) {
      throw new Error(
        "Your workspace changed. Finish any running tasks and try restarting again.",
      );
    }
    await persistQuitState(
      workspace.sessions(),
      workspace.tabs(),
      workspace.activeTabId(),
      workspace.projectCwd(),
      "update",
      workspace.projectTerminals(),
    );
    if (hasInFlightSessions(workspace.sessions())) {
      throw new Error("A task started. Finish it before restarting to update.");
    }
    workspace.saveBrowserState();
    await invoke("finish_update_restart_preparation", { closeTerminals });
    return true;
  } catch (error) {
    await invoke("cancel_update_restart").catch(() => undefined);
    throw error;
  }
}

export async function handleQuitRequested(): Promise<void> {
  if (liveWorkspace) {
    liveWorkspace.flush();
    await confirmQuitAndExit(
      liveWorkspace.sessions(),
      liveWorkspace.tabs(),
      liveWorkspace.activeTabId(),
      liveWorkspace.projectCwd(),
      liveWorkspace.projectTerminals(),
    );
    return;
  }
  let resumed: ResumedWorkspace | null;
  try {
    ({ resumed } = await loadBootWorkspace());
  } catch {
    // Startup failed before an editable workspace mounted. Nothing in memory
    // may replace the unread saved data; quitting here needs no save attempt.
    await invoke("confirm_quit");
    return;
  }
  const pending = resumed ?? bootingResumed;
  if (pending) {
    quitting = true;
    try {
      await persistBootingResume(pending);
      await invoke("confirm_quit");
    } catch (error) {
      quitting = false;
      await showQuitSaveFailure(error);
    }
    return;
  }
  await invoke("confirm_quit");
}

/** Save an explicit window close, confirming active work when necessary. */
export async function closeBusyWindow(): Promise<void> {
  if (!liveWorkspace) return;
  liveWorkspace.flush();
  await confirmQuitAndExit(
    liveWorkspace.sessions(),
    liveWorkspace.tabs(),
    liveWorkspace.activeTabId(),
    liveWorkspace.projectCwd(),
    liveWorkspace.projectTerminals(),
    true,
  );
}

export function loadResumedWorkspace(): Promise<ResumedWorkspace | null> {
  if (!resumedPromise) {
    resumedPromise = loadResumedWorkspaceOnce().catch((error) => {
      resumedPromise = null;
      throw error;
    });
  }
  return resumedPromise;
}

/** Transfer and restore run once; callers share the same promise. */
export function loadBootWorkspace(): Promise<BootWorkspace> {
  if (!bootPromise) {
    bootPromise = (async () => {
      // Startup reads the workspace while the interface bundle still loads,
      // so providers must be known before sessions are restored.
      registerBuiltinHarnesses();
      const hintedCwd = lastProjectPath();
      const historyHint = listProjectHistory(hintedCwd);
      const windowTransfer = await loadWindowTransfer();
      if (windowTransfer) {
        const listed = await historyForCwd(
          windowTransfer.projectCwd,
          hintedCwd,
          historyHint,
        );
        return {
          windowTransfer,
          resumed: null,
          history: listed?.rows ?? [],
          historyCwd: listed?.cwd ?? null,
        };
      }
      const [resumed, hinted] = await Promise.all([
        loadResumedWorkspace(),
        historyHint,
      ]);
      const listed = await historyForCwd(
        resumed?.projectCwd ?? hintedCwd,
        hintedCwd,
        Promise.resolve(hinted),
      );
      return {
        windowTransfer: null,
        resumed,
        history: listed?.rows ?? [],
        historyCwd: listed?.cwd ?? null,
      };
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

async function listProjectHistory(
  cwd: string | null | undefined,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  try {
    const rows = await listSessionsByProject(cwd);
    return { cwd: normalizeProjectPath(cwd), rows };
  } catch {
    return null;
  }
}

async function historyForCwd(
  cwd: string | null | undefined,
  hintedCwd: string | null | undefined,
  hinted: Promise<{ cwd: string; rows: SessionSummary[] } | null>,
): Promise<{ cwd: string; rows: SessionSummary[] } | null> {
  if (!cwd || cwd === "~") return null;
  if (hintedCwd && sameProjectPath(cwd, hintedCwd)) return hinted;
  return listProjectHistory(cwd);
}

async function loadResumedWorkspaceOnce(): Promise<ResumedWorkspace | null> {
  const [snapshotRaw, refs] = await Promise.all([
    loadWorkspaceSnapshot().catch((error) => {
      throw workspaceReadFailure("workspace layout", error);
    }),
    listInFlightSessions().catch((error) => {
      throw workspaceReadFailure("unfinished tasks", error);
    }),
  ]);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);

  const ids = new Set<string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) ids.add(stub.id);
    for (const tab of snapshot.tabs) {
      const nonSessionPanes = new Set(
        [...tab.editorPanes, ...(tab.terminalPanes ?? [])].map((pane) => pane.id),
      );
      for (const id of leafIds(tab.layout)) {
        if (!nonSessionPanes.has(id)) ids.add(id);
      }
    }
  }
  for (const ref of refs) ids.add(ref.sessionId);

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      // Only a successful null result means this was a blank, unsaved tab.
      // A failed read must reach the startup recovery screen before hydration
      // creates an editable session with the original transcript's identity.
      const record = await getSession(id).catch((error) => {
        throw workspaceReadFailure(`conversation ${id}`, error);
      });
      if (record) loaded.set(id, record);
    }),
  );

  let workspace = snapshot
    ? hydrateWorkspaceSnapshot(snapshot, loaded, interrupted)
    : null;
  if (!workspace && refs.length > 0) {
    const sessions: Session[] = [];
    for (const ref of refs) {
      const record = loaded.get(ref.sessionId);
      if (!record) continue;
      sessions.push(markTurnInterrupted(record));
    }
    workspace = workspaceFromResumed(sessions);
  }

  if (workspace) {
    workspace = {
      ...workspace,
      sessions: await Promise.all(
        workspace.sessions.map((session) => restoreSessionCheckout(session)),
      ),
    };
  }

  bootingResumed = workspace;
  if (workspace) {
    // Rewriting every restored transcript at startup sent megabytes back to
    // the store before the first paint. Save only what restoring changed:
    // new sessions, interrupted turns, and moved checkouts or queues.
    await Promise.all(
      workspace.sessions
        .filter(shouldPersistSession)
        .filter((session) => {
          const record = loaded.get(session.id);
          return (
            !record ||
            interrupted.has(session.id) ||
            persistedMetadataKey(session) !== persistedMetadataKey(record)
          );
        })
        .map((session) => upsertSession(session).catch(() => null)),
    );
  }
  return workspace;
}

function workspaceReadFailure(subject: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Aven couldn't read your saved ${subject}. Reload the interface to try again. Your saved conversations have not been replaced.\n\n${detail}`,
  );
}

async function showQuitSaveFailure(
  error: unknown,
  closeWindow = false,
): Promise<void> {
  if (quitSaveFailureOpen) return;
  quitSaveFailureOpen = true;
  const detail = error instanceof Error ? error.message : String(error);
  try {
    await message(
      `Aven couldn't save your workspace. This window will stay open so you can retry.\n\n${detail}`,
      {
        title: closeWindow ? "Could not close window" : "Could not quit Aven",
        kind: "error",
      },
    ).catch(() => undefined);
  } finally {
    quitSaveFailureOpen = false;
  }
}

export function bindResumedSessions(sessions: Session[]): void {
  for (const session of sessions) {
    if (!session.providerSessionId || !isLiveHarness(session.harness)) continue;
    bindHarnessSession(
      session.harness,
      session.id,
      session.providerSessionId,
      sessionWorkCwd(session),
    );
  }
}

export async function hideCurrentWindow(): Promise<void> {
  await invoke("hide_window");
}

export async function closeCurrentWindow(): Promise<void> {
  await invoke("destroy_window");
}

export async function persistLiveTranscripts(
  sessions: Session[],
): Promise<void> {
  await Promise.all(
    sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session).catch(() => null)),
  );
}

export async function persistQuitState(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  mode: "quit" | "unload" | "update" = "quit",
  projectTerminals: ProjectTerminalDock[] = [],
): Promise<void> {
  if (mode !== "unload") {
    const workspace = liveWorkspace;
    await flushWorkspaceDrafts();
    // Returning detached windows can replace the owner's immutable arrays.
    // Capture them after the return handshake, not from the pre-flush arguments.
    if (workspace && liveWorkspace === workspace) {
      workspace.flush();
      sessions = workspace.sessions();
      tabs = workspace.tabs();
      activeTabId = workspace.activeTabId();
      projectCwd = workspace.projectCwd();
      projectTerminals = workspace.projectTerminals();
    }
  }
  const refs = inFlightRefs(sessions, tabs);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  await Promise.all(
    sessions.map(async (session) => {
      if (!shouldPersistSession(session)) return;
      const payload = interrupted.has(session.id)
        ? markTurnInterrupted(session)
        : session;
      await upsertSession(payload).catch((error) => {
        if (mode !== "unload") throw error;
        return null;
      });
    }),
  );
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      projectTerminals,
    ),
  ).catch((error) => {
    if (mode !== "unload") throw error;
  });
  // Vite/webview reload must not wipe a restored snapshot: those chats are idle
  // in this process until Continue runs.
  if (mode !== "unload" || refs.length > 0) {
    await replaceInFlightSessions(refs).catch((error) => {
      if (mode !== "unload") throw error;
    });
  }
}

async function persistBootingResume(
  workspace: ResumedWorkspace,
): Promise<void> {
  await Promise.all(
    workspace.sessions
      .filter(shouldPersistSession)
      .map((session) => upsertSession(session)),
  );
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectTerminals ?? [],
    ),
  );
  await replaceInFlightSessions(
    workspace.sessions.filter(wasTurnInterrupted).map((session) => ({
      sessionId: session.id,
      cwd: session.cwd,
    })),
  );
}

async function confirmQuitAndExit(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  projectTerminals: ProjectTerminalDock[] = [],
  closeWindow = false,
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) {
      const ok = await ask(
        closeWindow
          ? "Close this window and stop its running chats? Other windows will stay open."
          : quitWhileBusyMessage(refs.length),
        {
          title: "Aven",
          kind: "warning",
          okLabel: closeWindow ? "Close window" : "Quit",
        },
      );
      if (!ok) return;
    }
    quitting = true;
    try {
      await persistQuitState(
        sessions,
        tabs,
        activeTabId,
        projectCwd,
        "quit",
        projectTerminals,
      );
      if (closeWindow) {
        await reapWindowRuntime(sessions, tabs, projectTerminals, false);
        await closeCurrentWindow();
      } else {
        await invoke("confirm_quit");
      }
    } catch (error) {
      quitting = false;
      await showQuitSaveFailure(error, closeWindow);
    }
  } finally {
    quitDialogOpen = false;
  }
}

export async function reapWindowRuntime(
  sessions: Session[],
  tabs: WorkspaceTab[],
  projectTerminals: ProjectTerminalDock[] = [],
  includeAllChildren = true,
): Promise<void> {
  await Promise.all(
    sessions.map((session) =>
      Promise.all(
        sessionChildHarnesses(session).map((harness) =>
          forgetHarnessSession(harness, session.id),
        ),
      ),
    ),
  );
  await Promise.all(
    [...terminalFileIds(tabs), ...projectTerminalFileIds(projectTerminals)].map(
      (id) => killPty(id),
    ),
  );
  // Catalog probes, title generators, and usage scrapers are not session
  // children. Drop them so an unused Pi/Codex probe cannot outlive the window.
  if (includeAllChildren) await killAllChildren().catch(() => undefined);
}

function terminalFileIds(tabs: WorkspaceTab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.terminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
