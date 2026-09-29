// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createDropIndicatorPresenter,
  normalizeDropIndicator,
  parseDropColor,
  useBrowserDropIndicator,
  WORKSPACE_DROP_FEEDBACK,
} from "./useBrowserDropIndicator";

const native = vi.hoisted(() => ({
  present: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/browser", () => ({
  nativeBrowser: { dropIndicator: native.present },
  browserBounds: () => ({ x: 200, y: 100, width: 600, height: 400, scale: 2 }),
}));

const details = { edge: "tab", kind: "tab", title: "Browser" } as const;
const viewport = { x: 200, y: 100, width: 600, height: 400, scale: 2 };
const area = { left: 260, top: 120, right: 740, bottom: 460 };
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("native drop feedback", () => {
  it("normalizes computed legacy and sRGB colors without forwarding CSS expressions", () => {
    expect(parseDropColor("rgb(51, 102, 153)")).toEqual([0.2, 0.4, 0.6, 1]);
    expect(parseDropColor("rgba(51, 102, 153, 0.1)")).toEqual([
      0.2, 0.4, 0.6, 0.1,
    ]);
    expect(parseDropColor("rgb(20% 40% 60% / 55%)")).toEqual([
      0.2, 0.4, 0.6, 0.55,
    ]);
    expect(parseDropColor("color(srgb 0.2 0.4 0.6 / .9)")).toEqual([
      0.2, 0.4, 0.6, 0.9,
    ]);
    expect(parseDropColor("color(srgb -.1 1.1 0.5)")).toEqual([0, 1, 0.5, 1]);
    for (const value of [
      "var(--accent)",
      "url(test)",
      "color(display-p3 1 0 0)",
      "rgb(NaN 0 1)",
      "rgb(1 2 3 4 5)",
    ])
      expect(parseDropColor(value)).toBeNull();
  });

  it("sends the resolved theme once and repaints palette changes without resampling pointer moves", async () => {
    native.present.mockClear();
    const shell = document.createElement("div");
    shell.className = "personal-shell";
    shell.innerHTML =
      '<div data-workspace-stage><div data-workspace-body><div data-browser></div><div data-workspace-drop-hint data-drop-edge="tab" data-drop-kind="tab" data-drop-title="Browser"></div></div></div>';
    document.body.append(shell);
    const stage = shell.querySelector<HTMLElement>("[data-workspace-stage]")!;
    const hint = shell.querySelector<HTMLElement>(
      "[data-workspace-drop-hint]",
    )!;
    hint.getBoundingClientRect = () => new DOMRect(260, 120, 480, 340);
    const host = {
      current: shell.querySelector<HTMLElement>("[data-browser]")!,
    };
    let colors = {
      borderTopColor: "color(srgb .2 .4 .6)",
      backgroundColor: "color(srgb .2 .4 .6 / .1)",
      outlineColor: "rgba(10, 20, 30, 0.9)",
    };
    const realStyle = globalThis.getComputedStyle;
    let paletteReads = 0;
    const style = vi
      .spyOn(globalThis, "getComputedStyle")
      .mockImplementation((element) => {
        if (element !== hint) return realStyle(element);
        paletteReads++;
        return colors as CSSStyleDeclaration;
      });
    const mount = document.createElement("div");
    document.body.append(mount);
    const root = createRoot(mount);
    function Harness() {
      useBrowserDropIndicator(host, "themed-browser", true);
      return null;
    }
    try {
      await act(async () => root.render(createElement(Harness)));
      expect(paletteReads).toBe(1);
      expect(native.present).toHaveBeenCalledTimes(1);
      expect(native.present.mock.calls[0][1].palette).toEqual({
        stroke: [0.2, 0.4, 0.6, 1],
        fill: [0.2, 0.4, 0.6, 0.1],
        halo: [10 / 255, 20 / 255, 30 / 255, 0.9],
      });
      for (let i = 0; i < 1000; i++)
        stage.dispatchEvent(
          new Event(WORKSPACE_DROP_FEEDBACK, { bubbles: true }),
        );
      expect(paletteReads).toBe(1);
      expect(native.present).toHaveBeenCalledTimes(1);
      colors = { ...colors, borderTopColor: "color(srgb .3 .7 .4)" };
      await act(async () => {
        shell.style.setProperty("--theme-accent-color", "#33aa44");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(paletteReads).toBe(2);
      expect(native.present).toHaveBeenCalledTimes(2);
      expect(native.present.mock.calls[1][1].palette.stroke).toEqual([
        0.3, 0.7, 0.4, 1,
      ]);
      // An unrelated root class can invalidate the cache but not cause IPC.
      await act(async () => {
        shell.classList.add("same-palette");
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(native.present).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      style.mockRestore();
      mount.remove();
      shell.remove();
    }
    expect(native.present).toHaveBeenLastCalledWith("themed-browser", null);
  });

  it("clips the target to its native viewport without depending on pixel scale", () => {
    const expected = { ...details, x: 0.1, y: 0.05, width: 0.8, height: 0.85 };
    expect(normalizeDropIndicator(viewport, area, details)).toEqual(expected);
    expect(
      normalizeDropIndicator({ ...viewport, scale: 0.8 }, area, details),
    ).toEqual(expected);
    expect(
      normalizeDropIndicator(
        viewport,
        { left: 0, top: 0, right: 800, bottom: 700 },
        details,
      ),
    ).toEqual({ ...details, x: 0, y: 0, width: 1, height: 1 });
  });
  it("clears targets outside this browser or with invalid geometry", () => {
    expect(
      normalizeDropIndicator(
        viewport,
        { left: 0, top: 0, right: 100, bottom: 99 },
        details,
      ),
    ).toBeNull();
    expect(
      normalizeDropIndicator(viewport, { ...area, left: NaN }, details),
    ).toBeNull();
    expect(
      normalizeDropIndicator({ ...viewport, width: 0 }, area, details),
    ).toBeNull();
  });
  it("bounds titles without leaving a broken UTF16 surrogate", () => {
    const result = normalizeDropIndicator(viewport, area, {
      ...details,
      title: "a".repeat(159) + "🌊",
    });
    expect(result?.title).toBe("a".repeat(159));
  });
  it("coalesces 1000 destination changes behind one native request and clears after cancellation", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const presenter = createDropIndicatorPresenter(present);
    const value = normalizeDropIndicator(viewport, area, details)!;
    presenter.update(value);
    for (let i = 0; i < 1000; i++)
      presenter.update({ ...value, title: `Tab ${i}` });
    expect(present).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(present).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenLastCalledWith({ ...value, title: "Tab 999" });
    presenter.update({ ...value, title: "Tab 999" });
    expect(present).toHaveBeenCalledTimes(2);
    presenter.dispose();
    await tick();
    expect(present).toHaveBeenLastCalledWith(null);
    presenter.update(value);
    expect(present).toHaveBeenCalledTimes(3);
  });
  it("never paints queued destinations after an interrupted drag", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const presenter = createDropIndicatorPresenter(present);
    const value = normalizeDropIndicator(viewport, area, details)!;
    presenter.update(value);
    presenter.update({ ...value, edge: "left" });
    presenter.dispose();
    release();
    await tick();
    expect(present.mock.calls).toEqual([[value], [null]]);
  });
  it("does not let a retired owner's delayed clear erase a new owner's identical target", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const value = normalizeDropIndicator(viewport, area, details)!;
    const first = createDropIndicatorPresenter(present, "same-page");
    first.update(value);
    first.dispose();
    const second = createDropIndicatorPresenter(present, "same-page");
    second.update(value);
    first.dispose();
    first.update(null);
    expect(present).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(present.mock.calls).toEqual([[value], [value]]);
    second.dispose();
    await tick();
    expect(present).toHaveBeenLastCalledWith(null);
  });
  it("restores the same target after a fully settled hide and new owner", async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    const value = normalizeDropIndicator(viewport, area, details)!;
    const first = createDropIndicatorPresenter(present, "reappeared-page");
    first.update(value);
    await tick();
    first.dispose();
    await tick();
    const second = createDropIndicatorPresenter(present, "reappeared-page");
    second.update(value);
    await tick();
    expect(present.mock.calls).toEqual([[value], [null], [value]]);
    second.dispose();
    await tick();
  });
});
