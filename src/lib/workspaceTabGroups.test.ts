import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  leafIds,
  newFileTab,
  newTab,
  newTerminalFile,
  splitPane,
  type WorkspaceTab,
} from "./layout";
import type { Session } from "./session";
import {
  applyPlaceSessionOnPane,
  filterTabsForProject,
  findProjectPane,
  findTabForProject,
  focusedWorkspaceTabCwd,
  loadProjectFocusedTabs,
  saveProjectFocusedTabs,
  planWorkspaceTabClose,
  replaceGroupInTabOrder,
  visibleProjectTabs,
  workspaceTabCwd,
  workspaceTabProject,
} from "./workspaceTabGroups";

function session(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy: false,
    model: "",
  };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

describe("workspaceTabProject", () => {
  it("reads project from the tab session cwd", () => {
    const workspace = tab("t1", "s1");
    const sessions = [session("s1", "/Users/me/agent-terminal")];
    expect(workspaceTabProject(workspace, sessions)).toBe("agent-terminal");
  });
});

describe("findTabForProject", () => {
  it("matches a tab by project path, ignoring trailing slashes", () => {
    const tabs = [tab("t1", "s1"), tab("t2", "s2")];
    const sessions = [session("s1", "/tmp/alpha"), session("s2", "/tmp/beta")];
    expect(findTabForProject(tabs, sessions, "/tmp/beta/")?.id).toBe("t2");
  });

  it("returns undefined when no open tab belongs to the project", () => {
    const tabs = [tab("t1", "s1")];
    const sessions = [session("s1", "/tmp/alpha")];
    expect(findTabForProject(tabs, sessions, "/tmp/beta")).toBeUndefined();
  });

  it("restores a preferred second tab belonging to the requested project", () => {
    const tabs = [tab("first", "s1"), tab("draft", "s2")];
    const sessions = [session("s1", "/tmp/work"), session("s2", "/tmp/work")];
    expect(findTabForProject(tabs, sessions, "/tmp/work/", "draft")?.id).toBe(
      "draft",
    );
  });

  it("ignores a preferred tab from another project with the same folder name", () => {
    const tabs = [tab("work", "s1"), tab("foreign", "s2")];
    const sessions = [
      session("s1", "/work/app"),
      session("s2", "/personal/app"),
    ];
    expect(findTabForProject(tabs, sessions, "/work/app", "foreign")?.id).toBe(
      "work",
    );
  });

  it("falls back to the first project tab when the remembered tab was closed", () => {
    const tabs = [tab("first", "s1"), tab("second", "s2")];
    const sessions = [session("s1", "/tmp/work"), session("s2", "/tmp/work")];
    expect(findTabForProject(tabs, sessions, "/tmp/work", "closed")?.id).toBe(
      "first",
    );
    expect(
      findTabForProject(tabs, sessions, "/missing", "closed"),
    ).toBeUndefined();
  });
});

describe("project pane navigation", () => {
  const holo = "/projects/HOLO";
  const aven = "/projects/Aven";
  const sessions = [session("holo", holo), session("aven", aven)];

  it.each([
    ["holo", "aven"],
    ["aven", "holo"],
  ])("finds HOLO in a mixed tab ordered %s then %s", (first, second) => {
    const mixed: WorkspaceTab = {
      ...tab("mixed", first),
      layout: splitPane(newTab(first).layout, first, "right", second),
      focusedId: "aven",
    };
    expect(focusedWorkspaceTabCwd(mixed, sessions)).toBe(aven);
    expect(findProjectPane(mixed, sessions, holo)).toBe("holo");
    expect(findTabForProject([mixed], sessions, holo)).toBe(mixed);
    // Navigation resolution neither mutates focus nor changes tab ownership.
    expect(mixed.focusedId).toBe("aven");
    expect(workspaceTabCwd(mixed, sessions)).toBe(first === "holo" ? holo : aven);
  });

  it("validates preferred panes and keeps an already focused project pane", () => {
    const currentSessions = [...sessions, session("other-holo", holo)];
    const mixed: WorkspaceTab = {
      ...tab("mixed", "holo"),
      layout: splitPane(
        splitPane(newTab("holo").layout, "holo", "right", "other-holo"),
        "other-holo", "right", "aven",
      ),
      focusedId: "aven",
    };
    expect(findProjectPane(mixed, currentSessions, holo, "other-holo"))
      .toBe("other-holo");
    expect(findProjectPane(mixed, currentSessions, holo, "aven")).toBe("holo");
    expect(findProjectPane(mixed, currentSessions, holo, "closed")).toBe("holo");
    expect(findProjectPane({ ...mixed, focusedId: "holo" }, currentSessions, holo, "other-holo"))
      .toBe("holo");
  });

  it.each(["editor", "terminal"] as const)(
    "finds the active %s surface in a mixed tab",
    (kind) => {
      const file = kind === "editor"
        ? newFileTab(`${holo}/readme.md`, holo)
        : newTerminalFile(holo);
      const pane = { id: "surface", files: [file], activeFileId: file.id };
      const mixed: WorkspaceTab = {
        ...tab("mixed", "aven"),
        layout: splitPane(newTab("aven").layout, "aven", "right", pane.id),
        editorPanes: kind === "editor" ? [pane] : [],
        terminalPanes: kind === "terminal" ? [pane] : [],
      };
      expect(findProjectPane(mixed, sessions, holo)).toBe(pane.id);
      expect(findTabForProject([mixed], sessions, holo)).toBe(mixed);
      const focused = { ...mixed, focusedId: pane.id };
      expect(focusedWorkspaceTabCwd(focused, sessions)).toBe(holo);
      expect(workspaceTabCwd(focused, sessions)).toBe(aven);
      const surfaceOnly = { ...focused, layout: newTab(pane.id).layout };
      expect(findProjectPane(surfaceOnly, [], holo)).toBe(pane.id);
      expect(focusedWorkspaceTabCwd(surfaceOnly, [])).toBe(holo);
    },
  );

  it("ignores inactive files and stale active file IDs", () => {
    const active = newFileTab(`${aven}/readme.md`, aven);
    const inactive = newFileTab(`${holo}/readme.md`, holo);
    const pane = {
      id: "editor", files: [active, inactive], activeFileId: active.id,
    };
    const workspace = { ...tab("files", pane.id), editorPanes: [pane] };
    expect(findProjectPane(workspace, [], holo)).toBeUndefined();
    expect(focusedWorkspaceTabCwd(workspace, [])).toBe(aven);
    const stale = {
      ...workspace, editorPanes: [{ ...pane, activeFileId: "closed-file" }],
    };
    expect(findProjectPane(stale, [], holo)).toBeUndefined();
    expect(focusedWorkspaceTabCwd(stale, [])).toBeNull();
  });

  it("ignores unmounted chats and surfaces, including in a preferred tab", () => {
    const file = newFileTab(`${holo}/readme.md`, holo);
    const ghost: WorkspaceTab = {
      ...tab("ghost", "aven"),
      focusedId: "holo",
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
      terminalPanes: [{ id: "terminal", files: [file], activeFileId: file.id }],
    };
    for (const id of ["holo", "editor", "terminal"]) {
      expect(findProjectPane(ghost, sessions, holo, id)).toBeUndefined();
      expect(focusedWorkspaceTabCwd({ ...ghost, focusedId: id }, sessions))
        .toBeNull();
    }
    const live = tab("live", "holo");
    expect(findTabForProject([ghost, live], sessions, holo, ghost.id)).toBe(live);
    expect(findProjectPane(live, [], holo)).toBeUndefined();
  });

  it("does not borrow a different pane's cwd for projectless or browser focus", () => {
    const mixed: WorkspaceTab = {
      ...tab("mixed", "blank"),
      layout: splitPane(newTab("blank").layout, "blank", "right", "holo"),
    };
    const currentSessions = [...sessions, session("blank", "~")];
    expect(focusedWorkspaceTabCwd(mixed, currentSessions)).toBeNull();
    expect(findProjectPane(mixed, currentSessions, "~")).toBeUndefined();
    expect(findProjectPane(mixed, currentSessions, holo)).toBe("holo");
    // Browser workspaces are separate from Aven's chat/editor/terminal leaves.
    const browser = tab("browser", "browser:HOLO:preview");
    expect(focusedWorkspaceTabCwd(browser, currentSessions)).toBeNull();
    expect(findProjectPane(browser, currentSessions, holo)).toBeUndefined();
  });

  it("matches canonical Windows paths without confusing equal folder names", () => {
    const workspace: WorkspaceTab = {
      ...tab("windows", "foreign"),
      layout: splitPane(newTab("foreign").layout, "foreign", "right", "holo"),
    };
    const windows = [
      session("foreign", "C:\\Personal\\HOLO"),
      session("holo", "C:\\Work\\HOLO\\"),
    ];
    expect(findProjectPane(workspace, windows, "c:/work/holo", "foreign"))
      .toBe("holo");
    expect(findTabForProject([workspace], windows, "c:/work/holo/")).toBe(workspace);
  });
});

describe("project focused tab preferences", () => {
  const key = "monocode.personal.focusedTabs";
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips absolute project paths and ignores invalid entries", () => {
    localStorage.setItem(
      key,
      JSON.stringify({
        "/tmp/work/": "draft",
        "C:\\Projects\\App": "windows",
        "relative/project": "bad",
        "~": "bad",
        "/empty": "",
        "/not-an-id": 12,
      }),
    );
    expect(loadProjectFocusedTabs()).toEqual({
      "/tmp/work": "draft",
      "C:/Projects/App": "windows",
    });
    saveProjectFocusedTabs({ "/tmp/personal": "second", relative: "bad" });
    expect(loadProjectFocusedTabs()).toEqual({ "/tmp/personal": "second" });
  });

  it("returns an empty preference for malformed or nonobject storage", () => {
    for (const value of ["invalid", "null", "[]", "42", '"text"']) {
      localStorage.setItem(key, value);
      expect(loadProjectFocusedTabs()).toEqual({});
    }
  });

  it("does not interrupt navigation when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadProjectFocusedTabs()).toEqual({});
    expect(() =>
      saveProjectFocusedTabs({ "/tmp/work": "draft" }),
    ).not.toThrow();
  });
});

describe("filterTabsForProject", () => {
  it("keeps only tabs that belong to the project", () => {
    const tabs = [tab("t1", "s1"), tab("t2", "s2"), tab("t3", "s3")];
    const sessions = [
      session("s1", "/tmp/alpha"),
      session("s2", "/tmp/beta"),
      session("s3", "/tmp/beta"),
    ];
    expect(
      filterTabsForProject(tabs, sessions, "/tmp/beta").map((tab) => tab.id),
    ).toEqual(["t2", "t3"]);
  });
});

describe("visibleProjectTabs", () => {
  it("shows the selected mixed tab while keeping ownership-based actions unchanged", () => {
    const sessions = [
      session("aven", "/projects/Aven"),
      session("holo", "/projects/HOLO"),
      session("first", "/projects/HOLO"),
      session("last", "/projects/HOLO"),
    ];
    const mixed: WorkspaceTab = {
      ...tab("mixed", "aven"),
      layout: splitPane(newTab("aven").layout, "aven", "right", "holo"),
      focusedId: "holo",
    };
    const tabs = [tab("first", "first"), mixed, tab("last", "last")];
    const ids = (items: WorkspaceTab[]) => items.map((item) => item.id);
    expect(ids(filterTabsForProject(tabs, sessions, "/projects/HOLO")))
      .toEqual(["first", "last"]);
    expect(ids(visibleProjectTabs(tabs, sessions, "/projects/HOLO", mixed.id)))
      .toEqual(["first", "mixed", "last"]);
    expect(ids(filterTabsForProject(tabs, sessions, "/projects/Aven")))
      .toEqual(["mixed"]);
    // An inactive mixed tab, or one focused elsewhere, is not added to the deck.
    expect(ids(visibleProjectTabs(tabs, sessions, "/projects/HOLO", "first")))
      .toEqual(["first", "last"]);
    expect(ids(visibleProjectTabs(
      [tabs[0], { ...mixed, focusedId: "aven" }, tabs[2]],
      sessions, "/projects/HOLO", mixed.id,
    ))).toEqual(["first", "last"]);
  });
});

describe("planWorkspaceTabClose", () => {
  const sessions = [
    session("m1", "/projects/monocode"),
    session("r1", "/projects/ruler"),
    session("m2", "/projects/monocode"),
  ];
  const tabs = [tab("tm1", "m1"), tab("tr1", "r1"), tab("tm2", "m2")];

  it("uses the global neighbor in workspace scope", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm2",
        scope: "workspace",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("prefers the previous same-project tab in project scope", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm2",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tm1" });
  });

  it("uses the next same-project tab when none exists to the left", () => {
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "tm1",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tm2" });
  });

  it("keeps the last tab of a project instead of jumping to another", () => {
    expect(
      planWorkspaceTabClose({
        tabs: tabs.slice(0, 2),
        sessions,
        closingTabId: "tm1",
        scope: "project",
      }),
    ).toEqual({ action: "keep" });
  });

  it("still jumps across projects in workspace scope when a project is emptied", () => {
    expect(
      planWorkspaceTabClose({
        tabs: tabs.slice(0, 2),
        sessions,
        closingTabId: "tm1",
        scope: "workspace",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("uses the global neighbor for a projectless tab", () => {
    const projectlessSessions = [
      ...sessions,
      session("blank1", "~"),
      session("blank2", "~"),
    ];
    expect(
      planWorkspaceTabClose({
        tabs: [tab("projectless", "blank1"), tabs[1]],
        sessions: projectlessSessions,
        closingTabId: "projectless",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
    expect(
      planWorkspaceTabClose({
        tabs: [tab("blank1", "blank1"), tabs[1], tab("blank2", "blank2")],
        sessions: projectlessSessions,
        closingTabId: "blank2",
        scope: "project",
      }),
    ).toEqual({ action: "close", nextActiveTabId: "tr1" });
  });

  it("keeps the sole tab or an unknown tab", () => {
    expect(
      planWorkspaceTabClose({
        tabs: [tabs[0]],
        sessions,
        closingTabId: "tm1",
        scope: "workspace",
      }),
    ).toEqual({ action: "keep" });
    expect(
      planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: "missing",
        scope: "project",
      }),
    ).toEqual({ action: "keep" });
  });
});

describe("applyPlaceSessionOnPane", () => {
  const sessions = [
    session("m1", "/projects/monocode"),
    session("m2", "/projects/monocode"),
    session("r1", "/projects/ruler"),
  ];

  function replacementFrom(seed: Session | undefined): Session {
    return session("replacement", seed?.cwd ?? "/tmp/fallback");
  }

  it("splits the target pane toward the drop edge", () => {
    const next = applyPlaceSessionOnPane({
      tabs: [tab("tm1", "m1")],
      sessions,
      sessionId: "m2",
      targetId: "m1",
      edge: "right",
      replaceTarget: false,
      scope: "workspace",
      createReplacement: replacementFrom,
    });
    expect(next?.activeTabId).toBe("tm1");
    expect(next?.tabs[0]?.focusedId).toBe("m2");
    expect(leafIds(next!.tabs[0]!.layout)).toEqual(["m1", "m2"]);
  });

  it("replaces a blank target instead of splitting it", () => {
    const blank = session("blank", "/projects/monocode");
    const next = applyPlaceSessionOnPane({
      tabs: [tab("tm1", "blank")],
      sessions: [...sessions, blank],
      sessionId: "m2",
      targetId: "blank",
      edge: "right",
      replaceTarget: true,
      scope: "workspace",
      createReplacement: replacementFrom,
    });
    expect(leafIds(next!.tabs[0]!.layout)).toEqual(["m2"]);
    expect(next?.sessions.map((entry) => entry.id)).toEqual(["m1", "m2", "r1"]);
  });

  it("relocates a session from another tab and closes that tab", () => {
    const next = applyPlaceSessionOnPane({
      tabs: [tab("tm1", "m1"), tab("tm2", "m2")],
      sessions,
      sessionId: "m2",
      targetId: "m1",
      edge: "left",
      replaceTarget: false,
      scope: "workspace",
      createReplacement: replacementFrom,
    });
    expect(next?.tabs.map((entry) => entry.id)).toEqual(["tm1"]);
    expect(leafIds(next!.tabs[0]!.layout)).toEqual(["m2", "m1"]);
  });

  it("keeps the last tab of a project and fills it with a replacement", () => {
    const next = applyPlaceSessionOnPane({
      tabs: [tab("tr1", "r1"), tab("tm1", "m1")],
      sessions,
      sessionId: "m1",
      targetId: "r1",
      edge: "right",
      replaceTarget: false,
      scope: "project",
      createReplacement: replacementFrom,
    });
    expect(next?.tabs.map((entry) => entry.id)).toEqual(["tr1", "tm1"]);
    expect(leafIds(next!.tabs[0]!.layout)).toEqual(["r1", "m1"]);
    expect(next?.tabs[1]?.focusedId).toBe("replacement");
  });
});

describe("replaceGroupInTabOrder", () => {
  it("swaps a contiguous slice of ids", () => {
    expect(
      replaceGroupInTabOrder(["a", "b", "c", "d"], 1, 2, ["d", "c"]),
    ).toEqual(["a", "d", "c", "d"]);
  });
});
