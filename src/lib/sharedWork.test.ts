import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "./harness/types";
import {
  editOverlapsSnapshot,
  forgetSharedWorkSession,
  installSharedWorkSessions,
  observeSharedWorkEvent,
  overlapSentence,
  resetSharedWork,
  sharedWorkTurnEnded,
  sharedWorkTurnStarted,
  sharedWorkTurns,
  subscribeSharedWork,
} from "./sharedWork";

const SITE = "/Users/me/site";
const API = "/Users/me/api";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetSharedWork();
});

afterEach(() => {
  resetSharedWork();
  vi.unstubAllGlobals();
});

function edit(sessionId: string, path: string, callId = path): void {
  const event: HarnessEvent = {
    type: "tool.started",
    callId,
    title: `Edit ${path}`,
    kind: "edit",
    paths: [path],
  };
  observeSharedWorkEvent(sessionId, event);
}

function turn(
  sessionId: string,
  cwd = SITE,
  harness: "claude" | "codex" = "claude",
) {
  sharedWorkTurnStarted({ sessionId, harness, cwd });
}

function files(sessionId: string) {
  return sharedWorkTurns().find((entry) => entry.sessionId === sessionId)
    ?.files;
}

describe("turns and edited files", () => {
  it("records the files a turn edits, resolved and once each", () => {
    turn("a");
    edit("a", "src/App.tsx");
    edit("a", `${SITE}/src/App.tsx`, "again");
    observeSharedWorkEvent("a", {
      type: "tool.updated",
      callId: "w",
      kind: "other",
      title: "Write notes.md",
      preview: { kind: "write", path: "notes.md" },
    });
    expect(files("a")).toEqual([`${SITE}/src/App.tsx`, `${SITE}/notes.md`]);
  });

  it("ignores reads, shell commands and chats without a turn", () => {
    turn("a");
    observeSharedWorkEvent("a", {
      type: "tool.started",
      callId: "r",
      title: "Read src/App.tsx",
      kind: "read",
      paths: ["src/App.tsx"],
    });
    observeSharedWorkEvent("a", {
      type: "tool.started",
      callId: "s",
      title: "npm test",
      kind: "execute",
    });
    observeSharedWorkEvent("a", { type: "message.delta", text: "Edit" });
    edit("nobody", "src/App.tsx");
    expect(files("a")).toEqual([]);
    expect(files("nobody")).toBeUndefined();
  });

  it("starts each turn afresh but keeps files for a turn queued behind it", () => {
    turn("a");
    edit("a", "one.ts");
    turn("a");
    sharedWorkTurnEnded("a");
    expect(files("a")).toEqual([`${SITE}/one.ts`]);
    sharedWorkTurnEnded("a", 1_000);
    const ended = sharedWorkTurns()[0];
    expect(ended.running).toBe(0);
    expect(ended.endedAt).toBe(1_000);
    expect(ended.files).toEqual([`${SITE}/one.ts`]);
    turn("a");
    expect(files("a")).toEqual([]);
  });

  it("reads the chat's project from the workspace", () => {
    installSharedWorkSessions((id) =>
      id === "a"
        ? {
            harness: "claude",
            title: "Fix login",
            project: SITE,
            cwd: `${SITE}/packages/web`,
            runtimeMode: "supervised",
          }
        : undefined,
    );
    turn("a", `${SITE}/packages/web`);
    expect(sharedWorkTurns()[0].project).toBe(SITE);
  });
});

describe("same-file overlaps", () => {
  it("flags two working chats in one project editing the same file", () => {
    turn("a");
    turn("b", SITE, "codex");
    edit("a", "src/App.tsx");
    edit("b", "src/other.ts");
    expect(editOverlapsSnapshot()).toEqual({});
    edit("b", "src/App.tsx");
    expect(editOverlapsSnapshot()).toEqual({
      a: [{ sessionId: "b", harness: "codex", files: ["src/App.tsx"] }],
      b: [{ sessionId: "a", harness: "claude", files: ["src/App.tsx"] }],
    });
    expect(overlapSentence(editOverlapsSnapshot().a)).toBe(
      "Codex is also editing src/App.tsx",
    );
  });

  it("leaves other projects and finished turns alone", () => {
    turn("a");
    turn("c", API, "codex");
    edit("a", "src/App.tsx");
    edit("c", `${SITE}/src/App.tsx`);
    expect(editOverlapsSnapshot()).toEqual({});

    turn("b", SITE, "codex");
    edit("b", "src/App.tsx");
    expect(Object.keys(editOverlapsSnapshot()).sort()).toEqual(["a", "b"]);
    sharedWorkTurnEnded("b");
    expect(editOverlapsSnapshot()).toEqual({});
  });

  it("clears when a chat is closed", () => {
    turn("a");
    turn("b", SITE, "codex");
    edit("a", "x.ts");
    edit("b", "x.ts");
    forgetSharedWorkSession("b");
    expect(editOverlapsSnapshot()).toEqual({});
  });

  it("keeps its identity and stays quiet until an overlap changes", () => {
    const listener = vi.fn();
    subscribeSharedWork(listener);
    turn("a");
    turn("b", SITE, "codex");
    edit("a", "x.ts");
    edit("b", "y.ts");
    expect(listener).not.toHaveBeenCalled();
    edit("b", "x.ts");
    expect(listener).toHaveBeenCalledTimes(1);
    const first = editOverlapsSnapshot();
    const entry = first.a;
    edit("a", "z.ts");
    edit("b", "w.ts");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editOverlapsSnapshot()).toBe(first);
    turn("c", SITE, "claude");
    edit("c", "q.ts");
    expect(editOverlapsSnapshot().a).toBe(entry);
  });

  it("names several agents and files in one line", () => {
    expect(
      overlapSentence([
        { sessionId: "b", harness: "codex", files: ["a.ts", "b.ts"] },
        { sessionId: "c", harness: "claude", files: ["a.ts"] },
      ]),
    ).toBe("Codex and Claude are also editing a.ts and 1 more file");
  });
});
