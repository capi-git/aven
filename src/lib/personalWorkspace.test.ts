// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_BROWSER,
  browserIdForProject,
  loadBrowserWorkspaces,
  saveBrowserWorkspaces,
  loadPersonalInspector,
  savePersonalInspector,
  loadPersonalSidebar,
  savePersonalSidebar,
  addBrowserTab,
  selectBrowserTab,
  updateBrowserTab,
  closeBrowserTab,
  normalizeBrowserWorkspace,
  patchBrowserWorkspace,
  browserIdForTab,
} from "./personalWorkspace";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("personal panel persistence", () => {
  it("restores independent project URLs, expanded state and previous split size", () => {
    saveBrowserWorkspaces({
      "/one": {
        ...EMPTY_BROWSER,
        open: true,
        expanded: true,
        url: "http://localhost:3000/",
        ratio: 0.6,
      },
      "/two": {
        ...EMPTY_BROWSER,
        open: true,
        expanded: false,
        url: "https://example.com/",
        ratio: 0.3,
      },
    });
    const value = loadBrowserWorkspaces();
    expect(value["/one"]).toEqual({
      open: true,
      mode: "tab",
      expanded: true,
      url: "http://localhost:3000/",
      ratio: 0.6,
      tabs: [{ id: "legacy", url: "http://localhost:3000/" }],
      activeTabId: "legacy",
    });
    expect(value["/two"].expanded).toBe(false);
    expect(value["/two"].ratio).toBe(0.3);
    expect(browserIdForProject("/one")).not.toBe(browserIdForProject("/two"));
  });

  it("moves an older open preview into a top tab and retains its URL and split width", () => {
    localStorage.setItem(
      "monocode.personal.browser",
      JSON.stringify({
        "/one": { open: true, url: "https://example.com", ratio: 4 },
        "/two": { ratio: -2 },
      }),
    );
    expect(loadBrowserWorkspaces()["/one"]).toEqual({
      open: true,
      mode: "tab",
      expanded: true,
      url: "https://example.com",
      ratio: 0.7,
      tabs: [{ id: "legacy", url: "https://example.com" }],
      activeTabId: "legacy",
    });
    expect(loadBrowserWorkspaces()["/two"].ratio).toBe(0.25);
  });

  it("restores an inactive browser tab without losing its page or switching sessions", () => {
    saveBrowserWorkspaces({
      "/one": {
        ...EMPTY_BROWSER,
        open: true,
        mode: "tab",
        expanded: false,
        url: "https://example.com/saved",
        ratio: 0.5,
      },
    });
    expect(loadBrowserWorkspaces()["/one"]).toEqual({
      ...EMPTY_BROWSER,
      open: true,
      mode: "tab",
      expanded: false,
      url: "https://example.com/saved",
      ratio: 0.5,
      tabs: [{ id: "legacy", url: "https://example.com/saved" }],
      activeTabId: "legacy",
    });
    saveBrowserWorkspaces({
      "/one": {
        ...loadBrowserWorkspaces()["/one"],
        mode: "split",
      },
    });
    expect(loadBrowserWorkspaces()["/one"].mode).toBe("split");
    expect(loadBrowserWorkspaces()["/one"].expanded).toBe(false);
  });

  it("persists left and right panel choices independently", () => {
    savePersonalSidebar(false);
    savePersonalInspector({ open: true, tab: "changes", width: 340 });
    expect(loadPersonalSidebar()).toBe(false);
    expect(loadPersonalInspector()).toEqual({
      open: true,
      tab: "changes",
      width: 340,
    });
  });

  it("recovers malformed browser and inspector storage without blocking startup", () => {
    localStorage.setItem("monocode.personal.browser", "broken{");
    localStorage.setItem("monocode.personal.inspector", "broken{");
    expect(loadBrowserWorkspaces()).toEqual({});
    expect(loadPersonalInspector()).toEqual({
      open: true,
      tab: "files",
      width: 280,
    });
  });
});

describe("multiple browser tabs", () => {
  it("migrates hidden single-page workspaces without replacing their saved URL", () => {
    const old = {
      open: false,
      url: "https://www.google.com/search?q=notes",
      ratio: 0.36,
    };
    const migrated = normalizeBrowserWorkspace(old);
    expect(migrated).toMatchObject({
      open: false,
      expanded: false,
      url: old.url,
      ratio: 0.36,
      activeTabId: "legacy",
      tabs: [{ id: "legacy", url: old.url }],
    });
    expect(normalizeBrowserWorkspace(old)).toEqual(migrated);
    expect(normalizeBrowserWorkspace(migrated)).toEqual(migrated);
  });

  it("keeps each page when adding, navigating and switching tabs", () => {
    const one = addBrowserTab(EMPTY_BROWSER, {
      id: "one",
      url: "https://one.example",
    });
    const two = addBrowserTab(one, {
      id: "two",
      url: "https://two.example",
      title: "Second page",
    });
    const snapshot = JSON.stringify(two);
    const updated = updateBrowserTab(two, "one", {
      url: "https://one.example/next",
      title: "First page",
    });
    expect(updated.activeTabId).toBe("two");
    expect(updated.url).toBe("https://two.example");
    const selected = selectBrowserTab(updated, "one");
    expect(selected.url).toBe("https://one.example/next");
    expect(selected.tabs).toHaveLength(2);
    expect(selected.tabs[1].title).toBe("Second page");
    expect(selected.open).toBe(true);
    expect(selected.expanded).toBe(true);
    expect(JSON.stringify(two)).toBe(snapshot);
    expect(
      addBrowserTab(selected, { id: "two", url: "do not overwrite" }).tabs,
    ).toEqual(selected.tabs);
  });

  it("legacy URL and visibility patches preserve inactive pages and split layout", () => {
    let state = addBrowserTab(
      { ...EMPTY_BROWSER, mode: "split", ratio: 0.61 },
      { id: "one", url: "https://one.example" },
    );
    state = addBrowserTab(state, { id: "two", url: "https://two.example" });
    const hidden = patchBrowserWorkspace(state, {
      open: false,
      expanded: false,
      url: "https://two.example/next",
    });
    expect(hidden.tabs[0].url).toBe("https://one.example");
    expect(hidden.tabs[1].url).toBe("https://two.example/next");
    const restored = selectBrowserTab(hidden, "one");
    expect(restored).toMatchObject({
      mode: "split",
      ratio: 0.61,
      expanded: false,
      open: true,
    });
    saveBrowserWorkspaces({ "/project": hidden });
    expect(loadBrowserWorkspaces()["/project"]).toEqual(hidden);
    expect(patchBrowserWorkspace(EMPTY_BROWSER, { open: true }).tabs).toEqual([
      { id: "legacy", url: "" },
    ]);
  });

  it("closes only the chosen page and retains sizing after the final close", () => {
    let state = addBrowserTab(
      { ...EMPTY_BROWSER, ratio: 0.6 },
      { id: "one", url: "https://one.example" },
    );
    state = addBrowserTab(state, { id: "two", url: "https://two.example" });
    state = addBrowserTab(state, { id: "three", url: "https://three.example" });
    const backgroundClosed = closeBrowserTab(state, "one");
    expect(backgroundClosed.activeTabId).toBe("three");
    const selectedClosed = closeBrowserTab(backgroundClosed, "three");
    expect(selectedClosed.activeTabId).toBe("two");
    expect(selectedClosed.url).toBe("https://two.example");
    expect(closeBrowserTab(selectedClosed, "missing")).toEqual(selectedClosed);
    expect(closeBrowserTab(selectedClosed, "two")).toEqual({
      ...EMPTY_BROWSER,
      ratio: 0.6,
    });
    expect(state.tabs).toHaveLength(3);
  });

  it("repairs malformed stored tabs and selection without dropping valid pages", () => {
    const state = normalizeBrowserWorkspace({
      open: true,
      mode: "split",
      ratio: NaN,
      url: "stale mirror",
      activeTabId: "missing",
      tabs: [
        null,
        { id: "", url: "bad" },
        { id: "one", url: "https://one.example" },
        { id: "one", url: "duplicate" },
        { id: "two", url: 12, title: " Second " },
      ],
    });
    expect(state.tabs).toEqual([
      { id: "one", url: "https://one.example" },
      { id: "two", url: "", title: "Second" },
    ]);
    expect(state.activeTabId).toBe("one");
    expect(state.url).toBe("https://one.example");
    expect(state.ratio).toBe(EMPTY_BROWSER.ratio);
    expect(normalizeBrowserWorkspace([])).toEqual(EMPTY_BROWSER);
  });

  it("uses stable distinct native identities across projects and tabs", () => {
    const id = browserIdForTab("/Users/test/Some Project", "tab-1");
    expect(id).toBe(browserIdForTab("/Users/test/Some Project", "tab-1"));
    expect(id).not.toBe(browserIdForTab("/Users/test/Other Project", "tab-1"));
    expect(id).not.toBe(browserIdForTab("/Users/test/Some Project", "tab-2"));
    expect(browserIdForTab("/a", "b:c")).not.toBe(browserIdForTab("/a:b", "c"));
    expect(id).toMatch(/^[a-zA-Z0-9-]{1,80}$/);
  });
});
