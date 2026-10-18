// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode } from "../lib/layout";
import { MOTION_ATTRIBUTE, MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { WorkspaceStage, type WorkspaceStageProps } from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), leaf("browser")],
  sizes: [0.5, 0.5],
};

describe("workspace stage motion", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: WorkspaceStageProps;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      layout: leaf("chat"),
      focusedId: "chat",
      visible: true,
      surfaces: ["chat", "browser", "notes"].map((id) => ({
        id,
        content: createElement("p", null, id),
      })),
      onFocus: vi.fn(),
      onLayoutChange: vi.fn(),
      dragTarget: null,
      dragging: false,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
    vi.unstubAllGlobals();
  });

  async function render(patch: Partial<WorkspaceStageProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(createElement(WorkspaceStage, props)));
  }
  const motion = (id: string) =>
    container
      .querySelector(`[data-workspace-surface="${id}"]`)!
      .getAttribute(MOTION_ATTRIBUTE);

  it("shows the first layout at once", async () => {
    await render();
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("shows the pane a tab switch brings into view at once", async () => {
    await render();
    await render({ layout: leaf("browser"), focusedId: "browser" });
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
    const hidden = container.querySelector(`[data-workspace-surface="chat"]`)!;
    expect(hidden.hasAttribute("hidden")).toBe(true);
  });

  it("shows the workspace at once when it comes back from Settings", async () => {
    await render({ layout: columns });
    await render({ visible: false });
    await render({ visible: true });
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("switches a split tab for another at once", async () => {
    await render({ layout: columns });
    await render({ layout: leaf("notes"), focusedId: "notes" });
    await render({ layout: columns, focusedId: "chat" });
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("eases a new split's card in and leaves the pane already there", async () => {
    await render();
    await render({ layout: columns });
    expect(motion("browser")).toBe("pane-in");
    expect(motion("chat")).toBeNull();
  });

  it("opens a split at once when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render();
    await render({ layout: columns });
    expect(container.querySelector(`[${MOTION_ATTRIBUTE}]`)).toBeNull();
  });
});
