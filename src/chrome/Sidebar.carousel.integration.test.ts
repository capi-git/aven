// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { saveSessionFolders } from "../lib/sessionFolders";
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
    onToggle,
    expanded,
  }: {
    path: string;
    onSelect: () => void;
    onToggle: () => void;
    expanded: boolean;
  }) =>
    createElement(
      "div",
      null,
      createElement(
        "button",
        { "data-live-project": path, onClick: onSelect },
        path,
      ),
      createElement(
        "button",
        {
          "data-toggle-project": path,
          "aria-expanded": expanded,
          onClick: onToggle,
        },
        "Toggle project tasks",
      ),
    ),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));

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
let loadMoreCallbacks: Set<() => void>;
const sidebarCommitPhases: string[] = [];

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
function longProjectData(
  profile: "personal" | "work",
  cwd = projectPaths[profile],
): Partial<SidebarProps> {
  return {
    ...activeData(profile),
    cwd,
    recents: [{ path: cwd, openedAt: 1 }],
    activeSessionId: undefined,
    sessions: Array.from({ length: 96 }, (_, index) => ({
      ...session(profile),
      cwd,
      id: `${cwd}-task-${index}`,
      title: `${profile === "personal" ? "Personal" : "Work"} Task ${index}`,
      updatedAt: 200 - index,
    })),
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
function taskScroller() {
  return body().querySelector<HTMLElement>(".personal-projects-scroll")!;
}
function taskCount() {
  return body().querySelectorAll("[data-session-card]").length;
}
async function scrollTasks(top: number) {
  await act(async () => {
    taskScroller().scrollTop = top;
    taskScroller().dispatchEvent(new Event("scroll"));
  });
}
async function loadNextPage() {
  expect(loadMoreCallbacks.size).toBe(1);
  await act(async () => [...loadMoreCallbacks][0]());
}
async function changeTaskQuery(value: string) {
  const input = body().querySelector<HTMLInputElement>(
    '[aria-label="Filter tasks"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function accessible(selector: string) {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => !node.closest("[inert],[aria-hidden=true]"),
  );
}
async function render(patch: Partial<SidebarProps> = {}) {
  props = { ...props, ...patch };
  await act(async () =>
    root.render(
      createElement(
        Profiler,
        {
          id: "sidebar",
          onRender: (_id, phase) => sidebarCommitPhases.push(phase),
        },
        createElement(Sidebar, props),
      ),
    ),
  );
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
  expect(
    accessible('button[aria-label="New session without a project"]'),
  ).toHaveLength(1);
  expect(accessible("[data-live-project]")).toHaveLength(1);
  expect(accessible(".personal-profile-header")).toHaveLength(1);
  expect(accessible(".personal-profile-picker")).toHaveLength(1);
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
  loadMoreCallbacks = new Set();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private emit: () => void;
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        this.emit = () => callback([{ isIntersecting: true }]);
      }
      observe() {
        loadMoreCallbacks.add(this.emit);
      }
      unobserve() {
        loadMoreCallbacks.delete(this.emit);
      }
      disconnect() {
        loadMoreCallbacks.delete(this.emit);
      }
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

it("restores each workspace's folders without a second warm layout commit", async () => {
  for (const profile of ["personal", "work"] as const) {
    saveSessionFolders(projectPaths[profile], [
      {
        id: `${profile}-folder`,
        name: `${profile} folder`,
        sessionIds: [`${profile}-task`],
        collapsed: profile === "work",
      },
    ]);
  }
  await render(activeData("work"));
  await render(activeData("personal"));
  expect(
    body()
      .querySelector('[data-session-folder="personal-folder"] button')
      ?.getAttribute("aria-expanded"),
  ).toBe("true");

  sidebarCommitPhases.length = 0;
  await render(activeData("work"));
  expect(sidebarCommitPhases).not.toContain("nested-update");
  const workFolder = body().querySelector<HTMLButtonElement>(
    '[data-session-folder="work-folder"] button',
  )!;
  expect(workFolder.getAttribute("aria-expanded")).toBe("false");
  await act(async () => workFolder.click());
  expect(workFolder.getAttribute("aria-expanded")).toBe("true");

  await render(activeData("personal"));
  saveSessionFolders(projectPaths.work, [
    {
      id: "work-folder",
      name: "Changed elsewhere",
      sessionIds: ["work-task"],
      collapsed: true,
    },
  ]);
  sidebarCommitPhases.length = 0;
  await render(activeData("work"));
  expect(sidebarCommitPhases).not.toContain("nested-update");
  const restored = body().querySelector<HTMLButtonElement>(
    '[data-session-folder="work-folder"] button',
  )!;
  expect(restored.title).toBe("Changed elsewhere");
  expect(restored.getAttribute("aria-expanded")).toBe("false");
  expect(
    body().querySelector('[data-session-folder="personal-folder"]'),
  ).toBeNull();
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

it("slides each workspace heading and library with its task page while window controls and footer stay fixed", async () => {
  const search = vi.fn();
  const notes = vi.fn();
  const inbox = vi.fn();
  await render({ onSearch: search, onOpenNotes: notes, onOpenInbox: inbox });
  const liveBody = body();
  const heading = body().querySelector<HTMLElement>(
    ".personal-profile-header",
  )!;
  const library = body().querySelector<HTMLElement>(".personal-library-nav")!;
  const windowbar = container.querySelector(".personal-sidebar-windowbar")!;
  const footer = container.querySelector('[aria-label="Workspace switcher"]')!;
  expect(heading).not.toBeNull();
  expect(library).not.toBeNull();
  expect(heading.closest(".personal-profile-viewport")).toBe(viewport());
  expect(library.closest(".personal-profile-viewport")).toBe(viewport());
  expect(windowbar.closest(".personal-profile-viewport")).toBeNull();
  expect(footer.closest(".personal-profile-viewport")).toBeNull();
  expect(library.textContent).toContain("Notes");
  expect(library.textContent).toContain("Inbox");
  expect(accessible(".personal-library-nav")).toHaveLength(1);

  const coldPreview = container.querySelector<HTMLElement>(
    '[data-profile-preview="work"]',
  )!;
  expect(
    coldPreview.querySelector(".personal-profile-header")?.textContent,
  ).toContain("Work");
  expect(
    coldPreview.querySelector(".personal-library-nav")?.textContent,
  ).toContain("Notes");
  expect(
    coldPreview.querySelector(".personal-library-nav")?.textContent,
  ).toContain("Inbox");
  expect(coldPreview.querySelector("button,a,input,[tabindex]")).toBeNull();

  for (const profile of ["work", "personal"] as const) {
    const outgoingProfile = profile === "work" ? "personal" : "work";
    await settledNativePage(profile === "work" ? 1 : 0);
    await render(activeData(profile));
    expect(body()).toBe(liveBody);
    expect(body().querySelector(".personal-profile-header")).toBe(heading);
    expect(body().querySelector(".personal-library-nav")).toBe(library);
    expect(heading.textContent).toContain(
      profile === "work" ? "Work" : "Personal",
    );
    const preview = container.querySelector<HTMLElement>(
      `[data-profile-preview="${outgoingProfile}"]`,
    )!;
    expect(preview.querySelector(".personal-profile-snapshot")).not.toBeNull();
    expect(
      preview.querySelector(".personal-profile-header")?.textContent,
    ).toContain(outgoingProfile === "work" ? "Work" : "Personal");
    expect(
      preview.querySelector(".personal-library-nav")?.textContent,
    ).toContain("Notes");
    expect(
      preview.querySelector(".personal-library-nav")?.textContent,
    ).toContain("Inbox");
    await act(async () => {
      for (const control of preview.querySelectorAll<HTMLButtonElement>(
        "button",
      )) {
        expect(control.tabIndex).toBe(-1);
        control.click();
      }
    });
    expect(search).not.toHaveBeenCalled();
    expect(notes).not.toHaveBeenCalled();
    expect(inbox).not.toHaveBeenCalled();
    expect(container.querySelector(".personal-sidebar-windowbar")).toBe(
      windowbar,
    );
    expect(container.querySelector('[aria-label="Workspace switcher"]')).toBe(
      footer,
    );
    expectOneActiveBody();
    expect(accessible(".personal-library-nav")).toHaveLength(1);
  }
});

it("keeps live heading and library callbacks current after returning from another workspace", async () => {
  const initialSearch = vi.fn();
  const initialNotes = vi.fn();
  const initialInbox = vi.fn();
  await render({
    onSearch: initialSearch,
    onOpenNotes: initialNotes,
    onOpenInbox: initialInbox,
  });
  await settledNativePage(1);
  await render(activeData("work"));
  await settledNativePage(0);
  const search = vi.fn();
  const notes = vi.fn();
  const inbox = vi.fn();
  await render({
    ...activeData("personal"),
    onSearch: search,
    onOpenNotes: notes,
    onOpenInbox: inbox,
  });
  await act(async () => {
    body()
      .querySelector<HTMLButtonElement>(
        '.personal-profile-header button[aria-label^="Search"]',
      )!
      .click();
    const controls = [
      ...body().querySelectorAll<HTMLButtonElement>(
        ".personal-library-nav button",
      ),
    ];
    controls.find((button) => button.textContent === "Notes")!.click();
    controls.find((button) => button.textContent === "Inbox")!.click();
  });
  expect(search).toHaveBeenCalledOnce();
  expect(notes).toHaveBeenCalledOnce();
  expect(inbox).toHaveBeenCalledOnce();
  expect(initialSearch).not.toHaveBeenCalled();
  expect(initialNotes).not.toHaveBeenCalled();
  expect(initialInbox).not.toHaveBeenCalled();
  expectOneActiveBody();
});

it("keeps the workspace heading and settings controls usable outside the carousel and restores the full page afterwards", async () => {
  const search = vi.fn();
  const notes = vi.fn();
  const inbox = vi.fn();
  const selectSettings = vi.fn();
  const closeSettings = vi.fn();
  await render({ onSearch: search, onOpenNotes: notes, onOpenInbox: inbox });
  await render({
    settingsOpen: true,
    settingsSection: "appearance",
    onSelectSettingsSection: selectSettings,
    onCloseSettings: closeSettings,
  });
  expect(container.querySelector(".personal-profile-viewport")).toBeNull();
  expect(container.querySelectorAll(".personal-profile-header")).toHaveLength(
    1,
  );
  expect(container.querySelectorAll(".personal-profile-picker")).toHaveLength(
    1,
  );
  expect(
    container.querySelector(".personal-profile-header")?.textContent,
  ).toContain("Personal");
  expect(container.querySelector(".personal-library-nav")).toBeNull();
  const settings = container.querySelector<HTMLElement>(
    '[aria-label="Settings sections"]',
  )!;
  expect(settings).not.toBeNull();
  expect(settings.closest(".personal-profile-viewport")).toBeNull();
  expect(
    settings
      .querySelector('[data-settings-section="appearance"]')
      ?.getAttribute("aria-current"),
  ).toBe("page");
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        '.personal-profile-header button[aria-label^="Search"]',
      )!
      .click();
    settings
      .querySelector<HTMLButtonElement>('[data-settings-section="providers"]')!
      .click();
    container
      .querySelector<HTMLButtonElement>(
        '.settings-nav button[aria-label="Back"]',
      )!
      .click();
  });
  expect(search).toHaveBeenCalledOnce();
  expect(selectSettings).toHaveBeenCalledExactlyOnceWith("providers");
  expect(closeSettings).toHaveBeenCalledOnce();
  await render({ settingsOpen: false });
  expect(
    body().querySelector(".personal-profile-header")?.textContent,
  ).toContain("Personal");
  expect(body().querySelector(".personal-library-nav")).not.toBeNull();
  await act(async () => {
    body()
      .querySelector<HTMLButtonElement>(
        '.personal-profile-header button[aria-label^="Search"]',
      )!
      .click();
    [
      ...body().querySelectorAll<HTMLButtonElement>(
        ".personal-library-nav button",
      ),
    ]
      .find((button) => button.textContent === "Notes")!
      .click();
  });
  expect(search).toHaveBeenCalledTimes(2);
  expect(notes).toHaveBeenCalledOnce();
  expectOneActiveBody();
});

it("restores the live task position and loaded pages per workspace and project, including after settings", async () => {
  const personal = longProjectData("personal");
  const work = longProjectData("work");
  await render(personal);
  expect(taskCount()).toBe(32);
  await loadNextPage();
  expect(taskCount()).toBe(64);
  await scrollTasks(387);
  await settledNativePage(1);
  await render(work);
  expect(taskCount()).toBe(32);
  expect(taskScroller().scrollTop).toBe(0);
  expect(
    container.querySelector<HTMLElement>(
      '[data-profile-preview="personal"] .personal-projects-scroll',
    )!.scrollTop,
  ).toBe(387);
  await scrollTasks(181);
  await settledNativePage(0);
  await render(personal);
  expect(taskCount()).toBe(64);
  expect(taskScroller().scrollTop).toBe(387);
  await settledNativePage(1);
  await render(work);
  expect(taskCount()).toBe(32);
  expect(taskScroller().scrollTop).toBe(181);
  await settledNativePage(0);
  await render(personal);

  await render(longProjectData("personal", "/tmp/AnotherPersonalProject"));
  expect(taskCount()).toBe(32);
  expect(taskScroller().scrollTop).toBe(0);
  await scrollTasks(72);
  await render(personal);
  expect(taskCount()).toBe(64);
  expect(taskScroller().scrollTop).toBe(387);

  const originalScroller = taskScroller();
  await render({
    settingsOpen: true,
    settingsSection: "appearance",
    onSelectSettingsSection: vi.fn(),
    onCloseSettings: vi.fn(),
  });
  expect(container.querySelector(".personal-profile-viewport")).toBeNull();
  await render({ settingsOpen: false });
  expect(taskScroller()).not.toBe(originalScroller);
  expect(taskCount()).toBe(64);
  expect(taskScroller().scrollTop).toBe(387);
});

it("restores the last user scroll position when outgoing content is clamped during a workspace change", async () => {
  const personal = longProjectData("personal");
  await render(personal);
  await scrollTasks(185);
  // React/WebKit can shorten outgoing content before its ref detaches. That
  // geometry clamp is not a new user scroll and must not replace the cache.
  taskScroller().scrollTop = 0;
  await render(longProjectData("work"));
  expect(taskScroller().scrollTop).toBe(0);
  await scrollTasks(91);
  await render(personal);
  expect(taskScroller().scrollTop).toBe(185);
});

it("keeps task search and collapsed project state with their workspace instead of applying them to the next one", async () => {
  const personal = longProjectData("personal");
  const work = longProjectData("work");
  await render(personal);
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Filter tasks by title"]')!
      .click(),
  );
  await changeTaskQuery("Personal");
  expect(
    body().querySelector<HTMLInputElement>('[aria-label="Filter tasks"]')!
      .value,
  ).toBe("Personal");
  await act(async () =>
    body().querySelector<HTMLButtonElement>("[data-toggle-project]")!.click(),
  );
  expect(taskCount()).toBe(0);
  await settledNativePage(1);
  await render(work);
  expect(taskCount()).toBe(32);
  expect(body().querySelector('[aria-label="Filter tasks"]')).toBeNull();
  await settledNativePage(0);
  await render(personal);
  expect(
    body()
      .querySelector("[data-toggle-project]")!
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(taskCount()).toBe(0);
  await act(async () =>
    body().querySelector<HTMLButtonElement>("[data-toggle-project]")!.click(),
  );
  expect(
    body().querySelector<HTMLInputElement>('[aria-label="Filter tasks"]')!
      .value,
  ).toBe("Personal");
  expect(taskCount()).toBe(32);
});

it("restores an open workspace search without stealing editor focus and focuses only on an explicit search request", async () => {
  const personal = longProjectData("personal");
  await render(personal);
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Filter tasks by title"]')!
      .click(),
  );
  const searchInput = () =>
    body().querySelector<HTMLInputElement>('[aria-label="Filter tasks"]')!;
  expect(document.activeElement).toBe(searchInput());
  await changeTaskQuery("Personal");
  const editor = document.createElement("input");
  editor.setAttribute("aria-label", "Outside editor");
  container.append(editor);
  editor.focus();
  await settledNativePage(1);
  await render(longProjectData("work"));
  expect(document.activeElement).toBe(editor);
  await settledNativePage(0);
  await render(personal);
  expect(searchInput().value).toBe("Personal");
  expect(document.activeElement).toBe(editor);
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Filter tasks by title"]')!
      .click(),
  );
  expect(searchInput()).toBeNull();
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Filter tasks by title"]')!
      .click(),
  );
  expect(document.activeElement).toBe(searchInput());
});

it("resets live position and pagination for a genuine task search or filter change", async () => {
  await render(longProjectData("personal"));
  await loadNextPage();
  await scrollTasks(333);
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Filter tasks by title"]')!
      .click(),
  );
  await changeTaskQuery("Task");
  expect(taskScroller().scrollTop).toBe(0);
  expect(taskCount()).toBe(32);
  await loadNextPage();
  await scrollTasks(222);
  await changeTaskQuery("Personal");
  expect(taskScroller().scrollTop).toBe(0);
  expect(taskCount()).toBe(32);
  await loadNextPage();
  await scrollTasks(444);
  await render({
    busySessionIds: new Set(props.sessions.map((entry) => entry.id)),
  });
  await act(async () =>
    body()
      .querySelector<HTMLButtonElement>('[aria-label="Task filters"]')!
      .click(),
  );
  const working = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemcheckbox"]',
    ),
  ].find((button) => button.textContent === "Working")!;
  expect(working).toBeDefined();
  await act(async () => working.click());
  expect(taskScroller().scrollTop).toBe(0);
  expect(taskCount()).toBe(32);
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
    const scroller = body().querySelector<HTMLElement>(
      ".personal-projects-scroll",
    )!;
    scroller.scrollTop = 117;
    // This marker represents live markup that the data-only fallback cannot recreate.
    scroller.dataset.capturedProjectState = "expanded";
    let target: HTMLButtonElement;
    if (control === "heading") {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Switch workspace, Personal"]',
          )!
          .click();
      });
      target = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ),
      ].find((button) => button.textContent?.includes("Work"))!;
    } else {
      target = [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Workspace switcher"] button',
        ),
      ].find((button) => button.textContent === "Work")!;
    }
    await act(async () => target.click());
    expect(selectProfile).toHaveBeenCalledExactlyOnceWith("work");
    await render(activeData("work"));
    const outgoing = container.querySelector<HTMLElement>(
      '[data-profile-preview="personal"]',
    )!;
    expect(outgoing.querySelector(".personal-profile-snapshot")).not.toBeNull();
    const savedScroller = outgoing.querySelector<HTMLElement>(
      ".personal-projects-scroll",
    )!;
    expect(savedScroller.dataset.capturedProjectState).toBe("expanded");
    expect(savedScroller.scrollTop).toBe(117);
    expect(body()).toBe(originalBody);
    expectOneActiveBody();
  },
);

it("captures a long sidebar without reading scroll geometry from every row and icon", async () => {
  const scroller = body().querySelector<HTMLElement>(
    ".personal-projects-scroll",
  )!;
  scroller.scrollTop = 117;
  const unrelatedGeometry = vi.fn(() => 0);
  for (let index = 0; index < 300; index++) {
    const label = document.createElement("span");
    label.textContent = `Task label ${index}`;
    Object.defineProperties(label, {
      scrollTop: { get: unrelatedGeometry },
      scrollLeft: { get: unrelatedGeometry },
    });
    scroller.append(label);
  }
  await settledNativePage(1);
  expect(unrelatedGeometry).not.toHaveBeenCalled();
  await render(activeData("work"));
  const preview = container.querySelector<HTMLElement>(
    '[data-profile-preview="personal"] .personal-projects-scroll',
  )!;
  expect(preview.scrollTop).toBe(117);
  expect(preview.textContent).toContain("Task label 299");
});

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
