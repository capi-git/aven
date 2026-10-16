import { useEffect, useSyncExternalStore } from "react";
import {
  getHarnessAvailabilitySnapshot,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import {
  getKeeperProject,
  subscribeMemoryKeeper,
  type KeeperProject,
} from "../lib/memoryKeeper";
import { pickKeeperModel, type KeeperModel } from "../lib/memoryKeeperModel";

const EMPTY: KeeperProject = Object.freeze({});

/** A project's memory keeper state, current across windows. */
export function useMemoryKeeperProject(
  path: string | undefined,
): KeeperProject {
  const select = () => (path ? getKeeperProject(path) : EMPTY);
  return useSyncExternalStore(subscribeMemoryKeeper, select, select);
}

/** The model that would keep memories now, or null when none is installed. */
export function useKeeperModel(): KeeperModel | null {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  // Which providers are installed is only known after a probe, which the
  // model list otherwise starts. Ask here too (cached for 30 s), or the
  // switch reads "needs Claude Code or Codex" until that list is opened.
  useEffect(() => {
    void probeHarnessAvailability();
  }, []);
  return pickKeeperModel();
}
