// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetTurnNotes,
  pendingTurnNotes,
  queueTurnNote,
  takeTurnNotes,
  TURN_NOTE_LIMIT,
  turnNotesBlock,
} from "./turnNotes";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("turn notes", () => {
  it("rides ahead of the chat's next message once, then is gone", () => {
    queueTurnNote("a", { kind: "ship", text: "Shipped as 4c19b02.", at: 1 });
    const first = takeTurnNotes("a", "What next?");
    expect(first.text).toBe(
      "<aven-note>\nFrom Aven, about this chat. The user's message follows.\nShipped as 4c19b02.\n</aven-note>\n\nWhat next?",
    );
    expect(takeTurnNotes("a", "And then?").text).toBe("And then?");
    // Other chats never hear it.
    queueTurnNote("a", { kind: "ship", text: "Again.", at: 2 });
    expect(takeTurnNotes("b", "Hi").text).toBe("Hi");
  });

  it("keeps one note of each kind, the newest", () => {
    queueTurnNote("a", { kind: "ship", text: "First ship.", at: 1 });
    queueTurnNote("a", { kind: "race", text: "Kept yours.", at: 2 });
    queueTurnNote("a", { kind: "ship", text: "Second ship.", at: 3 });
    expect(pendingTurnNotes("a").map((note) => note.text)).toEqual([
      "Kept yours.",
      "Second ship.",
    ]);
    expect(takeTurnNotes("a", "Go").text).toContain(
      "- Kept yours.\n- Second ship.",
    );
  });

  it("leaves a provider command untouched and the notes waiting", () => {
    queueTurnNote("a", { kind: "ship", text: "Shipped.", at: 1 });
    expect(takeTurnNotes("a", "  /compact").text).toBe("  /compact");
    expect(pendingTurnNotes("a")).toHaveLength(1);
  });

  it("puts the notes back when the message never reached the agent", () => {
    queueTurnNote("a", { kind: "ship", text: "Old ship.", at: 1 });
    queueTurnNote("a", { kind: "race", text: "Kept yours.", at: 2 });
    const taken = takeTurnNotes("a", "Go");
    expect(pendingTurnNotes("a")).toEqual([]);
    // A newer ship arrived meanwhile: it wins over the one restored.
    queueTurnNote("a", { kind: "ship", text: "New ship.", at: 3 });
    taken.restore();
    expect(pendingTurnNotes("a").map((note) => note.text)).toEqual([
      "Kept yours.",
      "New ship.",
    ]);
  });

  it("survives a restart and is dropped with its chat", async () => {
    queueTurnNote("a", {
      kind: "race",
      text: "Kept yours.",
      hint: "Codex knows which version you kept",
      at: 5,
    });
    vi.resetModules();
    const fresh = await import("./turnNotes");
    expect(fresh.pendingTurnNotes("a")).toEqual([
      {
        kind: "race",
        text: "Kept yours.",
        hint: "Codex knows which version you kept",
        at: 5,
      },
    ]);
    fresh.forgetTurnNotes("a");
    expect(fresh.pendingTurnNotes("a")).toEqual([]);
    forgetTurnNotes("a");
  });

  it("clips a long note and ignores an empty one", () => {
    queueTurnNote("a", { kind: "race", text: "   ", at: 1 });
    expect(pendingTurnNotes("a")).toEqual([]);
    queueTurnNote("a", { kind: "race", text: "x".repeat(9_000), at: 1 });
    expect(pendingTurnNotes("a")[0].text).toHaveLength(TURN_NOTE_LIMIT);
    expect(turnNotesBlock([])).toBe("");
  });
});
