/**
 * Restart to update without making the person work out what to close.
 *
 * Aven tidies what it can by itself: tabs moved to their own windows and
 * Picture in Picture come back, other workspace windows save and close, and
 * idle terminals close. Only real work — agents running or waiting for an
 * answer, queued messages, terminal commands and unsaved files — is listed for
 * the person to decide about. Every workspace window reports that work, so a
 * waiting restart hears about changes without polling.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { flushSync } from "react-dom";
import type { BrowserState } from "./browser";
import { applyBrowserUpdateStates } from "./browserUpdateState";
import { currentWorkspace, persistQuitState } from "./appLifecycle";
import type { LiveWorkspace } from "./appLifecycle";
import { flushComposerDrafts } from "./composerDrafts";
import { errorText } from "./errors";
import { isInFlightSession, markTurnInterrupted } from "./inFlight";
import { isFilesystemTab, type WorkspaceTab } from "./layout";
import { listenerGroup } from "./listenerGroup";
import { projectName } from "./paths";
import {
  sessionDisplayTitle,
  sessionNeedsInput,
  type Session,
} from "./session";
import { shouldPersistSession, upsertSession } from "./sessionStore";
import {
  hasRestartWork,
  mergeRestartWork,
  readWindowWork,
  type AgentWork,
  type FileWork,
  type RestartWork,
  type WindowWork,
} from "./updateRestartWork";
import { flushWorkspaceDrafts } from "./workspaceDraftFlush";

/** `unknown`: Aven cannot see what runs in this terminal (Windows). */
type NativeTerminal = {
  id: string;
  command?: string | null;
  unknown?: boolean;
};

/** A terminal that may be running something worth keeping. */
const mayBeBusy = (terminal: NativeTerminal) =>
  !!terminal.command || terminal.unknown === true;

type UpdateRestartPreparation = {
  browserStates: BrowserState[];
  terminals: NativeTerminal[];
};

type UpdateRestartActivity = {
  windows: { label: string; activity: unknown }[];
  terminals: NativeTerminal[];
};

/** A terminal's output can mean its command finished; look again this soon. */
const TERMINAL_RECHECK_MS = 1000;
/** How long stopped agents get to confirm they stopped. */
const STOP_SETTLE_MS = 10_000;

const changes = new Set<() => void>();
let reported = "";

function agentState(session: Session): AgentWork["state"] | null {
  if (isInFlightSession(session))
    return sessionNeedsInput(session) ? "waiting" : "working";
  if (session.queuedMessages?.length && session.queueStatus !== "paused")
    return "queued";
  return null;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function unsavedFiles(
  tabs: WorkspaceTab[],
  dirty: ReadonlySet<string>,
): FileWork[] {
  const files = new Map<string, FileWork>();
  for (const tab of tabs)
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])])
      for (const file of pane.files)
        if (dirty.has(file.id) && isFilesystemTab(file) && !files.has(file.id))
          files.set(file.id, {
            id: file.id,
            name: fileName(file.path),
            project: projectName(file.cwd),
          });
  return [...files.values()];
}

/** The work in this window a restart would interrupt. */
export function ownRestartWork(workspace: LiveWorkspace): WindowWork {
  const sessions = workspace.sessions();
  const states = new Map(
    sessions.map((session) => [session.id, agentState(session)]),
  );
  const agents = sessions.flatMap((session): AgentWork[] => {
    const state = states.get(session.id);
    if (!state) return [];
    // A team's workers are part of their lead's work.
    if (session.orchestrationLeadId && states.get(session.orchestrationLeadId))
      return [];
    return [
      {
        id: session.id,
        title: session.inboxAsk
          ? "Inbox question"
          : sessionDisplayTitle(session.title, session.harness),
        project: session.cwd === "~" ? "" : projectName(session.cwd),
        state,
      },
    ];
  });
  const dirty = workspace.dirtyFileIds();
  return {
    agents,
    files: dirty.size ? unsavedFiles(workspace.tabs(), dirty) : [],
  };
}

/**
 * Tell other windows, and a restart waiting in this one, when this window's
 * work changes. The workspace calls this after each change; it is cheap and
 * sends nothing when the summary is unchanged.
 */
export function reportWorkspaceActivity(): void {
  const workspace = currentWorkspace();
  if (!workspace) return;
  const own = ownRestartWork(workspace);
  const key = JSON.stringify(own);
  if (key === reported) return;
  reported = key;
  for (const change of changes) change();
  // Best effort: another window that misses it still refuses at restart.
  void Promise.resolve()
    .then(() => invoke("update_report_activity", { activity: own }))
    .catch(() => undefined);
}

/** Everything a restart would interrupt now, in every Aven window. */
export async function assessUpdateRestart(): Promise<RestartWork> {
  const workspace = currentWorkspace();
  workspace?.flush();
  const own = workspace ? ownRestartWork(workspace) : { agents: [], files: [] };
  let activity: UpdateRestartActivity = { windows: [], terminals: [] };
  try {
    activity =
      (await invoke<UpdateRestartActivity>("update_restart_activity")) ??
      activity;
  } catch {
    // The native checks during the restart still refuse work they find.
  }
  return mergeRestartWork(
    own,
    activity.windows.map((window) => readWindowWork(window.activity)),
    activity.terminals.flatMap((terminal) =>
      mayBeBusy(terminal)
        ? [{ id: terminal.id, command: terminal.command ?? "" }]
        : [],
    ),
  );
}

/**
 * Call `onChange` when the work might have changed: this window's agents or
 * files, another window's report, or output from a watched terminal (whose
 * command may have finished). No timer runs while nothing happens.
 */
export function watchUpdateRestartWork(
  onChange: () => void,
  watchesTerminal: (id: string) => boolean,
): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (delay = 0) => {
    if (disposed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed) onChange();
    }, delay);
  };
  const local = () => soon();
  changes.add(local);
  const group = listenerGroup([
    listen("update-activity-changed", () => soon()),
    listen<{ id: string }>("pty-exit", ({ payload }) => {
      if (watchesTerminal(payload.id)) soon();
    }),
    listen<{ id: string }>("pty-data", ({ payload }) => {
      if (watchesTerminal(payload.id)) soon(TERMINAL_RECHECK_MS);
    }),
  ]);
  void group.ready.catch(() => undefined);
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    changes.delete(local);
    group.dispose();
  };
}

function settled(done: () => boolean, timeoutMs: number): Promise<boolean> {
  if (done()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => {
      if (!done()) return;
      finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (result: boolean) => {
      clearTimeout(timer);
      changes.delete(check);
      resolve(result);
    };
    changes.add(check);
  });
}

/**
 * Stop this window's agents and queues the way the Stop button does, and wait
 * briefly for them to confirm. Terminal commands stop when Aven restarts.
 */
export async function stopUpdateRestartWork(
  timeoutMs = STOP_SETTLE_MS,
): Promise<void> {
  const workspace = currentWorkspace();
  if (!workspace) return;
  workspace.flush();
  const ids = workspace
    .sessions()
    .filter((session) => agentState(session) !== null)
    .map((session) => session.id);
  if (ids.length === 0) return;
  workspace.stopSessions(ids);
  await settled(
    () => !workspace.sessions().some((session) => agentState(session) !== null),
    timeoutMs,
  );
}

export type UpdateRestartOptions = {
  /** The person chose to stop running work and restart now. */
  stopWork?: boolean;
  /** Plain labels of native work the restart is waiting for. */
  onWaiting?: (labels: string[]) => void;
};

function ownWorkRemains(workspace: LiveWorkspace): boolean {
  workspace.flush();
  return hasRestartWork({ ...ownRestartWork(workspace), terminals: [] });
}

async function listenForWaiting(
  onWaiting: UpdateRestartOptions["onWaiting"],
): Promise<() => void> {
  if (!onWaiting) return () => {};
  try {
    return await getCurrentWebview().listen<string[]>(
      "update-restart-waiting",
      ({ payload }) => onWaiting(Array.isArray(payload) ? payload : []),
    );
  } catch {
    return () => {};
  }
}

/**
 * Save the workspace and let Aven tidy up for the restart. Resolves true when
 * Aven is ready to install, and false when real work started meanwhile; then
 * the restart steps aside, nothing running was stopped, and the person
 * decides again. Throws when saving or a native check fails.
 */
export async function prepareUpdateRestart(
  options: UpdateRestartOptions = {},
): Promise<boolean> {
  const stopWork = options.stopWork === true;
  const workspace = currentWorkspace();
  if (!workspace)
    throw new Error("Wait for Aven to finish opening before restarting.");
  if (!stopWork && ownWorkRemains(workspace)) return false;
  // Bring back tabs moved to their own windows while their terminals and
  // pages can still reattach; the restart refuses new native work.
  await flushWorkspaceDrafts();
  if (!stopWork && ownWorkRemains(workspace)) return false;
  const stopListening = await listenForWaiting(options.onWaiting);
  let preparation: UpdateRestartPreparation;
  try {
    preparation = await invoke<UpdateRestartPreparation>(
      "prepare_update_restart",
      { stopWork },
    );
  } finally {
    stopListening();
  }
  const abandon = async () => {
    await invoke("cancel_update_restart").catch(() => undefined);
    return false;
  };
  try {
    const { browserStates, terminals } = preparation;
    // Idle shells close without asking; a running command is real work.
    if (!stopWork && terminals.some(mayBeBusy)) return await abandon();
    flushSync(() => applyBrowserUpdateStates(browserStates));
    await flushWorkspaceDrafts();
    if (currentWorkspace() !== workspace)
      throw new Error("Your workspace changed. Try restarting again.");
    if (!stopWork && ownWorkRemains(workspace)) return await abandon();
    await persistQuitState(
      workspace.sessions(),
      workspace.tabs(),
      workspace.activeTabId(),
      workspace.projectCwd(),
      "update",
      workspace.projectTerminals(),
    );
    if (!stopWork && ownWorkRemains(workspace)) return await abandon();
    workspace.saveBrowserState();
    await invoke("finish_update_restart_preparation", {
      closeTerminals: true,
    });
    return true;
  } catch (error) {
    await invoke("cancel_update_restart").catch(() => undefined);
    throw error;
  }
}

/**
 * Another window is restarting to update: save this window's conversations
 * and drafts so it can be closed. Without `stopWork`, work that started since
 * the person decided keeps the window open and stops the restart.
 */
export async function saveWindowForUpdate(stopWork: boolean): Promise<void> {
  const refuse = (reason: string) =>
    invoke("update_restart_window_refused", { reason }).catch(() => undefined);
  const workspace = currentWorkspace();
  if (!workspace) {
    await refuse(
      "Another Aven window is still opening. Try restarting again in a moment. The update will stay downloaded and ready.",
    );
    return;
  }
  try {
    workspace.flush();
    if (!stopWork && ownWorkRemains(workspace)) {
      await refuse(
        "Work started in another Aven window. Restart to update again to choose what to do with it. The update will stay downloaded and ready.",
      );
      return;
    }
    await flushWorkspaceDrafts();
    workspace.flush();
    flushComposerDrafts();
    await Promise.all(
      workspace
        .sessions()
        .filter(shouldPersistSession)
        .map((session) =>
          upsertSession(
            isInFlightSession(session) ? markTurnInterrupted(session) : session,
          ),
        ),
    );
    await invoke("update_restart_window_saved");
  } catch (error) {
    await refuse(
      `Another Aven window couldn't save its work. ${errorText(error)} The update will stay downloaded and ready.`,
    );
  }
}

/** Answer restart requests from another window. Returns a cleanup. */
export function listenForUpdateWindowClose(): () => void {
  const group = listenerGroup([
    getCurrentWebview().listen<{ stopWork?: boolean }>(
      "update-restart-close-window",
      ({ payload }) => void saveWindowForUpdate(payload?.stopWork === true),
    ),
  ]);
  void group.ready.catch(() => undefined);
  return group.dispose;
}
