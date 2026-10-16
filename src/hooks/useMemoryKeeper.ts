import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getActivitySnapshot, subscribeActivity } from "../lib/activity";
import { logError } from "../lib/errors";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import {
  clearKeeperRequest,
  getKeeperProject,
  keeperDecision,
  keeperProjects,
  offerMemoryKeeper,
  providerNearLimit,
  setMemoryKeeper,
  subscribeMemoryKeeper,
  type KeeperProject,
} from "../lib/memoryKeeper";
import { splitMemory } from "../lib/memoryKeeperFormat";
import {
  keeperTurnsSince,
  pickKeeperModel,
  runKeeperPass,
  type KeeperModel,
} from "../lib/memoryKeeperRun";
import {
  loadProjectMemory,
  memoryProjectFor,
  projectMemoryKey,
} from "../lib/projectMemory";
import { isInFlightSession } from "../lib/inFlight";
import type { Session } from "../lib/session";
import { getUsageForecasts } from "../lib/usageHistory";

/** Wait this long after a turn ends, so the next message usually comes first. */
export const KEEPER_SETTLE_MS = 20_000;
/** While an agent works in the project, look again this often. */
export const KEEPER_BUSY_RETRY_MS = 60_000;
/** Projects are looked at again this often, for the daily check. */
export const KEEPER_RECHECK_MS = 10 * 60_000;
/** Turn ends older than this when first seen are history, not work now. */
const FRESH_TURN_MS = 60_000;

/** This window, so two windows never run the same pass. */
const OWNER = `window-${Math.random().toString(36).slice(2, 10)}`;

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (
      window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number;
      }
    ).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 5_000 });
    else window.setTimeout(resolve, 250);
  });
}

/** The projects where an agent is at work, as `projectMemoryKey`s. */
export function keeperBusyProjects(sessions: readonly Session[]): Set<string> {
  const keys = new Set<string>();
  for (const session of sessions) {
    if (!isInFlightSession(session)) continue;
    const project = memoryProjectFor(session.cwd);
    if (project) keys.add(projectMemoryKey(project));
  }
  return keys;
}

/**
 * Runs the memory keeper for this workspace window: offers it the first
 * time a project with an empty memory finishes a turn, and runs passes when
 * the rules in `keeperDecision` allow, after turns end, when the user asks
 * (Turn on, Refresh now, from any window) and every few minutes for the
 * daily check. Nothing runs in a project while one of `sessions` is at work
 * there.
 */
export function useMemoryKeeper(sessions: readonly Session[]) {
  const busyProjects = useMemo(() => keeperBusyProjects(sessions), [sessions]);
  const busy = useRef(busyProjects);
  busy.current = busyProjects;

  useEffect(() => {
    const timers = new Map<string, number>();
    const active = new Set<string>();
    const known = new Set(getActivitySnapshot().map((entry) => entry.id));
    let disposed = false;

    const schedule = (path: string, delay: number, replace = true) => {
      const key = projectMemoryKey(path);
      if (timers.has(key)) {
        if (!replace) return;
        window.clearTimeout(timers.get(key));
      }
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          void check(path).catch((error) => logError("Memory keeper", error));
        }, delay),
      );
    };

    const check = async (path: string) => {
      const key = projectMemoryKey(path);
      if (disposed || active.has(key)) return;
      const state = getKeeperProject(path);
      if (state.consent !== "on") return clearKeeperRequest(path);
      if (busy.current.has(key)) {
        schedule(path, KEEPER_BUSY_RETRY_MS);
        return;
      }
      active.add(key);
      try {
        const memory = await loadProjectMemory(path);
        const model = pickKeeperModel();
        const now = Date.now();
        const fresh = getKeeperProject(path);
        const decision = keeperDecision({
          project: fresh,
          hasBlock: splitMemory(memory?.body ?? "").auto != null,
          turnsSince: keeperTurnsSince(path, getActivitySnapshot()),
          now,
          projectBusy: busy.current.has(key),
          nearLimit: model
            ? providerNearLimit(model.harness, getUsageForecasts(), now)
            : false,
          modelAvailable: model != null,
          manual: fresh.requested?.manual,
          requested: fresh.requested != null,
        });
        if ("skip" in decision) {
          if (decision.skip === "busy") schedule(path, KEEPER_BUSY_RETRY_MS);
          else if (decision.skip === "removed") setMemoryKeeper(path, false);
          else clearKeeperRequest(path);
          return;
        }
        await whenIdle();
        if (disposed || busy.current.has(key)) {
          if (!disposed) schedule(path, KEEPER_BUSY_RETRY_MS);
          return;
        }
        await runKeeperPass({
          project: path,
          kind: decision.run,
          model: model as KeeperModel,
          owner: OWNER,
        });
      } finally {
        active.delete(key);
      }
    };

    const offerIfEmpty = async (path: string) => {
      if (!pickKeeperModel()) return;
      const memory = await loadProjectMemory(path).catch(() => undefined);
      if (memory === undefined || memory?.body.trim()) return;
      offerMemoryKeeper(path);
    };

    const onActivity = () => {
      const now = Date.now();
      for (const entry of getActivitySnapshot()) {
        if (known.has(entry.id)) continue;
        known.add(entry.id);
        if (entry.outcome !== "completed") continue;
        if (Math.abs(now - entry.createdAt) > FRESH_TURN_MS) continue;
        const project = memoryProjectFor(entry.cwd);
        if (!project) continue;
        const state = getKeeperProject(project);
        if (!state.consent && state.offeredAt == null)
          void offerIfEmpty(project);
        else if (state.consent === "on") schedule(project, KEEPER_SETTLE_MS);
      }
    };

    const forEachProject = (
      visit: (path: string, state: KeeperProject) => void,
    ) => {
      for (const state of Object.values(keeperProjects()))
        if (state.path) visit(state.path, state);
    };

    const onStore = () =>
      forEachProject((path, state) => {
        if (state.requested && state.consent === "on") schedule(path, 0, false);
      });

    const recheck = () =>
      forEachProject((path, state) => {
        if (state.consent === "on") schedule(path, 0, false);
      });

    const stopActivity = subscribeActivity(onActivity);
    const stopStore = subscribeMemoryKeeper(onStore);
    onStore();
    // The daily check also covers projects used before Aven restarted.
    const first = window.setTimeout(recheck, KEEPER_SETTLE_MS);
    const interval = window.setInterval(recheck, KEEPER_RECHECK_MS);
    return () => {
      disposed = true;
      stopActivity();
      stopStore();
      window.clearTimeout(first);
      window.clearInterval(interval);
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);
}

/** A project's keeper state, current across windows. */
export function useMemoryKeeperProject(
  path: string | undefined,
): KeeperProject {
  const select = () => (path ? getKeeperProject(path) : EMPTY);
  return useSyncExternalStore(subscribeMemoryKeeper, select, select);
}

const EMPTY: KeeperProject = Object.freeze({});

/** The model that would keep memories now, or null when none is installed. */
export function useKeeperModel(): KeeperModel | null {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  return pickKeeperModel();
}
