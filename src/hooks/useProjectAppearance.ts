import { useCallback, useSyncExternalStore } from "react";
import {
  hasProjectAppearance,
  projectAppearance,
  subscribeProjectAppearance,
  type ProjectAppearance,
} from "../lib/projectAppearance";

/**
 * A project's colour, mark and name, kept current when they change here or in
 * another window. Null for home, scratch folders and missing paths.
 */
export function useProjectAppearance(
  path: string | null | undefined,
): ProjectAppearance | null {
  const getSnapshot = useCallback(
    () => (hasProjectAppearance(path) ? projectAppearance(path) : null),
    [path],
  );
  return useSyncExternalStore(
    subscribeProjectAppearance,
    getSnapshot,
    getSnapshot,
  );
}
