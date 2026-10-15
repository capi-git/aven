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
import { saveTabGroupLabel } from "../lib/tabGroups";
import type {
  HomeAttention,
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

const APP = "/projects/app";
const SITE = "/projects/site";
const MINUTE = 60_000;

type Props = ComponentProps<typeof WorkspaceHome>;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
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

describe("header", () => {
  it("names the workspace and sums up what is happening", async () => {
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
    ).toBe("2 agents running · 1 needs you · 2 unread");
    expect(container.textContent).not.toContain("Make room for your next idea");
  });

  it("says it is quiet, or how to begin when there is nothing yet", async () => {
    await render(props({ projects }));
    expect(
      container.querySelector(".workspace-home-summary")?.textContent,
    ).toBe("All quiet — pick up where you left off.");
    await render(props());
    expect(
      container.querySelector(".workspace-home-summary")?.textContent,
    ).toBe("Start a task, or add a project to work in.");
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
        needsYou: Array.from({ length: 9 }, (_, index) =>
          attention({ id: `s${index}`, title: `Reply ${index}` }),
        ),
      }),
    );
    expect(rowTitles(section("Needs you"))).toHaveLength(6);
    await act(async () => button("Show 3 more").click());
    expect(rowTitles(section("Needs you"))).toHaveLength(9);
  });
});

describe("Running now", () => {
  it("lists running sessions with an animating mark and elapsed time", async () => {
    const value = props({
      running: [
        {
          id: "run",
          title: "Refactor",
          cwd: APP,
          startedAt: Date.now() - 12.5 * MINUTE,
        },
        { id: "bg", title: "Background", cwd: SITE },
      ] satisfies HomeRunning[],
    });
    await render(value);
    const running = section("Running now")!;
    expect(rowTitles(running)).toEqual(["Refactor", "Background"]);
    const rows = running.querySelectorAll(".workspace-home-row");
    expect(rows[0].textContent).toContain("Running for 12m");
    expect(rows[1].textContent).toContain("Working");
    expect(
      rows[0].querySelector("[data-mark]")?.getAttribute("data-active"),
    ).toBe("true");
    await act(async () => (rows[0] as HTMLButtonElement).click());
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("run");
  });
});

describe("Projects", () => {
  it("shows each project's mark, branch, status, last activity and actions", async () => {
    const value = props({
      projects,
      projectStatus: {
        [projectKey(APP)]: { running: 2, waiting: 1, unread: 3, files: 12 },
      },
    });
    await render(value);
    const cards = [...container.querySelectorAll(".workspace-home-project")];
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      "app",
      "site",
    ]);
    const [app, site] = cards as HTMLElement[];
    expect(app.querySelector("[data-mark]")?.getAttribute("data-active")).toBe(
      "true",
    );
    expect(app.textContent).toContain("main");
    expect(app.textContent).toContain("Active 3h ago");
    expect(app.textContent).toContain("Ship the release");
    expect(
      [...app.querySelectorAll("[data-status]")].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["2 running", "1 waiting", "3 unread", "+12 files"]);
    expect(site.textContent).toContain("No sessions yet");
    expect(site.querySelector("[data-status]")).toBeNull();

    await act(async () =>
      button("Resume Ship the release in app", app).click(),
    );
    expect(value.onSession).toHaveBeenCalledExactlyOnceWith("app-latest");
    await act(async () => button("Open site", site).click());
    expect(value.onProject).toHaveBeenCalledExactlyOnceWith(SITE);
    await act(async () => button("New task in site", site).click());
    expect(value.onNewProjectTask).toHaveBeenCalledExactlyOnceWith(SITE);
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

  it("keeps at most eight rows", async () => {
    await render(
      props({
        recent: Array.from({ length: 12 }, (_, index) =>
          recentRow({ id: `r${index}`, title: `Task ${index}` }),
        ),
      }),
    );
    expect(rowTitles(section("Recent sessions"))).toHaveLength(8);
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
        windows: [{ id: "w", label: "Window" }],
      }),
    );
    for (const name of [
      "Needs you",
      "Running now",
      "Projects",
      "Recent sessions",
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
        projects: projects.map((card) => ({ ...card })),
        recent: [recentRow({ updatedAt: 1_000 })],
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
