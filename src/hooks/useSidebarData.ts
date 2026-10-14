import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { WorkspaceProfilePreviewData } from "../chrome/ProfileCarouselPreview";
import type { OrchestrationRun } from "../lib/orchestration";
import { normalizeProjectPath, type RecentProject } from "../lib/recents";
import type { Session } from "../lib/session";
import {
  projectSessionSummaries as buildProjectSessionSummaries,
  workspaceProfilePreviews,
} from "../lib/sidebarData";
import {
  replaceProjectHistory,
  standaloneSessionRows,
} from "../lib/sessionHistory";
import {
  listSessionsByProject,
  type SessionSummary,
} from "../lib/sessionStore";
import { loadTabGroupLabels } from "../lib/tabGroups";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { projectDisplayName } from "./useProjectLabels";

type Options = {
  /** The sidebar is on screen (see `sidebarOnScreen`). */
  onScreen: boolean;
  profiles: {
    profiles: WorkspaceProfile[];
    /** The active workspace's projects. */
    profileProjects: RecentProject[];
    projectsByProfile: Readonly<Record<string, RecentProject[]>>;
  };
  standaloneCwds: readonly string[];
  history: SessionSummary[];
  sessions: Session[];
  orchestrationRuns: readonly OrchestrationRun[];
  busySessionIds: ReadonlySet<string>;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setLoadedProjects: Dispatch<SetStateAction<ReadonlySet<string>>>;
  loadedProjectsRef: { readonly current: ReadonlySet<string> };
};

/**
 * What the sidebar lists beyond the current project: every project's tasks,
 * tasks without a project, and the workspace switcher's previews. History for
 * projects other than the current one loads on demand while the sidebar is on
 * screen; while it is hidden the lists keep their last value.
 */
export function useSidebarData({
  onScreen,
  profiles,
  standaloneCwds,
  history,
  sessions,
  orchestrationRuns,
  busySessionIds,
  setHistory,
  setLoadedProjects,
  loadedProjectsRef,
}: Options) {
  const [profileHistoryErrors, setProfileHistoryErrors] = useState<
    ReadonlySet<string>
  >(new Set());
  const profileHistoryRequests = useRef(new Set<string>());
  const refreshProfileHistory = useCallback(
    async (cwd: string) => {
      const key = normalizeProjectPath(cwd);
      if (
        loadedProjectsRef.current.has(key) ||
        profileHistoryRequests.current.has(key)
      )
        return;
      profileHistoryRequests.current.add(key);
      setProfileHistoryErrors((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
      try {
        const rows = await listSessionsByProject(cwd);
        setHistory((current) => replaceProjectHistory(current, cwd, rows));
        setLoadedProjects((previous) => new Set(previous).add(key));
      } catch {
        setProfileHistoryErrors((previous) => new Set(previous).add(key));
      } finally {
        profileHistoryRequests.current.delete(key);
      }
    },
    [loadedProjectsRef, setHistory, setLoadedProjects],
  );

  useEffect(() => {
    if (onScreen) {
      for (const cwd of standaloneCwds) void refreshProfileHistory(cwd);
    }
  }, [standaloneCwds, onScreen, refreshProfileHistory]);

  const standaloneSessions = useMemo(
    () => standaloneSessionRows(history, sessions, standaloneCwds),
    [standaloneCwds, history, sessions],
  );
  // A closing sidebar keeps its last previews: clearing them would remove rows
  // during the fade and re-render the sidebar for content no longer shown.
  const lastProfileSessionSummaries = useRef<Record<string, SessionSummary[]>>(
    {},
  );
  const profileSessionSummaries = useMemo(
    () =>
      !onScreen
        ? lastProfileSessionSummaries.current
        : (lastProfileSessionSummaries.current = buildProjectSessionSummaries(
            profiles.profileProjects,
            history,
            sessions,
            orchestrationRuns,
          )),
    [onScreen, profiles.profileProjects, history, sessions, orchestrationRuns],
  );
  const lastProfilePreviews = useRef<
    Readonly<Record<string, WorkspaceProfilePreviewData>>
  >({});
  const profilePreviews = useMemo<
    Readonly<Record<string, WorkspaceProfilePreviewData>>
  >(() => {
    if (!onScreen) return lastProfilePreviews.current;
    const labels = loadTabGroupLabels();
    return (lastProfilePreviews.current = workspaceProfilePreviews({
      profiles: profiles.profiles,
      projectsByProfile: profiles.projectsByProfile,
      history,
      sessions,
      runs: orchestrationRuns,
      busySessionIds,
      nameFor: (path) => projectDisplayName(path, labels),
    }));
  }, [
    onScreen,
    profiles.profiles,
    profiles.projectsByProfile,
    history,
    sessions,
    orchestrationRuns,
    busySessionIds,
  ]);

  return {
    profileHistoryErrors,
    refreshProfileHistory,
    standaloneSessions,
    profileSessionSummaries,
    profilePreviews,
  };
}
