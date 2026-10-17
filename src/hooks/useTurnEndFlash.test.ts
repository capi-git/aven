// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivitySnapshot,
  recordActivity,
  type ActivityInput,
} from "../lib/activity";
import { MOTION_ATTRIBUTE, MOTION_ROOT_ATTRIBUTE } from "../lib/motion";
import { useTurnEndFlash } from "./useTurnEndFlash";

const NOW = new Date(2026, 9, 17, 10, 0).getTime();

function turn(id: string, patch: Partial<ActivityInput> = {}): ActivityInput {
  return {
    id,
    sessionId: "chat-1",
    outcome: "completed",
    title: "Fix tabs",
    summary: "Tabs fixed",
    cwd: "/projects/app",
    harness: "codex",
    model: "gpt-5",
    createdAt: Date.now(),
    ...patch,
  };
}

function Row({ ids, label }: { ids: string[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useTurnEndFlash(ref, ids);
  return createElement("div", { ref, "data-row": "" }, label);
}

describe("a finished turn's flash", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    getActivitySnapshot();
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(ids: string[], label = "row") {
    await act(async () => root.render(createElement(Row, { ids, label })));
  }
  const row = () => container.querySelector<HTMLElement>("[data-row]")!;

  it("sweeps the row of the chat whose turn finished, once", async () => {
    await render(["chat-1", "chat-2"]);
    await act(
      async () => void recordActivity(turn("other", { sessionId: "x" })),
    );
    expect(row().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);

    await act(async () => void recordActivity(turn("t1")));
    expect(row().getAttribute(MOTION_ATTRIBUTE)).toBe("flash");
    row().dispatchEvent(new Event("animationend"));
    expect(row().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);

    // Renders while the mascot still cheers do not start it again.
    await render(["chat-1", "chat-2"], "renamed");
    expect(row().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
    // Nothing is left to wake the window once the reaction is over.
    await act(async () => void vi.advanceTimersByTime(1200));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays still for a failed or stopped turn", async () => {
    await render(["chat-1"]);
    await act(
      async () => void recordActivity(turn("t2", { outcome: "failed" })),
    );
    expect(row().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });

  it("stays still when motion is reduced", async () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    await render(["chat-1"]);
    await act(async () => void recordActivity(turn("t3")));
    expect(row().hasAttribute(MOTION_ATTRIBUTE)).toBe(false);
  });
});
