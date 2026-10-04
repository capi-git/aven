import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { prepareUpdateRestart } from "./appLifecycle";
import { lockUpdateInput } from "./updateInputLock";
import { announceUpdateAvailable } from "./sounds";
import { forgetInstalledUpdate, rememberInstalledUpdate } from "./updateNotice";
import { IS_PERSONAL_BUILD, PERSONAL_UPDATE_MESSAGE } from "./personalBuild";
import { IS_WIN } from "./platform";

/** Windows installs by running the NSIS installer, which ends this process. */
const INSTALLER_EXITS_APP = IS_WIN;

export type UpdateNotice = { title: string; text: string };

/** Update messages show in Aven's own dialog rather than a system alert. */
let notice: UpdateNotice | null = null;
const noticeListeners = new Set<() => void>();

function showUpdateNotice(title: string, text: string): void {
  notice = { title, text };
  for (const listener of noticeListeners) listener();
}

export function getUpdateNotice(): UpdateNotice | null {
  return notice;
}

export function dismissUpdateNotice(): void {
  notice = null;
  for (const listener of noticeListeners) listener();
}

export function subscribeUpdateNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

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
  /** The isolated preview is updated from its source checkout. */
  developmentBuild?: boolean;
  availableVersion?: string;
  progress?: number;
  error?: string;
};

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const UPDATE_FOCUS_THROTTLE_MS = 15 * 60 * 1000;
/** tauri-plugin-updater's TargetNotFound / TargetsNotFound messages. */
const PLATFORM_MISSING_FROM_FEED =
  /(?:was not found|were found) in the response `?platforms`? object/i;
const DEVELOPMENT_UPDATE_MESSAGE =
  "Aven Dev runs from your source checkout. Rebuild and restart the development preview to use your latest changes.";
let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
const listeners = new Set<() => void>();
let pendingUpdate: Update | null = null;
let downloaded = false;
let pendingInstalled = false;
let checking: Promise<UpdaterSnapshot> | null = null;
let installing: Promise<UpdaterSnapshot> | null = null;
let lastAutomaticCheck = -Infinity;
let developmentBuild = false;

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

async function isDevelopmentApp(): Promise<boolean> {
  try {
    return (await getIdentifier()) === "com.capi.aven.dev";
  } catch {
    // Preserve the normal updater error path when native metadata is unavailable.
    // Native debug builds also omit the updater plugin as an independent guard.
    return false;
  }
}

/** Download verifies the signed archive in the native plugin; never installs. */
async function checkAndDownload(): Promise<UpdaterSnapshot> {
  const [currentVersion, isDevelopment] = await Promise.all([
    readAppVersion(),
    isDevelopmentApp(),
  ]);
  developmentBuild = isDevelopment;
  if (developmentBuild)
    return publish({ phase: "idle", currentVersion, developmentBuild: true });
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
    // A release can ship for macOS alone. Its feed then has no entry for this
    // platform, which means there is nothing newer to install here.
    if (!pendingUpdate && PLATFORM_MISSING_FROM_FEED.test(errorText(error))) {
      return publish({ phase: "current", currentVersion });
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
      showUpdateNotice(
        developmentBuild ? "Aven Dev" : "Aven",
        result.phase === "idle"
          ? developmentBuild
            ? DEVELOPMENT_UPDATE_MESSAGE
            : PERSONAL_UPDATE_MESSAGE
          : result.phase === "current"
            ? "You're on the latest version."
            : `Couldn't prepare the update.\n\n${result.error}`,
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
    let installerPrepared = false;
    try {
      // Acquires the native restart guard and saves drafts/session state. It
      // refuses active tasks and extra windows, without stopping their work.
      if (!(await prepareUpdateRestart())) {
        releaseInput();
        return publish({
          phase: "ready",
          currentVersion,
          availableVersion: update.version,
        });
      }
      if (INSTALLER_EXITS_APP) {
        // Windows: the updater starts the signed NSIS installer and exits Aven
        // at once; the installer reopens Aven when it finishes. The native
        // final idle checks therefore run before the installer starts.
        await invoke("prepare_update_install");
        installerPrepared = true;
        rememberInstalledUpdate(update.version);
        await update.install();
        throw new Error("The update installer didn't start. Try again.");
      }
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
      if (installerPrepared) {
        forgetInstalledUpdate(update.version);
        await invoke("abandon_update_install").catch(() => undefined);
      }
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
      showUpdateNotice("Couldn’t restart to update", detail);
      return result;
    }
  })().finally(() => {
    installing = null;
    unsubscribe();
  });
  return installing;
}
