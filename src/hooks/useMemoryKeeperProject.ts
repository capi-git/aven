import { useSyncExternalStore } from "react";
import {
  getHarnessAvailabilitySnapshot,
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
  return pickKeeperModel();
}
