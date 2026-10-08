// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf } from "../lib/layout";
import {
  minimizeWorkspaceSide,
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
        setView((current) =>
          minimizeWorkspaceSide(current, split, index, side),
        ),
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

  it("removes the minimized pane's entire tab strip and restores its original group and draft", async () => {
    const chatDraft = draft("chat");
    chatDraft.value = "Unsent prompt remains here";
    expect(tabIds()).toEqual(["chat", "chat-two", "web", "web-two"]);
    await act(async () => button("Hide left pane").click());
    expect(tabIds()).toEqual(["web", "web-two"]);
    expect(
      container.querySelector('[data-workspace-header="chat"]'),
    ).toBeNull();
    expect(draft("chat")).toBe(chatDraft);
    expect(
      chatDraft.closest<HTMLElement>("[data-workspace-surface]")!.hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(button("Show hidden pane"));
    await act(async () => button("Show hidden pane").click());
    expect(tabIds()).toEqual(["chat", "chat-two", "web", "web-two"]);
    expect(
      chatDraft.closest<HTMLElement>("[data-workspace-surface]")!.hidden,
    ).toBe(false);
    expect(chatDraft.value).toBe("Unsent prompt remains here");
    expect(
      container
        .querySelector('[data-workspace-surface="chat"]')!
        .getAttribute("style"),
    ).toContain("30%");
  });

  it("restores a hidden group when a task is explicitly selected elsewhere", async () => {
    await act(async () => button("Hide left pane").click());
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
      container.querySelector('[data-workspace-header="chat-two"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-workspace-surface="chat-two"]')!
        .getAttribute("data-focused"),
    ).toBe("true");
    expect(container.querySelector(".workspace-pane-restore")).toBeNull();
  });
});
