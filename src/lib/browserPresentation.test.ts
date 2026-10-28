// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserBounds } from "./browser";
import {
  createBrowserPresentation,
  type BrowserPresentation,
  type BrowserPresentationAdapter,
  type BrowserPresentationState,
  type BrowserSnapshot,
} from "./browserPresentation";
import { resetBrowserHandoff } from "./browserHandoff";
import { BROWSER_MOVING_ATTRIBUTE } from "./browserOverlays";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeNativePage implements BrowserPresentationAdapter {
  measured: BrowserBounds = {
    x: 100,
    y: 80,
    width: 600,
    height: 500,
    scale: 2,
  };
  page = { bounds: this.measured, visible: false };
  reads = 0;
  layouts: Array<{ id: string; bounds: BrowserBounds; visible: boolean }> = [];
  captures: BrowserBounds[] = [];
  decodes: string[] = [];
  focus: (() => void) | undefined;
  stoppedFocus = 0;
  nextLayout: ReturnType<typeof deferred<void>> | undefined;
  nextCapture: ReturnType<typeof deferred<string>> | undefined;
  nextDecode: ReturnType<typeof deferred<void>> | undefined;

  bounds() {
    this.reads += 1;
    return this.measured;
  }
  async layout(id: string, bounds: BrowserBounds, visible: boolean) {
    this.layouts.push({ id, bounds, visible });
    const pending = this.nextLayout;
    this.nextLayout = undefined;
    if (pending) await pending.promise;
    this.page.bounds = bounds;
    this.page.visible = visible;
  }
  async snapshot() {
    this.captures.push(this.page.bounds);
    const pending = this.nextCapture;
    this.nextCapture = undefined;
    return pending
      ? pending.promise
      : `data:image/png;base64,capture-${this.captures.length}`;
  }
  async decode(src: string) {
    this.decodes.push(src);
    const pending = this.nextDecode;
    this.nextDecode = undefined;
    if (pending) await pending.promise;
  }
  async onFocusChanged(callback: () => void) {
    this.focus = callback;
    return () => {
      this.focus = undefined;
      this.stoppedFocus += 1;
    };
  }
}

describe("browser presentation", () => {
  let element: HTMLDivElement;
  let native: FakeNativePage;
  let state: BrowserPresentationState;
  let controller: BrowserPresentation;
  let snapshots: Array<BrowserSnapshot | null>;
  let notices: string[];
  let frames: Map<number, FrameRequestCallback>;
  let resizeObservers: Set<{ targets: Set<Element>; callback: () => void }>;
  let mutationObservers: Set<(records: Partial<MutationRecord>[]) => void>;
  let pageSequence = 0;
  const settle = async () => {
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
  };
  const paint = async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
    await settle();
  };
  const resize = () => {
    for (const observer of resizeObservers)
      if (observer.targets.has(element)) observer.callback();
  };
  const overlay = (modal = false) => {
    const menu = document.createElement("div");
    menu.setAttribute("role", modal ? "dialog" : "menu");
    if (modal) menu.setAttribute("aria-modal", "true");
    vi.spyOn(menu, "getClientRects").mockReturnValue([
      new DOMRect(120, 100, 200, 150),
    ] as unknown as DOMRectList);
    element.append(menu);
    for (const callback of mutationObservers)
      callback([
        {
          type: "childList",
          addedNodes: [menu] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
        },
      ]);
    return menu;
  };

  /** A dragged tab's copy over the page, as sortableMotion draws it. */
  const movingCopy = (rect = new DOMRect(400, 300, 110, 30)) => {
    const copy = document.createElement("div");
    copy.dataset.nativeBrowserOccluded = "true";
    copy.setAttribute(BROWSER_MOVING_ATTRIBUTE, "true");
    const at = vi
      .spyOn(copy, "getClientRects")
      .mockReturnValue([rect] as unknown as DOMRectList);
    element.append(copy);
    const changed = (records: Partial<MutationRecord>[]) => {
      for (const callback of mutationObservers) callback(records);
    };
    changed([
      {
        type: "childList",
        addedNodes: [copy] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
      },
    ]);
    return {
      move(next: DOMRect) {
        at.mockReturnValue([next] as unknown as DOMRectList);
        changed([{ type: "attributes", attributeName: "style", target: copy }]);
      },
      remove() {
        copy.remove();
        changed([
          {
            type: "childList",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [copy] as unknown as NodeList,
          },
        ]);
      },
    };
  };
  /** The last surface the page's pane holds, such as a copy. */
  const lastSurface = () => element.lastElementChild as HTMLElement;
  /** The page's frame, which a hover must never change. */
  const frameOf = (bounds: BrowserBounds) => ({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    clipLeft: bounds.clipLeft,
    clipRight: bounds.clipRight,
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    frames = new Map();
    let frame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frame, callback);
      return frame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    resizeObservers = new Set();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        constructor(public callback: () => void) {}
        observe(target: Element) {
          this.targets.add(target);
          resizeObservers.add(this);
        }
        disconnect() {
          this.targets.clear();
          resizeObservers.delete(this);
        }
      },
    );
    mutationObservers = new Set();
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(
          private callback: (records: Partial<MutationRecord>[]) => void,
        ) {}
        observe() {
          mutationObservers.add(this.callback);
        }
        disconnect() {
          mutationObservers.delete(this.callback);
        }
      },
    );
    element = document.createElement("div");
    document.body.append(element);
    native = new FakeNativePage();
    state = {
      visible: true,
      paused: false,
      nativeId: `page-${++pageSequence}`,
      holesSupported: false,
      url: "https://example.com/",
      navigation: 0,
      zoom: { factor: 1, menu: null },
    };
    snapshots = [];
    notices = [];
    controller = createBrowserPresentation({
      surfaceId: "surface",
      pageId: state.nativeId!,
      element,
      readState: () => state,
      adapter: native,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onNotice: (notice) => notices.push(notice),
    });
    await settle();
    snapshots.length = 0;
  });
  afterEach(async () => {
    controller.dispose();
    await settle();
    element.remove();
    resetBrowserHandoff();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retains the page and suppresses repeated placement until a transfer invalidates it", async () => {
    const page = native.page;
    for (let count = 0; count < 10; count += 1) controller.update();
    await settle();
    expect(native.layouts).toHaveLength(1);
    expect(native.page.visible).toBe(true);
    window.dispatchEvent(new Event("supermono:browser-layout-reset"));
    await settle();
    expect(native.layouts).toHaveLength(2);
    expect(native.page).toBe(page);
    expect(native.captures).toEqual([]);
  });

  it("hides the page for a layout motion and shows it again at its final bounds", async () => {
    let held = false;
    void controller.holdForMotion().then(() => {
      held = true;
    });
    await settle();
    expect(held).toBe(true);
    expect(native.page.visible).toBe(false);
    // No still image of its own: the motion supplies the picture.
    expect(native.captures).toEqual([]);
    expect(snapshots).toEqual([]);
    // The pane moves while held; the page stays hidden.
    native.measured = { ...native.measured, x: 300, width: 900 };
    resize();
    await vi.advanceTimersByTimeAsync(16);
    expect(native.page.visible).toBe(false);
    const pending = deferred<void>();
    native.nextLayout = pending;
    let released = false;
    void controller.releaseFromMotion().then(() => {
      released = true;
    });
    await settle();
    expect(released).toBe(false);
    pending.resolve();
    await settle();
    expect(released).toBe(true);
    expect(native.page).toMatchObject({
      visible: true,
      bounds: { x: 300, width: 900 },
    });
  });

  it("leaves a page that is no longer showing hidden when its motion ends", async () => {
    await controller.holdForMotion();
    state.visible = false;
    controller.update();
    await settle();
    let released = false;
    void controller.releaseFromMotion().then(() => {
      released = true;
    });
    await settle();
    expect(released).toBe(true);
    expect(native.page.visible).toBe(false);
  });

  it("never waits on the native page past its motion deadline", async () => {
    native.nextLayout = deferred<void>();
    let held = false;
    void controller.holdForMotion().then(() => {
      held = true;
    });
    await settle();
    expect(held).toBe(false);
    await vi.advanceTimersByTimeAsync(160);
    expect(held).toBe(true);
  });

  it("serializes native layouts and sends the latest pending bounds", async () => {
    const pending = deferred<void>();
    native.nextLayout = pending;
    native.measured = { ...native.measured, width: 700 };
    controller.update();
    native.measured = { ...native.measured, width: 900 };
    for (let count = 0; count < 10; count += 1) controller.update();
    expect(native.layouts).toHaveLength(2);
    pending.resolve();
    await settle();
    expect(native.layouts).toHaveLength(3);
    expect(native.page.bounds.width).toBe(900);
    expect(native.page.visible).toBe(true);
  });

  it("updates resize bounds within one frame when animation frames are deferred", async () => {
    native.measured = { ...native.measured, height: 550 };
    for (let count = 0; count < 10; count += 1) resize();
    expect(frames.size).toBe(1);
    expect(native.layouts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(16);
    expect(native.page.bounds.height).toBe(550);
    expect(native.layouts).toHaveLength(2);
    expect(frames.size).toBe(0);
  });

  it("disconnects hidden panes and rechecks overlays before returning", async () => {
    state.visible = false;
    state.paused = true;
    controller.update();
    await settle();
    expect(native.page.visible).toBe(false);
    expect(resizeObservers.size).toBe(0);
    expect(mutationObservers.size).toBe(0);
    const reads = native.reads;
    overlay();
    resize();
    expect(native.reads).toBe(reads);
    state.visible = true;
    state.paused = false;
    state.holesSupported = true;
    controller.update();
    await settle();
    expect(native.page.visible).toBe(true);
    expect(native.page.bounds.holes).toHaveLength(1);
    expect(mutationObservers.size).toBe(1);
    expect(native.captures).toEqual([]);
  });

  it("cuts menus out of the live page and captures true modals", async () => {
    state.holesSupported = true;
    const menu = overlay();
    await settle();
    expect(native.page.bounds.holes).toEqual([
      { x: 20, y: 20, width: 200, height: 150, radius: 0 },
    ]);
    expect(native.page.visible).toBe(true);
    expect(native.captures).toHaveLength(0);
    menu.remove();
    overlay(true);
    await settle();
    expect(native.captures).toHaveLength(1);
    await paint();
    expect(native.page.visible).toBe(false);
    expect(snapshots.at(-1)?.width).toBe(600);
  });

  it("decodes and commits backing pixels before hiding Chromium", async () => {
    const pending = deferred<void>();
    native.nextDecode = pending;
    overlay();
    await settle();
    expect(native.decodes).toHaveLength(1);
    expect(snapshots).toHaveLength(0);
    expect(native.page.visible).toBe(true);
    pending.resolve();
    await settle();
    expect(snapshots.at(-1)).toMatchObject({
      width: 600,
      height: 500,
      scale: 2,
      left: 0,
      top: 0,
    });
    expect(native.page.visible).toBe(true);
    await paint();
    expect(native.page.visible).toBe(false);
  });

  it.each(["navigation", "zoom", "replacement"] as const)(
    "ignores a capture invalidated by %s while native work finishes",
    async (change) => {
      const pending = deferred<string>();
      native.nextCapture = pending;
      overlay();
      await settle();
      if (change === "navigation") {
        state.url = "https://example.org/";
        state.navigation += 1;
      } else if (change === "zoom") {
        state.zoom = { factor: 1.25, menu: null };
        controller.updateZoom();
      } else state.nativeId = "replacement";
      pending.resolve("data:image/png;base64,obsolete");
      await settle();
      expect(native.decodes).toHaveLength(0);
      expect(snapshots).toHaveLength(0);
    },
  );

  it("reveals overlays at the deadline and accepts a still-relevant late backing", async () => {
    const pending = deferred<string>();
    native.nextCapture = pending;
    overlay();
    await vi.advanceTimersByTimeAsync(80);
    expect(native.page.visible).toBe(false);
    expect(snapshots).toHaveLength(0);
    pending.resolve("data:image/png;base64,late");
    await settle();
    expect(snapshots.at(-1)?.src).toBe("data:image/png;base64,late");
    await paint();
    expect(notices).toEqual([]);
  });

  it("cancels timers and observations while a disposed native layout settles", async () => {
    const pending = deferred<void>();
    native.nextLayout = pending;
    native.measured = { ...native.measured, width: 700 };
    controller.update();
    native.measured = { ...native.measured, width: 900 };
    resize();
    controller.dispose();
    controller.dispose();
    controller.update();
    controller.updateZoom();
    pending.resolve();
    await settle();
    expect(native.layouts).toHaveLength(2);
    expect(snapshots).toHaveLength(0);
    expect(mutationObservers.size).toBe(0);
    expect(resizeObservers.size).toBe(0);
    expect(native.stoppedFocus).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("ignores capture completion after disposal without reviving observers", async () => {
    const pending = deferred<string>();
    native.nextCapture = pending;
    overlay();
    await settle();
    controller.dispose();
    pending.resolve("data:image/png;base64,disposed");
    await settle();
    expect(native.decodes).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(native.layouts).toHaveLength(1);
    expect(mutationObservers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(notices).toEqual([]);
  });

  it("freezes the page behind a supplied picture without an overlay capture, then shows it again", async () => {
    const src = "data:image/png;base64,markup";
    const frozen = controller.freeze(src);
    await settle();
    expect(native.decodes).toEqual([src]);
    expect(snapshots.at(-1)).toMatchObject({ src, width: 600, height: 500 });
    // Painted beneath the live page before Chromium is hidden.
    expect(native.page.visible).toBe(true);
    await paint();
    await expect(frozen).resolves.toBe(true);
    expect(native.page.visible).toBe(false);
    // Modals and resizes keep the frozen picture instead of replacing it.
    overlay(true);
    native.measured = { ...native.measured, width: 700 };
    resize();
    await vi.advanceTimersByTimeAsync(16);
    await paint();
    expect(native.page).toMatchObject({ visible: false });
    expect(native.page.bounds.width).toBe(700);
    expect(native.captures).toEqual([]);
    expect(snapshots.at(-1)?.src).toBe(src);
    document.querySelector('[aria-modal="true"]')!.remove();
    controller.thaw();
    await settle();
    expect(native.page.visible).toBe(true);
    expect(snapshots.at(-1)).toBeNull();
    expect(native.captures).toEqual([]);
  });

  it("abandons a freeze that is thawed before the page is hidden", async () => {
    const decode = deferred<void>();
    native.nextDecode = decode;
    const early = controller.freeze("data:image/png;base64,early");
    await settle();
    controller.thaw();
    decode.resolve();
    await expect(early).resolves.toBe(false);
    expect(snapshots.filter(Boolean)).toEqual([]);
    expect(native.page.visible).toBe(true);

    const late = controller.freeze("data:image/png;base64,late");
    await settle();
    expect(snapshots.at(-1)?.src).toBe("data:image/png;base64,late");
    controller.thaw();
    await paint();
    await expect(late).resolves.toBe(false);
    // The picture it slid beneath the page is released at once.
    expect(snapshots.at(-1)).toBeNull();
    expect(native.page.visible).toBe(true);
    expect(native.layouts.every((layout) => layout.visible)).toBe(true);
  });

  it("keeps a freeze's picture when a layout already in flight shows the page", async () => {
    const layout = deferred<void>();
    native.nextLayout = layout;
    native.measured = { ...native.measured, width: 640 };
    controller.update();
    await settle();
    const src = "data:image/png;base64,markup";
    const frozen = controller.freeze(src);
    await settle();
    expect(snapshots.at(-1)?.src).toBe(src);
    layout.resolve();
    await settle();
    expect(snapshots.at(-1)?.src).toBe(src);
    await paint();
    await expect(frozen).resolves.toBe(true);
    expect(native.page.visible).toBe(false);
    expect(snapshots.at(-1)?.src).toBe(src);
  });

  it("does not freeze a hidden pane", async () => {
    state.visible = false;
    state.paused = true;
    controller.update();
    await settle();
    await expect(
      controller.freeze("data:image/png;base64,hidden"),
    ).resolves.toBe(false);
    expect(native.decodes).toEqual([]);
    expect(snapshots).toEqual([]);
  });
  describe("a dragged tab's copy over the page", () => {
    beforeEach(async () => {
      state.holesSupported = true;
      controller.update();
      await settle();
    });

    it("stays under the live page until a still image is painted beneath, then is cut out where drawn", async () => {
      const frame = frameOf(native.page.bounds);
      const pending = deferred<string>();
      native.nextCapture = pending;
      const copy = movingCopy();
      await settle();
      // Nothing cut out yet, and the page never hides or moves for it.
      expect(native.captures).toHaveLength(1);
      expect(native.page.visible).toBe(true);
      expect(native.page.bounds.holes).toBeUndefined();
      pending.resolve("data:image/png;base64,still");
      await settle();
      expect(snapshots.at(-1)).toMatchObject({
        src: "data:image/png;base64,still",
        width: 600,
        height: 500,
      });
      expect(native.page.bounds.holes).toBeUndefined();
      await paint();
      expect(native.page.visible).toBe(true);
      expect(native.page.bounds.holes).toEqual([
        { x: 300, y: 220, width: 110, height: 30, radius: 0 },
      ]);
      expect(frameOf(native.page.bounds)).toEqual(frame);
      // Moving it moves only its cut-out, over the same still image.
      copy.move(new DOMRect(150, 120, 110, 30));
      await settle();
      expect(native.page.bounds.holes).toEqual([
        { x: 50, y: 40, width: 110, height: 30, radius: 0 },
      ]);
      expect(native.captures).toHaveLength(1);
      expect(snapshots.at(-1)?.src).toBe("data:image/png;base64,still");
      expect(frameOf(native.page.bounds)).toEqual(frame);
      expect(native.layouts.every((layout) => layout.visible)).toBe(true);
      // Gone, the page is whole first, then the still image goes.
      copy.remove();
      await settle();
      expect(native.page).toMatchObject({ visible: true });
      expect(native.page.bounds.holes).toBeUndefined();
      expect(snapshots.at(-1)).toBeNull();
      expect(frameOf(native.page.bounds)).toEqual(frame);
    });

    it("follows the copy each frame while its springs run, and stops after", async () => {
      const copy = movingCopy();
      await settle();
      await paint();
      expect(native.page.bounds.holes).toHaveLength(1);
      // Its springs run as WAAPI: no attribute changes while it moves.
      const element = lastSurface();
      const running = vi
        .spyOn(element, "getAnimations")
        .mockReturnValue([
          { playState: "running", pending: false } as unknown as Animation,
        ]);
      copy.move(new DOMRect(400, 300, 110, 30));
      await settle();
      vi.spyOn(element, "getClientRects").mockReturnValue([
        new DOMRect(420, 310, 90, 30),
      ] as unknown as DOMRectList);
      await paint();
      expect(native.page.bounds.holes).toEqual([
        { x: 320, y: 230, width: 90, height: 30, radius: 0 },
      ]);
      running.mockReturnValue([]);
      vi.spyOn(element, "getClientRects").mockReturnValue([
        new DOMRect(430, 310, 80, 30),
      ] as unknown as DOMRectList);
      await paint();
      expect(native.page.bounds.holes?.[0]).toMatchObject({ x: 330 });
      // At rest it is no longer followed.
      await paint();
      expect(frames.size).toBe(0);
    });

    it("drops a still image that arrives after the copy has gone", async () => {
      const pending = deferred<string>();
      native.nextCapture = pending;
      const copy = movingCopy();
      await settle();
      copy.remove();
      await settle();
      pending.resolve("data:image/png;base64,late");
      await settle();
      await paint();
      expect(native.decodes).toEqual([]);
      expect(snapshots.filter(Boolean)).toEqual([]);
      expect(native.page.visible).toBe(true);
      expect(native.page.bounds.holes).toBeUndefined();
    });

    it("takes the still image again when the page loads under a held copy", async () => {
      const pending = deferred<string>();
      native.nextCapture = pending;
      movingCopy();
      await settle();
      state.url = "https://example.com/loaded";
      state.navigation += 1;
      pending.resolve("data:image/png;base64,before-load");
      await settle();
      expect(native.decodes).toEqual([]);
      expect(native.page.bounds.holes).toBeUndefined();
      // Held still, nothing moves it; the image is taken again regardless.
      await vi.advanceTimersByTimeAsync(120);
      await settle();
      await paint();
      expect(native.captures).toHaveLength(2);
      expect(native.page.bounds.holes).toHaveLength(1);
      expect(native.page.visible).toBe(true);
    });

    it("keeps the copy under a page whose still image fails", async () => {
      let attempts = 0;
      native.snapshot = () => {
        attempts += 1;
        return Promise.reject(new Error("no image"));
      };
      movingCopy();
      await settle();
      await paint();
      // A few tries, then it stops asking.
      for (let tick = 0; tick < 20; tick += 1) {
        await vi.advanceTimersByTimeAsync(120);
        await settle();
      }
      expect(attempts).toBeLessThanOrEqual(6);
      expect(native.page.visible).toBe(true);
      expect(native.page.bounds.holes).toBeUndefined();
      expect(snapshots.filter(Boolean)).toEqual([]);
    });

    it("hands the page to a layout motion and back whole after the drop", async () => {
      const copy = movingCopy();
      await settle();
      await paint();
      expect(native.page.bounds.holes).toHaveLength(1);
      await controller.holdForMotion();
      expect(native.page.visible).toBe(false);
      copy.remove();
      native.measured = { ...native.measured, width: 300 };
      await settle();
      await controller.releaseFromMotion();
      await settle();
      expect(native.page).toMatchObject({
        visible: true,
        bounds: { width: 300 },
      });
      expect(native.page.bounds.holes).toBeUndefined();
      expect(snapshots.at(-1)).toBeNull();
    });

    it("shows the still image instead of the page on an engine without cut-outs, once painted", async () => {
      state.holesSupported = false;
      const pending = deferred<string>();
      native.nextCapture = pending;
      const copy = movingCopy();
      await settle();
      // Never hidden with nothing beneath it, however slow the image.
      await vi.advanceTimersByTimeAsync(400);
      expect(native.page.visible).toBe(true);
      pending.resolve("data:image/png;base64,still");
      await settle();
      expect(native.page.visible).toBe(true);
      await paint();
      expect(native.page.visible).toBe(false);
      expect(snapshots.at(-1)?.src).toBe("data:image/png;base64,still");
      expect(native.captures).toHaveLength(1);
      copy.remove();
      await settle();
      expect(native.page.visible).toBe(true);
      expect(snapshots.at(-1)).toBeNull();
    });
  });
});
