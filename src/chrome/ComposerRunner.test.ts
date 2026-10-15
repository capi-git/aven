// @vitest-environment happy-dom
import { act, createElement, StrictMode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { ComposerRunner } from "./ComposerRunner";
import { EXIT_MS, REACTION_WAIT_MS, STAR_COUNT } from "../lib/composerRunner";
import {
  getActivitySnapshot,
  recordActivity,
  type ActivityOutcome,
} from "../lib/activity";
import { MASCOT_REACTION_MS } from "../lib/mascotReactions";

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
  let onExited: Mock<() => void>;

  beforeEach(() => {
    hidden = false;
    reduced = false;
    now = 0;
    frameId = 0;
    frames = new Map();
    onExited = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    getActivitySnapshot();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
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
    // Without a reaction it stands on the rim only briefly before hopping.
    await frame(32 + REACTION_WAIT_MS);
    await frame(32 + REACTION_WAIT_MS + EXIT_MS);
    expect(onExited).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  const y = () => sprite().style.getPropertyValue("--runner-y");
  const mascot = () => sprite().querySelector("svg")!;
  const finish = (outcome: ActivityOutcome, id = "turn") =>
    act(
      async () =>
        void recordActivity({
          id,
          sessionId: "s",
          outcome,
          title: "Task",
          summary: "",
          cwd: "/project",
          harness: "codex",
          model: "gpt-5",
        }),
    );

  it("plays the turn's reaction on the rim, then hops away", async () => {
    await render(true);
    await frame(32);
    expect(mascot().classList.contains("mascot-active")).toBe(true);
    await finish("completed");
    // Still working: another session's end never shows on a busy runner.
    expect(mascot().dataset.reaction).toBeUndefined();
    await finish("completed", "ended");
    await render(true, false);
    expect(mascot().dataset.reaction).toBe("cheer");
    expect(mascot().classList.contains("mascot-active")).toBe(false);
    await frame(48);
    const rim = y();
    await frame(32 + MASCOT_REACTION_MS.cheer - 1);
    expect(y()).toBe(rim);
    expect(onExited).not.toHaveBeenCalled();
    await frame(32 + MASCOT_REACTION_MS.cheer);
    await frame(32 + MASCOT_REACTION_MS.cheer + EXIT_MS / 3);
    expect(y()).not.toBe(rim);
    await frame(32 + MASCOT_REACTION_MS.cheer + EXIT_MS);
    expect(onExited).toHaveBeenCalledOnce();
  });

  it("slumps when the turn failed and plays a late-arriving reaction", async () => {
    await render(true);
    await frame(32);
    await render(true, false);
    await frame(80);
    expect(mascot().dataset.reaction).toBeUndefined();
    // The ledger entry arrives just after the session's state, as it can in
    // a detached window.
    await finish("failed");
    expect(mascot().dataset.reaction).toBe("slump");
    await frame(120);
    await frame(120 + MASCOT_REACTION_MS.slump - 1);
    expect(onExited).not.toHaveBeenCalled();
    await frame(120 + MASCOT_REACTION_MS.slump);
    await frame(120 + MASCOT_REACTION_MS.slump + EXIT_MS);
    expect(onExited).toHaveBeenCalledOnce();
  });

  it("leaves room for the reaction's sparkle around the sprite", async () => {
    await render(true);
    expect(sprite().style.clipPath).toContain("-8px");
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

  it("keeps animating through transcript changes without measuring layout each frame", async () => {
    await render(true);
    const reads = () => vi.mocked(box.getBoundingClientRect).mock.calls.length;
    const initial = reads();
    for (let i = 1; i <= 5; i++) {
      box.append(document.createElement("span"));
      await frame(i * 16);
    }
    expect(reads()).toBe(initial);
    const position = x();
    await frame(100);
    expect(reads()).toBe(initial + 1);
    expect(x()).not.toBe(position);
  });

  it("measures again as soon as a parked workspace returns", async () => {
    await render(true);
    await frame(16);
    await render(false);
    const reads = vi.mocked(box.getBoundingClientRect).mock.calls.length;
    now = 40;
    await render(true);
    expect(box.getBoundingClientRect).toHaveBeenCalledTimes(reads + 1);
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
