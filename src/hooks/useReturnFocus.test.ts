// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReturnFocus } from "./useReturnFocus";

type ReturnFocus = ReturnType<typeof useReturnFocus>;
let root: Root;
let host: HTMLDivElement;
let api: ReturnFocus;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function Harness() {
  api = useReturnFocus();
  return null;
}

async function render() {
  await act(async () => root.render(createElement(Harness)));
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useReturnFocus", () => {
  it("restores the original workspace opener after switching utilities", async () => {
    await render();
    const opener = document.createElement("button");
    const search = document.createElement("input");
    const notes = document.createElement("input");
    host.append(opener, search, notes);
    opener.focus();
    api.captureReturnFocus();
    opener.inert = true;
    search.focus();
    api.captureReturnFocus();
    notes.focus();
    notes.remove();
    search.remove();
    opener.inert = false;
    api.restoreReturnFocus();
    flushFrames();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus on a new file or conversation opened from the utility", async () => {
    await render();
    const opener = document.createElement("button");
    const search = document.createElement("input");
    const destination = document.createElement("textarea");
    host.append(opener, search, destination);
    opener.focus();
    api.captureReturnFocus();
    search.focus();
    search.remove();
    api.restoreReturnFocus();
    destination.focus();
    flushFrames();
    expect(document.activeElement).toBe(destination);
  });

  it("skips removed, hidden, and disabled openers", async () => {
    await render();
    for (const state of ["removed", "hidden", "disabled"]) {
      const opener = document.createElement("button");
      host.append(opener);
      opener.focus();
      api.captureReturnFocus();
      if (state === "removed") opener.remove();
      if (state === "hidden") opener.parentElement!.hidden = true;
      if (state === "disabled") opener.disabled = true;
      document.body.tabIndex = -1;
      document.body.focus();
      api.restoreReturnFocus();
      flushFrames();
      expect(document.activeElement).not.toBe(opener);
      host.hidden = false;
      opener.remove();
    }
    document.body.removeAttribute("tabindex");
  });

  it("cancels pending restoration when cleared or unmounted", async () => {
    await render();
    const opener = document.createElement("button");
    host.append(opener);
    opener.focus();
    api.captureReturnFocus();
    opener.blur();
    api.restoreReturnFocus();
    expect(frames.size).toBe(1);
    api.clearReturnFocus();
    expect(frames.size).toBe(0);
    opener.focus();
    api.captureReturnFocus();
    opener.blur();
    api.restoreReturnFocus();
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    root = createRoot(host);
  });
});
