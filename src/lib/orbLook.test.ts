import { describe, expect, it } from "vitest";
import { orbLook, sessionOrbActivity } from "./orbLook";
import type { Block, Session } from "./session";

function session(blocks: Partial<Block>[], extra: Partial<Session> = {}) {
  return {
    id: "s",
    cwd: "/p",
    busy: true,
    blocks: [{ id: "u", role: "user", text: "go" }, ...blocks],
    ...extra,
  } as unknown as Session;
}

const tool = (title: string, tool: Record<string, unknown> = {}) =>
  ({
    id: title,
    role: "tool",
    text: title,
    tool: { title, status: "in_progress", ...tool },
  }) as Partial<Block>;

describe("sessionOrbActivity", () => {
  it("thinks before anything happens, and while it reasons", () => {
    expect(sessionOrbActivity(session([]))).toBe("reasoning");
    expect(
      sessionOrbActivity(session([{ id: "r", role: "reasoning", text: "" }])),
    ).toBe("reasoning");
  });

  it("is plain work while it writes or edits", () => {
    expect(
      sessionOrbActivity(session([{ id: "a", role: "assistant", text: "Hi" }])),
    ).toBeUndefined();
    expect(
      sessionOrbActivity(
        session([
          tool("Read src/chrome/Composer.tsx", {
            kind: "read",
            preview: { kind: "read", path: "/p/src/chrome/Composer.tsx" },
          }),
        ]),
      ),
    ).toBeUndefined();
  });

  it("searches, and uses a browser", () => {
    expect(
      sessionOrbActivity(
        session([
          tool("Grep", { kind: "search", preview: { kind: "search" } }),
        ]),
      ),
    ).toBe("searching");
    expect(
      sessionOrbActivity(session([tool("mcp__aven_browser__screenshot")])),
    ).toBe("using");
  });

  it("reads only the turn since your last message", () => {
    expect(
      sessionOrbActivity(
        session([
          { id: "r", role: "reasoning", text: "" },
          { id: "u2", role: "user", text: "and" },
        ]),
      ),
    ).toBe("reasoning");
  });
});

describe("orbLook", () => {
  it("moves only while the state lasts until it changes", () => {
    expect(orbLook("still").moving).toBe(false);
    expect(orbLook("resting").moving).toBe(false);
    expect(orbLook("ready").moving).toBe(false);
    expect(orbLook("working").moving).toBe(true);
    expect(orbLook("needs").moving).toBe(true);
    expect(orbLook("watching")).toMatchObject({ state: "waiting" });
    expect(orbLook("working", "searching")).toMatchObject({
      state: "searching",
    });
  });
});
