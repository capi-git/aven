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

describe("Aven's own data folder in the doing line", () => {
  const shot =
    "/Users/jack/Library/Application Support/com.capi.monocode.personal/turn-shots/s1/1-after.png";
  const reading = (block: Session["blocks"][number]): Session => ({
    ...newSession("claude", "/work/site"),
    busy: true,
    blocks: [{ id: "u", role: "user", text: "Check it" }, block],
  });

  it("names a picture Aven took as Aven data", () => {
    const session = reading({
      id: "t",
      role: "tool",
      text: "Read",
      tool: {
        kind: "read",
        status: "in_progress",
        preview: { kind: "read", path: shot, fileName: "1-after.png" },
      },
    });
    expect(sessionDoing(session)).toBe(
      "Read Aven data/turn-shots/s1/1-after.png",
    );
    // The chat itself still holds the real path.
    expect(session.blocks[1].tool?.preview?.path).toBe(shot);
  });

  it("names it in a line the harness wrote", () => {
    expect(
      currentActivity(
        reading({
          id: "t",
          role: "tool",
          text: "Reading ~/Library/Application Support/com.capi.aven.dev/turn-shots/s1/1-after.png",
          tool: { kind: "other", status: "in_progress" },
        }),
      ),
    ).toBe("Reading Aven data/turn-shots/s1/1-after.png");
  });
});
