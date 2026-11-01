import { useCallback, useSyncExternalStore } from "react";
import type { MarkTone } from "../lib/markTones";
import {
  hasProjectAppearance,
  projectToneAt,
  subscribeProjectAppearance,
} from "../lib/projectAppearance";

/**
 * The colour a project's marks take (a crew's members, its bot), kept
 * current when it changes here or in another window. Grey for home, scratch
 * folders and no folder. A string, so a mark re-renders only when it changes.
 */
export function useProjectTone(path: string | null | undefined): MarkTone {
  const getSnapshot = useCallback(
    (): MarkTone => (hasProjectAppearance(path) ? projectToneAt(path) : "grey"),
    [path],
  );
  return useSyncExternalStore(
    subscribeProjectAppearance,
    getSnapshot,
    getSnapshot,
  );
}
