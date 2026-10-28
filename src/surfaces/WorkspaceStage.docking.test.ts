// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode } from "../lib/layout";
import { MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { DOCK_EASE, DOCK_TWEEN_MS } from "../lib/paneDock";
import { SPRING_BOUND_SLACK_MS, SPRING_MAX_MS } from "../lib/spring";

/** Long enough for any spring to have ended by its timer. */
const SPRING_END_MS = SPRING_MAX_MS + SPRING_BOUND_SLACK_MS + 10;
import {
  WorkspaceStage,
  ZOOM_GLIDE_MS,
  type WorkspaceStageProps,
} from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), leaf("browser")],
  sizes: [0.5, 0.5],
};

type Box = { left: number; top: number; width: number; height: number };
const rect = ({ left, top, width, height }: Box) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  }) as DOMRect;

let root: Root;
let container: HTMLDivElement;
let props: WorkspaceStageProps;
let boxes: Map<string, Box>;
let animations: Array<{
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel?: ReturnType<typeof vi.fn>;
}>;

/** What each element measures: the stage, a pane's body, the drop hint. */
function boxFor(element: Element): Box {
  if (element.classList.contains("workspace-stage"))
    return { left: 0, top: 0, width: 1000, height: 600 };
  const body = (element as HTMLElement).dataset?.workspaceBody;
  if (body && boxes.has(`body:${body}`)) return boxes.get(`body:${body}`)!;
  if (element.hasAttribute("data-workspace-drop-hint"))
    return boxes.get("hint") ?? { left: 0, top: 0, width: 0, height: 0 };
  return { left: 0, top: 0, width: 0, height: 0 };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  boxes = new Map();
  animations = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return rect(boxFor(this));
    },
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const cancel = vi.fn();
      animations.push({ element: this, keyframes, options, cancel });
      return {
        playState: "running",
        cancel,
        onfinish: null,
      } as unknown as Animation;
    },
  });
  for (const [name, size] of [
    ["clientWidth", 1000],
    ["clientHeight", 600],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("workspace-stage") ? size : 0;
      },
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    layout: leaf("chat"),
    focusedId: "chat",
    visible: true,
    surfaces: ["chat", "browser"].map((id) => ({
      id,
      content: createElement("p", null, id),
    })),
    headers: ["chat", "browser"].map((id) => ({
      id,
      content: createElement("div", { "data-variant": "title" }, id),
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of ["animate", "clientWidth", "clientHeight"])
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
});

async function render(patch: Partial<WorkspaceStageProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(WorkspaceStage, props)));
}

const preview = () =>
  container.querySelector<HTMLElement>(".workspace-stage-drop-preview")!;
const surface = (id: string) =>
  container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
const header = (id: string) =>
  container.querySelector<HTMLElement>(`[data-workspace-header="${id}"]`)!;
const animationsOf = (element: Element) =>
  animations.filter((entry) => entry.element === element);

describe("docking motion", () => {
  it("draws the preview where the target pane's hint says", async () => {
    await render();
    expect(preview().dataset.shown).toBe("false");
    boxes.set("hint", { left: 4, top: 36, width: 492, height: 560 });
    await render({ dragging: true, dragTarget: { id: "chat", edge: "left" } });
    expect(preview().dataset.shown).toBe("true");
    expect(preview().style.left).toBe("4px");
    expect(preview().style.top).toBe("36px");
    expect(preview().style.width).toBe("492px");
    expect(preview().style.height).toBe("560px");
    // It appears where it goes, fading in and growing a little from the
    // side it splits (its left edge stays put).
    const [appear] = animationsOf(preview());
    expect(appear.keyframes[0]).toEqual({
      transform: "translate(0px, 8.4px) scale(0.97, 0.97)",
      opacity: "0",
      offset: 0,
    });
    expect(appear.keyframes.at(-1)).toEqual({
      transform: "translate(0px, 0px) scale(1, 1)",
      opacity: "1",
      offset: 1,
    });
    expect(appear.options).toMatchObject({ easing: "linear", fill: "none" });
  });

  it("glides between zones on a spring, with transforms only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    await render();
    boxes.set("hint", { left: 4, top: 36, width: 492, height: 560 });
    await render({ dragging: true, dragTarget: { id: "chat", edge: "left" } });
    await act(async () => vi.advanceTimersByTime(SPRING_END_MS));
    boxes.set("hint", { left: 4, top: 36, width: 992, height: 280 });
    await render({ dragTarget: { id: "chat", edge: "up" } });
    expect(preview().style.width).toBe("992px");
    const glide = animationsOf(preview()).at(-1)!;
    // From the left half it was drawn in, to the top half.
    expect(glide.keyframes[0]).toMatchObject({
      transform: "translate(0px, 0px) scale(0.49597, 2)",
    });
    expect(glide.keyframes.at(-1)).toMatchObject({
      transform: "translate(0px, 0px) scale(1, 1)",
    });
    for (const frame of glide.keyframes)
      expect(Object.keys(frame).sort()).toEqual([
        "offset",
        "opacity",
        "transform",
      ]);
    expect(glide.options.easing).toBe("linear");
  });

  it("grows the pane a drop makes from the preview while the preview fades", async () => {
    await render();
    boxes.set("hint", { left: 504, top: 36, width: 492, height: 560 });
    await render({
      dragging: true,
      dragTarget: { id: "chat", edge: "right" },
    });
    boxes.set("body:chat", { left: 0, top: 32, width: 499.5, height: 568 });
    boxes.set("body:browser", {
      left: 500.5,
      top: 32,
      width: 499.5,
      height: 568,
    });
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(
      function (this: Element) {
        const box = boxFor(this);
        if ((this as HTMLElement).dataset?.workspaceSurface === "browser")
          return rect({ left: 500.5, top: 0, width: 499.5, height: 600 });
        if ((this as HTMLElement).dataset?.workspaceHeader === "browser")
          return rect({ left: 500.5, top: 0, width: 499.5, height: 32 });
        return rect(box);
      },
    );
    await render({ dragging: false, dragTarget: null, layout: columns });
    const fade = animationsOf(preview()).at(-1)!;
    expect(fade.keyframes.at(-1)!.opacity).toBe("0");
    const [grow] = animationsOf(surface("browser"));
    expect(grow.keyframes).toEqual([
      { clipPath: "inset(36px 4px 4px 3.5px round 6px)" },
      { clipPath: "inset(0px 0px 0px 0px round 0px)" },
    ]);
    expect(grow.options).toEqual({
      duration: DOCK_TWEEN_MS,
      easing: DOCK_EASE,
    });
    // Its title row starts hidden above the preview and opens with it.
    expect(animationsOf(header("browser"))[0].keyframes[0]).toEqual({
      clipPath: "inset(32px 4px 0px 3.5px round 6px)",
    });
    // The pane that was there does not grow.
    expect(animationsOf(surface("chat"))).toEqual([]);
  });

  it("does not grow anything when the drop stacks or nothing changes", async () => {
    await render({ layout: columns });
    boxes.set("hint", { left: 504, top: 36, width: 492, height: 560 });
    await render({
      dragging: true,
      dragTarget: { id: "browser", edge: "tab" },
    });
    await render({ dragging: false, dragTarget: null });
    expect(
      animations.filter((entry) => "clipPath" in entry.keyframes[0]),
    ).toEqual([]);
  });

  it("moves at once and draws nothing in motion when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render();
    boxes.set("hint", { left: 4, top: 36, width: 492, height: 560 });
    await render({ dragging: true, dragTarget: { id: "chat", edge: "left" } });
    boxes.set("hint", { left: 4, top: 36, width: 992, height: 280 });
    await render({ dragTarget: { id: "chat", edge: "up" } });
    await render({ dragging: false, dragTarget: null, layout: columns });
    expect(animations).toEqual([]);
    expect(preview().dataset.shown).toBe("false");
  });
});

describe("zoom", () => {
  it("glides the expanded pane from its place while the others fade under it", async () => {
    vi.useFakeTimers();
    await render({ layout: columns, focusedId: "browser" });
    await render({ layout: leaf("browser"), zoomedId: "browser" });
    const [grow] = animationsOf(surface("browser"));
    // It stood in the right half of a 1000 × 600 stage.
    expect(grow.keyframes).toEqual([
      { clipPath: "inset(0px 0px 0px 500px round 0px)" },
      { clipPath: "inset(0px 0px 0px 0px round 0px)" },
    ]);
    expect(grow.options).toEqual({
      duration: ZOOM_GLIDE_MS,
      easing: DOCK_EASE,
    });
    expect(ZOOM_GLIDE_MS).toBe(200);
    // The chat stays painted beneath it, fading, until the glide ends.
    expect(surface("chat").dataset.handoff).toBe("out");
    expect(animationsOf(surface("chat"))[0].keyframes).toEqual([
      { opacity: 1 },
      { opacity: 0 },
    ]);
    await act(async () => vi.advanceTimersByTime(ZOOM_GLIDE_MS));
    expect(surface("chat").dataset.handoff).toBeUndefined();
    expect(surface("chat").hidden).toBe(true);
  });

  it("scales the pane back to its place on Restore while the others ease in", async () => {
    await render({ layout: columns, focusedId: "browser" });
    await render({ layout: leaf("browser"), zoomedId: "browser" });
    animations = [];
    await render({ layout: columns, zoomedId: null });
    const [shrink] = animationsOf(surface("browser"));
    expect(shrink.keyframes).toEqual([
      {
        transformOrigin: "0 0",
        transform: "translate(-500px, 0px) scale(2, 1)",
      },
      { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1, 1)" },
    ]);
    expect(surface("chat").getAttribute("data-aven-motion")).toBe("pane-in");
  });

  it("does not glide or fade when the expanded pane switches its tab", async () => {
    props.surfaces = ["chat", "browser", "notes"].map((id) => ({
      id,
      content: createElement("p", null, id),
    }));
    await render({ layout: columns, focusedId: "browser" });
    await render({ layout: leaf("browser"), zoomedId: "browser" });
    animations = [];
    // The expanded pane's tab in front changes: its leaf is another tab.
    await render({ layout: leaf("notes"), zoomedId: "notes" });
    expect(animations).toEqual([]);
    expect(surface("browser").dataset.handoff).toBeUndefined();
  });

  it("lets a native page land, and does nothing with reduced motion", async () => {
    props.surfaces = [
      { id: "chat", content: createElement("p", null, "chat") },
      {
        id: "browser",
        content: createElement("div", { className: "browser-native-host" }),
      },
    ];
    await render({ layout: columns, focusedId: "browser" });
    await render({ layout: leaf("browser"), zoomedId: "browser" });
    expect(animationsOf(surface("browser"))).toEqual([]);
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    props.surfaces = ["chat", "browser"].map((id) => ({
      id,
      content: createElement("p", null, id),
    }));
    animations = [];
    await render({ layout: columns, zoomedId: null });
    await render({ layout: leaf("chat"), zoomedId: "chat" });
    expect(animations).toEqual([]);
  });
});

describe("when WebKit holds the animation timeline back", () => {
  // The mock's animations never finish on their own, as under a native page.
  const preview = () =>
    container.querySelector<HTMLElement>(".workspace-stage-drop-preview")!;
  const shown = () => preview().dataset.shown;
  async function dragOver(edge: "left" | "right") {
    boxes.set(
      "hint",
      edge === "right"
        ? { left: 504, top: 36, width: 492, height: 560 }
        : { left: 4, top: 36, width: 492, height: 560 },
    );
    await render({ dragging: true, dragTarget: { id: "chat", edge } });
    expect(shown()).toBe("true");
  }

  beforeEach(() => vi.useFakeTimers());

  it("still removes the preview after a drop", async () => {
    await render();
    await dragOver("right");
    await render({ dragging: false, dragTarget: null, layout: columns });
    expect(shown()).toBe("true");
    await act(async () => vi.advanceTimersByTime(SPRING_END_MS));
    expect(shown()).toBe("false");
    // Its fade is stopped too, so it holds no animation of its own.
    const fade = animationsOf(preview()).at(-1)!;
    expect(fade.keyframes.at(-1)!.opacity).toBe("0");
    expect(fade.cancel).toHaveBeenCalled();
  });

  it("removes it when the drag is cancelled (Escape, blur, pointercancel)", async () => {
    await render();
    await dragOver("left");
    // Every cancel reaches the stage as the drag ending with no target.
    await render({ dragging: false, dragTarget: null });
    await act(async () => vi.advanceTimersByTime(SPRING_END_MS));
    expect(shown()).toBe("false");
  });

  it("removes it when the pointer leaves every pane mid-drag", async () => {
    await render();
    await dragOver("left");
    await render({ dragging: true, dragTarget: null });
    await act(async () => vi.advanceTimersByTime(SPRING_END_MS));
    expect(shown()).toBe("false");
  });

  it("removes it when the workspace is hidden mid-drag", async () => {
    await render();
    await dragOver("left");
    await render({ visible: false });
    await act(async () => vi.advanceTimersByTime(SPRING_END_MS));
    expect(shown()).toBe("false");
  });

  it("stops every animation and timer when the stage goes away", async () => {
    await render();
    await dragOver("left");
    await render({ dragging: false, dragTarget: null });
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBeLessThan(pending);
    expect(animationsOf(preview() ?? document.body).length).toBe(0);
    expect(animations.at(-1)!.cancel).toHaveBeenCalled();
    root = createRoot(container);
  });

  it("ends a pane's reveal and a zoom's clip at their durations", async () => {
    await render({ layout: columns, focusedId: "browser" });
    await render({ layout: leaf("browser"), zoomedId: "browser" });
    const [grow] = animationsOf(surface("browser"));
    // The held chat goes when the glide's time is up, run or not.
    expect(surface("chat").dataset.handoff).toBe("out");
    await act(async () => vi.advanceTimersByTime(ZOOM_GLIDE_MS + 60));
    expect(surface("chat").dataset.handoff).toBeUndefined();
    // And the expanding pane's clip is stopped, so none of it stays hidden.
    expect(grow.cancel).toHaveBeenCalled();
  });
});
