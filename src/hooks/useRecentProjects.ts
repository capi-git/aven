import { useCallback, useEffect, useRef, useState } from "react";
import {
  archiveProject,
  forgetProject,
  loadRecents,
  looksLikeProject,
  readRecents,
  RECENT_PROJECTS_KEY,
  rememberProject,
  sameProjectPath,
  type RecentProject,
} from "../lib/recents";

/** Storage seeds the window; navigation must not replace known projects with a
 * fresh, possibly missing or stale disk value. Explicit removals still apply. */
export function useRecentProjects(resumedCwd?: string) {
  const [seed] = useState(() => {
    const recents =
      resumedCwd && looksLikeProject(resumedCwd)
        ? rememberProject(resumedCwd)
        : loadRecents();
    return { recents, persisted: JSON.stringify(readRecents()) };
  });
  const [recents, setRecents] = useState(seed.recents);
  const current = useRef(recents);
  const persisted = useRef(seed.persisted);
  const refresh = useCallback(() => {
    const saved = readRecents();
    if (saved !== null) {
      const snapshot = JSON.stringify(saved);
      // Failed writes leave the old valid value on disk. Re-reading that value
      // must not discard local additions/removals; changed external saves sync.
      if (snapshot !== persisted.current) {
        persisted.current = snapshot;
        current.current = saved;
        setRecents(saved);
      }
    }
    return current.current;
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RECENT_PROJECTS_KEY || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);
  const update = useCallback(
    (change: (previous: RecentProject[]) => RecentProject[]) => {
      const next = change(refresh());
      current.current = next;
      setRecents(next);
      const saved = readRecents();
      if (saved !== null && JSON.stringify(saved) === JSON.stringify(next)) {
        persisted.current = JSON.stringify(saved);
      }
      return next;
    },
    [refresh],
  );
  const remember = useCallback(
    (path: string) => update((previous) => rememberProject(path, previous)),
    [update],
  );
  const rememberIfEmpty = useCallback(
    (path: string) => {
      if (refresh().length === 0) remember(path);
    },
    [refresh, remember],
  );
  const forget = useCallback(
    (path: string) => update((previous) => forgetProject(path, previous)),
    [update],
  );
  const archive = useCallback(
    (path: string) => update((previous) => archiveProject(path, previous)),
    [update],
  );
  const isKnownProject = useCallback(
    (path: string) =>
      refresh().some((project) => sameProjectPath(project.path, path)),
    [refresh],
  );
  return {
    recents,
    remember,
    rememberIfEmpty,
    forget,
    archive,
    isKnownProject,
  };
}
