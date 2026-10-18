import { describe, expect, it } from "vitest";
import { newSession, type Session } from "./session";
import { currentActivity, sessionDoing } from "./sessionDoing";

const working = (command: string): Session => ({
  ...newSession("claude", "/work/site"),
  busy: true,
  blocks: [
    { id: "u", role: "user", text: "Coordinate it" },
    {
      id: "t",
      role: "tool",
      text: command,
      tool: { kind: "execute", title: command, status: "in_progress" },
    },
  ],
});

describe("what a working chat is doing", () => {
  it("says a lead's coordination commands in plain words", () => {
    const session = working(
      `A='/Users/jack/Developer/.worktrees/Aven/x/target/debug/aven'; "$A" control wait --json '{"timeoutSeconds":120}'`,
    );
    expect(sessionDoing(session)).toBe("Waiting for the agents");
    expect(currentActivity(session)).toBe("Waiting for the agents");
  });

  it("starts no line with a setting or a long path", () => {
    expect(
      sessionDoing(
        working("NODE_ENV=test /Users/jack/site/node_modules/.bin/vitest run"),
      ),
    ).toBe("vitest run");
  });
});
