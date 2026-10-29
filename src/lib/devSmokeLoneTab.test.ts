import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  combinedProblem,
  dragPath,
  frame,
  joinedProblem,
  splitLeftProblem,
  smokeMouse,
  strippedProblem,
} from "./devSmokeLoneTab";

describe("the real-app check of a lone tab's header", () => {
  it("moves the hand past the drag threshold first, then evenly to the end", () => {
    const path = dragPath({ x: 100, y: 20 }, { x: 300, y: 220 }, 4);
    expect(path[0]).toEqual({ x: 108, y: 22 });
    expect(path.slice(1)).toEqual([
      { x: 150, y: 70 },
      { x: 200, y: 120 },
      { x: 250, y: 170 },
      { x: 300, y: 220 },
    ]);
  });

  it("waits for a painted frame, but never longer than a moment where none comes", async () => {
    vi.useFakeTimers();
    // A hidden window: WebKit runs no frame callbacks.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    try {
      let done = false;
      const waiting = frame().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("reads a split to the chat's left, a join and the strip from the arrangement", () => {
    expect(splitLeftProblem([["page"], ["chat"]], "chat", "page")).toBeNull();
    expect(splitLeftProblem([["chat"], ["page"]], "chat", "page")).toBe(
      "the page's pane is not left of the chat's",
    );
    expect(splitLeftProblem([["chat", "page"]], "chat", "page")).toMatch(
      /not alone in a pane/,
    );

    expect(joinedProblem([["chat", "page", "other"]], "chat", "page")).toBe(
      null,
    );
    expect(joinedProblem([["page"], ["chat"]], "chat", "page")).toMatch(
      /not in the chat's pane/,
    );
    expect(joinedProblem([["page"]], "chat", "page")).toBe(
      "the chat's pane is gone",
    );

    expect(strippedProblem([{ id: "chat" }, { id: "page" }], "page")).toBe(
      null,
    );
    expect(strippedProblem([{ split: ["chat", "page"] }], "page")).toBe(
      "the page is still in a split on the strip",
    );
    expect(strippedProblem([{ id: "chat" }], "page")).toBe(
      "the page is not on the strip",
    );
  });

  it("reads a split of the two tabs a no-rest drop made on the strip", () => {
    expect(
      combinedProblem(
        [{ id: "notes" }, { split: ["chat", "page"] }],
        "chat",
        "page",
      ),
    ).toBeNull();
    expect(
      combinedProblem([{ id: "chat" }, { id: "page" }], "chat", "page"),
    ).toMatch(/no split on the strip/);
    expect(
      combinedProblem([{ split: ["chat", "page", "other"] }], "chat", "page"),
    ).toMatch(/not just the two tabs/);
  });

  it("lets go at once when asked not to wait for the drag's frames", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    try {
      // No frame ever comes, yet it returns as soon as the release is sent.
      await smokeMouse("up", { x: 10, y: 20 }, { settle: false });
      expect(invoke).toHaveBeenLastCalledWith("dev_smoke_pointer", {
        kind: "up",
        x: 10,
        y: 20,
        zoom: expect.any(Number),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
