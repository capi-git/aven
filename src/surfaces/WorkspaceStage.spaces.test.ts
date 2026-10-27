// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode } from "../lib/layout";
import { MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import {
  paneGlideKeyframes,
  SWITCH_MS,
  WorkspaceStage,
  ZOOM_GLIDE_MS,
  type WorkspaceStageProps,
} from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns = (a: string, b: string): LayoutNode => ({
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf(a), leaf(b)],
  sizes: [0.5, 0.5],
});

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
    layout: columns("chat", "web"),
    focusedId: "chat",
    visible: true,
    surfaces: ["chat", "web", "notes"].map((id) => ({
      id,
      content:
        id === "web"
          ? createElement("div", { className: "browser-native-host" }, id)
          : createElement("p", null, id),
    })),
    headers: ["chat", "web", "notes"].map((id) => ({
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

const surface = (id: string) =>
  container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
const header = (id: string) =>
  container.querySelector<HTMLElement>(`[data-workspace-header="${id}"]`)!;
const animationsOf = (element: Element) =>
  animations.filter((entry) => entry.element === element);
/** A held page's picture, as BrowserPane draws it while its pane moves. */
function picture(id: string) {
  const image = document.createElement("img");
  image.className = "browser-motion-image";
  surface(id).querySelector(".browser-native-host")!.append(image);
}

describe("strip switches and pane glides", () => {
  it("slides the incoming arrangement in and fades the outgoing one away", async () => {
    vi.useFakeTimers();
    await render({ arrangement: { key: "p\nspace", step: 0 } });
    expect(animations).toEqual([]);
    await render({
      layout: leaf("notes"),
      focusedId: "notes",
      arrangement: { key: "p\nnotes", step: 1 },
    });
    const [slide] = animationsOf(surface("notes"));
    expect(slide.keyframes).toEqual([
      { opacity: 0, transform: "translateX(24px)" },
      { opacity: 1, transform: "translateX(0px)" },
    ]);
    expect(slide.options).toMatchObject({ duration: SWITCH_MS });
    expect(animationsOf(header("notes"))).toHaveLength(1);
    // The panes it replaces stay painted while they fade.
    for (const id of ["chat", "web"]) {
      expect(surface(id).hidden).toBe(false);
      expect(animationsOf(surface(id))[0].keyframes).toEqual([
        { opacity: 1 },
        { opacity: 0 },
      ]);
    }
    await act(async () => vi.advanceTimersByTimeAsync(SWITCH_MS));
    expect(surface("chat").hidden).toBe(true);
    expect(surface("web").hidden).toBe(true);
  });

  it("slides in from the left when the strip moves back", async () => {
    await render({ arrangement: { key: "p\nspace", step: 0 } });
    await render({
      layout: leaf("notes"),
      arrangement: { key: "p\nnotes", step: -1 },
    });
    expect(animationsOf(surface("notes"))[0].keyframes[0]).toEqual({
      opacity: 0,
      transform: "translateX(-24px)",
    });
  });

  it("switches at once with Reduce motion, or when it is no switch", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render({ arrangement: { key: "p\nspace", step: 0 } });
    await render({
      layout: leaf("notes"),
      arrangement: { key: "p\nnotes", step: 1 },
    });
    expect(animations).toEqual([]);
    expect(surface("chat").hidden).toBe(true);
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    // The entry in front turned into a space: a new key with no step.
    await render({
      layout: columns("notes", "chat"),
      arrangement: { key: "p\nspace-2", step: 0 },
    });
    expect(
      animations.filter((entry) =>
        JSON.stringify(entry.keyframes).includes("translateX"),
      ),
    ).toEqual([]);
  });

  it("glides each pane that stays to its new place when asked", async () => {
    await render({ glide: 0 });
    await render({ layout: leaf("chat"), glide: 1 });
    // The chat grows from the left half to the whole stage: its clip opens.
    const [grow] = animationsOf(surface("chat"));
    expect(grow.keyframes[0]).toHaveProperty("clipPath");
    expect(grow.options).toMatchObject({ duration: ZOOM_GLIDE_MS });
    // Without the ask (a resize drag, a tab switch) nothing glides.
    animations.length = 0;
    await render({ layout: columns("chat", "web") });
    expect(animationsOf(surface("chat"))).toEqual([]);
  });

  it("moves a page held as a picture with its pane, and leaves a live one to land", async () => {
    await render({ glide: 0 });
    // Move: the panes swap places.
    await render({ layout: columns("web", "chat"), glide: 1 });
    expect(animationsOf(surface("chat"))[0].keyframes).toEqual([
      { transform: "translate(-500px, 0px)" },
      { transform: "translate(0px, 0px)" },
    ]);
    // The live page is a native view; it lands at its new bounds.
    expect(animationsOf(surface("web"))).toEqual([]);
    picture("web");
    animations.length = 0;
    await render({ layout: columns("chat", "web"), glide: 2 });
    expect(animationsOf(surface("web"))[0].keyframes).toEqual([
      { transform: "translate(-500px, 0px)" },
      { transform: "translate(0px, 0px)" },
    ]);
  });

  it("scales a pictured page as it grows, and clips a growing page of HTML", () => {
    const half = { left: 0, top: 0, width: 500, height: 600 };
    const whole = { left: 0, top: 0, width: 1000, height: 600 };
    expect(paneGlideKeyframes(half, whole)[0]).toHaveProperty("clipPath");
    expect(paneGlideKeyframes(half, whole, true)[0]).toEqual({
      transformOrigin: "0 0",
      transform: "translate(0px, 0px) scale(0.5, 1)",
    });
    expect(paneGlideKeyframes(whole, half)[0]).toEqual({
      transformOrigin: "0 0",
      transform: "translate(0px, 0px) scale(2, 1)",
    });
  });

  it("glides a pictured page in a zoom instead of leaving it behind", async () => {
    await render({ zoomedId: null });
    picture("web");
    await render({ layout: leaf("web"), focusedId: "web", zoomedId: "web" });
    const [glide] = animationsOf(surface("web"));
    expect(glide.keyframes[0]).toEqual({
      transformOrigin: "0 0",
      transform: "translate(500px, 0px) scale(0.5, 1)",
    });
  });
});
