import { useCallback, useSyncExternalStore } from "react";
import {
  loadBookmarks,
  subscribeBookmarks,
  type BrowserBookmark,
} from "../lib/browserBookmarks";
import { hasProjectAppearance } from "../lib/projectAppearance";

const NONE: readonly BrowserBookmark[] = [];

/**
 * A project's bookmarks, kept current when they change here or in another
 * window. Home, scratch folders and missing paths aren't projects: none.
 */
export function useBrowserBookmarks(
  project: string | null | undefined,
): readonly BrowserBookmark[] {
  const getSnapshot = useCallback(
    () => (hasProjectAppearance(project) ? loadBookmarks(project) : NONE),
    [project],
  );
  return useSyncExternalStore(subscribeBookmarks, getSnapshot, getSnapshot);
}
