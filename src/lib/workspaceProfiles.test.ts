// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultWorkspaceTheme,
  loadWorkspaceTheme,
  WORKSPACE_THEMES_KEY,
} from "./workspaceThemes";
import {
  assignWorkspaceProject,
  defaultWorkspaceProfiles,
  loadWorkspaceProfiles,
  projectWorkspaceProfile,
  projectsForWorkspace,
  saveWorkspaceProfiles,
  useWorkspaceProfiles,
  workspaceProjectTarget,
  workspaceSwipeDirection,
  WORKSPACE_PROFILES_KEY,
} from "./workspaceProfiles";

const personalPath = "/Users/test/Projects/PersonalApp";
const workPath = "/Users/test/Projects/WorkApp";
const otherWorkPath = "/Users/test/Projects/Catalog";
function configuredProfiles() {
  let state = defaultWorkspaceProfiles();
  state = assignWorkspaceProject(state, workPath, "work");
  return assignWorkspaceProject(state, otherWorkPath, "work");
}
const projects = [
  { path: personalPath, openedAt: 30 },
  { path: workPath, openedAt: 20 },
  { path: otherWorkPath, openedAt: 10 },
];
let root: Root | undefined;
let container: HTMLDivElement;
let latest: ReturnType<typeof useWorkspaceProfiles>;
function Probe({
  currentProject,
  recents = projects,
}: {
  currentProject: string;
  recents?: typeof projects;
}) {
  latest = useWorkspaceProfiles(recents, currentProject);
  return null;
}
function render(currentProject: string, recents = projects) {
  act(() => root!.render(createElement(Probe, { currentProject, recents })));
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  saveWorkspaceProfiles(configuredProfiles());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace project organization", () => {
  it("keeps carousel projects stable while selecting and remembering workspace destinations", () => {
    render(personalPath);
    const previews = latest.projectsByProfile;
    const personalProjects = latest.profileProjects;
    expect(personalProjects).toBe(previews.personal);

    act(() => latest.selectProfile("work"));
    expect(latest.projectsByProfile).toBe(previews);
    expect(latest.profileProjects).toBe(previews.work);
    render(workPath);
    expect(loadWorkspaceProfiles().lastProjectByProfile.work).toBe(workPath);
    expect(latest.projectsByProfile).toBe(previews);

    act(() => latest.selectProfile("personal"));
    expect(latest.projectsByProfile).toBe(previews);
    expect(latest.profileProjects).toBe(personalProjects);
  });

  it("refreshes carousel membership after moves and preserves changed recent project ordering", () => {
    render(personalPath);
    const beforeMove = latest.projectsByProfile;
    act(() => latest.moveProject(workPath, "personal"));
    expect(latest.projectsByProfile).not.toBe(beforeMove);
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      personalPath,
      workPath,
    ]);
    expect(
      latest.projectsByProfile.work.map((project) => project.path),
    ).toEqual([otherWorkPath]);

    const updatedRecents = [
      { path: workPath, openedAt: 40 },
      ...projects.filter((project) => project.path !== workPath),
    ];
    render(personalPath, updatedRecents);
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      workPath,
      personalPath,
    ]);
    expect(latest.profileProjects[0]).toBe(updatedRecents[0]);
  });

  it("acknowledges the selected workspace without another storage write or render", () => {
    render(personalPath);
    const persist = vi.spyOn(localStorage, "setItem");
    let target = "";
    act(() => {
      target = latest.selectProfile("work");
      // Project restoration acknowledges the same selection in the same event.
      latest.selectProfile("work");
    });
    expect(target).toBe(otherWorkPath);
    expect(latest.activeProfileId).toBe("work");
    expect(
      persist.mock.calls.filter(([key]) => key === WORKSPACE_PROFILES_KEY),
    ).toHaveLength(1);
    const selected = latest;
    persist.mockClear();
    act(() => {
      target = latest.selectProfile("work");
    });
    expect(target).toBe(otherWorkPath);
    expect(latest).toBe(selected);
    expect(persist).not.toHaveBeenCalled();
    persist.mockRestore();
  });

  it("keeps unassigned folders in Personal without machine-specific assumptions", () => {
    const state = defaultWorkspaceProfiles();
    expect(
      projectsForWorkspace(state, projects).map((project) => project.path),
    ).toEqual(projects.map((project) => project.path));
    expect(projectsForWorkspace(state, projects, "work")).toEqual([]);
    expect(projectWorkspaceProfile(state, "/Users/another/Work/Example")).toBe(
      "personal",
    );
  });

  it("persists an explicit move without touching recents or credentials", () => {
    localStorage.setItem("monocode.recentProjects", JSON.stringify(projects));
    localStorage.setItem("existing.account.preference", "keep");
    const moved = assignWorkspaceProject(
      configuredProfiles(),
      workPath + "/",
      "personal",
    );
    saveWorkspaceProfiles(moved);
    const reloaded = loadWorkspaceProfiles();
    expect(projectWorkspaceProfile(reloaded, workPath)).toBe("personal");
    expect(projectWorkspaceProfile(reloaded, otherWorkPath)).toBe("work");
    expect(localStorage.getItem("monocode.recentProjects")).toBe(
      JSON.stringify(projects),
    );
    expect(localStorage.getItem("existing.account.preference")).toBe("keep");
  });

  it("restores only remembered projects still in the selected workspace", () => {
    const state = configuredProfiles();
    state.lastProjectByProfile.work = otherWorkPath;
    expect(workspaceProjectTarget(state, projects, "work")).toBe(otherWorkPath);
    const moved = assignWorkspaceProject(state, otherWorkPath, "personal");
    expect(workspaceProjectTarget(moved, projects, "work")).toBe(workPath);
    expect(workspaceProjectTarget(moved, projects.slice(0, 1), "work")).toBe(
      "~",
    );
  });

  it("recovers safely from malformed storage and unknown memberships", () => {
    localStorage.setItem(WORKSPACE_PROFILES_KEY, "not json");
    expect(loadWorkspaceProfiles()).toEqual(defaultWorkspaceProfiles());
    localStorage.setItem(
      WORKSPACE_PROFILES_KEY,
      JSON.stringify({
        activeProfileId: "gone",
        profiles: [null, { id: "custom", name: " Research " }],
        projectProfiles: { [personalPath]: "gone", [workPath]: "custom" },
      }),
    );
    const state = loadWorkspaceProfiles();
    expect(state.activeProfileId).toBe("personal");
    expect(
      state.profiles.find((profile) => profile.id === "custom")?.name,
    ).toBe("Research");
    expect(projectWorkspaceProfile(state, personalPath)).toBe("personal");
    expect(projectWorkspaceProfile(state, workPath)).toBe("custom");
  });
});

describe("workspace transitions", () => {
  it("opens an externally assigned project before its storage event without overwriting its workspace", () => {
    const initial = configuredProfiles();
    initial.activeProfileId = "work";
    saveWorkspaceProfiles(initial);
    render(otherWorkPath);
    const holoPath = "/Users/test/Projects/HOLO";
    saveWorkspaceProfiles(assignWorkspaceProject(loadWorkspaceProfiles(), holoPath, "work"));

    act(() => latest.selectProjectProfile(holoPath));
    expect(latest.activeProfileId).toBe("work");
    expect(latest.projectProfile(holoPath)).toBe("work");
    expect(projectWorkspaceProfile(loadWorkspaceProfiles(), holoPath)).toBe("work");
  });

  it.each([
    "missing",
    "malformed",
    "empty object",
    "null assignments",
    "unavailable",
  ])(
    "keeps project navigation in its loaded workspace when profile storage is %s",
    (failure) => {
      const initial = configuredProfiles();
      initial.activeProfileId = "work";
      saveWorkspaceProfiles(initial);
      render(otherWorkPath);
      const previews = latest.projectsByProfile;
      const read = localStorage.getItem.bind(localStorage);
      vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
        if (key !== WORKSPACE_PROFILES_KEY) return read(key);
        if (failure === "unavailable") throw new Error("Storage unavailable");
        if (failure === "empty object") return "{}";
        if (failure === "null assignments")
          return JSON.stringify({ ...initial, projectProfiles: null });
        return failure === "missing" ? null : "not json";
      });

      // A project click must agree with the Work project row already visible.
      expect(projectWorkspaceProfile(loadWorkspaceProfiles(), workPath)).toBe(
        "personal",
      );
      act(() => latest.selectProjectProfile(workPath));
      expect(latest.activeProfileId).toBe("work");
      expect(latest.projectProfile(workPath)).toBe("work");
      expect(latest.projectsByProfile).toBe(previews);
      expect(latest.profileProjects.map((project) => project.path)).toEqual([
        workPath,
        otherWorkPath,
      ]);

      // Missing data on a storage notification is not an intentional reset.
      for (const key of [WORKSPACE_PROFILES_KEY, null]) {
        act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
        expect(latest.activeProfileId).toBe("work");
        expect(latest.projectsByProfile).toBe(previews);
      }

      // Retaining assignments must still allow deliberate cross-workspace opens.
      act(() => latest.selectProjectProfile(personalPath));
      expect(latest.activeProfileId).toBe("personal");
      act(() => latest.selectProjectProfile(workPath));
      expect(latest.activeProfileId).toBe("work");
    },
  );

  it("uses an assignment or move immediately even when its write fails", () => {
    render(personalPath);
    const holoPath = "/Users/test/Projects/HOLO";
    const write = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === WORKSPACE_PROFILES_KEY) throw new Error("Storage unavailable");
      write(key, value);
    });

    act(() => {
      latest.assignProject(holoPath, "work");
      latest.selectProjectProfile(holoPath);
    });
    expect(latest.activeProfileId).toBe("work");
    expect(latest.projectProfile(holoPath)).toBe("work");
    // The persisted snapshot still lacks the new assignment.
    expect(projectWorkspaceProfile(loadWorkspaceProfiles(), holoPath)).toBe(
      "personal",
    );
    for (const key of [WORKSPACE_PROFILES_KEY, null]) {
      act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
      act(() => latest.selectProjectProfile(holoPath));
      expect(latest.activeProfileId).toBe("work");
      expect(latest.projectProfile(holoPath)).toBe("work");
    }
    render(holoPath);
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      workPath,
      otherWorkPath,
      holoPath,
    ]);

    act(() => {
      latest.moveProject(holoPath, "personal");
      latest.selectProjectProfile(holoPath);
    });
    expect(latest.activeProfileId).toBe("personal");
    expect(latest.projectProfile(holoPath)).toBe("personal");
    expect(latest.projectProfile(workPath)).toBe("work");
  });

  it("adopts valid profile moves from another window", () => {
    render(personalPath);
    saveWorkspaceProfiles(
      assignWorkspaceProject(loadWorkspaceProfiles(), workPath, "personal"),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: WORKSPACE_PROFILES_KEY }),
      );
    });
    expect(latest.projectProfile(workPath)).toBe("personal");
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      personalPath,
      workPath,
    ]);
    act(() => latest.selectProjectProfile(workPath));
    expect(latest.activeProfileId).toBe("personal");
    act(() => latest.selectProjectProfile(otherWorkPath));
    expect(latest.activeProfileId).toBe("work");
  });

  it("adopts a changed external snapshot after a local write fails", () => {
    render(personalPath);
    const write = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === WORKSPACE_PROFILES_KEY) throw new Error("Storage unavailable");
      write(key, value);
    });
    act(() => latest.moveProject(workPath, "personal"));
    expect(latest.projectProfile(workPath)).toBe("personal");

    const external = assignWorkspaceProject(
      configuredProfiles(),
      otherWorkPath,
      "personal",
    );
    write(WORKSPACE_PROFILES_KEY, JSON.stringify(external));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: WORKSPACE_PROFILES_KEY }),
      );
    });
    expect(latest.projectProfile(workPath)).toBe("work");
    expect(latest.projectProfile(otherWorkPath)).toBe("personal");
  });

  it("accepts an explicit complete reset from another window", () => {
    const initial = configuredProfiles();
    initial.activeProfileId = "work";
    initial.profiles.push({ id: "research", name: "Research", icon: "folder" });
    saveWorkspaceProfiles(initial);
    render(workPath);

    const reset = defaultWorkspaceProfiles();
    saveWorkspaceProfiles(reset);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: WORKSPACE_PROFILES_KEY }),
      );
    });
    expect(latest.profiles).toEqual(reset.profiles);
    expect(latest.activeProfileId).toBe("personal");
    expect(latest.projectProfile(workPath)).toBe("personal");
    expect(latest.projectProfile(otherWorkPath)).toBe("personal");
  });

  it("restores standalone sessions to their workspace without adding project cards or changing their membership", () => {
    const standalone =
      "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces/work";
    localStorage.setItem(
      "monocode.projectlessWorkspaces.v1",
      JSON.stringify({ work: standalone }),
    );
    const initial = configuredProfiles();
    initial.activeProfileId = "work";
    initial.lastProjectByProfile.work = standalone;
    // Ignore a stale attempt to reassign the managed path as a project.
    initial.projectProfiles[standalone] = "personal";
    saveWorkspaceProfiles(initial);
    const restored = loadWorkspaceProfiles();
    expect(projectWorkspaceProfile(restored, standalone)).toBe("work");
    expect(restored.projectProfiles[standalone]).toBeUndefined();
    expect(workspaceProjectTarget(restored, projects, "work")).toBe(standalone);
    expect(assignWorkspaceProject(restored, standalone, "personal")).toBe(
      restored,
    );
    expect(
      projectsForWorkspace(
        restored,
        [...projects, { path: standalone, openedAt: 40 }],
        "work",
      ),
    ).toHaveLength(2);
    render(standalone);
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      workPath,
      otherWorkPath,
    ]);
    expect(loadWorkspaceProfiles().lastProjectByProfile.work).toBe(standalone);
    act(() => {
      latest.selectProfile("personal");
    });
    // A still-rendered Work session cannot overwrite the Personal target.
    expect(
      loadWorkspaceProfiles().lastProjectByProfile.personal,
    ).toBeUndefined();
    render(personalPath);
    let target = "";
    act(() => {
      target = latest.selectProfile("work");
    });
    expect(target).toBe(standalone);
    expect(loadWorkspaceProfiles().lastProjectByProfile.work).toBe(standalone);
  });

  it("keeps a standalone last target across storage reload, including a workspace with no projects", () => {
    const cwd =
      "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces/personal";
    localStorage.setItem(
      "monocode.projectlessWorkspaces.v1",
      JSON.stringify({ personal: cwd }),
    );
    render(cwd);
    const stored = loadWorkspaceProfiles();
    expect(stored.lastProjectByProfile.personal).toBe(cwd);
    expect(workspaceProjectTarget(stored, [], "personal")).toBe(cwd);
    expect(workspaceProjectTarget(stored, [], "work")).toBe("~");
  });

  it("does not remember a previous workspace project during an async switch", () => {
    const initial = configuredProfiles();
    initial.lastProjectByProfile.work = otherWorkPath;
    saveWorkspaceProfiles(initial);
    render(personalPath);
    let target = "";
    act(() => {
      target = latest.selectProfile("work");
    });
    expect(target).toBe(otherWorkPath);
    expect(latest.activeProfileId).toBe("work");
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      workPath,
      otherWorkPath,
    ]);
    expect(loadWorkspaceProfiles().lastProjectByProfile.work).toBe(
      otherWorkPath,
    );
    render(workPath);
    expect(loadWorkspaceProfiles().lastProjectByProfile.work).toBe(workPath);
    act(() => {
      target = latest.selectProfile("personal");
    });
    expect(target).toBe(personalPath);
    expect(loadWorkspaceProfiles().lastProjectByProfile.personal).toBe(
      personalPath,
    );
  });

  it("assigns new projects to the selected workspace and returns a safe target after moving the current one", () => {
    render(personalPath);
    act(() => {
      latest.selectProfile("work");
    });
    render(workPath);
    act(() => {
      latest.assignProject("/tmp/new-project");
    });
    expect(
      projectWorkspaceProfile(loadWorkspaceProfiles(), "/tmp/new-project"),
    ).toBe("work");
    let replacement = "";
    act(() => {
      replacement = latest.moveProject(workPath, "personal");
    });
    expect(replacement).toBe(otherWorkPath);
    expect(latest.profileProjects.map((project) => project.path)).toEqual([
      otherWorkPath,
    ]);
  });

  it("creates persistent empty workspaces without reusing a foreign project", () => {
    const inherited = {
      hue: 265,
      saturation: 18,
      preference: "dark",
      opacity: 0.2,
      blur: 12,
      bodyGlass: true,
    };
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({ version: 1, fallback: inherited, themes: {} }),
    );
    render(personalPath);
    let id = "";
    let target = "";
    act(() => {
      id = latest.createProfile(" Research ");
      target = latest.selectProfile(id);
    });
    expect(target).toBe("~");
    expect(latest.activeProfile.name).toBe("Research");
    expect(latest.profileProjects).toEqual([]);
    expect(
      loadWorkspaceProfiles().profiles.find((profile) => profile.id === id)
        ?.name,
    ).toBe("Research");
    expect(loadWorkspaceTheme(id)).toEqual(defaultWorkspaceTheme());
    expect(loadWorkspaceTheme("personal")).toEqual({
      ...inherited,
      matchPanels: false,
    });
  });
});

describe("workspace swipe intent", () => {
  it("accepts horizontal travel in both directions", () => {
    expect(workspaceSwipeDirection(75, 4)).toBe(1);
    expect(workspaceSwipeDirection(-90, 18)).toBe(-1);
  });
  it("ignores short gestures, vertical scroll, and ambiguous diagonals", () => {
    expect(workspaceSwipeDirection(40, 0)).toBe(0);
    expect(workspaceSwipeDirection(100, 180)).toBe(0);
    expect(workspaceSwipeDirection(90, 65)).toBe(0);
    expect(workspaceSwipeDirection(70, 0, 72)).toBe(0);
  });
});
