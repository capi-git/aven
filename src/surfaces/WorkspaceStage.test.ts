// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutLeaves, type LayoutNode } from "../lib/layout";
import {
  WorkspaceStage,
  workspaceSurfaceDropAt,
  type WorkspaceStageProps,
} from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns = (sizes = [0.5, 0.5]): LayoutNode => ({
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), leaf("browser")],
  sizes,
});
const rectangle = (x: number, y: number, width: number, height: number) =>
  new DOMRect(x, y, width, height);
const pointer = (type: string, x: number, y = 300, pointerId = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId,
    clientX: x,
    clientY: y,
  });

describe("workspace stage", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: WorkspaceStageProps;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const rendered = vi.fn();

  function StatefulSurface({ id }: { id: string }) {
    rendered(id);
    useEffect(() => {
      mounted(id);
      return () => unmounted(id);
    }, [id]);
    return createElement("input", {
      "aria-label": id,
      defaultValue: `Unsaved ${id}`,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
      () => {},
    );
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      layout: leaf("chat"),
      focusedId: "chat",
      visible: true,
      surfaces: ["chat", "browser"].map((id) => ({
        id,
        content: createElement(StatefulSurface, { id }),
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(patch: Partial<WorkspaceStageProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(createElement(WorkspaceStage, props)));
  }
  const stage = () =>
    container.querySelector<HTMLElement>("[data-workspace-stage]")!;
  const surface = (id: string) =>
    container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
  const input = (id: string) =>
    surface(id).querySelector<HTMLInputElement>("input")!;
  const body = (id: string) =>
    surface(id).querySelector<HTMLElement>("[data-workspace-body]")!;
  const header = (id: string) =>
    stage().querySelector<HTMLElement>(`[data-workspace-header="${id}"]`);
  const sash = (index = 0) =>
    container.querySelectorAll<HTMLElement>('[role="separator"]')[index];
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };
  const bindStageBounds = () =>
    vi
      .spyOn(stage(), "getBoundingClientRect")
      .mockReturnValue(rectangle(100, 50, 1000, 600));

  it("preserves mounted content and unsaved state through splits, reordering and hiding", async () => {
    await render();
    const chat = input("chat");
    const browser = input("browser");
    const browserWrapper = surface("browser");
    chat.value = "Draft that must survive a split";
    browser.value = "A browser form value";
    expect(browserWrapper.hidden).toBe(true);
    expect(browserWrapper.hasAttribute("inert")).toBe(true);

    await render({ layout: columns() });
    expect(browserWrapper.hidden).toBe(false);
    expect(surface("chat").style.width).toBe("calc(50% - 4px)");
    expect(
      surface("chat").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(0cqw - 1px)");
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(-50cqw - 5px)");
    await render({
      layout: {
        type: "split",
        id: "reordered",
        dir: "down",
        children: [leaf("browser"), leaf("chat")],
        sizes: [0.3, 0.7],
      },
    });
    expect(surface("chat").style.top).toBe("calc(30% + 4px)");
    expect(
      surface("chat").style.getPropertyValue("--workspace-background-top"),
    ).toBe("calc(-30cqh - 5px - var(--workspace-background-header-offset))");
    expect(surface("browser")).toBe(browserWrapper);
    await render({ layout: leaf("browser") });
    expect(surface("chat").hidden).toBe(true);
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(0cqw - 1px)");
    await render({ visible: false });
    expect(stage().hidden).toBe(true);
    await render({ visible: true, layout: columns() });

    expect(input("chat")).toBe(chat);
    expect(input("browser")).toBe(browser);
    expect(chat.value).toBe("Draft that must survive a split");
    expect(browser.value).toBe("A browser form value");
    expect(mounted.mock.calls).toEqual([["chat"], ["browser"]]);
    expect(unmounted).not.toHaveBeenCalled();
    expect(rendered).toHaveBeenCalledTimes(2);
  });

  it("paints resize frames without rendering content and commits once on release", async () => {
    await render({ layout: columns() });
    const measure = bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    expect(
      container.querySelector('[data-native-browser-occluded="true"]'),
    ).toBeNull();
    rendered.mockClear();
    act(() => window.dispatchEvent(pointer("pointermove", 700)));
    act(() => window.dispatchEvent(pointer("pointermove", 750)));
    expect(frames.size).toBe(1);
    expect(surface("chat").style.width).toBe("calc(50% - 4px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(65% - 4px)");
    expect(surface("browser").style.left).toBe("calc(65% + 4px)");
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(-65cqw - 5px)");
    expect(sash().getAttribute("aria-valuenow")).toBe("65");
    expect(rendered).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(pointer("pointerup", 750)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      columns([0.65, 0.35]),
    );
    act(() => window.dispatchEvent(pointer("pointerup", 750)));
    act(() => sash().dispatchEvent(new Event("lostpointercapture")));
    expect(props.onLayoutChange).toHaveBeenCalledOnce();
    expect(stage().hasAttribute("data-resizing")).toBe(false);
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    expect(document.documentElement.classList.contains("is-reordering")).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("keeps vertical dragging current when animation frames are deferred", async () => {
    const rows = (sizes = [0.5, 0.5]): LayoutNode => ({
      type: "split",
      id: "rows",
      dir: "down",
      children: [leaf("chat"), leaf("browser")],
      sizes,
    });
    await render({ layout: rows() });
    bindStageBounds();
    const painted = vi.fn();
    stage().addEventListener("supermono:workspace-layout", painted);
    rendered.mockClear();
    // Grabbing off-center must not snap the divider to the pointer.
    act(() => sash().dispatchEvent(pointer("pointerdown", 600, 353)));
    act(() => window.dispatchEvent(pointer("pointermove", 600, 413)));
    act(() => window.dispatchEvent(pointer("pointermove", 600, 473)));
    act(() => vi.advanceTimersByTime(15));
    expect(surface("chat").style.height).toBe("calc(50% - 4px)");
    act(() => vi.advanceTimersByTime(1));
    expect(surface("chat").style.height).toBe("calc(70% - 4px)");
    expect(surface("browser").style.top).toBe("calc(70% + 4px)");
    expect(painted).toHaveBeenCalledOnce();
    expect(rendered).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Release can arrive before the final move or animation callback.
    act(() => window.dispatchEvent(pointer("pointermove", 600, 483)));
    act(() => window.dispatchEvent(pointer("pointerup", 600, 503)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      rows([0.75, 0.25]),
    );
    expect(surface("chat").style.height).toBe("calc(75% - 4px)");
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(painted).toHaveBeenCalledTimes(2);
  });

  it("cancels the fallback when an animation frame paints first", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    const painted = vi.fn();
    stage().addEventListener("supermono:workspace-layout", painted);
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 700)));
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(60% - 4px)");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(painted).toHaveBeenCalledOnce();
  });

  it("does not rewrite unchanged pane geometry while dragging", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    const chatStyle = vi.spyOn(surface("chat").style, "setProperty");
    const browserStyle = vi.spyOn(surface("browser").style, "setProperty");
    act(() => sash().dispatchEvent(pointer("pointerdown", 603)));
    act(() => window.dispatchEvent(pointer("pointermove", 603)));
    flushFrame();
    expect(chatStyle).not.toHaveBeenCalled();
    expect(browserStyle).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(pointer("pointerup", 603)));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
  });

  it("keeps bodies mounted while pane-local headers appear, move and disappear", async () => {
    await render({ layout: columns() });
    const chat = input("chat");
    const browser = input("browser");
    const retainedBody = body("browser");
    browser.value = "Unsaved page field";
    await render({
      headers: [
        { id: "chat", content: createElement("button", null, "Session tabs") },
        {
          id: "browser",
          content: createElement("button", null, "Browser tabs"),
        },
      ],
    });
    expect(header("browser")?.parentElement).toBe(stage());
    expect(surface("browser").dataset.hasHeader).toBe("true");
    expect(surface("browser").children[0]).toBe(retainedBody);
    await render({ layout: leaf("browser"), focusedId: "browser" });
    expect(header("chat")).toBeNull();
    expect(surface("browser").dataset.focused).toBe("true");
    await render({ headers: [] });
    expect(body("browser")).toBe(retainedBody);
    expect(input("browser")).toBe(browser);
    expect(browser.value).toBe("Unsaved page field");
    expect(input("chat")).toBe(chat);
    expect(unmounted).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it("retains a group's header DOM and scroll when its selected leaf changes", async () => {
    const headerContent = (active: string) =>
      createElement(
        "div",
        { "data-tab-strip": true },
        createElement(
          "button",
          { "data-surface-tab-id": "chat" },
          `Chat ${active === "chat" ? "active" : ""}`,
        ),
        createElement(
          "button",
          { "data-surface-tab-id": "browser" },
          `Browser ${active === "browser" ? "active" : ""}`,
        ),
      );
    await render({
      layout: leaf("chat"),
      headers: [
        { id: "chat", key: "browser,chat", content: headerContent("chat") },
      ],
    });
    const groupHeader = header("chat")!;
    const strip = groupHeader.querySelector<HTMLElement>("[data-tab-strip]")!;
    strip.scrollLeft = 127;
    const chatBody = body("chat");
    const browserBody = body("browser");
    await render({
      layout: leaf("browser"),
      focusedId: "browser",
      headers: [
        {
          id: "browser",
          key: "browser,chat",
          content: headerContent("browser"),
        },
      ],
    });
    expect(header("chat")).toBeNull();
    expect(header("browser")).toBe(groupHeader);
    expect(groupHeader.querySelector("[data-tab-strip]")).toBe(strip);
    expect(strip.scrollLeft).toBe(127);
    expect(strip.textContent).toContain("Browser active");
    expect(body("chat")).toBe(chatBody);
    expect(body("browser")).toBe(browserBody);
    await render({ visible: false });
    await render({ visible: true });
    expect(header("browser")).toBe(groupHeader);
    expect(strip.scrollLeft).toBe(127);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("notifies native geometry after equal-size pane moves and coalesced resize paint", async () => {
    await render({ layout: columns() });
    const moved = vi.fn();
    window.addEventListener("supermono:workspace-layout", moved);
    try {
      await render({
        layout: {
          type: "split",
          id: "columns",
          dir: "right",
          children: [leaf("browser"), leaf("chat")],
          sizes: [0.5, 0.5],
        },
      });
      expect(moved).toHaveBeenCalledOnce();
      expect(surface("browser").style.left).toBe("0%");
      await render({ focusedId: "browser" });
      expect(moved).toHaveBeenCalledOnce();
      await render({
        headers: [
          { id: "browser", content: createElement("span", null, "Tabs") },
        ],
      });
      expect(moved).toHaveBeenCalledTimes(2);
      moved.mockClear();
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", 700)));
      act(() => window.dispatchEvent(pointer("pointermove", 800)));
      expect(moved).not.toHaveBeenCalled();
      flushFrame();
      expect(moved).toHaveBeenCalledOnce();
      expect(surface("browser").style.width).toBe("calc(70% - 4px)");
      act(() => window.dispatchEvent(pointer("pointerup", 800)));
      expect(moved).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("supermono:workspace-layout", moved);
    }
  });

  it("reserves a real eight-pixel internal gutter without insetting outside edges", async () => {
    await render();
    expect(surface("chat").style.left).toBe("0%");
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("chat").style.height).toBe("100%");
    await render({
      layout: {
        type: "split",
        id: "three",
        dir: "right",
        children: [leaf("chat"), leaf("browser"), leaf("third")],
        sizes: [0.2, 0.3, 0.5],
      },
      surfaces: [
        ...props.surfaces,
        { id: "third", content: createElement("p", null, "Third surface") },
      ],
    });
    expect(surface("chat").style.left).toBe("0%");
    expect(surface("chat").style.width).toBe("calc(20% - 4px)");
    expect(surface("browser").style.left).toBe("calc(20% + 4px)");
    expect(surface("browser").style.width).toBe("calc(30% - 8px)");
    expect(surface("third").style.left).toBe("calc(50% + 4px)");
    expect(surface("third").style.width).toBe("calc(50% - 4px)");
    expect(surface("browser").style.top).toBe("0%");
    expect(surface("browser").style.height).toBe("100%");

    await render({
      layout: {
        type: "split",
        id: "rows",
        dir: "down",
        children: [leaf("chat"), leaf("browser")],
        sizes: [0.5, 0.5],
      },
    });
    expect(surface("chat").style.top).toBe("0%");
    expect(surface("chat").style.height).toBe("calc(50% - 4px)");
    expect(surface("browser").style.top).toBe("calc(50% + 4px)");
    expect(surface("browser").style.height).toBe("calc(50% - 4px)");
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("browser").style.width).toBe("100%");
  });

  it("cancels a draft with Escape and ignores unrelated pointer events", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 1000, 300, 2)));
    expect(frames.size).toBe(0);
    act(() => window.dispatchEvent(pointer("pointermove", 900)));
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(80% - 4px)");
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(surface("chat").style.width).toBe("calc(50% - 4px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(pointer("pointerup", 900)));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
  });

  it.each(["blur", "lostpointercapture"])(
    "finishes and cleans up a resize after %s",
    async (event) => {
      await render({ layout: columns() });
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", 800)));
      act(() =>
        (event === "blur" ? window : sash()).dispatchEvent(new Event(event)),
      );
      expect(frames.size).toBe(0);
      expect(props.onLayoutChange).toHaveBeenCalledOnce();
      expect(surface("chat").style.width).toBe("calc(70% - 4px)");
      expect(document.body.style.cursor).toBe("");
      expect(stage().hasAttribute("data-resizing")).toBe(false);
      expect(
        container.querySelector("[data-native-browser-occluded]"),
      ).toBeNull();
      act(() => window.dispatchEvent(pointer("pointermove", 900)));
      expect(frames.size).toBe(0);
    },
  );

  it("cancels an in-progress resize when the workspace becomes hidden", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 800)));
    await render({ visible: false });
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(surface("chat").style.width).toBe("calc(50% - 4px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains("is-reordering")).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("supports keyboard resize and balances only the adjacent pair on double-click", async () => {
    await render({
      layout: {
        type: "split",
        id: "three",
        dir: "right",
        children: [leaf("chat"), leaf("browser"), leaf("third")],
        sizes: [0.2, 0.3, 0.5],
      },
    });
    act(() =>
      sash(1).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    const change = vi.mocked(props.onLayoutChange);
    layoutLeaves(change.mock.calls[0][0]).forEach(({ rect }, index) => {
      expect(rect.w).toBeCloseTo([0.2, 0.32, 0.48][index]);
    });
    change.mockClear();
    act(() =>
      sash(1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    const widths = layoutLeaves(change.mock.calls[0][0]).map(
      ({ rect }) => rect.w,
    );
    expect(widths[0]).toBeCloseTo(0.2);
    expect(widths[1]).toBeCloseTo(0.4);
    expect(widths[2]).toBeCloseTo(0.4);
    act(() =>
      sash().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(layoutLeaves(change.mock.lastCall![0])[0].rect.w).toBeCloseTo(0.08);
  });

  it("focuses surfaces and shows drop hints without occluding the browser", async () => {
    await render({ layout: columns() });
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    act(() => input("browser").dispatchEvent(pointer("pointerdown", 900)));
    expect(props.onFocus).toHaveBeenCalledWith("browser");
    vi.mocked(props.onFocus).mockClear();
    act(() => input("browser").focus());
    expect(props.onFocus).toHaveBeenCalledWith("browser");
    await render({
      dragging: true,
      dragTarget: { id: "browser", edge: "down" },
    });
    expect(
      container.querySelector('[data-native-browser-occluded="true"]'),
    ).toBeNull();
    const hint = container.querySelector<HTMLElement>(
      ".workspace-stage-drop-hint",
    )!;
    expect(hint.parentElement).toBe(body("browser"));
    expect(hint.style.left).toBe("0%");
    expect(hint.style.top).toBe("50%");
    expect(hint.style.width).toBe("100%");
    expect(hint.style.height).toBe("50%");
    await render({ dragging: false });
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("finds drop edges only on visible sibling surfaces in client coordinates", async () => {
    await render({ layout: columns() });
    vi.spyOn(body("chat"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 50, 500, 600),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 600),
    );
    expect(workspaceSurfaceDropAt(stage(), 620, 300, "chat")).toEqual({
      id: "browser",
      edge: "left",
    });
    expect(workspaceSurfaceDropAt(stage(), 1080, 300, "chat")?.edge).toBe(
      "right",
    );
    expect(workspaceSurfaceDropAt(stage(), 850, 70, "chat")?.edge).toBe("up");
    expect(workspaceSurfaceDropAt(stage(), 850, 630, "chat")?.edge).toBe(
      "down",
    );
    expect(workspaceSurfaceDropAt(stage(), 300, 300, "chat")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 1200, 300, "chat")).toBeNull();
    surface("browser").inert = true;
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
    surface("browser").inert = false;
    await render({ layout: leaf("chat") });
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
    await render({ visible: false, layout: columns() });
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
  });

  it("targets another pane's header by tab midpoints without consuming same-group reorders", async () => {
    await render({
      layout: columns(),
      headers: [
        {
          id: "browser",
          content: createElement(
            "div",
            null,
            createElement(
              "button",
              { "data-surface-tab-id": "browser" },
              "Page",
            ),
            createElement("button", { "data-surface-tab-id": "docs" }, "Docs"),
          ),
        },
      ],
    });
    const browserHeader = header("browser")!;
    vi.spyOn(browserHeader, "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 32),
    );
    const tabs = browserHeader.querySelectorAll<HTMLElement>(
      "[data-surface-tab-id]",
    );
    vi.spyOn(tabs[0], "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 100, 32),
    );
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(
      rectangle(700, 50, 100, 32),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 82, 500, 568),
    );
    expect(workspaceSurfaceDropAt(stage(), 620, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 0,
    });
    expect(workspaceSurfaceDropAt(stage(), 690, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 1,
    });
    expect(workspaceSurfaceDropAt(stage(), 1050, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 2,
    });
    expect(workspaceSurfaceDropAt(stage(), 620, 60, "docs")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 850, 84, "chat")).toEqual({
      id: "browser",
      edge: "up",
    });
    await render({
      dragging: true,
      dragTarget: { id: "browser", edge: "tab", index: 1 },
    });
    expect(browserHeader.dataset.dropTarget).toBe("true");
    expect(container.querySelector(".workspace-stage-drop-hint")).toBeNull();
    await render({ dragging: false });
    expect(browserHeader.dataset.dropTarget).toBeUndefined();
  });

  it("allows the selected tab to split from its own body only when its group has a sibling", async () => {
    const groupedHeader = (members: string[]) => [
      {
        id: "browser",
        content: createElement(
          "div",
          null,
          ...members.map((id) =>
            createElement("button", { key: id, "data-surface-tab-id": id }, id),
          ),
        ),
      },
    ];
    await render({
      layout: leaf("browser"),
      headers: groupedHeader(["browser", "docs"]),
    });
    vi.spyOn(header("browser")!, "getBoundingClientRect").mockReturnValue(
      rectangle(100, 50, 1000, 32),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 82, 1000, 568),
    );
    expect(workspaceSurfaceDropAt(stage(), 500, 60, "browser")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 102, 300, "browser")).toEqual({
      id: "browser",
      edge: "left",
    });
    expect(workspaceSurfaceDropAt(stage(), 1098, 300, "browser")).toEqual({
      id: "browser",
      edge: "right",
    });
    expect(workspaceSurfaceDropAt(stage(), 500, 84, "browser")).toEqual({
      id: "browser",
      edge: "up",
    });
    expect(workspaceSurfaceDropAt(stage(), 500, 648, "browser")).toEqual({
      id: "browser",
      edge: "down",
    });
    await render({ headers: groupedHeader(["browser"]) });
    expect(workspaceSurfaceDropAt(stage(), 102, 300, "browser")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 500, 60, "browser")).toBeNull();
  });
  it("joins in the body center, labels the outcome, and keeps the edge preview stable near its boundary", async () => {
    await render({ layout: columns() });
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 600),
    );
    const center = workspaceSurfaceDropAt(stage(), 850, 350, "chat");
    expect(center).toEqual({ id: "browser", edge: "tab" });
    const left = workspaceSurfaceDropAt(stage(), 705, 350, "chat");
    expect(left).toEqual({ id: "browser", edge: "left" });
    expect(workspaceSurfaceDropAt(stage(), 715, 350, "chat", left)).toEqual(
      left,
    );
    expect(workspaceSurfaceDropAt(stage(), 715, 350, "chat", center)).toEqual(
      center,
    );
    expect(workspaceSurfaceDropAt(stage(), 850, 350, "chat", left)).toEqual(
      center,
    );
    await render({
      dragging: true,
      dragTarget: center,
      dragLabel: "Research · 2 tabs",
      dragKind: "group",
    });
    const hint = container.querySelector(".workspace-stage-drop-hint")!;
    expect(hint.textContent).toContain("Join group");
    expect(hint.textContent).toContain("Move group");
    expect(hint.textContent).toContain("Research");
  });

  it("refuses to split or join a moving whole group back onto itself", async () => {
    await render({
      layout: leaf("browser"),
      headers: [
        {
          id: "browser",
          content: createElement(
            "div",
            null,
            createElement(
              "button",
              { "data-surface-tab-id": "browser" },
              "Page",
            ),
            createElement("button", { "data-surface-tab-id": "docs" }, "Docs"),
          ),
        },
      ],
    });
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 82, 1000, 568),
    );
    expect(
      workspaceSurfaceDropAt(stage(), 105, 300, "browser", null, [
        "browser",
        "docs",
      ]),
    ).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 500, 300, "docs")).toBeNull();
  });
});
