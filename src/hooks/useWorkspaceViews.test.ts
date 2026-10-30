// @vitest-environment happy-dom
import { restoreProfileWorkspace } from "../lib/workspaceProfiles";
import { act, createElement, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, leafIds, type LayoutNode } from "../lib/layout";
import {
  closeWorkspaceViews,
  minimizeWorkspaceSide,
  moveWorkspaceTab,
  restoreWorkspaceSplit,
  selectWorkspaceView,
  splitWorkspaceView,
  type WorkspaceView,
} from "../lib/workspaceViews";
import {
  NO_PROJECT_STRIP_KEY,
  WORKSPACE_SPACES_KEY,
  type WorkspaceStrip,
} from "../lib/workspaceSpaces";
import { useWorkspaceViews } from "./useWorkspaceViews";

const STORAGE_KEY = "supermono.workspaceViews.v1";
const projectA = "/projects/a";
const projectB = "/projects/b";
const columns: LayoutNode = {
  type: "split",
  id: "a-split",
  dir: "right",
  sizes: [0.35, 0.65],
  children: [leaf("a-chat"), leaf("a-web")],
};
const savedA: WorkspaceView = {
  layout: columns,
  focusedId: "a-web",
  order: ["a-web", "a-chat", "a-other"],
  groups: { "a-chat": ["a-chat"], "a-web": ["a-web", "a-other"] },
};
const savedB: WorkspaceView = {
  layout: leaf("b-web"),
  focusedId: "b-web",
  order: ["b-chat", "b-web"],
  groups: { "b-web": ["b-chat", "b-web"] },
};

describe("useWorkspaceViews project and explicit focus lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useWorkspaceViews>;
  let props: {
    project: string;
    ids: string[];
    requestedFocus: string;
    existing?: string[];
  };
  let storage: Map<string, string>;

  function Harness({ project, ids, requestedFocus, existing }: typeof props) {
    current = useWorkspaceViews(
      project,
      ids,
      requestedFocus,
      undefined,
      existing,
    );
    return null;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    storage = new Map([
      [STORAGE_KEY, JSON.stringify({ [projectA]: savedA, [projectB]: savedB })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      project: projectA,
      ids: ["a-chat", "a-web", "a-other"],
      requestedFocus: "a-chat",
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(patch: Partial<typeof props> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(createElement(Harness, props)));
  }
  const persisted = () =>
    JSON.parse(storage.get(STORAGE_KEY)!) as Record<string, WorkspaceView>;

  let selectLegacySession: (id: string) => void;
  let selectLegacyBrowser: () => void;
  let mirrored: { session: string; browser: boolean };
  function MirroredFocusHarness() {
    const [session, setSession] = useState("a-chat");
    const [browser, setBrowser] = useState(false);
    current = useWorkspaceViews(
      projectA,
      ["a-chat", "a-web", "a-other"],
      browser ? "a-web" : session,
    );
    const focusedId = current.view.focusedId;
    // App mirrors the selected surface into its older session/browser state.
    // That state also requests selection when opening a new session or page.
    useLayoutEffect(() => {
      if (focusedId === "a-web") setBrowser(true);
      else {
        setSession(focusedId);
        setBrowser(false);
      }
    }, [focusedId]);
    selectLegacySession = (id) => {
      setSession(id);
      setBrowser(false);
    };
    selectLegacyBrowser = () => setBrowser(true);
    mirrored = { session, browser };
    return null;
  }

  it("restores a selected projectless browser after an empty Work Home round trip", async () => {
    let selectProfile!: (id: string) => void;
    function ProfileHarness() {
      const [browser, setBrowser] = useState(true);
      const [, setProfile] = useState("personal");
      current = useWorkspaceViews(
        projectA,
        ["a-chat", "a-web", "a-other"],
        browser ? "a-web" : "a-chat",
      );
      selectProfile = (id) =>
        restoreProfileWorkspace(
          id,
          (next) => {
            setProfile(next);
            return next === "personal" ? projectA : "~";
          },
          (_cwd, restoreWorkspace = false) => {
            if (!restoreWorkspace) setBrowser(false);
          },
        );
      return null;
    }
    await act(async () => root.render(createElement(ProfileHarness)));
    expect(current.view.focusedId).toBe("a-web");
    await act(async () => selectProfile("work"));
    await act(async () => selectProfile("personal"));
    expect(current.view.focusedId).toBe("a-web");
    expect(current.view.layout).toEqual(columns);
  });

  it("accepts legacy session and browser requests while actual focus is unchanged", async () => {
    await act(async () => root.render(createElement(MirroredFocusHarness)));
    expect(current.view.focusedId).toBe("a-web");
    expect(mirrored.browser).toBe(true);
    await act(async () => selectLegacySession("a-other"));
    expect(current.view.focusedId).toBe("a-other");
    expect(mirrored).toEqual({ session: "a-other", browser: false });
    await act(async () => selectLegacyBrowser());
    expect(current.view).toEqual(savedA);
    expect(mirrored.browser).toBe(true);
  });

  it("keeps a tab selection authoritative when stale session preference changes in the same commit", async () => {
    await act(async () => root.render(createElement(MirroredFocusHarness)));
    await act(async () => {
      current.change((view) => selectWorkspaceView(view, "a-other"));
      selectLegacySession("a-chat");
    });
    expect(current.view.focusedId).toBe("a-other");
    expect(mirrored).toEqual({ session: "a-other", browser: false });
    expect(current.view.layout).toEqual({
      ...columns,
      children: [leaf("a-chat"), leaf("a-other")],
    });
    expect(current.view.groups["a-other"]).toEqual(["a-web", "a-other"]);
  });

  it("focuses a grouped browser without mirrored focus loops or detaching its original group", async () => {
    await act(async () => root.render(createElement(MirroredFocusHarness)));
    await act(async () => selectLegacySession("a-other"));
    await act(async () => {
      flushSync(() => {
        current.focus(projectA, "a-web");
        // A pending project selection can still carry the prior session.
        selectLegacySession("a-chat");
      });
    });
    expect(current.view).toEqual(savedA);
    expect(mirrored.browser).toBe(true);
    expect(persisted()[projectA]).toEqual(savedA);
  });

  it("keeps a surviving surface selected while closing tabs and pruning detached sessions", async () => {
    let close: (id: string) => void;
    let select: (id: string) => void;
    function ClosingHarness() {
      const [ids, setIds] = useState(["a-chat", "a-web", "a-other"]);
      const [session, setSession] = useState("a-chat");
      const [browser, setBrowser] = useState(true);
      current = useWorkspaceViews(projectA, ids, browser ? "a-web" : session);
      const focusedId = current.view.focusedId;
      // Like App, mirror only focus changes; closing a tab must not re-run this.
      const idsRef = useRef(ids);
      idsRef.current = ids;
      useLayoutEffect(() => {
        if (focusedId === "a-web") setBrowser(true);
        else if (idsRef.current.includes(focusedId)) {
          setSession(focusedId);
          setBrowser(false);
        }
      }, [focusedId]);
      select = (id) => {
        current.focus(projectA, id);
        setSession(id);
        setBrowser(false);
      };
      close = (id) => {
        const next = ids.filter((entry) => entry !== id);
        const fallback = next.find((entry) => entry !== "a-web") ?? "a-web";
        setIds(next);
        const nextView = closeWorkspaceViews(current.view, [id], fallback);
        current.change(() => nextView);
        if (id === session) {
          if (nextView.focusedId !== "a-web") {
            current.focus(projectA, nextView.focusedId);
            setBrowser(false);
            setSession(nextView.focusedId);
          } else setSession(fallback);
        }
      };
      return createElement("div", null, focusedId);
    }
    await act(async () => root.render(createElement(ClosingHarness)));
    await act(async () => select("a-other"));
    await act(async () => close("a-other"));
    expect(current.view.focusedId).toBe("a-web");
    expect(container.textContent).toBe("a-web");
    await act(async () => close("a-chat"));
    expect(current.view.layout).toEqual(leaf("a-web"));
    expect(current.view.order).toEqual(["a-web"]);
  });

  it("restores each project's saved browser focus, geometry and mixed order without applying the remembered session fallback", async () => {
    await render();
    expect(current.view).toEqual(savedA);
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-chat",
    });
    expect(current.view).toEqual(savedB);
    await render({
      project: projectA,
      ids: ["a-chat", "a-web", "a-other"],
      requestedFocus: "a-chat",
    });
    expect(current.view).toEqual(savedA);
    expect(persisted()).toEqual({ [projectA]: savedA, [projectB]: savedB });
  });

  it("opens a specifically selected destination session instead of restoring that project's previous browser focus", async () => {
    await render();
    await act(async () => {
      current.focus(projectB, "b-chat");
      props = {
        project: projectB,
        ids: ["b-chat", "b-web"],
        requestedFocus: "b-chat",
      };
      root.render(createElement(Harness, props));
    });
    expect(current.view.layout).toEqual(leaf("b-chat"));
    expect(current.view.focusedId).toBe("b-chat");
    expect(current.view.order).toEqual(["b-chat", "b-web"]);
    expect(persisted()[projectA]).toEqual(savedA);
    expect(persisted()[projectB]).toEqual(current.view);
  });

  it("accepts explicit focus for a newly opened tab before switching projects and preserves destination split neighbors", async () => {
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-chat",
    });
    await act(async () => current.focus(projectA, "a-new"));
    expect(current.view).toEqual(savedB);
    await render({
      project: projectA,
      ids: ["a-chat", "a-web", "a-other", "a-new"],
      requestedFocus: "a-new",
    });
    expect(current.view.focusedId).toBe("a-new");
    expect(current.view.layout).toEqual({
      ...columns,
      children: [leaf("a-chat"), leaf("a-new")],
    });
    expect(current.view.order).toEqual(["a-web", "a-new", "a-chat", "a-other"]);
    expect(persisted()[projectB]).toEqual(savedB);
  });

  it("replaces only the focused slot when a new tab requests focus in the current project", async () => {
    await render();
    await render({ ids: [...props.ids, "a-new"], requestedFocus: "a-new" });
    expect(current.view.focusedId).toBe("a-new");
    expect(current.view.layout).toEqual({
      ...columns,
      children: [leaf("a-chat"), leaf("a-new")],
    });
    expect(current.view.order).toEqual(["a-web", "a-new", "a-chat", "a-other"]);
    expect(persisted()[projectA]).toEqual(current.view);
  });

  it("persists a surviving browser after its session closes and does not restore the removed split on revisiting", async () => {
    await render();
    await act(async () => {
      current.change((view) =>
        closeWorkspaceViews(view, ["a-chat"], "a-other"),
      );
      props = { ...props, ids: ["a-web", "a-other"], requestedFocus: "a-web" };
      root.render(createElement(Harness, props));
    });
    expect(leafIds(current.view.layout!)).toEqual(["a-web"]);
    expect(current.view.focusedId).toBe("a-web");
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-chat",
    });
    await render({
      project: projectA,
      ids: ["a-web", "a-other"],
      requestedFocus: "a-other",
    });
    expect(current.view.layout).toEqual(leaf("a-web"));
    expect(current.view.focusedId).toBe("a-web");
    expect(persisted()[projectA].order).toEqual(["a-web", "a-other"]);
  });

  it("keeps minimized tabs out of visible groups through rerenders with a stale session preference", async () => {
    await render();
    await act(async () => {
      current.change((view) =>
        minimizeWorkspaceSide(view, "a-split", 0, "before"),
      );
    });
    expect(current.view.layout).toEqual(leaf("a-web"));
    expect(current.view.groups).toEqual({ "a-web": ["a-web", "a-other"] });
    expect(current.view.hiddenGroups).toEqual({ "a-chat": ["a-chat"] });
    expect(current.view.order).toEqual(savedA.order);
    const minimized = current.view;
    // The legacy selected session still points at the hidden chat. Rebuilding
    // the available IDs during ordinary app updates must not make it a tab.
    await render({ ids: [...props.ids], requestedFocus: "a-chat" });
    expect(current.view).toEqual(minimized);
    expect(current.get(projectA)).toEqual(minimized);
    expect(persisted()[projectA]).toEqual(minimized);
  });

  it("persists hidden tab membership across remount and a project round trip", async () => {
    await render();
    await act(async () => {
      current.change((view) =>
        minimizeWorkspaceSide(view, "a-split", 0, "after"),
      );
    });
    const minimized = current.view;
    expect(minimized.groups).toEqual({ "a-chat": ["a-chat"] });
    expect(minimized.hiddenGroups).toEqual({ "a-web": ["a-web", "a-other"] });
    await act(async () => root.unmount());
    root = createRoot(container);
    // A remembered browser preference on a fresh mount is not a new request.
    await render({ requestedFocus: "a-web" });
    expect(current.view).toEqual(minimized);
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-chat",
    });
    await render({
      project: projectA,
      ids: ["a-chat", "a-web", "a-other"],
      requestedFocus: "a-other",
    });
    expect(current.view).toEqual(minimized);
    expect(persisted()[projectA]).toEqual(minimized);
  });

  it.each([false, true])(
    "restores and selects a hidden tab on explicit focus (other project: %s)",
    async (fromOtherProject) => {
      await render();
      await act(async () => {
        current.change((view) =>
          minimizeWorkspaceSide(view, "a-split", 0, "after"),
        );
      });
      if (fromOtherProject) {
        await render({
          project: projectB,
          ids: ["b-chat", "b-web"],
          requestedFocus: "b-chat",
        });
      }
      await act(async () => current.focus(projectA, "a-other"));
      if (fromOtherProject) {
        expect(current.view).toEqual(savedB);
        await render({
          project: projectA,
          ids: ["a-chat", "a-web", "a-other"],
          requestedFocus: "a-other",
        });
      }
      expect(current.view.layout).toEqual({
        ...columns,
        children: [leaf("a-chat"), leaf("a-other")],
      });
      expect(current.view.focusedId).toBe("a-other");
      expect(current.view.groups).toEqual({
        "a-chat": ["a-chat"],
        "a-other": ["a-web", "a-other"],
      });
      expect(current.view.hiddenGroups).toBeUndefined();
      expect(current.view.restoreView).toBeUndefined();
      expect(persisted()[projectA]).toEqual(current.view);
    },
  );

  it("keeps a newly opened visible tab selected when restoring minimized tabs", async () => {
    await render();
    await act(async () => {
      current.change((view) =>
        minimizeWorkspaceSide(view, "a-split", 0, "before"),
      );
    });
    await render({ ids: [...props.ids, "a-new"], requestedFocus: "a-new" });
    expect(current.view.layout).toEqual(leaf("a-new"));
    expect(current.view.focusedId).toBe("a-new");
    expect(Object.values(current.view.groups).flat()).not.toContain("a-chat");
    expect(current.view.hiddenGroups).toEqual({ "a-chat": ["a-chat"] });
    await act(async () => current.change(restoreWorkspaceSplit));
    expect(current.view.layout).toEqual({
      ...columns,
      children: [leaf("a-chat"), leaf("a-new")],
    });
    expect(current.view.focusedId).toBe("a-new");
    expect(current.view.groups["a-chat"]).toEqual(["a-chat"]);
    expect(current.view.groups["a-new"]).toEqual(
      expect.arrayContaining(["a-web", "a-other", "a-new"]),
    );
    expect(current.view.hiddenGroups).toBeUndefined();
    expect(persisted()[projectA]).toEqual(current.view);
  });

  const spaces = () =>
    JSON.parse(storage.get(WORKSPACE_SPACES_KEY)!) as {
      version: number;
      projects: Record<string, WorkspaceStrip>;
    };

  it("migrates each project once to a versioned strip, keeping the former views readable", async () => {
    await render();
    // A's split is one space; B (not opened) stays as it was.
    expect(spaces().version).toBe(1);
    const strip = spaces().projects[projectA];
    expect(strip.entries).toHaveLength(1);
    expect(strip.entries[0].kind).toBe("space");
    expect(strip.front).toBe("aven-space:former");
    expect(spaces().projects[projectB]).toBeUndefined();
    expect(persisted()[projectA]).toEqual(current.view);
    expect(persisted()[projectB]).toEqual(savedB);
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-web",
    });
    expect(spaces().projects[projectB]).toEqual({
      entries: [
        { kind: "item", id: "b-chat" },
        { kind: "item", id: "b-web" },
      ],
      front: "b-web",
    });
  });

  it("switches the whole arrangement between strip entries and remembers the front", async () => {
    await render({
      project: projectB,
      ids: ["b-chat", "b-web", "b-docs"],
      requestedFocus: "b-web",
    });
    // Drag b-docs onto the right edge of b-web: a space of the two.
    await act(async () =>
      current.change((view) =>
        splitWorkspaceView(view, "b-docs", "right", "b-web"),
      ),
    );
    expect(current.strip.entries.map((entry) => entry.kind)).toEqual([
      "item",
      "space",
    ]);
    expect(leafIds(current.view.layout!)).toEqual(["b-web", "b-docs"]);
    // The single tab: one pane again.
    await act(async () => current.select("b-chat"));
    expect(current.view.layout).toEqual(leaf("b-chat"));
    await act(async () => current.select("b-docs"));
    expect(leafIds(current.view.layout!)).toEqual(["b-web", "b-docs"]);
    expect(current.view.focusedId).toBe("b-docs");
    const front = current.strip.front;
    expect(spaces().projects[projectB].front).toBe(front);
    // Another project and back: the space is still in front.
    await render({
      project: projectA,
      ids: ["a-chat", "a-web", "a-other"],
      requestedFocus: "a-chat",
    });
    await render({
      project: projectB,
      ids: ["b-chat", "b-web", "b-docs"],
      requestedFocus: "b-docs",
    });
    expect(current.strip.front).toBe(front);
  });

  it("persists the strip's order", async () => {
    await render({
      project: projectB,
      ids: ["b-chat", "b-web"],
      requestedFocus: "b-web",
    });
    await act(async () => current.reorderEntries(["b-web", "b-chat"]));
    expect(
      spaces().projects[projectB].entries.map((entry) =>
        entry.kind === "item" ? entry.id : entry.kind,
      ),
    ).toEqual(["b-web", "b-chat"]);
  });

  it("brings a single tab into the space in front for a drop", async () => {
    await render({
      project: projectB,
      ids: ["b-chat", "b-web", "b-docs"],
      requestedFocus: "b-web",
    });
    await act(async () =>
      current.change((view) =>
        splitWorkspaceView(view, "b-docs", "right", "b-web"),
      ),
    );
    // b-chat is a single tab on the strip; drop it onto b-web's title row.
    const view = current.viewWith(["b-chat"]);
    await act(async () =>
      current.change(() => moveWorkspaceTab(view, "b-chat", "b-web")),
    );
    expect(current.strip.entries.map((entry) => entry.kind)).toEqual(["space"]);
    expect(current.view.groups["b-web"]).toEqual(["b-web", "b-chat"]);
  });
  describe("split entries", () => {
    /** b-chat on its own, then b-web | b-docs as a split behind it. */
    async function withSplit() {
      await render({
        project: projectB,
        ids: ["b-chat", "b-web", "b-docs"],
        requestedFocus: "b-web",
      });
      await act(async () =>
        current.change((view) =>
          splitWorkspaceView(view, "b-docs", "right", "b-web"),
        ),
      );
      await act(async () => current.select("b-chat"));
      expect(current.strip.front).toBe("b-chat");
      return current.strip.entries.find((entry) => entry.kind === "space")!;
    }
    const entryKeyOf = (entry: { kind: string; id: string }) =>
      entry.kind === "item" ? entry.id : `aven-space:${entry.id}`;

    it("brings a split forward on one of its tabs in a single call", async () => {
      const split = await withSplit();
      // One select: the split comes forward, its pane takes focus and the
      // tab shows, with nothing to follow up.
      await act(async () => current.select("b-web"));
      expect(current.strip.front).toBe(entryKeyOf(split));
      expect(current.view.focusedId).toBe("b-web");
      expect(leafIds(current.view.layout!)).toEqual(["b-web", "b-docs"]);
      expect(spaces().projects[projectB].front).toBe(entryKeyOf(split));
    });

    it("adds a tab dropped on the split as a pane at its right", async () => {
      const split = await withSplit();
      await act(async () => current.addPane(entryKeyOf(split), "b-chat"));
      expect(current.strip.entries.map((entry) => entry.kind)).toEqual([
        "space",
      ]);
      expect(leafIds(current.view.layout!)).toEqual([
        "b-web",
        "b-docs",
        "b-chat",
      ]);
      expect(current.view.focusedId).toBe("b-chat");
      expect(spaces().projects[projectB].front).toBe(entryKeyOf(split));
    });

    it("takes a tab out of its split onto the strip", async () => {
      await withSplit();
      await act(async () => current.detach("b-docs", "b-chat"));
      expect(
        current.strip.entries.map((entry) =>
          entry.kind === "item" ? entry.id : entry.kind,
        ),
      ).toEqual(["b-docs", "b-chat", "b-web"]);
      // The tab pulled out is what is shown.
      expect(current.strip.front).toBe("b-docs");
    });

    it("undoes a layout change in the split it was made in", async () => {
      const split = await withSplit();
      await act(async () => current.select("b-web"));
      const snapshot = current.view;
      const entry = current.strip.front;
      await act(async () =>
        current.change((view) => ({
          ...view,
          layout: {
            ...(view.layout as Extract<LayoutNode, { type: "split" }>),
            sizes: [0.3, 0.7],
          },
        })),
      );
      // Another entry comes to the front before the undo.
      await act(async () => current.select("b-chat"));
      let undone = false;
      await act(async () => {
        undone = current.undoLayout(snapshot, entry);
      });
      expect(undone).toBe(true);
      expect(current.strip.front).toBe(entryKeyOf(split));
      expect(current.view.layout).toEqual(snapshot.layout);
      expect(
        current.strip.entries.map((item) =>
          item.kind === "item" ? item.id : item.kind,
        ),
      ).toEqual(["b-chat", "space"]);
    });

    it("makes a split of a tab let go on a single tab, stored as any split", async () => {
      await render({
        project: projectB,
        ids: ["b-chat", "b-web", "b-docs"],
        requestedFocus: "b-chat",
      });
      expect(current.strip.entries.map((entry) => entry.kind)).toEqual([
        "item",
        "item",
        "item",
      ]);
      await act(async () => current.combine("b-chat", "b-docs"));
      const stored = spaces();
      expect(stored.version).toBe(1);
      const entries = stored.projects[projectB].entries;
      expect(
        entries.map((entry) => (entry.kind === "item" ? entry.id : "space")),
      ).toEqual(["space", "b-web"]);
      expect(stored.projects[projectB].front).toBe(entryKeyOf(entries[0]));
      expect(leafIds(current.view.layout!)).toEqual(["b-chat", "b-docs"]);
      expect(current.view.focusedId).toBe("b-docs");
      // An older Aven still opens on the split in front.
      const legacy = JSON.parse(storage.get(STORAGE_KEY)!) as Record<
        string,
        WorkspaceView
      >;
      expect(leafIds(legacy[projectB].layout!)).toEqual(["b-chat", "b-docs"]);

      // The split let go on b-web takes it as a pane, in its place.
      await act(async () => current.combine("b-web", entryKeyOf(entries[0])));
      expect(current.strip.entries.map((entry) => entry.kind)).toEqual([
        "space",
      ]);
      expect(leafIds(current.view.layout!)).toEqual([
        "b-chat",
        "b-docs",
        "b-web",
      ]);
      expect(current.view.focusedId).toBe("b-docs");
    });

    it("separates a split into single tabs", async () => {
      const split = await withSplit();
      await act(async () => current.select("b-docs"));
      await act(async () => current.separate(entryKeyOf(split)));
      expect(
        spaces().projects[projectB].entries.map((entry) =>
          entry.kind === "item" ? entry.id : entry.kind,
        ),
      ).toEqual(["b-chat", "b-web", "b-docs"]);
      expect(current.view.layout).toEqual(leaf("b-docs"));
    });
  });

  describe("reading a strip back", () => {
    const stored = (strip: WorkspaceStrip) =>
      storage.set(
        WORKSPACE_SPACES_KEY,
        JSON.stringify({ version: 1, projects: { [projectB]: strip } }),
      );
    const kinds = () =>
      current.strip.entries.map((entry) =>
        entry.kind === "item" ? entry.id : `split(${viewIds(entry.view)})`,
      );
    const viewIds = (view: WorkspaceView) =>
      view.layout ? leafIds(view.layout).join("|") : "";
    const split: WorkspaceStrip = {
      entries: [
        {
          kind: "space",
          id: "s",
          view: {
            layout: {
              type: "split",
              id: "row",
              dir: "right",
              sizes: [0.5, 0.5],
              children: [leaf("b-web"), leaf("b-docs")],
            },
            focusedId: "b-web",
            order: ["b-web", "b-docs"],
            groups: { "b-web": ["b-web"], "b-docs": ["b-docs"] },
          },
        },
      ],
      front: "aven-space:s",
    };

    it("puts a tab the stored strip lost on the strip, not inside the split in front", async () => {
      stored(split);
      await render({
        project: projectB,
        ids: ["b-web", "b-docs", "b-chat"],
        requestedFocus: "b-web",
      });
      expect(kinds()).toEqual(["split(b-web|b-docs)", "b-chat"]);
      expect(current.strip.front).toBe("aven-space:s");
      // Saved that way, so it holds after the next restart.
      expect(spaces().projects[projectB].entries).toHaveLength(2);
      // Once read back, a new tab joins the split in front as before.
      await render({ ids: ["b-web", "b-docs", "b-chat", "b-new"] });
      expect(kinds()).toEqual(["split(b-web|b-docs)", "b-chat"]);
      expect(current.view.groups["b-web"]).toContain("b-new");
    });

    it("keeps saving every project when one project's stored strip is broken", async () => {
      storage.set(
        WORKSPACE_SPACES_KEY,
        JSON.stringify({
          version: 1,
          projects: {
            [projectB]: split,
            "/projects/broken": {
              entries: [{ kind: "space", id: "s", view: null }, null],
            },
            "/projects/worse": { entries: "x" },
            "/projects/gone": null,
          },
        }),
      );
      await render({
        project: projectB,
        ids: ["b-web", "b-docs", "b-chat"],
        requestedFocus: "b-web",
      });
      await act(async () => current.select("b-chat"));
      const saved = spaces().projects;
      // The broken strips are dropped; the good one keeps saving.
      expect(Object.keys(saved).sort()).toEqual(
        ["/projects/broken", projectB].sort(),
      );
      expect(saved["/projects/broken"]).toEqual({ entries: [], front: "" });
      expect(saved[projectB].front).toBe("b-chat");
      expect(JSON.parse(storage.get(STORAGE_KEY)!)[projectB]).toBeDefined();
    });

    it("saves each tab in exactly one place, in every project's strip", async () => {
      // Another project's strip holds a tab twice (an older Aven, a bug).
      stored({
        entries: [
          ...split.entries,
          { kind: "item", id: "b-docs" },
          { kind: "item", id: "b-chat" },
        ],
        front: "b-chat",
      });
      await render();
      const raw = spaces().projects[projectB];
      expect(
        raw.entries.map((entry) =>
          entry.kind === "item" ? entry.id : entry.kind,
        ),
      ).toEqual(["space", "b-chat"]);
      expect(raw.front).toBe("b-chat");
    });
  });

  describe("a chat of no project", () => {
    const pair = (one: string, two: string): WorkspaceView => ({
      layout: {
        type: "split",
        id: `${one}-${two}`,
        dir: "right",
        sizes: [0.5, 0.5],
        children: [leaf(one), leaf(two)],
      },
      focusedId: one,
      order: [one, two],
      groups: { [one]: [one], [two]: [two] },
    });
    /** x | y in front, a single tab, a | b, and a page. */
    const stored: WorkspaceStrip = {
      entries: [
        { kind: "space", id: "s1", view: pair("b-x", "b-y") },
        { kind: "item", id: "b-f" },
        { kind: "space", id: "s2", view: pair("b-a", "b-b") },
        { kind: "item", id: "b-page" },
      ],
      front: "aven-space:s1",
    };
    const ids = ["b-x", "b-y", "b-f", "b-a", "b-b", "b-page"];
    const existing = [...ids, "home"];
    const shape = () =>
      current.strip.entries.map((entry) =>
        entry.kind === "item"
          ? entry.id
          : `${entry.id}(${leafIds(entry.view.layout!).join("|")})`,
      );
    const whole = ["s1(b-x|b-y)", "b-f", "s2(b-a|b-b)", "b-page"];
    beforeEach(() => {
      storage.set(
        WORKSPACE_SPACES_KEY,
        JSON.stringify({ version: 1, projects: { [projectB]: stored } }),
      );
    });

    it("keeps the project's splits through a visit and back", async () => {
      await render({ project: projectB, ids, requestedFocus: "b-x", existing });
      expect(shape()).toEqual(whole);
      // The chat stands on a strip of its own, beside the project's page.
      await render({
        project: NO_PROJECT_STRIP_KEY,
        ids: ["home", "b-page"],
        requestedFocus: "home",
        existing,
      });
      await act(async () => current.select("b-page"));
      expect(spaces().projects[projectB]).toEqual(stored);
      // Back to one of the project's tabs.
      await act(async () => current.focus(projectB, "b-a"));
      await render({ project: projectB, ids, requestedFocus: "b-a", existing });
      expect(shape()).toEqual(whole);
      expect(current.strip.front).toBe("aven-space:s2");
      // An older Aven opens on the split in front, too.
      expect(leafIds(persisted()[projectB].layout!)).toEqual(["b-a", "b-b"]);
    });

    it("keeps them even when written from the chat's partial view", async () => {
      await render({ project: projectB, ids, requestedFocus: "b-x", existing });
      // The project's strip written while only the chat and a page show.
      await render({
        project: projectB,
        ids: ["home", "b-page"],
        requestedFocus: "home",
        existing,
      });
      await act(async () => current.select("b-page"));
      await render({
        project: projectB,
        ids,
        requestedFocus: "b-page",
        existing,
      });
      expect(shape()).toEqual(whole);
      await act(async () => current.select("b-x"));
      expect(leafIds(persisted()[projectB].layout!)).toEqual(["b-x", "b-y"]);
    });
  });
});
