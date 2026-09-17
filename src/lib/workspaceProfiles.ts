import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pathKey } from "./paths";
import {
  isProjectlessCwd,
  projectlessProfileForCwd,
} from "./projectlessWorkspace";
import {
  resetWorkspaceTheme,
  useActivateWorkspaceTheme,
} from "./workspaceThemes";
import {
  looksLikeProject,
  normalizeProjectPath,
  sameProjectPath,
  type RecentProject,
} from "./recents";

export const WORKSPACE_PROFILES_KEY = "monocode.workspaceProfiles.v1";

export type WorkspaceProfile = {
  id: string;
  name: string;
  icon: "home" | "briefcase" | "folder";
};
export type WorkspaceProfilesState = {
  profiles: WorkspaceProfile[];
  activeProfileId: string;
  projectProfiles: Record<string, string>;
  lastProjectByProfile: Record<string, string>;
};

export const DEFAULT_WORKSPACE_PROFILES: readonly WorkspaceProfile[] = [
  { id: "personal", name: "Personal", icon: "home" },
  { id: "work", name: "Work", icon: "briefcase" },
];

export function defaultWorkspaceProfiles(): WorkspaceProfilesState {
  return {
    profiles: DEFAULT_WORKSPACE_PROFILES.map((profile) => ({ ...profile })),
    activeProfileId: "personal",
    projectProfiles: {},
    lastProjectByProfile: {},
  };
}

/** Profiles organize local projects; they never select an external account. */
export function loadWorkspaceProfiles(): WorkspaceProfilesState {
  const fallback = defaultWorkspaceProfiles();
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(WORKSPACE_PROFILES_KEY) ?? "null",
    );
    if (!raw || typeof raw !== "object") return fallback;
    const saved = raw as Partial<WorkspaceProfilesState>;
    const profiles = [...fallback.profiles];
    if (Array.isArray(saved.profiles)) {
      for (const profile of saved.profiles) {
        if (
          !profile ||
          typeof profile.id !== "string" ||
          !profile.id ||
          ["__proto__", "prototype", "constructor"].includes(profile.id) ||
          typeof profile.name !== "string" ||
          !profile.name.trim() ||
          profiles.some((item) => item.id === profile.id)
        )
          continue;
        profiles.push({
          id: profile.id,
          name: profile.name.trim().slice(0, 40),
          icon: "folder",
        });
      }
    }
    const known = new Set(profiles.map((profile) => profile.id));
    const projectProfiles: Record<string, string> = {};
    const lastProjectByProfile: Record<string, string> = {};
    if (saved.projectProfiles && typeof saved.projectProfiles === "object") {
      for (const [path, id] of Object.entries(saved.projectProfiles)) {
        if (
          looksLikeProject(path) &&
          !isProjectlessCwd(path) &&
          typeof id === "string" &&
          known.has(id)
        ) {
          projectProfiles[pathKey(path)] = id;
        }
      }
    }
    if (
      saved.lastProjectByProfile &&
      typeof saved.lastProjectByProfile === "object"
    ) {
      for (const [id, path] of Object.entries(saved.lastProjectByProfile)) {
        if (
          known.has(id) &&
          typeof path === "string" &&
          looksLikeProject(path)
        ) {
          lastProjectByProfile[id] = normalizeProjectPath(path);
        }
      }
    }
    return {
      profiles,
      activeProfileId: known.has(saved.activeProfileId ?? "")
        ? saved.activeProfileId!
        : "personal",
      projectProfiles,
      lastProjectByProfile,
    };
  } catch {
    return fallback;
  }
}

export function saveWorkspaceProfiles(state: WorkspaceProfilesState) {
  try {
    localStorage.setItem(WORKSPACE_PROFILES_KEY, JSON.stringify(state));
  } catch {
    // Keep this window usable when storage is unavailable.
  }
}

export function projectWorkspaceProfile(
  state: WorkspaceProfilesState,
  path: string,
): string {
  const standaloneProfile = projectlessProfileForCwd(path);
  if (
    standaloneProfile &&
    state.profiles.some((profile) => profile.id === standaloneProfile)
  ) {
    return standaloneProfile;
  }
  const explicit = state.projectProfiles[pathKey(path)];
  if (explicit && state.profiles.some((profile) => profile.id === explicit))
    return explicit;
  return "personal";
}

export function projectsForWorkspace(
  state: WorkspaceProfilesState,
  recents: readonly RecentProject[],
  profileId = state.activeProfileId,
): RecentProject[] {
  return recents.filter(
    (project) =>
      looksLikeProject(project.path) &&
      !isProjectlessCwd(project.path) &&
      projectWorkspaceProfile(state, project.path) === profileId,
  );
}

export function workspaceProjectTarget(
  state: WorkspaceProfilesState,
  recents: readonly RecentProject[],
  profileId = state.activeProfileId,
): string {
  const projects = projectsForWorkspace(state, recents, profileId);
  const last = state.lastProjectByProfile[profileId];
  if (last && projectlessProfileForCwd(last) === profileId) return last;
  return (
    projects.find((project) => last && sameProjectPath(project.path, last))
      ?.path ??
    projects[0]?.path ??
    "~"
  );
}

export function assignWorkspaceProject(
  state: WorkspaceProfilesState,
  path: string,
  profileId: string,
): WorkspaceProfilesState {
  if (
    !looksLikeProject(path) ||
    isProjectlessCwd(path) ||
    !state.profiles.some((profile) => profile.id === profileId)
  )
    return state;
  const normalized = normalizeProjectPath(path);
  return {
    ...state,
    projectProfiles: {
      ...state.projectProfiles,
      [pathKey(normalized)]: profileId,
    },
    lastProjectByProfile: {
      ...state.lastProjectByProfile,
      [profileId]: normalized,
    },
  };
}

/** An intentional horizontal gesture; normal task-list scrolling never switches profiles. */
export function workspaceSwipeDirection(
  dx: number,
  dy: number,
  threshold = 64,
): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.6) return 0;
  return dx > 0 ? 1 : -1;
}

export function useWorkspaceProfiles(
  recents: readonly RecentProject[],
  currentProject: string,
) {
  const [state, setState] = useState(loadWorkspaceProfiles);
  useActivateWorkspaceTheme(state.activeProfileId);
  const stateRef = useRef(state);
  const commit = useCallback((next: WorkspaceProfilesState) => {
    stateRef.current = next;
    setState(next);
    saveWorkspaceProfiles(next);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = loadWorkspaceProfiles();
      stateRef.current = next;
      setState(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_PROFILES_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const current = stateRef.current;
    if (
      !looksLikeProject(currentProject) ||
      projectWorkspaceProfile(current, currentProject) !==
        current.activeProfileId
    )
      return;
    if (
      sameProjectPath(
        current.lastProjectByProfile[current.activeProfileId] ?? "~",
        currentProject,
      )
    )
      return;
    commit({
      ...current,
      lastProjectByProfile: {
        ...current.lastProjectByProfile,
        [current.activeProfileId]: normalizeProjectPath(currentProject),
      },
    });
  }, [currentProject, state.activeProfileId, commit]);

  const availableProjects = useMemo(() => {
    if (
      !looksLikeProject(currentProject) ||
      isProjectlessCwd(currentProject) ||
      recents.some((project) => sameProjectPath(project.path, currentProject))
    )
      return recents;
    return [...recents, { path: currentProject, openedAt: 0 }];
  }, [recents, currentProject]);
  const profileProjects = useMemo(
    () => projectsForWorkspace(state, availableProjects),
    [state, availableProjects],
  );
  // Read-only destinations for the native sidebar carousel. This uses the
  // same local project assignments as the selected workspace, without opening
  // projects or creating another workspace/session tree.
  const projectsByProfile = useMemo(
    () =>
      Object.fromEntries(
        state.profiles.map((profile) => [
          profile.id,
          projectsForWorkspace(state, availableProjects, profile.id),
        ]),
      ),
    [state, availableProjects],
  );
  const selectProfile = useCallback(
    (id: string) => {
      const current = stateRef.current;
      if (!current.profiles.some((profile) => profile.id === id))
        return currentProject;
      const target = workspaceProjectTarget(current, availableProjects, id);
      commit({ ...current, activeProfileId: id });
      return target;
    },
    [availableProjects, currentProject, commit],
  );
  const assignProject = useCallback(
    (path: string, profileId?: string) => {
      const current = stateRef.current;
      commit(
        assignWorkspaceProject(
          current,
          path,
          profileId ?? current.activeProfileId,
        ),
      );
    },
    [commit],
  );
  const moveProject = useCallback(
    (path: string, profileId: string) => {
      const current = stateRef.current;
      const next = assignWorkspaceProject(current, path, profileId);
      commit(next);
      return sameProjectPath(path, currentProject) &&
        projectWorkspaceProfile(next, path) !== next.activeProfileId
        ? workspaceProjectTarget(next, availableProjects)
        : currentProject;
    },
    [availableProjects, currentProject, commit],
  );
  const createProfile = useCallback(
    (name: string) => {
      const cleanName = name.trim().slice(0, 40);
      if (!cleanName) return stateRef.current.activeProfileId;
      const id = `workspace-${crypto.randomUUID()}`;
      const current = stateRef.current;
      resetWorkspaceTheme(id);
      commit({
        ...current,
        profiles: [
          ...current.profiles,
          { id, name: cleanName, icon: "folder" },
        ],
      });
      return id;
    },
    [commit],
  );

  return {
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    activeProfile: state.profiles.find(
      (profile) => profile.id === state.activeProfileId,
    )!,
    profileProjects,
    projectsByProfile,
    selectProfile,
    assignProject,
    moveProject,
    createProfile,
  };
}

/** Profile navigation restores a destination, unlike an explicit task click. */
export function restoreProfileWorkspace(
  id: string,
  selectProfile: (id: string) => string,
  selectProject: (cwd: string, restoreWorkspace?: boolean) => void,
) {
  const target = selectProfile(id);
  if (looksLikeProject(target)) selectProject(target, true);
}
