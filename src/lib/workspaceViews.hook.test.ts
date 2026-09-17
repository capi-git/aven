// @vitest-environment happy-dom
import { restoreProfileWorkspace } from "./workspaceProfiles";
import { act, createElement, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  closeWorkspaceViews,
  selectWorkspaceView,
  useWorkspaceViews,
  type WorkspaceView,
} from "./workspaceViews";
import { createWorkspacePipReturns } from "./workspacePictureInPicture";

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
  let props: { project: string; ids: string[]; requestedFocus: string };
  let storage: Map<string, string>;

  function Harness({ project, ids, requestedFocus }: typeof props) {
    current = useWorkspaceViews(project, ids, requestedFocus);
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
      current = useWorkspaceViews(projectA, ["a-chat", "a-web", "a-other"], browser ? "a-web" : "a-chat");
      selectProfile = (id) => restoreProfileWorkspace(id,
        (next) => {setProfile(next);return next === "personal" ? projectA : "~";},
        (_cwd, restoreWorkspace = false) => {if (!restoreWorkspace) setBrowser(false);});
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

  it("returns a selected grouped browser without mirrored focus loops or detaching its original group", async () => {
    await act(async () => root.render(createElement(MirroredFocusHarness)));
    await act(async () => selectLegacySession("a-other"));
    const returns = createWorkspacePipReturns();
    returns.register([
      {
        label: "pip-session",
        target: { kind: "session", id: "session", surfaceId: "a-other" },
      },
      {
        label: "pip-browser",
        target: { kind: "browser", id: "a-web", surfaceId: "a-web" },
      },
    ]);
    returns.complete("pip-browser", ["pip-session", "pip-browser"]);
    returns.restored("session", "session", () =>
      selectLegacySession("a-other"),
    );
    await act(async () => {
      returns.restored("browser", "a-web", () => {
        flushSync(() => {
          current.focus(projectA, "a-web");
          // A pending project selection can still carry the prior session.
          selectLegacySession("a-chat");
        });
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
      useLayoutEffect(() => {
        if (focusedId === "a-web") setBrowser(true);
        else if (ids.includes(focusedId)) {
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
});
