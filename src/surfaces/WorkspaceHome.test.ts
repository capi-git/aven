// @vitest-environment happy-dom
import {
  act,
  createElement,
  Profiler,
  type ComponentProps,
  type ProfilerOnRenderCallback,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHome } from "./WorkspaceHome";
import { useWorkspaceHomeData } from "../hooks/useWorkspaceHomeData";
import type { ActivityEntry } from "../lib/activity";
import { projectKey } from "../lib/paths";
import type { ProjectAppearance } from "../lib/projectAppearance";
import type { Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import { USAGE_STORAGE_KEY } from "../lib/rateLimits";
import { saveTabGroupLabel } from "../lib/tabGroups";
import type {
  HomeAttention,
  HomeFinished,
  HomeProject,
  HomeRunning,
  HomeSession,
} from "../lib/workspaceHome";

// Each project mark reports its renders through a Profiler of its own. The
// home's marks render only when the home itself does, so zero commits here
// means a parent re-render skipped the home entirely.
const marks = vi.hoisted(() => ({ commits: 0 }));
vi.mock("../chrome/ProjectMark", async () => {
  const react = await import("react");
  const onRender: ProfilerOnRenderCallback = () => {
    marks.commits += 1;
  };
  return {
    ProjectMark: ({
      appearance,
      active,
    }: {
      appearance?: ProjectAppearance | null;
      active?: boolean;
    }) =>
      react.createElement(
        react.Profiler,
        { id: "mark", onRender },
        react.createElement("span", {
          "data-mark": appearance?.key ?? "",
          "data-active": active ? "true" : undefined,
        }),
      ),
  };
});

// The customize popover belongs to the identity work and has its own tests.
vi.mock("../chrome/ProjectCustomizePopover", async () => {
  const react = await import("react");
  return {
    ProjectCustomizePopover: ({
      path,
      onClose,
    }: {
      path: string;
      onClose: () => void;
    }) =>
      react.createElement(
        "div",
        { "data-customize": path },
        react.createElement("button", { onClick: onClose }, "Done"),
      ),
  };
});

const APP = "/projects/app";
const SITE = "/projects/site";
const MINUTE = 60_000;

type Props = ComponentProps<typeof WorkspaceHome>;

let root: Root;
let container: HTMLDivElement;
let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  marks.commits = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  saveTabGroupLabel(projectKey(APP), "");
  vi.unstubAllGlobals();
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    profile: "Personal",
    needsYou: [],
    running: [],
    projects: [],
    recent: [],
    onNew: vi.fn(),
    onBrowser: vi.fn(),
    onSearch: vi.fn(),
    onProject: vi.fn(),
    onSession: vi.fn(),
    onNewProjectTask: vi.fn(),
    onAddProject: vi.fn(),
    onLoadProjects: vi.fn(),
    ...overrides,
  };
}

async function render(value: Props) {
  await act(async () => root.render(createElement(WorkspaceHome, value)));
}

const section = (name: string) =>
  [...container.querySelectorAll("section[aria-labelledby]")].find(
    (element) =>
      document.getElementById(element.getAttribute("aria-labelledby")!)
        ?.textContent === name,
  ) as HTMLElement | undefined;

const button = (name: string, within: ParentNode = container) => {
  const found = [...within.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found as HTMLButtonElement;
};

const rowTitles = (element: HTMLElement | undefined) =>
  [...(element?.querySelectorAll(".workspace-home-row strong") ?? [])].map(
    (title) => title.textContent,
  );

function attention(overrides: Partial<HomeAttention>): HomeAttention {
  return {
    id: "s",
    kind: "completed",
    title: "Task",
    cwd: APP,
    detail: "",
    at: Date.now() - 5.5 * MINUTE,
    ...overrides,
  };
}

function recentRow(overrides: Partial<HomeSession>): HomeSession {
  return {
    id: "r",
    title: "Recent task",
    cwd: APP,
    harness: "codex",
    updatedAt: Date.now() - 5.5 * MINUTE,
    ...overrides,
  };
}

function finishedRow(overrides: Partial<HomeFinished>): HomeFinished {
  return {
    id: "f",
    sessionId: "s",
    kind: "completed",
    title: "Finished task",
    cwd: APP,
    detail: "",
    at: Date.now() - 5.5 * MINUTE,
    unread: false,
    ...overrides,
  };
}

const projects: HomeProject[] = [
  {
    path: APP,
    name: "app",
    branch: "main",
    lastActivity: Date.now() - 3.2 * 60 * MINUTE,
    resumeId: "app-latest",
    resumeTitle: "Ship the release",
  },
  { path: SITE, name: "site" },
];

const tiles = () => [
  ...container.querySelectorAll<HTMLElement>(".workspace-home-agent"),
];
const stat = (label: string) =>
  [...container.querySelectorAll<HTMLElement>(".workspace-home-stat")].find(
    (tile) =>
      tile.querySelector(".workspace-home-stat-label")?.textContent === label,
  );

describe("header", () => {
  it("names the workspace and greets with how things stand", async () => {
    await render(
      props({
        needsYou: [
          attention({ id: "a", kind: "approval" }),
          attention({ id: "b" }),
          attention({ id: "c", kind: "failed" }),
        ],
        running: [
          { id: "r1", title: "One", cwd: APP },
          { id: "r2", title: "Two", cwd: SITE },
        ],
      }),
    );
    expect(container.querySelector("h1")?.textContent).toBe("Personal");
    expect(
      container.querySelector(".workspace-home-summary")?.textContent,
    ).toMatch(
      /^(Good morning|Good afternoon|Good evening|Working late)\. 2 agents are working, 1 thing needs you and 2 new replies to read\.$/,
    );
    expect(container.textContent).not.toContain("Make room for your next idea");
  });

  it("says it is quiet when nothing is happening", async () => {
    await render(props({ projects }));
    expect(
      container.querySelector(".workspace-home-summary")?.textContent,
    ).toContain("All quiet — pick up where you left off.");
  });

  it("keeps New task, Open browser and Search", async () => {
    const value = props();
    await render(value);
    await act(async () => button("New task").click());
    await act(async () => button("Open browser").click());
    await act(async () => button("Search").click());
    expect(value.onNew).toHaveBeenCalledOnce();
    expect(value.onBrowser).toHaveBeenCalledOnce();
    expect(value.onSearch).toHaveBeenCalledOnce();
    await render(props({ starting: true }));
    expect(button("Starting…").disabled).toBe(true);
  });
});

describe("stat tiles", () => {
  it("shows the five numbers, calm at zero", async () => {
    await render(props({ projects }));
    const labels = [
      ...container.querySelectorAll(".workspace-home-stat-label"),
    ].map((label) => label.textContent);
    expect(labels).toEqual([
      "Agents running",
      "Needs you",
      "Unread replies",
      "Files changed",
      "Done today",
    ]);
    for (const tile of container.querySelectorAll(".workspace-home-stat")) {
      expect(tile.hasAttribute("data-zero")).toBe(true);
      expect(tile.querySelector("button")).toBeNull();
    }
  });

  it("counts from the dashboard's data and the shared project status", async () => {
    await render(
      props({
        projects,
        running: [
          { id: "r1", title: "One", cwd: APP },
          { id: "r2", title: "Two", cwd: SITE },
        ],
        needsYou: [
          attention({ id: "a", kind: "approval" }),
          attention({ id: "b", kind: "question" }),
          attention({ id: "c" }),
        ],
        projectStatus: {
          [projectKey(APP)]: { running: 1, waiting: 0, unread: 0, files: 4 },
          [projectKey(SITE)]: { running: 1, waiting: 0, unread: 0, files: 3 },
        },
        finished: [
          finishedRow({ id: "1", at: Date.now() - MINUTE }),
          finishedRow({ id: "2", at: Date.now() - MINUTE, kind: "failed" }),
          finishedRow({ id: "3", at: Date.now() - 3 * 86_400_000 }),
        ],
      }),
    );
    const value = (label: string) =>
      stat(label)?.querySelector(".workspace-home-stat-value")?.textContent;
    expect(value("Agents running")).toBe("2");
    expect(stat("Agents running")?.textContent).toContain("in 2 projects");
    expect(value("Needs you")).toBe("2");
    expect(stat("Needs you")?.getAttribute("data-tone")).toBe("amber");
    expect(value("Unread reply")).toBe("1");
    expect(value("Files changed")).toBe("7");
    expect(stat("Files changed")?.textContent).toContain("in 2 projects");
    expect(value("Done today")).toBe("1");
    expect(stat("Done today")?.textContent).toContain("1 failed");
  });

  it("leads to the section behind a number", async () => {
    await render(
      props({
        needsYou: [attention({ id: "a", kind: "approval" })],
        finished: [finishedRow({ at: Date.now() - MINUTE })],
      }),
    );
    await act(async () => button("Needs you: 1").click());
    expect(document.activeElement?.textContent).toBe("Needs you");
    await act(async () => button("Done today: 1").click());
    expect(document.activeElement?.textContent).toBe("Activity");
  });
});

describe("Your agents", () => {
  it("gives every project a tile in order, with branch, files and last activity", async () => {
    await render(
      props({
        projects,
        projectStatus: {
          [projectKey(APP)]: { running: 0, waiting: 0, unread: 0, files: 12 },
        },
      }),
    );
    const [app, site] = tiles();
    expect(
      tiles().map((tile) => tile.querySelector("button")?.textContent),
    ).toEqual(["app", "site"]);
    expect(app.textContent).toContain("main");
    expect(app.textContent).toContain("+12");
    expect(app.textContent).toContain("3h ago");
    expect(app.getAttribute("data-state")).toBe("idle");
    expect(site.textContent).toContain("No sessions yet");
    expect(site.getAttribute("data-state")).toBe("resting");
    expect(container.querySelector(".workspace-home-agent-bubble")).toBeNull();
  });

  it("animates a working agent and says what it is doing", async () => {
    await render(
      props({
        projects: [{ ...projects[0], doing: "Edit App.tsx" }],
        projectStatus: {
          [projectKey(APP)]: { running: 1, waiting: 0, unread: 2 },
        },
      }),
    );
    const [app] = tiles();
    expect(app.getAttribute("data-state")).toBe("running");
    expect(app.querySelector("[data-mark]")?.getAttribute("data-active")).toBe(
      "true",
    );
    const bubble = app.querySelector(".workspace-home-agent-bubble")!;
    expect(bubble.getAttribute("data-kind")).toBe("doing");
    expect(bubble.textContent).toBe("Edit App.tsx");
    expect(app.querySelector(".workspace-home-agent-badge")?.textContent).toBe(
      "2",
    );
  });

  it("raises an amber ! while the agent waits on the user", async () => {
    await render(
      props({
        projects: [{ ...projects[0], asking: "Run npm test" }],
        projectStatus: {
          [projectKey(APP)]: { running: 0, waiting: 1, unread: 0 },
        },
      }),
    );
    const [app] = tiles();
    expect(app.getAttribute("data-state")).toBe("waiting");
    const bubble = app.querySelector(".workspace-home-agent-bubble")!;
    expect(bubble.getAttribute("data-kind")).toBe("asking");
    expect(bubble.textContent).toBe("!");
    expect(app.textContent).toContain("Waiting for you: Run npm test");
    expect(app.querySelector("[data-mark]")?.hasAttribute("data-active")).toBe(
      false,
    );
  });

  it("opens, starts a task and customizes from the tile", async () => {
    const value = props({ projects });
    await render(value);
    const [app, site] = tiles();
    await act(async () => button("Open Ship the release in app", app).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("app-latest");
    await act(async () => button("Open site", site).click());
    expect(value.onProject).toHaveBeenCalledExactlyOnceWith(SITE);
    await act(async () => button("New task in site", site).click());
    expect(value.onNewProjectTask).toHaveBeenCalledExactlyOnceWith(SITE);

    const customize = button("Customize app", app);
    await act(async () => customize.click());
    expect(customize.getAttribute("aria-expanded")).toBe("true");
    expect(
      container
        .querySelector("[data-customize]")
        ?.getAttribute("data-customize"),
    ).toBe(APP);
    await act(async () => button("Done").click());
    expect(container.querySelector("[data-customize]")).toBeNull();
    await act(async () => {
      site.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    expect(
      container
        .querySelector("[data-customize]")
        ?.getAttribute("data-customize"),
    ).toBe(SITE);

    await act(async () => button("Add project").click());
    expect(value.onAddProject).toHaveBeenCalledOnce();
  });

  it("asks once for the projects' saved sessions", async () => {
    const value = props({ projects });
    await render(value);
    await render({ ...value, projects: projects.map((card) => ({ ...card })) });
    expect(value.onLoadProjects).toHaveBeenCalledExactlyOnceWith([APP, SITE]);
  });

  it("offers to add the first project", async () => {
    const value = props();
    await render(value);
    await act(async () => button("Add your first project").click());
    expect(value.onAddProject).toHaveBeenCalledOnce();
  });

  it("follows saved project names without changing the paths it opens", async () => {
    const value = props({
      projects: [{ path: APP, name: "app" }],
      recent: [recentRow({ title: "Original task title" })],
    });
    saveTabGroupLabel(projectKey(APP), "Personal app");
    await render(value);
    const home = container.querySelector(".workspace-home")!;
    expect(home.textContent?.match(/Personal app/g)).toHaveLength(2);
    await act(async () => saveTabGroupLabel(projectKey(APP), "Renamed app"));
    expect(home.textContent?.match(/Renamed app/g)).toHaveLength(2);
    expect(home.textContent).toContain("Original task title");
    await act(async () => button("Open Renamed app").click());
    expect(value.onProject).toHaveBeenCalledExactlyOnceWith(APP);
  });
});

describe("Needs you", () => {
  it("is hidden when nothing needs the user", async () => {
    await render(props({ projects }));
    expect(section("Needs you")).toBeUndefined();
    expect(section("Running now")).toBeUndefined();
  });

  it("lists items in order with what each waits for, and opens the session", async () => {
    const value = props({
      needsYou: [
        attention({
          id: "ask",
          kind: "approval",
          title: "Deploy",
          detail: "Run npm test",
        }),
        attention({
          id: "done",
          title: "Write docs",
          cwd: SITE,
          detail: "Added a guide",
        }),
      ],
    });
    await render(value);
    const needs = section("Needs you")!;
    expect(rowTitles(needs)).toEqual(["Deploy", "Write docs"]);
    const rows = needs.querySelectorAll(".workspace-home-row");
    expect(rows[0].textContent).toContain("Needs approval · Run npm test");
    expect(rows[0].textContent).toContain("5m ago");
    expect(rows[0].getAttribute("data-attention")).toBe("approval");
    expect(rows[1].textContent).toContain("Finished · Added a guide");
    expect(rows[1].textContent).toContain("site");
    expect(
      rows[0].querySelector("[data-mark]")?.getAttribute("data-mark"),
    ).toBe(projectKey(APP));
    await act(async () => (rows[1] as HTMLButtonElement).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("done");
  });

  it("shows the first few and the rest on request", async () => {
    await render(
      props({
        needsYou: Array.from({ length: 8 }, (_, index) =>
          attention({ id: `s${index}`, title: `Reply ${index}` }),
        ),
      }),
    );
    expect(rowTitles(section("Needs you"))).toHaveLength(5);
    await act(async () => button("Show 3 more").click());
    expect(rowTitles(section("Needs you"))).toHaveLength(8);
  });
});

describe("Running now", () => {
  it("lists running sessions with what they do and how long they have run", async () => {
    const value = props({
      running: [
        {
          id: "run",
          title: "Refactor",
          cwd: APP,
          startedAt: Date.now() - 12.5 * MINUTE,
          doing: "Edit App.tsx",
        },
        { id: "bg", title: "Background", cwd: SITE },
      ] satisfies HomeRunning[],
    });
    await render(value);
    const running = section("Running now")!;
    expect(rowTitles(running)).toEqual(["Refactor", "Background"]);
    const rows = running.querySelectorAll(".workspace-home-row");
    expect(rows[0].textContent).toContain("app · Edit App.tsx");
    expect(rows[0].textContent).toContain("Running for 12m");
    expect(rows[1].textContent).toContain("Working");
    expect(
      rows[0].querySelector("[data-mark]")?.getAttribute("data-active"),
    ).toBe("true");
    await act(async () => (rows[0] as HTMLButtonElement).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("run");
  });
});

describe("Activity", () => {
  it("feeds finished turns with their outcome, summary and time", async () => {
    const value = props({
      finished: [
        finishedRow({
          id: "1",
          sessionId: "s1",
          title: "Fix tests",
          detail: "All green",
          unread: true,
        }),
        finishedRow({ id: "2", sessionId: "s2", kind: "failed", cwd: SITE }),
      ],
    });
    await render(value);
    const activity = section("Activity")!;
    expect(rowTitles(activity)).toEqual(["Fix tests", "Finished task"]);
    const rows = activity.querySelectorAll(".workspace-home-row");
    expect(rows[0].getAttribute("data-outcome")).toBe("completed");
    expect(rows[0].textContent).toContain("All green");
    expect(rows[0].textContent).toContain("Unread");
    expect(rows[0].textContent).toContain("5m ago");
    expect(rows[1].getAttribute("data-outcome")).toBe("failed");
    expect(rows[1].textContent).toContain("Failed");
    await act(async () => (rows[1] as HTMLButtonElement).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("s2");
  });

  it("keeps at most eight and explains an empty feed", async () => {
    await render(
      props({
        finished: Array.from({ length: 12 }, (_, index) =>
          finishedRow({ id: `${index}` }),
        ),
      }),
    );
    expect(rowTitles(section("Activity"))).toHaveLength(8);
    await render(props());
    expect(section("Activity")?.textContent).toContain(
      "Finished turns will show up here.",
    );
  });
});

describe("Usage", () => {
  it("shows the footer's last saved usage and fetches nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    storage.set(
      USAGE_STORAGE_KEY,
      JSON.stringify({
        claude: {
          provider: "claude",
          status: "ok",
          error: null,
          updatedAt: Date.now() - 10.5 * MINUTE,
          session: {
            usedPercent: 34,
            windowMinutes: 300,
            resetsAt: Date.now() + 130.5 * MINUTE,
          },
          weekly: { usedPercent: 85, windowMinutes: 10_080, resetsAt: null },
        },
      }),
    );
    await render(props({ usageProviders: ["claude", "codex"] }));
    const usage = section("Usage")!;
    expect(usage.textContent).toContain("Claude Code");
    expect(usage.textContent).toContain("34% · resets in 2h 10m");
    expect(usage.textContent).toContain("Last checked 10m ago");
    const meters = usage.querySelectorAll('[role="meter"]');
    expect(
      [...meters].map((meter) => meter.getAttribute("aria-valuenow")),
    ).toEqual(["34", "85"]);
    expect(meters[1].hasAttribute("data-high")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is left out without saved usage for the workspace's accounts", async () => {
    await render(props({ usageProviders: ["codex"] }));
    expect(section("Usage")).toBeUndefined();
  });
});

describe("Recent sessions", () => {
  it("lists recent sessions not already shown above, with their project and time", async () => {
    const value = props({
      needsYou: [attention({ id: "waiting", kind: "question" })],
      running: [{ id: "busy", title: "Busy", cwd: APP }],
      recent: [
        recentRow({ id: "busy", title: "Busy" }),
        recentRow({ id: "plain", title: "Plain task", cwd: SITE }),
        recentRow({ id: "waiting", title: "Waiting" }),
      ],
    });
    await render(value);
    const recent = section("Recent sessions")!;
    expect(rowTitles(recent)).toEqual(["Plain task"]);
    const row = recent.querySelector(".workspace-home-row")!;
    expect(row.textContent).toContain("site · Codex");
    expect(row.textContent).toContain("5m ago");
    await act(async () => (row as HTMLButtonElement).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("plain");
  });

  it("keeps a short list", async () => {
    await render(
      props({
        recent: Array.from({ length: 12 }, (_, index) =>
          recentRow({ id: `r${index}`, title: `Task ${index}` }),
        ),
      }),
    );
    expect(rowTitles(section("Recent sessions"))).toHaveLength(5);
  });

  it("explains an empty list", async () => {
    await render(props());
    expect(section("Recent sessions")?.textContent).toContain(
      "Your sessions will appear here.",
    );
    await render(
      props({
        running: [{ id: "busy", title: "Busy", cwd: APP }],
        recent: [recentRow({ id: "busy" })],
      }),
    );
    expect(section("Recent sessions")?.textContent).toContain(
      "Everything recent is listed above.",
    );
  });
});

describe("windows and accessibility", () => {
  it("lists detached windows only when there are some", async () => {
    await render(props());
    expect(section("Open windows")).toBeUndefined();
    const value = props({
      windows: [{ id: "w1", label: "Browser · docs" }],
      onShowWindow: vi.fn(),
      onReturnWindow: vi.fn(),
    });
    await render(value);
    await act(async () => button("Browser · docs").click());
    await act(async () => button("Return Browser · docs here").click());
    expect(value.onShowWindow).toHaveBeenCalledExactlyOnceWith("w1");
    expect(value.onReturnWindow).toHaveBeenCalledExactlyOnceWith("w1");
  });

  it("gives every section a heading and every button a name", async () => {
    await render(
      props({
        needsYou: [attention({ id: "a" })],
        running: [{ id: "r", title: "Run", cwd: APP }],
        projects,
        recent: [recentRow({})],
        finished: [finishedRow({})],
        windows: [{ id: "w", label: "Window" }],
      }),
    );
    for (const name of [
      "At a glance",
      "Your agents",
      "Needs you",
      "Running now",
      "Recent sessions",
      "Activity",
      "Open windows",
    ])
      expect(section(name)).toBeDefined();
    for (const element of container.querySelectorAll("button")) {
      expect(element.type).toBe("button");
      expect(
        (element.getAttribute("aria-label") ?? element.textContent)?.trim(),
      ).toBeTruthy();
    }
  });
});

describe("rendering cost", () => {
  it("skips re-renders from a parent when nothing shown changed", async () => {
    const make = () =>
      props({
        needsYou: [attention({ id: "a", at: 1_000 })],
        running: [{ id: "r", title: "Run", cwd: APP, startedAt: 1_000 }],
        projects: projects.map((card) => ({ ...card, doing: "Edit a.ts" })),
        recent: [recentRow({ updatedAt: 1_000 })],
        finished: [finishedRow({ at: 1_000 })],
        projectStatus: {
          [projectKey(APP)]: { running: 1, waiting: 0, unread: 0 },
        },
        windows: [{ id: "w", label: "Window" }],
      });
    await render(make());
    expect(marks.commits).toBeGreaterThan(0);
    marks.commits = 0;
    const latest = make();
    // New arrays and new callbacks with the same content, as App passes on
    // every streaming flush.
    await render(latest);
    expect(marks.commits).toBe(0);
    // The skipped render still calls the latest callbacks.
    await act(async () => button("Search").click());
    expect(latest.onSearch).toHaveBeenCalledOnce();

    await render({
      ...latest,
      running: [...latest.running, { id: "r2", title: "Another", cwd: SITE }],
    });
    expect(marks.commits).toBeGreaterThan(0);
  });

  it("does not re-render Home while an agent streams in the app", async () => {
    type Block = Session["blocks"][number];
    const user = {
      id: "u",
      role: "user",
      text: "Go",
      startedAt: Date.now() - 2 * MINUTE,
    } as Block;
    const reply = (text: string) =>
      ({ id: "reply", role: "assistant", text }) as Block;
    const live = (blocks: Block[]): Session[] => [
      {
        id: "busy",
        cwd: APP,
        harness: "codex",
        model: "gpt-5",
        runtimeMode: "full-access",
        title: "Streaming task",
        blocks,
        busy: true,
      } as Session,
    ];
    const busy = new Set(["busy"]);
    const history: SessionSummary[] = [];
    const activity: ActivityEntry[] = [];
    const workspace = [{ path: APP, openedAt: 1 }];
    const standalone: string[] = [];
    // Stands in for App: re-rendered on every flush, building inline callbacks.
    function Shell({ sessions }: { sessions: Session[] }) {
      const data = useWorkspaceHomeData({
        enabled: true,
        sessions,
        inFlightIds: busy,
        history,
        activity,
        projects: workspace,
        standaloneCwds: standalone,
      });
      return createElement(WorkspaceHome, {
        ...props(),
        ...data,
        onSession: (id: string) => void id,
      });
    }
    let shellCommits = 0;
    const draw = (sessions: Session[]) =>
      act(async () =>
        root.render(
          createElement(
            Profiler,
            { id: "app", onRender: () => (shellCommits += 1) },
            createElement(Shell, { sessions }),
          ),
        ),
      );
    await draw(live([user, reply("He")]));
    expect(rowTitles(section("Running now"))).toEqual(["Streaming task"]);
    marks.commits = 0;
    shellCommits = 0;
    for (const text of ["Hel", "Hello", "Hello, w", "Hello, world"])
      await draw(live([user, reply(text)]));
    // The app committed every flush; the home did not render once.
    expect(shellCommits).toBe(4);
    expect(marks.commits).toBe(0);
  });
});
