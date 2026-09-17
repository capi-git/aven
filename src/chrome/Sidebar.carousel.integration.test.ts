// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { Sidebar, type SidebarProps } from "./Sidebar";

// Keep Sidebar, its active task controls, carousel hook, and inert previews real.
// Unrelated native menus and project metadata subscriptions are outside this test.
vi.mock("./TitleBar", () => ({
  DevModeSlot: () => null,
  TabVisitNav: () => null,
}));
vi.mock("./WorkspaceThemePopover", () => ({
  WorkspaceThemePopover: () => null,
}));
vi.mock("./PersonalWorkspaceSwitcher", () => ({
  PersonalWorkspaceSwitcher: ({
    profiles,
    onSelectProfile,
  }: {
    profiles: readonly WorkspaceProfile[];
    onSelectProfile?: (id: string) => void;
  }) =>
    createElement(
      "nav",
      { "aria-label": "Workspace switcher" },
      ...profiles.map((profile) =>
        createElement(
          "button",
          { key: profile.id, onClick: () => onSelectProfile?.(profile.id) },
          profile.name,
        ),
      ),
    ),
  WorkspaceProfileIcon: () => null,
}));
vi.mock("./PersonalProjectRow", () => ({
  PersonalProjectRow: ({
    path,
    onSelect,
  }: {
    path: string;
    onSelect: () => void;
  }) =>
    createElement(
      "button",
      { "data-live-project": path, onClick: onSelect },
      path,
    ),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./SettingsRail", () => ({ SettingsNav: () => null }));

const profiles: WorkspaceProfile[] = [
  { id: "personal", name: "Personal", icon: "home" },
  { id: "work", name: "Work", icon: "briefcase" },
];
const projectPaths = { personal: "/tmp/CoveCode", work: "/tmp/HOLO" };
const selectProfile = vi.fn();
const selectProject = vi.fn();
const selectSession = vi.fn();
const expandProject = vi.fn();
const newSession = vi.fn();
let container: HTMLDivElement;
let root: Root;
let props: SidebarProps;

function session(profile: "personal" | "work"): SessionSummary {
  return {
    id: `${profile}-task`,
    cwd: projectPaths[profile],
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "supervised",
    title:
      profile === "personal"
        ? "Polish sidebar"
        : "Improve configuration controls",
    createdAt: 1,
    updatedAt: 2,
    additions: 0,
    deletions: 0,
  };
}
function activeData(profile: "personal" | "work"): Partial<SidebarProps> {
  return {
    activeProfileId: profile,
    cwd: projectPaths[profile],
    recents: [{ path: projectPaths[profile], openedAt: 1 }],
    sessions: [session(profile)],
    activeSessionId: `${profile}-task`,
  };
}
function body() {
  return container.querySelector<HTMLElement>(".personal-profile-content")!;
}
function viewport() {
  return container.querySelector<HTMLElement>(".personal-profile-viewport")!;
}
function pages() {
  return [...container.querySelectorAll<HTMLElement>(".personal-profile-page")];
}
async function render(patch: Partial<SidebarProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(Sidebar, props)));
}
async function settledNativePage(index: number) {
  // happy-dom has no native wheel physics. These are the scroll notifications
  // the mounted Sidebar receives after the browser finishes a native move.
  await act(async () => {
    viewport().scrollLeft = index * 280;
    viewport().dispatchEvent(new Event("scroll"));
    viewport().dispatchEvent(new Event("scrollend"));
  });
}
function expectOneActiveBody() {
  expect(container.querySelectorAll(".personal-profile-content")).toHaveLength(
    1,
  );
  expect(body().closest("[inert],[aria-hidden=true]")).toBeNull();
  const active = (selector: string) =>
    [...container.querySelectorAll(selector)].filter(
      (node) => !node.closest("[inert],[aria-hidden=true]"),
    );
  expect(
    active('button[aria-label="New session without a project"]'),
  ).toHaveLength(1);
  expect(active("[data-live-project]")).toHaveLength(1);
  const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
  expect(new Set(ids).size).toBe(ids.length);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("personal-profile-viewport") ? 280 : 0;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const callback of [
    selectProfile,
    selectProject,
    selectSession,
    expandProject,
    newSession,
  ])
    callback.mockClear();
  props = {
    cwd: projectPaths.personal,
    open: true,
    sessions: [session("personal")],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "personal-task",
    status: "idle",
    pending: false,
    onSelectSession: selectSession,
    onSelectProject: selectProject,
    onExpandProject: expandProject,
    onNewStandalone: newSession,
    onOpenFile: vi.fn(),
    tab: "sessions",
    onTabChange: vi.fn(),
    filesSearchOpen: false,
    onFilesSearchOpenChange: vi.fn(),
    profiles,
    activeProfileId: "personal",
    onSelectProfile: selectProfile,
    recents: [{ path: projectPaths.personal, openedAt: 1 }],
    profilePreviews: {
      personal: {
        id: "personal",
        name: "Personal",
        projects: [
          {
            path: projectPaths.personal,
            name: "CoveCode",
            tasks: [
              { id: "personal-task", title: "Polish sidebar", busy: false },
            ],
          },
        ],
        standaloneTasks: [],
      },
      work: {
        id: "work",
        name: "Work",
        projects: [
          {
            path: projectPaths.work,
            name: "HOLO",
            tasks: [
              {
                id: "work-task",
                title: "Improve configuration controls",
                busy: true,
              },
            ],
          },
        ],
        standaloneTasks: [
          { id: "work-note", title: "Review rollout", busy: false },
        ],
      },
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows actual cached project and task titles in the inactive page without live controls or callbacks", async () => {
  const preview = container.querySelector<HTMLElement>(
    '[data-profile-preview="work"]',
  )!;
  expect(preview.textContent).toContain("HOLO");
  expect(preview.textContent).toContain("Improve configuration controls");
  expect(preview.textContent).toContain("Review rollout");
  expect(preview.closest("[inert]")).not.toBeNull();
  expect(preview.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(
    preview.querySelector(
      "button,a,input,textarea,select,[tabindex],[contenteditable],[data-session-card]",
    ),
  ).toBeNull();
  await act(async () => {
    for (const row of preview.querySelectorAll(
      ".personal-project-row,.personal-task-card",
    ))
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (const callback of [
    selectProfile,
    selectProject,
    selectSession,
    expandProject,
    newSession,
  ])
    expect(callback).not.toHaveBeenCalled();
  expectOneActiveBody();
});

it("retains the single real sidebar body and scroller across consecutive native reversals", async () => {
  const originalBody = body();
  const originalScroller = body().querySelector(".personal-projects-scroll");
  const originalPages = pages();
  const originalControl = body().querySelector<HTMLButtonElement>(
    'button[aria-label="New session without a project"]',
  )!;
  originalControl.id = "current-new-session";
  originalControl.autofocus = true;
  for (const profile of ["work", "personal", "work", "personal"] as const) {
    const outgoingScroller = body().querySelector<HTMLElement>(
      ".personal-projects-scroll",
    )!;
    outgoingScroller.scrollTop = 37;
    await settledNativePage(profile === "work" ? 1 : 0);
    expect(selectProfile).toHaveBeenLastCalledWith(profile);
    await render(activeData(profile));
    expect(body()).toBe(originalBody);
    expect(body().querySelector(".personal-projects-scroll")).toBe(
      originalScroller,
    );
    expect(pages()).toHaveLength(originalPages.length);
    pages().forEach((page, index) => expect(page).toBe(originalPages[index]));
    expectOneActiveBody();
    const inactive = profile === "work" ? "personal" : "work";
    expect(
      container.querySelector(`[data-profile-preview="${profile}"]`),
    ).toBeNull();
    const preview = container.querySelector<HTMLElement>(
      `[data-profile-preview="${inactive}"]`,
    )!;
    expect(preview.closest("[inert]")).not.toBeNull();
    expect(preview.querySelector("[id],[autofocus]")).toBeNull();
    expect(
      preview.querySelector<HTMLElement>(".personal-projects-scroll")!
        .scrollTop,
    ).toBe(37);
    // Revisited pages contain captured markup. Its controls are inert and have
    // no copied React handlers, even if a synthetic event bypasses hit testing.
    const callsBefore = newSession.mock.calls.length;
    await act(async () => {
      for (const control of preview.querySelectorAll<HTMLButtonElement>(
        "button",
      )) {
        expect(control.tabIndex).toBe(-1);
        control.click();
      }
    });
    expect(newSession).toHaveBeenCalledTimes(callsBefore);
    expect(selectProject).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    const create = body().querySelector<HTMLButtonElement>(
      'button[aria-label="New session without a project"]',
    )!;
    await act(async () => create.click());
  }
  expect(selectProfile.mock.calls).toEqual([
    ["work"],
    ["personal"],
    ["work"],
    ["personal"],
  ]);
  expect(newSession).toHaveBeenCalledTimes(4);
  expect(container.querySelector("#current-new-session")).toBe(originalControl);
  expect(originalControl.autofocus).toBe(true);
});

it.each(["footer", "heading"] as const)(
  "preserves the outgoing sidebar markup and scroll position when switching from the %s",
  async (control) => {
    const originalBody = body();
    const scroller = body().querySelector<HTMLElement>(".personal-projects-scroll")!;
    scroller.scrollTop = 117;
    // This marker represents live markup that the data-only fallback cannot recreate.
    scroller.dataset.capturedProjectState = "expanded";
    let target: HTMLButtonElement;
    if (control === "heading") {
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Switch workspace, Personal"]')!.click();
      });
      target = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.includes("Work"))!;
    } else {
      target = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Workspace switcher"] button')]
        .find((button) => button.textContent === "Work")!;
    }
    await act(async () => target.click());
    expect(selectProfile).toHaveBeenCalledExactlyOnceWith("work");
    await render(activeData("work"));
    const outgoing = container.querySelector<HTMLElement>('[data-profile-preview="personal"]')!;
    expect(outgoing.querySelector(".personal-profile-snapshot")).not.toBeNull();
    const savedScroller = outgoing.querySelector<HTMLElement>(".personal-projects-scroll")!;
    expect(savedScroller.dataset.capturedProjectState).toBe("expanded");
    expect(savedScroller.scrollTop).toBe(117);
    expect(body()).toBe(originalBody);
    expectOneActiveBody();
  },
);

it("keeps page identity associated with each workspace through ordering and membership changes", async () => {
  const originalBody = body();
  const [personalPage, workPage] = pages();
  await render({ profiles: [profiles[1], profiles[0]] });
  expect(pages()[0]).toBe(workPage);
  expect(pages()[1]).toBe(personalPage);
  expect(body()).toBe(originalBody);
  const research: WorkspaceProfile = {
    id: "research",
    name: "Research",
    icon: "folder",
  };
  await render({ profiles: [profiles[1], research, profiles[0]] });
  const expandedPages = pages();
  expect(expandedPages).toHaveLength(3);
  expect(expandedPages[0]).toBe(workPage);
  expect(expandedPages[2]).toBe(personalPage);
  expect(expandedPages[1].textContent).toContain("Add a project to Research.");
  expect(body()).toBe(originalBody);
  await render({ profiles });
  expect(pages()).toHaveLength(2);
  expect(pages()[0]).toBe(personalPage);
  expect(pages()[1]).toBe(workPage);
  expectOneActiveBody();
});

it("keeps the footer and native carousel usable while an unfocused shell reports a hidden document", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  const outside = document.createElement("input");
  container.append(outside);
  outside.focus();
  expect(
    container.querySelector('[aria-label="Workspace switcher"]'),
  ).not.toBeNull();
  const event = new WheelEvent("wheel", {
    deltaX: 90,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => body().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  await settledNativePage(1);
  expect(selectProfile).toHaveBeenCalledExactlyOnceWith("work");
  expect(document.activeElement).toBe(outside);
  expectOneActiveBody();
});
