import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveProject,
  collectRailProjects,
  forgetProject,
  loadArchivedProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  loadRecents,
  looksLikeProject,
  projectRailItems,
  projectRailSections,
  rememberProject,
  savePinnedProjects,
  saveProjectRailOrder,
  syncProjectRailOrder,
} from "./recents";

describe("sessions without a project", () => {
  const cwd =
    "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces/personal";
  beforeEach(() => {
    mockLocalStorage();
    localStorage.setItem(
      "monocode.projectlessWorkspaces.v1",
      JSON.stringify({ personal: cwd }),
    );
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("keeps the working folder usable but never remembers it as a project", () => {
    expect(looksLikeProject(cwd)).toBe(true);
    rememberProject("/tmp/project");
    expect(rememberProject(cwd).map((item) => item.path)).toEqual([
      "/tmp/project",
    ]);
    expect(
      JSON.parse(localStorage.getItem("monocode.recentProjects")!).map(
        (item: { path: string }) => item.path,
      ),
    ).toEqual(["/tmp/project"]);
  });

  it("filters restored and currently active scratch folders out of the project rail", () => {
    const recents = [
      { path: cwd, openedAt: 2 },
      { path: "/tmp/project", openedAt: 1 },
    ];
    localStorage.setItem("monocode.recentProjects", JSON.stringify(recents));
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/project"]);
    expect(
      [...collectRailProjects(recents, cwd).values()].map((item) => item.path),
    ).toEqual(["/tmp/project"]);
    expect(collectRailProjects([], cwd).size).toBe(0);
  });
});

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("looksLikeProject", () => {
  it("rejects the home directory so it is never indexed", () => {
    // Home arrives expanded from `default_cwd`. Walking it reaches
    // ~/Library, which makes macOS prompt for access to other apps' data.
    expect(looksLikeProject("/Users/me")).toBe(false);
    expect(looksLikeProject("/Users/me/")).toBe(false);
    expect(looksLikeProject("/home/me")).toBe(false);
    expect(looksLikeProject("C:/Users/me")).toBe(false);
    expect(looksLikeProject("C:\\Users\\me")).toBe(false);
    expect(looksLikeProject("~")).toBe(false);
  });

  it("rejects system roots and app bundles", () => {
    expect(looksLikeProject("/")).toBe(false);
    expect(looksLikeProject("")).toBe(false);
    expect(looksLikeProject("C:/")).toBe(false);
    expect(looksLikeProject("C:")).toBe(false);
    expect(looksLikeProject("/Applications/Some.app/Contents")).toBe(false);
  });

  it("accepts real projects, including ones directly under home", () => {
    expect(looksLikeProject("/Users/me/code/app")).toBe(true);
    expect(looksLikeProject("/Users/me/Desktop")).toBe(true);
    expect(looksLikeProject("/tmp/scratch")).toBe(true);
    expect(looksLikeProject("C:/Users/me/code/app")).toBe(true);
  });
});

describe("projectRailSections", () => {
  it("keeps saved order and does not move the current project first", () => {
    const recents = [
      { path: "/tmp/older", openedAt: 1 },
      { path: "/tmp/current", openedAt: 2 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/current/",
      ["/tmp/older", "/tmp/current"],
      [],
    );
    expect([...pinned, ...projects].map((item) => item.path)).toEqual([
      "/tmp/older",
      "/tmp/current",
    ]);
  });

  it("places pinned projects before unpinned ones", () => {
    const recents = [
      { path: "/tmp/a", openedAt: 1 },
      { path: "/tmp/b", openedAt: 2 },
      { path: "/tmp/c", openedAt: 3 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/a",
      ["/tmp/a", "/tmp/b", "/tmp/c"],
      ["/tmp/b"],
    );
    expect(pinned.map((item) => item.path)).toEqual(["/tmp/b"]);
    expect(projects.map((item) => item.path)).toEqual(["/tmp/a", "/tmp/c"]);
  });

  it("appends new projects without reordering existing entries", () => {
    const recents = [
      { path: "/tmp/older", openedAt: 1 },
      { path: "/tmp/new", openedAt: 3 },
    ];
    const projects = new Map([
      ["/tmp/older", { path: "/tmp/older", openedAt: 1 }],
      ["/tmp/new", { path: "/tmp/new", openedAt: 3 }],
    ]);
    expect(syncProjectRailOrder(["/tmp/older"], projects)).toEqual([
      "/tmp/older",
      "/tmp/new",
    ]);
  });
});

describe("projectRailItems", () => {
  it("ignores home as a current folder", () => {
    expect(
      projectRailItems([{ path: "/tmp/app", openedAt: 1 }], "/Users/me").map(
        (item) => item.path,
      ),
    ).toEqual(["/tmp/app"]);
  });
});

describe("opening a project", () => {
  beforeEach(() => mockLocalStorage());
  afterEach(() => mockLocalStorage());
  const shown = () =>
    projectRailItems(loadRecents(), "~").map((item) => item.path);

  it("never moves it in the sidebar", () => {
    // Stored as the sidebar has always shown them: most recent first.
    localStorage.setItem(
      "monocode.recentProjects",
      JSON.stringify([
        { path: "/tmp/c", openedAt: 3 },
        { path: "/tmp/b", openedAt: 2 },
        { path: "/tmp/a", openedAt: 1 },
      ]),
    );
    expect(shown()).toEqual(["/tmp/c", "/tmp/b", "/tmp/a"]);
    rememberProject("/tmp/a");
    expect(shown()).toEqual(["/tmp/c", "/tmp/b", "/tmp/a"]);
    rememberProject("/tmp/b");
    expect(shown()).toEqual(["/tmp/c", "/tmp/b", "/tmp/a"]);
  });

  it("keeps a custom order and puts a new project on top", () => {
    rememberProject("/tmp/a");
    rememberProject("/tmp/b");
    saveProjectRailOrder(["/tmp/a", "/tmp/b"]);
    rememberProject("/tmp/b");
    expect(shown()).toEqual(["/tmp/a", "/tmp/b"]);
    rememberProject("/tmp/new");
    expect(shown()).toEqual(["/tmp/new", "/tmp/a", "/tmp/b"]);
  });
});

describe("forgetProject", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("drops the recent entry, rail order slot, and pin", () => {
    rememberProject("/tmp/keep");
    rememberProject("/tmp/gone");
    saveProjectRailOrder(["/tmp/keep", "/tmp/gone"]);
    savePinnedProjects(["/tmp/gone"]);

    expect(forgetProject("/tmp/gone").map((item) => item.path)).toEqual([
      "/tmp/keep",
    ]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/keep"]);
    expect(loadProjectRailOrder()).toEqual(["/tmp/keep"]);
    expect(loadPinnedProjects()).toEqual([]);
  });

  it("treats differently-cased Windows paths as one project", () => {
    rememberProject("C:/Users/me/Code/App");
    rememberProject("c:/users/ME/code/app");
    expect(loadRecents().map((item) => item.path)).toEqual([
      "c:/users/ME/code/app",
    ]);
  });
});

describe("archiveProject", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("files the project in the archive and takes it off the rail", () => {
    rememberProject("/tmp/keep");
    rememberProject("/tmp/gone");
    savePinnedProjects(["/tmp/gone"]);

    expect(archiveProject("/tmp/gone").map((item) => item.path)).toEqual([
      "/tmp/keep",
    ]);
    expect(loadArchivedProjects().map((item) => item.path)).toEqual([
      "/tmp/gone",
    ]);
    expect(loadPinnedProjects()).toEqual([]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/keep"]);
  });

  it("opening a project again restores it from the archive", () => {
    rememberProject("/tmp/gone");
    archiveProject("/tmp/gone");
    expect(loadArchivedProjects()).toHaveLength(1);

    rememberProject("/tmp/gone");
    expect(loadArchivedProjects()).toEqual([]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/gone"]);
  });

  it("delete drops an archived project instead of restoring it", () => {
    rememberProject("/tmp/gone");
    archiveProject("/tmp/gone");
    forgetProject("/tmp/gone");
    expect(loadArchivedProjects()).toEqual([]);
    expect(loadRecents()).toEqual([]);
  });
});
