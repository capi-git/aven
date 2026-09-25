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
const idleUpdate = vi.hoisted(() => ({ phase: "idle", currentVersion: "0.1.41" }));
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
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Switch workspace"]');
}

describe("sidebar workspace navigation", () => {
  it.each([false, true])(
    "keeps Work projects and their workspace after storage loss (writes fail: %s)",
    async (writesFail) => {
      const paths = ["/projects/HOLO", "/projects/Catalog", "/projects/Aven"];
      localStorage.setItem(
        RECENT_PROJECTS_KEY,
        JSON.stringify(paths.map((path, index) => ({ path, openedAt: 3 - index }))),
      );
      let initial = defaultWorkspaceProfiles();
      for (const path of paths.slice(0, 2))
        initial = assignWorkspaceProject(initial, path, "work");
      saveWorkspaceProfiles({ ...initial, activeProfileId: "work" });
      await act(async () => root.render(createElement(ProjectNavigationSidebar)));

      const content = () => container.querySelector<HTMLElement>(".personal-profile-content")!;
      const visibleButton = (label: string) =>
        content().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
      const visibleProjects = () =>
        [...content().querySelectorAll<HTMLButtonElement>(".personal-project-open")]
          .map((item) => item.title).sort();
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
        expect(content().querySelector(".personal-project-row[data-active=true] .personal-project-open")?.getAttribute("title"))
          .toBe(`/projects/${name}`);
      }
      await click(visibleButton("Switch workspace, Work"));
      await click([...menu()!.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "Personal")!);
      expect(visibleButton("Switch workspace, Personal")).not.toBeNull();
      expect(visibleProjects()).toEqual(["/projects/Aven"]);
      await click(visibleButton("Open Aven project"));
      expect(visibleButton("Switch workspace, Personal")).not.toBeNull();
      expect(visibleProjects()).toEqual(["/projects/Aven"]);
      await click(visibleButton("Switch workspace, Personal"));
      await click([...menu()!.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "Work")!);
      expectWork();
    },
  );

  it("switches profiles from the heading without changing appearance", async () => {
    const select = vi.fn();
    const before = loadWorkspaceTheme("personal");
    await act(async () => root.render(createElement(Sidebar, { ...props, onSelectProfile: select })));
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(document.querySelector('[aria-label^="Customize"]')).toBeNull();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const work = [...menu()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Work"))!;
    await click(work);
    expect(select).toHaveBeenCalledExactlyOnceWith("work");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(loadWorkspaceTheme("personal")).toEqual(before);
    await act(async () => root.render(createElement(Sidebar, { ...props, activeProfileId: "work", onSelectProfile: select })));
    expect(button("Switch workspace, Work")).not.toBeNull();
  });

  it("closes when the heading is clicked again after pointer focus returns", async () => {
    await act(async () => root.render(createElement(Sidebar, props)));
    const trigger = button("Switch workspace, Personal");
    await click(trigger);
    expect(menu()).not.toBeNull();
    await act(async () => trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    expect(menu()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes labeled Notes and Inbox shortcuts with current-page state and optional Notes", async () => {
    const notes = vi.fn(), inbox = vi.fn();
    const current = { ...props, onOpenNotes: notes, onOpenInbox: inbox, notesActive: true };
    await act(async () => root.render(createElement(Sidebar, current)));
    const libraries = [...container.querySelectorAll('nav[aria-label="Library"]')].filter(
      (node) => !node.closest('[inert],[aria-hidden="true"]'),
    );
    expect(libraries).toHaveLength(1);
    const library = libraries[0];
    const actions = [...library.querySelectorAll<HTMLButtonElement>("button")];
    expect(actions.map((item) => item.textContent)).toEqual(["Notes", "Inbox"]);
    expect(actions[0].getAttribute("aria-current")).toBe("page");
    expect(actions[1].title).toContain("GitHub");
    await click(actions[0]); await click(actions[1]);
    expect(notes).toHaveBeenCalledOnce(); expect(inbox).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement(Sidebar, { ...current, notesEnabled: false, notesActive: false, inboxActive: true })));
    expect(library.querySelectorAll("button")).toHaveLength(1);
    expect(library.querySelector("button")?.getAttribute("aria-current")).toBe("page");
  });

  it("keeps appearance in Settings and clears the switcher when the sidebar hides", async () => {
    const section = vi.fn();
    await act(async () => root.render(createElement(Sidebar, props)));
    await click(button("Switch workspace, Personal"));
    expect(menu()).not.toBeNull();
    await act(async () => root.render(createElement(Sidebar, { ...props, open: false })));
    expect(menu()).toBeNull();
    await act(async () => root.render(createElement(Sidebar, { ...props, settingsOpen: true, onSelectSettingsSection: section, onCloseSettings: noop, onOpenInbox: noop, onOpenNotes: noop })));
    expect(container.querySelector('nav[aria-label="Library"]')).toBeNull();
    const appearance = container.querySelector<HTMLButtonElement>('button[aria-label="Appearance"]')!;
    await click(appearance);
    expect(section).toHaveBeenCalledExactlyOnceWith("appearance");
  });
});
