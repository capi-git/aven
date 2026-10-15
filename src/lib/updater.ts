import { errorText } from "./errors";
import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { lockUpdateInput, setUpdateLockStatus } from "./updateInputLock";
import {
  hasRestartWork,
  plainList,
  requestRestartDecision,
  restartWaitReason,
  type RestartWork,
} from "./updateRestartWork";
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
  /**
   * The update restarts by itself once running work finishes. Finishes the
   * sentence "Restarting when …", such as "your agents finish".
   */
  waitingFor?: string;
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
/** Asking what to do about running work, or restarting after the answer. */
let deciding: Promise<UpdaterSnapshot> | null = null;
/** Waiting for running work to finish, then restarting by itself. */
let waiting: { work: RestartWork; stop: () => void } | null = null;
let rechecking = false;
let recheckAgain = false;
let lastAutomaticCheck = -Infinity;
let developmentBuild = false;

/**
 * A display-only renderer (the macOS floating sidebar) shows its workspace's
 * updater and asks it to act. It never checks, downloads or installs itself.
 */
export type UpdaterMirror = {
  refresh(manual: boolean): Promise<UpdaterSnapshot>;
  install(): Promise<UpdaterSnapshot>;
  restartNow(): Promise<UpdaterSnapshot>;
  cancelWait(): Promise<UpdaterSnapshot>;
};
let mirror: UpdaterMirror | null = null;

export function mirrorUpdater(next: UpdaterMirror | null) {
  mirror = next;
}

export function showMirroredUpdater(next: UpdaterSnapshot) {
  if (mirror && next !== snapshot) publish(next);
}

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
  // A background check must not hide that the restart is waiting.
  if (waiting && next.phase === "ready" && !next.waitingFor)
    next = { ...next, waitingFor: restartWaitReason(waiting.work) };
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

async function isDevelopmentApp(): Promise<boolean> {
  try {
    return (await getIdentifier()) === "com.capi.aven.dev";
  } catch {
    // Preserve the normal updater error path when native metadata is unavailable.
    // Native debug builds also omit the updater plugin as an independent guard.
    return false;
  }
}

/** Compare the semver releases accepted by the native updater, ignoring build metadata. */
function newerRelease(candidate: string, staged: string): boolean {
  const parts = (version: string) =>
    version.replace(/^v/, "").split("+", 1)[0]!.split("-");
  const [nextCore, ...nextPre] = parts(candidate);
  const [oldCore, ...oldPre] = parts(staged);
  const next = nextCore!.split(".").map(Number);
  const old = oldCore!.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== old[index]) return next[index]! > old[index]!;
  }
  if (!oldPre.length) return false;
  if (!nextPre.length) return true;
  const a = nextPre.join("-").split(".");
  const b = oldPre.join("-").split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    if (a[index] === undefined) return false;
    if (b[index] === undefined) return true;
    const numericA = /^\d+$/.test(a[index]!);
    const numericB = /^\d+$/.test(b[index]!);
    if (numericA && numericB) return Number(a[index]) > Number(b[index]);
    if (numericA !== numericB) return numericB;
    return a[index]! > b[index]!;
  }
  return false;
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
  // A failed relaunch still needs to finish the installed version first.
  if (pendingInstalled) return snapshot;
  const staged = downloaded ? pendingUpdate : null;
  const readySnapshot = (): UpdaterSnapshot => ({
    phase: "ready",
    currentVersion,
    availableVersion: staged!.version,
  });
  let candidate: Update | null = null;
  publish({ phase: "checking", currentVersion });
  try {
    candidate = await check({ timeout: 30_000 });
    if (
      staged &&
      (!candidate || !newerRelease(candidate.version, staged.version))
    ) {
      if (candidate && candidate !== staged)
        await candidate.close().catch(() => undefined);
      return publish(readySnapshot());
    }
    if (!candidate) return publish({ phase: "current", currentVersion });
    const update = candidate;
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
    pendingUpdate = update;
    downloaded = true;
    if (staged && staged !== update)
      await staged.close().catch(() => undefined);
    announceUpdateAvailable(update.version);
    return publish({
      phase: "ready",
      currentVersion,
      availableVersion: update.version,
    });
  } catch (error) {
    if (candidate && candidate !== staged)
      await candidate.close().catch(() => undefined);
    // A failed newer check/download must not discard the already verified archive.
    if (staged) return publish({ ...readySnapshot(), error: errorText(error) });
    downloaded = false;
    if (/updater does not have any endpoints set/i.test(errorText(error))) {
      return publish({ phase: "idle", currentVersion });
    }
    // A release can ship for macOS alone. Its feed then has no entry for this
    // platform, which means there is nothing newer to install here.
    if (!pendingUpdate && PLATFORM_MISSING_FROM_FEED.test(errorText(error))) {
      return publish({ phase: "current", currentVersion });
    }
    const availableVersion = candidate?.version;
    // Re-read the signed feed on retry; a broken or revoked release can be
    // corrected upstream without pinning this process to its old metadata.
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
  if (mirror) return mirror.refresh(manual);
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
  if (mirror) return () => {};
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

// Imported on demand because the floating sidebar's window shares this
// module but only mirrors the workspace's updater; a static import brought
// every agent harness into that window's startup. Loaded once and shared.
let restartImport: Promise<typeof import("./updateRestart")> | null = null;
const restartModule = () => {
  restartImport ??= import("./updateRestart").catch((error: unknown) => {
    restartImport = null;
    throw error;
  });
  return restartImport;
};

/**
 * Restart to install the downloaded update. Aven tidies up by itself and asks
 * only when real work would be interrupted: wait for it, stop it, or cancel.
 * While waiting, this asks again with stopping as the first choice.
 */
export function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (mirror) return mirror.install();
  return beginRestart(!!waiting, onProgress);
}

/** "Restart now" while waiting: ask whether to stop the work that is left. */
export function restartUpdateNow(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (mirror) return mirror.restartNow();
  return beginRestart(true, onProgress);
}

/** Stop waiting for work to finish; the update stays downloaded. */
export function cancelUpdateWait(): Promise<UpdaterSnapshot> {
  if (mirror) return mirror.cancelWait();
  stopWaiting();
  return Promise.resolve(snapshot);
}

function stopWaiting(): void {
  const current = waiting;
  waiting = null;
  current?.stop();
  if (snapshot.waitingFor) publish({ ...snapshot, waitingFor: undefined });
}

function beginRestart(
  now: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
  fromWait = false,
): Promise<UpdaterSnapshot> {
  if (installing) return installing;
  if (deciding) return deciding;
  // Do not install or close an archive while a refresh is replacing it.
  if (checking)
    return checking.then(() => beginRestart(now, onProgress, fromWait));
  const update = pendingUpdate;
  if (IS_PERSONAL_BUILD || !update || !downloaded)
    return Promise.resolve(snapshot);
  deciding = decideRestart(update, now, fromWait, onProgress).finally(() => {
    deciding = null;
  });
  return deciding;
}

async function decideRestart(
  update: Update,
  now: boolean,
  fromWait: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const restart = await restartModule();
  // Work that starts while the restart saves sends the person back here; a
  // few rounds cover that without looping on a window that keeps refusing.
  for (let round = 0; round < 3; round++) {
    const work = await restart.assessUpdateRestart();
    let stopWork = false;
    if (hasRestartWork(work)) {
      if (fromWait) {
        startWaiting(work);
        return snapshot;
      }
      const choice = await requestRestartDecision(work, now);
      if (choice === "cancel") {
        // From "Restart now", cancelling keeps waiting.
        if (!now) stopWaiting();
        return snapshot;
      }
      if (choice === "wait") {
        startWaiting(work);
        return snapshot;
      }
      stopWaiting();
      await restart.stopUpdateRestartWork();
      stopWork = true;
    } else {
      stopWaiting();
    }
    const result = await installNow(update, stopWork, onProgress);
    if (result !== "busy") return result;
    now = false;
  }
  showUpdateNotice(
    "Couldn’t restart to update",
    "New work kept starting while Aven was getting ready. Try again when it settles. The update will stay downloaded and ready.",
  );
  return snapshot;
}

function startWaiting(work: RestartWork): void {
  const current = waiting ?? { work, stop: () => {} };
  current.work = work;
  if (!waiting) {
    waiting = current;
    void restartModule().then((restart) => {
      if (waiting !== current) return;
      current.stop = restart.watchUpdateRestartWork(
        () => void recheckWaiting(),
        (id) => current.work.terminals.some((terminal) => terminal.id === id),
      );
    });
  }
  publish({ ...snapshot, phase: "ready", waitingFor: restartWaitReason(work) });
  // The work may have finished while the person was choosing.
  void recheckWaiting();
}

async function recheckWaiting(): Promise<void> {
  if (!waiting) return;
  if (rechecking) {
    recheckAgain = true;
    return;
  }
  rechecking = true;
  try {
    do {
      recheckAgain = false;
      const current: typeof waiting = waiting;
      if (!current) return;
      // Let an open question or a restart in progress finish first; a wait
      // chosen in that question is checked right after it closes.
      const busy = installing ?? deciding;
      if (busy) {
        await busy.catch(() => undefined);
        if (waiting !== current) return;
      }
      const work = await (await restartModule()).assessUpdateRestart();
      if (waiting !== current) return;
      if (hasRestartWork(work)) {
        current.work = work;
        const reason = restartWaitReason(work);
        if (snapshot.waitingFor !== reason)
          publish({ ...snapshot, waitingFor: reason });
        continue;
      }
      // Everything finished: restart as the person asked.
      void beginRestart(false, undefined, true);
      return;
    } while (recheckAgain);
  } finally {
    rechecking = false;
  }
}

function installNow(
  update: Update,
  stopWork: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot | "busy"> {
  const unsubscribe = onProgress
    ? subscribeUpdater(() => onProgress(snapshot))
    : () => {};
  const releaseInput = lockUpdateInput();
  const run = (async (): Promise<UpdaterSnapshot | "busy"> => {
    const currentVersion = await readAppVersion();
    publish({
      phase: "installing",
      currentVersion,
      availableVersion: update.version,
    });
    let installed = pendingInstalled;
    let installerPrepared = false;
    try {
      const { prepareUpdateRestart } = await restartModule();
      // Acquires the native restart guard and saves drafts/session state.
      // Aven tidies windows, browser tabs and idle terminals by itself.
      const prepared = await prepareUpdateRestart({
        stopWork,
        onWaiting: (labels) =>
          setUpdateLockStatus(
            labels.length
              ? `Waiting for Aven to finish ${plainList(labels, labels.length)}…`
              : null,
          ),
      });
      if (!prepared) {
        // Real work started meanwhile. Nothing was closed; ask again.
        releaseInput();
        publish({
          phase: "ready",
          currentVersion,
          availableVersion: update.version,
        });
        return "busy";
      }
      setUpdateLockStatus(null);
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
  })();
  installing = run
    .then((result) => (result === "busy" ? snapshot : result))
    .finally(() => {
      installing = null;
      unsubscribe();
    });
  return run;
}
