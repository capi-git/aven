import { useMemo, useRef } from "react";
import type { ActivityEntry } from "../lib/activity";
import {
  mergeProjectStatus,
  sameProjectStatus,
  sessionProjectCounts,
  unreadProjectCounts,
  type ProjectStatusMap,
} from "../lib/projectStatus";
import type { Session } from "../lib/session";
import { useProjectsDiffFiles } from "./useProjectDiffStats";

/**
 * Live per-project status for the sidebar, from state the workspace already
 * holds plus cached changed-file counts. Sessions change on every streaming
 * flush; the result keeps its identity until a count actually changes, so the
 * sidebar (and the floating sidebar's snapshot) skip those flushes.
 */
export function useProjectStatus({
  sessions,
  activity,
  projectPaths,
  enabled = true,
}: {
  sessions: readonly Session[];
  activity: readonly ActivityEntry[];
  /** Projects listed in the sidebar, whose changed files are counted. */
  projectPaths: readonly string[];
  enabled?: boolean;
}): ProjectStatusMap {
  const files = useProjectsDiffFiles(projectPaths, enabled);
  const unread = useMemo(() => unreadProjectCounts(activity), [activity]);
  const next = useMemo(
    () => mergeProjectStatus(sessionProjectCounts(sessions), unread, files),
    [sessions, unread, files],
  );
  const stable = useRef(next);
  if (stable.current !== next && !sameProjectStatus(stable.current, next))
    stable.current = next;
  return stable.current;
}
