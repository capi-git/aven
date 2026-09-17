// @vitest-environment happy-dom
import {
  act,
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeLeaf, leaf, leafIds, type WorkspaceTab } from "./layout";
import type { Session } from "./session";
import { resolvePaneCloseTab } from "./sessionPaneClose";
import {
  filterTabsForProject,
  planWorkspaceTabClose,
} from "./workspaceTabGroups";
import {
  closeWorkspaceViews,
  useWorkspaceViews,
  type WorkspaceView,
} from "./workspaceViews";

const project = "/projects/close-focus";
const initialTabs: WorkspaceTab[] = [
  {
    id: "nested",
    kind: "session",
    focusedId: "right",
    editorPanes: [],
    terminalPanes: [],
    layout: {
      type: "split",
      id: "inner",
      dir: "right",
      sizes: [0.4, 0.6],
      children: [leaf("left"), leaf("right")],
    },
  },
  {
    id: "single",
    kind: "session",
    focusedId: "last",
    editorPanes: [],
    terminalPanes: [],
    layout: leaf("last"),
  },
];
const initialSessions = ["left", "right", "last"].map((id) => ({
  id,
  cwd: project,
  busy: false,
})) as Session[];

/** The state/effect boundaries used by App, with native persistence excluded. */
describe("session close with workspace focus and detached-session cleanup", () => {
  let root: Root;
  let container: HTMLDivElement;
  let initialBrowser: boolean;
  let api: {
    closePane(id: string): void;
    closeTab(id: string): void;
    focus(id: string): void;
    tabs: WorkspaceTab[];
    sessions: Session[];
    view: WorkspaceView;
    activeId: string;
  };

  function Harness() {
    const [tabs, setTabs] = useState(initialTabs);
    const [sessions, setSessions] = useState(initialSessions);
    const [activeId, setActiveId] = useState("nested");
    const [browserExpanded, setBrowserExpanded] = useState(initialBrowser);
    const deck = filterTabsForProject(tabs, sessions, project);
    const views = useWorkspaceViews(
      project,
      [...deck.map((tab) => tab.id), ...(initialBrowser ? ["browser"] : [])],
      browserExpanded ? "browser" : activeId,
    );
    const focus = views.view.focusedId;
    useLayoutEffect(() => {
      if (focus === "browser") setBrowserExpanded(true);
      else if (deck.some((tab) => tab.id === focus)) {
        setActiveId(focus);
        setBrowserExpanded(false);
      }
    }, [focus]);
    useEffect(() => {
      const open = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
      if (sessions.every((session) => open.has(session.id))) return;
      setSessions((previous) =>
        previous.filter((session) => open.has(session.id)),
      );
    }, [sessions, tabs]);

    function activate(id: string) {
      setBrowserExpanded(false);
      setActiveId(id);
      views.focus(project, id);
    }
    function closeTab(id: string) {
      const closing = tabs.find((tab) => tab.id === id);
      if (!closing) return;
      const plan = planWorkspaceTabClose({
        tabs,
        sessions,
        closingTabId: id,
        scope: "project",
      });
      if (plan.action === "keep") {
        const replacement = {
          id: "replacement",
          cwd: project,
          busy: false,
        } as Session;
        setSessions((previous) => [...previous, replacement]);
        setTabs((previous) =>
          previous.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  layout: leaf(replacement.id),
                  focusedId: replacement.id,
                }
              : tab,
          ),
        );
        return;
      }
      const next = tabs.filter((tab) => tab.id !== id);
      setTabs(next);
      const view = closeWorkspaceViews(
        views.view,
        [id],
        plan.nextActiveTabId ?? "",
      );
      views.change(() => view);
      if (id === activeId && plan.nextActiveTabId) {
        if (next.some((tab) => tab.id === view.focusedId))
          activate(view.focusedId);
        else setActiveId(plan.nextActiveTabId);
      }
    }
    function closePane(id: string) {
      const owner = resolvePaneCloseTab(tabs, activeId, id);
      if (!owner || !sessions.some((session) => session.id === id)) return;
      const next = closeLeaf(owner, id);
      if (!next) closeTab(owner.id);
      else
        setTabs((previous) =>
          previous.map((tab) =>
            tab.id === owner.id
              ? { ...tab, layout: next.layout, focusedId: next.focusedId }
              : tab,
          ),
        );
    }
    api = {
      closeTab,
      closePane,
      focus: activate,
      tabs,
      sessions,
      view: views.view,
      activeId,
    };
    return createElement("div", null, focus);
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    initialBrowser = false;
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(browser: boolean) {
    initialBrowser = browser;
    const view: WorkspaceView = {
      layout: {
        type: "split",
        id: "outer",
        dir: "right",
        sizes: [0.45, 0.55],
        children: [leaf("nested"), leaf(browser ? "browser" : "single")],
      },
      focusedId: browser ? "browser" : "nested",
      order: ["nested", "single", ...(browser ? ["browser"] : [])],
      groups: {
        nested: ["nested"],
        [browser ? "browser" : "single"]: browser
          ? ["single", "browser"]
          : ["single"],
      },
    };
    localStorage.setItem(
      "supermono.workspaceViews.v1",
      JSON.stringify({ [project]: view }),
    );
    await act(async () => root.render(createElement(Harness)));
  }

  it.each([false, true])(
    "closes both nested children then the last remaining conversation, browser selected=%s",
    async (browser) => {
      await render(browser);
      await act(async () => api.closePane("right"));
      expect(api.tabs.find((tab) => tab.id === "nested")?.layout).toEqual(
        leaf("left"),
      );
      expect(api.sessions.map((session) => session.id)).toEqual([
        "left",
        "last",
      ]);
      expect(api.view.focusedId).toBe(browser ? "browser" : "nested");
      await act(async () => api.closePane("left"));
      expect(api.tabs.map((tab) => tab.id)).toEqual(["single"]);
      expect(api.view.focusedId).toBe(browser ? "browser" : "single");
      await act(async () => api.closePane("last"));
      expect(api.tabs[0].layout).toEqual(leaf("replacement"));
      expect(api.sessions.map((session) => session.id)).toEqual([
        "replacement",
      ]);
      expect(container.textContent).toBe(browser ? "browser" : "single");
    },
  );

  it.each([false, true])(
    "closes the first nested child while its sibling retains focus, browser selected=%s",
    async (browser) => {
      await render(browser);
      await act(async () => api.closePane("left"));
      const nested = api.tabs.find((tab) => tab.id === "nested")!;
      expect(nested.focusedId).toBe("right");
      expect(nested.layout).toEqual(leaf("right"));
      expect(api.view.focusedId).toBe(browser ? "browser" : "nested");
    },
  );

  it.each(["nested", "single"])(
    "closes outer tab %s while preserving the active browser and valid surviving groups",
    async (id) => {
      await render(true);
      await act(async () => api.closeTab(id));
      expect(api.tabs.some((tab) => tab.id === id)).toBe(false);
      expect(api.view.order).not.toContain(id);
      expect(Object.values(api.view.groups).flat()).not.toContain(id);
      expect(container.textContent).toBe("browser");
    },
  );

  it("ignores callbacks for leaves and outer tabs that already closed", async () => {
    await render(true);
    await act(async () => api.closeTab("nested"));
    const surviving = api.tabs;
    await act(async () => {
      api.closePane("right");
      api.closePane("left");
      api.closeTab("nested");
    });
    expect(api.tabs).toBe(surviving);
    expect(container.textContent).toBe("browser");
  });
});
