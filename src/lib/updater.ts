import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { prepareUpdateRestart } from "./appLifecycle";
import { lockUpdateInput } from "./updateInputLock";
import { announceUpdateAvailable } from "./sounds";
import { rememberInstalledUpdate } from "./updateNotice";
import { IS_PERSONAL_BUILD, PERSONAL_UPDATE_MESSAGE } from "./personalBuild";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";
export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
};

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const UPDATE_FOCUS_THROTTLE_MS = 15 * 60 * 1000;
let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
const listeners = new Set<() => void>();
let pendingUpdate: Update | null = null;
let downloaded = false;
let pendingInstalled = false;
let checking: Promise<UpdaterSnapshot> | null = null;
let installing: Promise<UpdaterSnapshot> | null = null;
let lastAutomaticCheck = -Infinity;

export function getUpdaterSnapshot(): UpdaterSnapshot {
  return snapshot;
}
export function subscribeUpdater(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: UpdaterSnapshot): UpdaterSnapshot {
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}
export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Download verifies the signed archive in the native plugin; never installs. */
async function checkAndDownload(): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  if (IS_PERSONAL_BUILD) return publish({ phase: "idle", currentVersion });
  if (pendingUpdate && downloaded) return snapshot;
  publish({ phase: "checking", currentVersion });
  try {
    const update = pendingUpdate ?? (await check({ timeout: 30_000 }));
    if (!update) return publish({ phase: "current", currentVersion });
    pendingUpdate = update;
    publish({
      phase: "available",
      currentVersion,
      availableVersion: update.version,
    });
    let received = 0;
    let length = 0;
    publish({
      phase: "downloading",
      currentVersion,
      availableVersion: update.version,
      progress: 0,
    });
    await update.download(
      (event: DownloadEvent) => {
        if (event.event === "Started") {
          length = event.data.contentLength ?? 0;
          received = 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
        }
        const progress =
          length > 0
            ? Math.min(100, Math.round((received / length) * 100))
            : undefined;
        if (snapshot.phase === "downloading" && snapshot.progress === progress)
          return;
        publish({
          phase: "downloading",
          currentVersion,
          availableVersion: update.version,
          progress,
        });
      },
      { timeout: 10 * 60 * 1000 },
    );
    // Finished progress alone does not prove signature verification. Only the
    // resolved download promise makes this archive eligible for installation.
    downloaded = true;
    announceUpdateAvailable(update.version);
    return publish({
      phase: "ready",
      currentVersion,
      availableVersion: update.version,
    });
  } catch (error) {
    downloaded = false;
    if (/updater does not have any endpoints set/i.test(errorText(error))) {
      return publish({ phase: "idle", currentVersion });
    }
    const availableVersion = pendingUpdate?.version;
    // Re-read the signed feed on retry; a broken or revoked release can be
    // corrected upstream without pinning this process to its old metadata.
    await pendingUpdate?.close().catch(() => undefined);
    pendingUpdate = null;
    return publish({
      phase: "error",
      currentVersion,
      availableVersion,
      error: errorText(error),
    });
  }
}

function refresh(): Promise<UpdaterSnapshot> {
  if (installing) return installing;
  if (!checking)
    checking = checkAndDownload().finally(() => {
      checking = null;
    });
  return checking;
}

/** Kept for callers that only need availability; downloads are safely staged. */
export async function probeForUpdate(): Promise<Update | null> {
  await refresh();
  return pendingUpdate;
}

export async function runUpdateFlow(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const unsubscribe = onProgress
    ? subscribeUpdater(() => onProgress(snapshot))
    : () => {};
  try {
    const result = await refresh();
    if (
      manual &&
      (result.phase === "idle" ||
        result.phase === "current" ||
        result.phase === "error")
    ) {
      await message(
        result.phase === "idle"
          ? PERSONAL_UPDATE_MESSAGE
          : result.phase === "current"
            ? "You're on the latest version."
            : `Couldn't prepare the update.\n\n${result.error}`,
        { title: "Aven" },
      );
    }
    return result;
  } finally {
    unsubscribe();
  }
}

/** Startup, foreground, network recovery and periodic checks share one request. */
export function startAutomaticUpdates(target: Window = window): () => void {
  let disposed = false;
  const checkNow = () => {
    if (disposed || Date.now() - lastAutomaticCheck < UPDATE_FOCUS_THROTTLE_MS)
      return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    lastAutomaticCheck = Date.now();
    void runUpdateFlow(false);
  };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    void readAppVersion().then((currentVersion) => {
      if (!disposed && snapshot.currentVersion === "…")
        publish({ ...snapshot, currentVersion });
    });
  }
  checkNow();
  target.addEventListener("focus", checkNow);
  target.addEventListener("online", checkNow);
  const interval = target.setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    disposed = true;
    target.removeEventListener("focus", checkNow);
    target.removeEventListener("online", checkNow);
    target.clearInterval(interval);
  };
}

export function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (installing) return installing;
  const update = pendingUpdate;
  if (IS_PERSONAL_BUILD || !update || !downloaded)
    return Promise.resolve(snapshot);
  const unsubscribe = onProgress
    ? subscribeUpdater(() => onProgress(snapshot))
    : () => {};
  const releaseInput = lockUpdateInput();
  installing = (async () => {
    const currentVersion = await readAppVersion();
    publish({
      phase: "installing",
      currentVersion,
      availableVersion: update.version,
    });
    let installed = pendingInstalled;
    try {
      // Acquires the native restart guard and saves drafts/session state. It
      // refuses active tasks and extra windows, without stopping their work.
      await prepareUpdateRestart();
      if (!pendingInstalled) {
        await update.install();
        pendingInstalled = true;
        installed = true;
        rememberInstalledUpdate(update.version);
      }
      installed = true;
      await invoke("relaunch_after_update");
      return snapshot;
    } catch (error) {
      await invoke("cancel_update_restart").catch(() => undefined);
      releaseInput();
      const detail = installed
        ? "The update was installed. Quit and reopen Aven to finish restarting."
        : errorText(error);
      const result = publish({
        phase: "ready",
        currentVersion,
        availableVersion: update.version,
        error: detail,
      });
      await message(detail, { title: "Aven update" });
      return result;
    }
  })().finally(() => {
    installing = null;
    unsubscribe();
  });
  return installing;
}
