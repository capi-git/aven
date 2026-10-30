// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf } from "../lib/layout";
import {
  railWorkspaceSide,
  restoreWorkspaceSplit,
  selectWorkspaceView,
  type WorkspaceView,
} from "../lib/workspaceViews";
import { WorkspaceStage } from "./WorkspaceStage";

const initial: WorkspaceView = {
  layout: {
    type: "split",
    id: "panes",
    dir: "right",
    children: [leaf("chat"), leaf("web")],
    sizes: [0.3, 0.7],
  },
  focusedId: "chat",
  order: ["chat", "chat-two", "web", "web-two"],
  groups: { chat: ["chat", "chat-two"], web: ["web", "web-two"] },
};

describe("workspace pane minimization and visible tab headers", () => {
  let root: Root;
  let container: HTMLDivElement;
  let selectExternal: (id: string) => void;

  function Harness() {
    const [view, setView] = useState(initial);
    selectExternal = (id) =>
      setView((current) => selectWorkspaceView(current, id));
    return createElement(WorkspaceStage, {
      layout: view.layout,
      focusedId: view.focusedId,
      visible: true,
      surfaces: initial.order.map((id) => ({
        id,
        content: createElement("input", {
          "aria-label": `${id} draft`,
          defaultValue: id,
        }),
      })),
      headers: Object.entries(view.groups).map(([id, members]) => ({
        id,
        content: createElement(
          "div",
          null,
          ...members.map((member) =>
            createElement(
              "button",
              {
                key: member,
                "data-surface-tab-id": member,
                onClick: () => selectExternal(member),
              },
              member,
            ),
          ),
        ),
      })),
      onFocus: selectExternal,
      onLayoutChange: (layout) =>
        setView((current) => ({ ...current, layout })),
      onMinimizeSide: (split, index, side) =>
        setView((current) => railWorkspaceSide(current, split, index, side)),
      onRestoreRail: selectExternal,
      railContent: (id) => ({
        label: `${id} rail`,
        content: createElement("span", null, (view.groups[id] ?? []).join(",")),
      }),
      onRestoreSplit: view.restoreView
        ? () => setView(restoreWorkspaceSplit)
        : undefined,
      restoreEdge: view.minimizedEdge,
      dragTarget: null,
      dragging: false,
    });
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const tabIds = () =>
    [...container.querySelectorAll<HTMLElement>("[data-surface-tab-id]")].map(
      (tab) => tab.dataset.surfaceTabId,
    );
  const draft = (id: string) =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${id} draft"]`,
    )!;
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    )!;

  const rail = () =>
    container.querySelector<HTMLButtonElement>("[data-pane-rail]");

  it.each([
    ["left", "chat", ["web", "web-two"], "web", "30%"],
    ["right", "web", ["chat", "chat-two"], "chat", "70%"],
  ] as const)(
    "collapses the %s pane to a rail that names its tabs, and opens it with its draft",
    async (side, collapsed, remainingTabs, open, width) => {
      const collapsedDraft = draft(collapsed);
      collapsedDraft.value = "Unsent content remains here";
      expect(tabIds()).toEqual(["chat", "chat-two", "web", "web-two"]);
      await act(async () => button(`Collapse ${side} pane`).click());
      // Its tabs leave the title rows for its rail; nothing is hidden away.
      expect(tabIds()).toEqual(remainingTabs);
      expect(
        container.querySelector(`[data-workspace-header="${collapsed}"]`),
      ).toBeNull();
      expect(draft(collapsed)).toBe(collapsedDraft);
      expect(
        collapsedDraft.closest<HTMLElement>("[data-workspace-surface]")!.hidden,
      ).toBe(true);
      expect(rail()?.dataset.paneRail).toBe(collapsed);
      expect(rail()?.getAttribute("aria-label")).toBe(`Open ${collapsed} rail`);
      expect(rail()?.textContent).toBe(
        collapsed === "chat" ? "chat,chat-two" : "web,web-two",
      );
      expect(document.activeElement).toBe(rail());
      expect(
        container
          .querySelector(`[data-workspace-surface="${open}"]`)!
          .getAttribute("data-focused"),
      ).toBe("true");
      await act(async () => rail()!.click());
      expect(tabIds()).toEqual(["chat", "chat-two", "web", "web-two"]);
      expect(rail()).toBeNull();
      expect(
        collapsedDraft.closest<HTMLElement>("[data-workspace-surface]")!.hidden,
      ).toBe(false);
      expect(collapsedDraft.value).toBe("Unsent content remains here");
      expect(
        container.querySelector<HTMLElement>(
          `[data-workspace-surface="${collapsed}"]`,
        )!.style.width,
      ).toBe(`calc(${width} - 0.5px)`);
    },
  );

  it("opens a collapsed pane when one of its tabs is selected elsewhere", async () => {
    await act(async () => button("Collapse left pane").click());
    expect(tabIds()).not.toContain("chat-two");
    await act(async () => selectExternal("chat-two"));
    expect(tabIds().sort()).toEqual(["chat", "chat-two", "web", "web-two"]);
    expect(
      [
        ...container.querySelectorAll<HTMLElement>(
          '[data-workspace-header="chat-two"] [data-surface-tab-id]',
        ),
      ].map((tab) => tab.dataset.surfaceTabId),
    ).toEqual(["chat", "chat-two"]);
    expect(
      container
        .querySelector('[data-workspace-surface="chat-two"]')!
        .getAttribute("data-focused"),
    ).toBe("true");
    expect(rail()).toBeNull();
  });
});

describe("a pane whose own panes name themselves", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (layout: WorkspaceView["layout"], headers: string[]) =>
    act(async () =>
      root.render(
        createElement(WorkspaceStage, {
          layout,
          focusedId: "chat",
          visible: true,
          surfaces: ["chat", "web"].map((id) => ({
            id,
            content: createElement("div", null, id),
          })),
          headers: headers.map((id) => ({ id, content: `${id} title` })),
          onFocus: vi.fn(),
          onLayoutChange: vi.fn(),
          onMinimizeSide: vi.fn(),
          dragTarget: null,
          dragging: false,
        }),
      ),
    );
  const surface = (id: string) =>
    container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
  const header = (id: string) =>
    container.querySelector<HTMLElement>(`[data-workspace-header="${id}"]`);

  it("gets no title row of its own, and no room kept for one", async () => {
    // A tab split into a chat and a file, alone: its panes' strips name it.
    await render(leaf("chat"), []);
    expect(header("chat")).toBeNull();
    expect(surface("chat").dataset.hasHeader).toBe("false");
  });

  it("still gets an empty row where it holds a pane's minimize control", async () => {
    await render(initial.layout, ["web"]);
    expect(header("web")?.textContent).toContain("web title");
    // The chat pane named itself, but the seam's Hide control lives here.
    expect(header("chat")).not.toBeNull();
    expect(header("chat")?.textContent).not.toContain("chat title");
    expect(surface("chat").dataset.hasHeader).toBe("true");
  });
});

describe("the keyboard as panes collapse and open", () => {
  let root: Root;
  let container: HTMLDivElement;
  let setView: (update: (view: WorkspaceView) => WorkspaceView) => void;
  let askRail: (id: string) => void;
  const three: WorkspaceView = {
    layout: {
      type: "split",
      id: "row",
      dir: "right",
      children: [leaf("a"), leaf("b"), leaf("c")],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    },
    focusedId: "b",
    order: ["a", "b", "c"],
    groups: { a: ["a"], b: ["b"], c: ["c"] },
  };

  function Harness() {
    const [view, set] = useState(three);
    const [focusRail, setFocusRail] = useState<{
      id: string;
      nonce: number;
    } | null>(null);
    setView = set;
    askRail = (id) =>
      setFocusRail((previous) => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
    return createElement(WorkspaceStage, {
      layout: view.layout,
      focusedId: view.focusedId,
      visible: true,
      surfaces: three.order.map((id) => ({
        id,
        content: createElement("input", { "aria-label": `${id} draft` }),
      })),
      headers: three.order.map((id) => ({ id, content: `${id} title` })),
      onFocus: (id) => set((current) => selectWorkspaceView(current, id)),
      onLayoutChange: (layout) => set((current) => ({ ...current, layout })),
      onMinimizeSide: (split, index, side) =>
        set((current) => railWorkspaceSide(current, split, index, side)),
      onRestoreRail: (id) => set((current) => selectWorkspaceView(current, id)),
      railContent: (id) => ({ label: `${id} rail`, content: null }),
      focusRail,
      dragTarget: null,
      dragging: false,
    });
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const rail = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-pane-rail="${id}"]`);
  const draft = (id: string) =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${id} draft"]`,
    )!;

  it("goes into a pane opened from its rail", async () => {
    await act(async () =>
      setView((view) => railWorkspaceSide(view, "row", 0, "before")),
    );
    rail("a")!.focus();
    await act(async () => rail("a")!.click());
    expect(rail("a")).toBeNull();
    expect(document.activeElement).toBe(draft("a"));
  });

  it("goes to the rail of a pane collapsed from its menu", async () => {
    draft("b").focus();
    // The menu's choice, made where the stage does not see it.
    await act(async () => {
      setView((view) => railWorkspaceSide(view, "row", 1, "before"));
      askRail("b");
    });
    expect(document.activeElement).toBe(rail("b"));
  });

  it("goes to the rail just made, not the first one", async () => {
    await act(async () =>
      setView((view) => railWorkspaceSide(view, "row", 0, "before")),
    );
    // The right pane's own control, beside its divider.
    const collapse = container.querySelector<HTMLButtonElement>(
      '[data-workspace-header="c"] button[aria-label="Collapse right pane"]',
    )!;
    await act(async () => collapse.click());
    expect(rail("a")).not.toBeNull();
    expect(document.activeElement).toBe(rail("c"));
  });
});
