// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceTheme } from "../lib/workspaceThemes";
import { useRecentProjects } from "../hooks/useRecentProjects";
import { RECENT_PROJECTS_KEY } from "../lib/recents";
import {
  assignWorkspaceProject,
  defaultWorkspaceProfiles,
  restoreProfileWorkspace,
  saveWorkspaceProfiles,
  useWorkspaceProfiles,
} from "../lib/workspaceProfiles";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  HAS_NATIVE_GLASS: true,
  IS_MAC: true,
}));
const idleUpdate = vi.hoisted(() => ({
  phase: "idle",
  currentVersion: "0.1.41",
}));
vi.mock("../lib/updater", () => ({
  readAppVersion: vi.fn().mockResolvedValue("0.1.41"),
  getUpdaterSnapshot: () => idleUpdate,
  subscribeUpdater: () => () => {},
  startAutomaticUpdates: () => () => {},
}));

let root: Root;
let container: HTMLDivElement;
const noop = () => {};
const props: SidebarProps = {
  cwd: "~",
  open: true,
  sessions: [],
  busySessionIds: new Set(),
  approvalSessionIds: new Set(),
  status: "idle",
  pending: false,
  onSelectSession: noop,
  onOpenFile: noop,
  tab: "sessions",
  onTabChange: noop,
  filesSearchOpen: false,
  onFilesSearchOpenChange: noop,
  onSelectProfile: noop,
};

function ProjectNavigationSidebar() {
  const [cwd, setCwd] = useState("/projects/Catalog");
  const recentProjects = useRecentProjects();
  const profiles = useWorkspaceProfiles(recentProjects.recents, cwd);
  const selectProject = (path: string) => {
    profiles.selectProjectProfile(path);
    setCwd(path);
    recentProjects.remember(path);
  };
  return createElement(Sidebar, {
    ...props,
    cwd,
    recents: profiles.profileProjects,
    profiles: profiles.profiles,
    activeProfileId: profiles.activeProfileId,
    onSelectProject: selectProject,
    onDeleteProfile: profiles.deleteProfile,
    onSelectProfile: (id) =>
      restoreProfileWorkspace(id, profiles.selectProfile, selectProject),
  });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    target.click();
  });
}
function menu() {
  return document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Switch workspace"]',
  );
}

async function rightClick(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    );
  });
}
function actions(name: string) {
  return document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="Actions for ${name}"]`,
  );
}
function item(container: HTMLElement | null, label: string) {
  return [
    ...(container?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((button) => button.textContent?.startsWith(label));
}

describe("sidebar workspace navigation", () => {
  it("deletes a workspace you are not in from its right-click menu", async () => {
    const state = assignWorkspaceProject(
      defaultWorkspaceProfiles(),
      "/projects/Catalog",
      "work",
    );
    saveWorkspaceProfiles(state);
    await act(async () => root.render(createElement(ProjectNavigationSidebar)));
    await rightClick(button("Work workspace"));
    const workMenu = actions("Work");
    expect(item(workMenu, "Switch to Work")).toBeDefined();
    await click(item(workMenu, "Delete workspace…")!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Delete “Work”?",
    );
    const confirm = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find((button) => button.textContent === "Delete workspace")!;
    await click(confirm as HTMLElement);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button("Work workspace")).toBeNull();
    expect(button("Switch workspace, Personal")).not.toBeNull();
    expect(container.textContent).toContain("Catalog");
  });

  it("never offers to delete Personal from its right-click menu", async () => {
    await act(async () => root.render(createElement(ProjectNavigationSidebar)));
    await rightClick(button("Personal workspace"));
    const remove = item(actions("Personal"), "Delete workspace…");
    expect(
      remove?.disabled ?? remove?.getAttribute("aria-disabled"),
    ).toBeTruthy();
    expect(item(actions("Personal"), "Switch to")).toBeUndefined();
  });

  it("opens workspace actions from the header and from a switcher row", async () => {
    const state = defaultWorkspaceProfiles();
    state.activeProfileId = "work";
    saveWorkspaceProfiles(state);
    await act(async () => root.render(createElement(ProjectNavigationSidebar)));
    await rightClick(button("Switch workspace, Work"));
    expect(actions("Work")).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await click(button("Switch workspace, Work"));
    const row = [
      ...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.includes("Personal"))!;
    await rightClick(row);
    expect(menu()).toBeNull();
    expect(item(actions("Personal"), "Switch to Personal")).toBeDefined();
  });

  it("deletes through the workspace menu and confirmation while retaining its projects", async () => {
    const state = assignWorkspaceProject(
      defaultWorkspaceProfiles(),
      "/projects/Catalog",
      "work",
    );
    state.activeProfileId = "work";
    saveWorkspaceProfiles(state);
    await act(async () => root.render(createElement(ProjectNavigationSidebar)));
    await click(button("Switch workspace, Work"));
    const remove = [...menu()!.querySelectorAll("button")].find(
      (button) => button.textContent === "Delete workspace…",
    )!;
    await click(remove);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Delete “Work”?",
    );
    expect(button("Switch workspace, Work")).not.toBeNull();
    const confirm = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find((button) => button.textContent === "Delete workspace")!;
    await click(confirm as HTMLElement);
    expect(button("Switch workspace, Personal")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(button("Switch workspace, Personal"));
    expect(menu()?.textContent).toBe("Personal");
    expect(container.textContent).toContain("Catalog");
  });

  it.each([false, true])(
    "keeps Work projects and their workspace after storage loss (writes fail: %s)",
    async (writesFail) => {
      const paths = ["/projects/HOLO", "/projects/Catalog", "/projects/Aven"];
      localStorage.setItem(
        RECENT_PROJECTS_KEY,
        JSON.stringify(
          paths.map((path, index) => ({ path, openedAt: 3 - index })),
        ),
      );
      let initial = defaultWorkspaceProfiles();
      for (const path of paths.slice(0, 2))
        initial = assignWorkspaceProject(initial, path, "work");
      saveWorkspaceProfiles({ ...initial, activeProfileId: "work" });
      await act(async () =>
        root.render(createElement(ProjectNavigationSidebar)),
      );

      const content = () =>
        container.querySelector<HTMLElement>(".personal-profile-content")!;
      const visibleButton = (label: string) =>
        content().querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        )!;
      const visibleProjects = () =>
        [
          ...content().querySelectorAll<HTMLButtonElement>(
            ".personal-project-open",
          ),
        ]
          .map((item) => item.title)
          .sort();
      const expectWork = () => {
        expect(visibleButton("Switch workspace, Work")).not.toBeNull();
        expect(visibleProjects()).toEqual(paths.slice(0, 2).sort());
      };
      expectWork();
      if (writesFail)
        vi.spyOn(localStorage, "setItem").mockImplementation(() => {
          throw new Error("Storage unavailable");
        });
      await act(async () => {
        localStorage.clear();
        window.dispatchEvent(new StorageEvent("storage", { key: null }));
      });
      expectWork();

      for (const name of ["HOLO", "Catalog", "HOLO"]) {
        await click(visibleButton(`Open ${name} project`));
        expectWork();
        expect(
          content()
            .querySelector(
              ".personal-project-row[data-active=true] .personal-project-open",
            )
            ?.getAttribute("title"),
        ).toBe(`/projects/${name}`);
      }
      await click(visibleButton("Switch workspace, Work"));
      await click(
        [...menu()!.querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent === "Personal",
        )!,
      );
      expect(visibleButton("Switch workspace, Personal")).not.toBeNull();
      expect(visibleProjects()).toEqual(["/projects/Aven"]);
      await click(visibleButton("Open Aven project"));
      expect(visibleButton("Switch workspace, Personal")).not.toBeNull();
      expect(visibleProjects()).toEqual(["/projects/Aven"]);
      await click(visibleButton("Switch workspace, Personal"));
      await click(
        [...menu()!.querySelectorAll<HTMLButtonElement>("button")].find(
          (item) => item.textContent === "Work",
        )!,
      );
      expectWork();
    },
  );

  it("switches profiles from the heading without changing appearance", async () => {
    const select = vi.fn();
    const before = loadWorkspaceTheme("personal");
    await act(async () =>
      root.render(
        createElement(Sidebar, { ...props, onSelectProfile: select }),
      ),
    );
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(document.querySelector('[aria-label^="Customize"]')).toBeNull();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const work = [
      ...menu()!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((item) => item.textContent?.includes("Work"))!;
    await click(work);
    expect(select).toHaveBeenCalledExactlyOnceWith("work");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(loadWorkspaceTheme("personal")).toEqual(before);
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          ...props,
          activeProfileId: "work",
          onSelectProfile: select,
        }),
      ),
    );
    expect(button("Switch workspace, Work")).not.toBeNull();
  });

  it("closes when the heading is clicked again after pointer focus returns", async () => {
    await act(async () => root.render(createElement(Sidebar, props)));
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    await act(async () =>
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    expect(menu()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes labeled Notes, Inbox and Automations tabs with current-page state and optional Notes", async () => {
    const notes = vi.fn(),
      inbox = vi.fn(),
      automations = vi.fn();
    const current = {
      ...props,
      onOpenNotes: notes,
      onOpenInbox: inbox,
      onOpenAutomations: automations,
      notesActive: true,
    };
    await act(async () => root.render(createElement(Sidebar, current)));
    const libraries = [
      ...container.querySelectorAll('nav[aria-label="Library"]'),
    ].filter((node) => !node.closest('[inert],[aria-hidden="true"]'));
    expect(libraries).toHaveLength(1);
    const library = libraries[0];
    const actions = [...library.querySelectorAll<HTMLButtonElement>("button")];
    expect(actions.map((item) => item.textContent)).toEqual([
      "Notes",
      "Inbox",
      "Automations",
    ]);
    expect(actions.map((item) => item.getAttribute("aria-current"))).toEqual([
      "page",
      null,
      null,
    ]);
    expect(actions[1].title).toContain("GitHub");
    expect(actions[2].title).toContain("schedule");
    await click(actions[0]);
    await click(actions[1]);
    await click(actions[2]);
    expect(notes).toHaveBeenCalledOnce();
    expect(inbox).toHaveBeenCalledOnce();
    expect(automations).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          ...current,
          notesActive: false,
          automationsActive: true,
        }),
      ),
    );
    expect(
      [...library.querySelectorAll("button")].map((item) =>
        item.getAttribute("aria-current"),
      ),
    ).toEqual([null, null, "page"]);
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          ...current,
          notesEnabled: false,
          notesActive: false,
          inboxActive: true,
        }),
      ),
    );
    expect(
      [...library.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Inbox", "Automations"]);
    expect(library.querySelector("button")?.getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("keeps appearance in Settings and clears the switcher when the sidebar hides", async () => {
    const section = vi.fn();
    await act(async () => root.render(createElement(Sidebar, props)));
    await click(button("Switch workspace, Personal"));
    expect(menu()).not.toBeNull();
    await act(async () =>
      root.render(createElement(Sidebar, { ...props, open: false })),
    );
    expect(menu()).toBeNull();
    await act(async () =>
      root.render(
        createElement(Sidebar, {
          ...props,
          settingsOpen: true,
          onSelectSettingsSection: section,
          onCloseSettings: noop,
          onOpenInbox: noop,
          onOpenAutomations: noop,
          onOpenNotes: noop,
        }),
      ),
    );
    expect(container.querySelector('nav[aria-label="Library"]')).toBeNull();
    const appearance = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Appearance"]',
    )!;
    await click(appearance);
    expect(section).toHaveBeenCalledExactlyOnceWith("appearance");
  });
});
