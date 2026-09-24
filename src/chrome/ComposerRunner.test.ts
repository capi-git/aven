// @vitest-environment happy-dom
import { act, createElement, StrictMode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerRunner } from "./ComposerRunner";
import { EXIT_MS, STAR_COUNT } from "../lib/composerRunner";

describe("composer mascot presentation", () => {
  let root: Root;
  let container: HTMLDivElement;
  let box: HTMLDivElement;
  let boxRef: RefObject<HTMLElement | null>;
  let hidden: boolean;
  let reduced: boolean;
  let now: number;
  let frameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let onExited: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hidden = false;
    reduced = false;
    now = 0;
    frameId = 0;
    frames = new Map();
    onExited = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    box = document.createElement("div");
    document.body.append(container, box);
    boxRef = { current: box };
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      right: 700,
      bottom: 300,
      width: 600,
      height: 100,
      x: 100,
      y: 200,
      toJSON() {},
    });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(enabled: boolean, busy = true, strict = false) {
    const runner = createElement(ComposerRunner, {
      boxRef,
      cwd: "/project",
      busy,
      enabled,
      onExited,
    });
    await act(async () =>
      root.render(strict ? createElement(StrictMode, {}, runner) : runner),
    );
  }

  const sprite = () =>
    document.querySelector<HTMLElement>(".will-change-transform")!;
  const layer = () => sprite().parentElement!;
  const x = () => sprite().style.getPropertyValue("--runner-x");

  async function frame(time: number) {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(now)));
  }

  async function visibility(value: boolean) {
    hidden = value;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
  }

  it("schedules no frames or layout reads until its retained workspace is presented", async () => {
    await render(false);
    expect(frames.size).toBe(0);
    expect(box.getBoundingClientRect).not.toHaveBeenCalled();
    expect(layer().style.visibility).toBe("hidden");
    await render(true);
    expect(frames.size).toBe(1);
    expect(layer().style.visibility).toBe("visible");
    expect(box.getBoundingClientRect).toHaveBeenCalled();
  });

  it("cancels hidden workspace frames and resumes the same position and coins", async () => {
    await render(true);
    await frame(4000);
    const position = x();
    const coin = layer().children[0]!.firstElementChild;
    expect(coin).not.toBeNull();
    await render(false);
    const reads = vi.mocked(box.getBoundingClientRect).mock.calls.length;
    expect(frames.size).toBe(0);
    await frame(5000);
    expect(box.getBoundingClientRect).toHaveBeenCalledTimes(reads);
    await render(true);
    expect(x()).toBe(position);
    expect(layer().children[0]!.firstElementChild).toBe(coin);
    expect(frames.size).toBe(1);
    await frame(5032);
    expect(x()).not.toBe(position);
  });

  it("pauses for document occlusion and does not advance the track while absent", async () => {
    await render(true);
    await frame(32);
    const position = x();
    await visibility(true);
    const reads = vi.mocked(box.getBoundingClientRect).mock.calls.length;
    expect(frames.size).toBe(0);
    expect(layer().style.visibility).toBe("hidden");
    await frame(1000);
    expect(box.getBoundingClientRect).toHaveBeenCalledTimes(reads);
    await visibility(false);
    expect(x()).toBe(position);
    expect(frames.size).toBe(1);
  });

  it("retires a turn that ends in a parked workspace without a frame loop", async () => {
    await render(true);
    await render(false);
    await render(false, false);
    expect(onExited).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    await visibility(true);
    await visibility(false);
    expect(onExited).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("keeps the visible exit animation and stops scheduling once it finishes", async () => {
    await render(true);
    await frame(32);
    await render(true, false);
    expect(onExited).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    await frame(32 + EXIT_MS);
    expect(onExited).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("preserves reduced-motion positioning and immediate completion", async () => {
    reduced = true;
    await render(true);
    const position = x();
    await frame(1000);
    expect(x()).toBe(position);
    await render(false);
    expect(frames.size).toBe(0);
    await render(true);
    expect(x()).toBe(position);
    await render(true, false);
    expect(onExited).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("leaves one loop and one star set after Strict Mode setup replay", async () => {
    await render(true, true, true);
    expect(frames.size).toBe(1);
    expect(layer().children[2]!.children).toHaveLength(STAR_COUNT);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
    await visibility(true);
    await visibility(false);
    expect(frames.size).toBe(0);
  });
});
