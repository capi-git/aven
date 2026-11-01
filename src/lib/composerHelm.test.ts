// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HELM_CRITTER,
  doneWords,
  effortPips,
  helmAccessibleName,
  helmClock,
  helmCritterSnapshot,
  helmHintDue,
  helmPose,
  helmRows,
  HELM_CRITTER_KEY,
  loadHelmCritter,
  markHelmHintSeen,
  moveGridCursor,
  moveHelmCursor,
  moveMarkCursor,
  roomBar,
  saveHelmCritter,
  subscribeHelmCritter,
  turnChangedFiles,
} from "./composerHelm";
import type { Block } from "./session";

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("the critter's pose", () => {
  it("dozes at rest, wakes to watch the text, and looks up at its dialog", () => {
    const base = { busy: false, hasValue: false, open: false, outcome: null };
    expect(helmPose(base)).toBe("rest");
    expect(helmPose({ ...base, hasValue: true })).toBe("typing");
    expect(helmPose({ ...base, hasValue: true, open: true })).toBe("hover");
  });

  it("works at its laptop whatever else is going on", () => {
    expect(
      helmPose({ busy: true, hasValue: true, open: true, outcome: "error" }),
    ).toBe("running");
  });

  it("sparkles when done and sweats on an error, which outlasts hovering", () => {
    const base = { busy: false, hasValue: false, open: false };
    expect(helmPose({ ...base, outcome: "done" })).toBe("done");
    expect(helmPose({ ...base, outcome: "error" })).toBe("error");
    expect(helmPose({ ...base, open: true, outcome: "error" })).toBe("error");
    expect(helmPose({ ...base, open: true, outcome: "done" })).toBe("hover");
    expect(helmPose({ ...base, outcome: "stopped" })).toBe("rest");
  });
});

describe("the room bar", () => {
  it("lights the room left, rounding a sliver up to one cell", () => {
    expect(roomBar(0)).toEqual({ lit: 12, tone: "calm", percentLeft: 100 });
    expect(roomBar(0.5).lit).toBe(6);
    expect(roomBar(0.995).lit).toBe(1);
    expect(roomBar(1).lit).toBe(0);
    expect(roomBar(0.77)).toMatchObject({ lit: 3, percentLeft: 23 });
  });

  it("turns its tip amber past 75% used and red past 90%", () => {
    expect(roomBar(0.75).tone).toBe("calm");
    expect(roomBar(0.76).tone).toBe("amber");
    expect(roomBar(0.9).tone).toBe("amber");
    expect(roomBar(0.91).tone).toBe("red");
  });

  it("reads nonsense as an empty window", () => {
    expect(roomBar(Number.NaN).lit).toBe(12);
    expect(roomBar(-1).lit).toBe(12);
    expect(roomBar(4).lit).toBe(0);
  });
});

describe("words", () => {
  it("reads elapsed time as a clock", () => {
    expect(helmClock(42_000)).toBe("0:42");
    expect(helmClock(72_400)).toBe("1:12");
    expect(helmClock(3_723_000)).toBe("1:02:03");
    expect(helmClock(-5)).toBe("0:00");
    expect(helmClock(undefined)).toBeNull();
  });

  it("says how a turn went", () => {
    expect(doneWords(72_000, 3)).toEqual({
      headline: "Done in 1:12",
      detail: "3 files changed",
    });
    expect(doneWords(8_000, 1).detail).toBe("1 file changed");
    expect(doneWords(undefined, 0)).toEqual({ headline: "Done", detail: null });
  });

  it("names the critter's controls without a tooltip", () => {
    expect(
      helmAccessibleName({
        model: "Claude Opus 5.5",
        effort: "Max",
        access: "Full access",
        roomLeft: 23,
      }),
    ).toBe(
      "Message settings, Claude Opus 5.5, Max effort, Full access, 23% room left",
    );
    // A bot's chat has no agent choices; the room still shows.
    expect(helmAccessibleName({ roomLeft: 80 })).toBe(
      "Message settings, 80% room left",
    );
    expect(
      helmAccessibleName({ model: "Codex GPT-5", fast: true, mode: "Race" }),
    ).toBe("Message settings, Codex GPT-5, Fast, Race");
  });

  it("fills effort pips by level", () => {
    expect(effortPips(null)).toBe(0);
    expect(effortPips("Low")).toBe(1);
    expect(effortPips("Medium")).toBe(2);
    expect(effortPips("High")).toBe(3);
    expect(effortPips("Max")).toBe(4);
    expect(effortPips("X-High")).toBe(4);
  });
});

describe("files a turn changed", () => {
  const tool = (id: string, kind: string, path: string, status = "completed") =>
    ({
      id,
      role: "tool",
      text: "",
      tool: {
        callId: id,
        kind,
        title: `${kind} ${path}`,
        status,
        preview: { kind: kind === "edit" ? "write" : "read", path },
      },
    }) as unknown as Block;

  it("counts each edited file once, in the latest turn only", () => {
    const blocks = [
      { id: "u1", role: "user", text: "first" },
      tool("t1", "edit", "/a.ts"),
      { id: "u2", role: "user", text: "second" },
      tool("t2", "edit", "/b.ts"),
      tool("t3", "edit", "/b.ts"),
      tool("t4", "read", "/c.ts"),
      tool("t5", "edit", "/d.ts", "failed"),
      tool("t6", "edit", "/e.ts"),
    ] as Block[];
    expect(turnChangedFiles(blocks)).toBe(2);
  });
});

describe("the dialog's rows and keys", () => {
  it("keeps the rows in one order and leaves out what a chat lacks", () => {
    expect(
      helmRows({ critter: true, model: true, files: true, room: false }),
    ).toEqual(["model", "files", "critter"]);
  });

  it("moves the cursor with the arrow keys, wrapping at the ends", () => {
    expect(moveHelmCursor("ArrowDown", 0, 3)).toBe(1);
    expect(moveHelmCursor("ArrowDown", 2, 3)).toBe(0);
    expect(moveHelmCursor("ArrowUp", 0, 3)).toBe(2);
    expect(moveHelmCursor("End", 0, 3)).toBe(2);
    expect(moveHelmCursor("Home", 2, 3)).toBe(0);
    expect(moveHelmCursor("Enter", 1, 3)).toBeNull();
    expect(moveHelmCursor("ArrowDown", 0, 0)).toBeNull();
  });

  it("moves through a grid of critters in two directions", () => {
    // Twelve critters, six to a row.
    expect(moveGridCursor("ArrowRight", 5, 12, 6)).toBe(6);
    expect(moveGridCursor("ArrowLeft", 0, 12, 6)).toBe(11);
    expect(moveGridCursor("ArrowDown", 2, 12, 6)).toBe(8);
    expect(moveGridCursor("ArrowDown", 8, 12, 6)).toBe(2);
    expect(moveGridCursor("ArrowUp", 3, 12, 6)).toBe(9);
    expect(moveGridCursor("ArrowUp", 9, 12, 6)).toBe(3);
    // A short last row: up from the top lands on the last whole column.
    expect(moveGridCursor("ArrowUp", 4, 8, 6)).toBe(4);
    expect(moveGridCursor("ArrowUp", 1, 8, 6)).toBe(7);
    expect(moveGridCursor("Tab", 1, 12, 6)).toBeNull();
  });

  it("moves between the marks and the colour row under them", () => {
    // Twelve marks six to a row (0-11), then nine colours (12-20).
    const move = (key: string, at: number) => moveMarkCursor(key, at, 12, 6, 9);
    expect(move("ArrowDown", 2)).toBe(8);
    // Down from the last row: the colour under the cell, ends to ends.
    expect(move("ArrowDown", 6)).toBe(12);
    expect(move("ArrowDown", 11)).toBe(20);
    expect(move("ArrowDown", 8)).toBe(15);
    // Up from the top row wraps to the colours.
    expect(move("ArrowUp", 0)).toBe(12);
    // Along the colour row, wrapping within it.
    expect(move("ArrowRight", 12)).toBe(13);
    expect(move("ArrowRight", 20)).toBe(12);
    expect(move("ArrowLeft", 12)).toBe(20);
    // Up to the marks' last row, down to the first.
    expect(move("ArrowUp", 12)).toBe(6);
    expect(move("ArrowUp", 20)).toBe(11);
    expect(move("ArrowDown", 20)).toBe(5);
    // Along the marks as before.
    expect(move("ArrowRight", 5)).toBe(6);
    expect(move("ArrowLeft", 0)).toBe(11);
    expect(move("Home", 17)).toBe(0);
    expect(move("End", 3)).toBe(20);
    expect(move("Tab", 3)).toBeNull();
  });
});

describe("what the helm remembers", () => {
  it("keeps your own critter for chats outside a project", () => {
    expect(loadHelmCritter()).toEqual(DEFAULT_HELM_CRITTER);
    const heard = vi.fn();
    const stop = subscribeHelmCritter(heard);
    saveHelmCritter({ mascot: "fox", colorIndex: 2 });
    expect(JSON.parse(storage.get(HELM_CRITTER_KEY)!)).toEqual({
      mascot: "fox",
      colorIndex: 2,
    });
    expect(heard).toHaveBeenCalledOnce();
    expect(helmCritterSnapshot()).toEqual({ mascot: "fox", colorIndex: 2 });
    stop();
  });

  it("ignores a damaged choice", () => {
    storage.set(HELM_CRITTER_KEY, "{not json");
    expect(loadHelmCritter()).toEqual(DEFAULT_HELM_CRITTER);
    storage.set(
      HELM_CRITTER_KEY,
      JSON.stringify({ mascot: "owl", colorIndex: -3 }),
    );
    expect(loadHelmCritter()).toEqual({ mascot: "owl", colorIndex: null });
  });

  it("says its hint once", () => {
    expect(helmHintDue()).toBe(true);
    markHelmHintSeen();
    expect(helmHintDue()).toBe(false);
  });
});
