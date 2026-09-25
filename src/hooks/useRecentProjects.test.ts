// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecents, type RecentProject } from "../lib/recents";
import { useRecentProjects } from "./useRecentProjects";

const KEY = "monocode.recentProjects";
const AVEN = "/projects/Aven";
const HOLO = "/projects/HOLO";
const CLIPPED = "/projects/ClippedIn";
const initial = [
  { path: AVEN, openedAt: 3 },
  { path: HOLO, openedAt: 2 },
  { path: CLIPPED, openedAt: 1 },
];
let values: Map<string, string>;
let root: Root;
let container: HTMLDivElement;
let projects: ReturnType<typeof useRecentProjects>;

function Probe({ resumedCwd }: { resumedCwd?: string }) {
  projects = useRecentProjects(resumedCwd);
  return createElement(
    "nav",
    null,
    projects.recents.map(({ path }) =>
      createElement(
        "button",
        { key: path, onClick: () => projects.remember(path) },
        path,
      ),
    ),
  );
}

beforeEach(() => {
  values = new Map([[KEY, JSON.stringify(initial)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const paths = (items: RecentProject[]) => items.map(({ path }) => path).sort();
function click(path: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === path,
  );
  expect(button, `Project ${path} should remain available`).toBeDefined();
  act(() => button!.click());
}

function storageChanged(key: string | null = KEY) {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
}

describe("project selection when persistence is unavailable", () => {
  it.each(["missing", "corrupt", "unreadable"])(
    "keeps every loaded project when storage becomes %s between clicks",
    (failure) => {
      act(() => root.render(createElement(Probe)));
      if (failure === "missing") values.clear();
      if (failure === "corrupt") values.set(KEY, "not JSON");
      if (failure === "unreadable")
        vi.spyOn(localStorage, "getItem").mockImplementation(() => {
          throw new Error("Storage unavailable");
        });

      for (const path of [HOLO, AVEN, CLIPPED, HOLO]) {
        click(path);
        expect(paths(projects.recents)).toEqual(paths(initial));
        expect(container.querySelectorAll("button")).toHaveLength(3);
        expect(projects.isKnownProject(HOLO + "/")).toBe(true);
      }
    },
  );

  it("retains newly added projects when writes fail and disk still contains an older list", () => {
    act(() => root.render(createElement(Probe)));
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    act(() => {
      projects.remember("/projects/new-one");
      projects.remember("/projects/new-two");
    });
    click(HOLO);
    expect(paths(projects.recents)).toEqual(
      [...paths(initial), "/projects/new-one", "/projects/new-two"].sort(),
    );
    expect(paths(loadRecents())).toEqual(paths(initial));
    write.mockRestore();
    click(AVEN);
    expect(paths(loadRecents())).toEqual(paths(projects.recents));
  });

  it.each(["forget", "archive"] as const)(
    "keeps explicit %s removals without discarding or resurrecting other projects",
    (action) => {
      act(() => root.render(createElement(Probe)));
      values.clear();
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      act(() => projects[action](HOLO));
      expect(paths(projects.recents)).toEqual([AVEN, CLIPPED].sort());
      click(AVEN);
      expect(paths(projects.recents)).toEqual([AVEN, CLIPPED].sort());
      expect(projects.isKnownProject(HOLO)).toBe(false);
    },
  );

  it("does not replace loaded projects when the asynchronous initial-folder result arrives", () => {
    act(() => root.render(createElement(Probe)));
    values.clear();
    act(() => projects.rememberIfEmpty("/projects/default"));
    expect(paths(projects.recents)).toEqual(paths(initial));
  });

  it("initializes an empty window and retains sequential additions before React renders", () => {
    values.clear();
    act(() => root.render(createElement(Probe)));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    act(() => {
      projects.rememberIfEmpty(AVEN);
      projects.remember(HOLO);
      projects.rememberIfEmpty(CLIPPED);
    });
    expect(paths(projects.recents)).toEqual([AVEN, HOLO].sort());
  });

  it("adds a resumed project while keeping the saved project list", () => {
    act(() =>
      root.render(createElement(Probe, { resumedCwd: "/projects/resumed" })),
    );
    expect(paths(projects.recents)).toEqual(
      [...paths(initial), "/projects/resumed"].sort(),
    );
  });

  it.each([undefined, "/projects/resumed"])(
    "salvages valid projects from a partially damaged startup list (resumed: %s)",
    (resumedCwd) => {
      values.set(
        KEY,
        JSON.stringify([initial[0], null, initial[1], {}, initial[2]]),
      );
      act(() => root.render(createElement(Probe, { resumedCwd })));
      const expected = [
        ...paths(initial),
        ...(resumedCwd ? [resumedCwd] : []),
      ].sort();
      expect(paths(projects.recents)).toEqual(expected);
      click(HOLO);
      expect(paths(loadRecents())).toEqual(expected);
    },
  );
});

describe("project lists shared between windows", () => {
  it("recognizes a project added by another window before its storage event arrives", () => {
    act(() => root.render(createElement(Probe)));
    const next = [...initial, { path: "/projects/other-window", openedAt: 4 }];
    values.set(KEY, JSON.stringify(next));
    act(() =>
      expect(projects.isKnownProject("/projects/other-window")).toBe(true),
    );
    expect(paths(projects.recents)).toEqual(paths(next));
  });

  it("keeps another window's additions when a project is selected", () => {
    act(() => root.render(createElement(Probe)));
    const next = [...initial, { path: "/projects/other-window", openedAt: 4 }];
    values.set(KEY, JSON.stringify(next));
    storageChanged();
    expect(paths(projects.recents)).toEqual(paths(next));
    click(HOLO);
    expect(paths(loadRecents())).toEqual(paths(next));
  });

  it.each([true, false])(
    "does not resurrect another window's removed project (event delivered: %s)",
    (eventDelivered) => {
      act(() => root.render(createElement(Probe)));
      values.set(
        KEY,
        JSON.stringify(initial.filter(({ path }) => path !== CLIPPED)),
      );
      if (eventDelivered) storageChanged();
      click(HOLO);
      expect(paths(projects.recents)).toEqual([AVEN, HOLO].sort());
      expect(paths(loadRecents())).toEqual([AVEN, HOLO].sort());
    },
  );

  it("preserves unsaved additions and removals across stale storage events", () => {
    act(() => root.render(createElement(Probe)));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    act(() => {
      projects.remember("/projects/new");
      projects.forget(CLIPPED);
    });
    storageChanged();
    storageChanged(null);
    click(HOLO);
    expect(paths(projects.recents)).toEqual(
      [AVEN, HOLO, "/projects/new"].sort(),
    );
  });

  it.each([null, "{}", '[{"path":null}]', '[{"path":""}]'])(
    "keeps loaded projects after an invalid storage refresh (%s)",
    (value) => {
      act(() => root.render(createElement(Probe)));
      if (value === null) values.clear();
      else values.set(KEY, value);
      storageChanged(value === null ? null : KEY);
      expect(paths(projects.recents)).toEqual(paths(initial));
      click(HOLO);
      expect(paths(projects.recents)).toEqual(paths(initial));
    },
  );

  it("honors an explicitly saved empty project list", () => {
    act(() => root.render(createElement(Probe)));
    values.set(KEY, "[]");
    storageChanged();
    expect(projects.recents).toEqual([]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    act(() => projects.remember(HOLO));
    expect(paths(projects.recents)).toEqual([HOLO]);
  });
});
