import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => mocks.tauri,
}));

import type { Block, Session } from "./session";
import {
  endedTurns,
  referencedTurnShots,
  tidyTurnShots,
  TURN_START_SLACK_MS,
  turnShotNames,
} from "./turnShots";

const DIR =
  "/Users/jack/Library/Application Support/com.capi.monocode.personal/turn-shots/s1";

function session(id: string, blocks: Block[] = []): Session {
  return {
    id,
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "supervised",
    title: id,
    cwd: "/w",
    blocks,
  } as Session;
}

describe("turnShotNames", () => {
  it("finds screenshot names however the agent wrote the path", () => {
    expect(
      turnShotNames(
        [
          `![Before](<${DIR}/1792438599200-before.jpg>)`,
          `![After](${DIR.replaceAll(" ", "%20")}/1792438599300-after.jpg)`,
          "See `~/Library/Application Support/com.capi.aven.dev/turn-shots/s1/1792438599400-page-2.JPG`.",
          "C:\\Users\\jack\\AppData\\Roaming\\com.capi.monocode.personal\\turn-shots\\s1\\1792438599500-page.png",
          "Just the name: 1792438599600-preview-login.jpeg, then more text.",
        ].join("\n"),
      ),
    ).toEqual([
      "1792438599200-before.jpg",
      "1792438599300-after.jpg",
      "1792438599400-page-2.jpg",
      "1792438599500-page.png",
      "1792438599600-preview-login.jpeg",
    ]);
  });

  it("ignores text that is not a screenshot name", () => {
    expect(
      turnShotNames(
        "logo.png, 1792438599200-page.gif, 1792438599200-page.jpgx, -page.jpg, 1792438599200.jpg",
      ),
    ).toEqual([]);
  });
});

describe("referencedTurnShots", () => {
  it("counts the chat's messages and attachments, never tool output or reasoning", () => {
    const blocks: Block[] = [
      {
        id: "u",
        role: "user",
        text: "Compare with 1792438599100-labelled.jpg",
        attachments: [
          {
            id: "a",
            name: "1792438599150-page.jpg",
            mimeType: "image/jpeg",
            kind: "image",
            size: 1,
            path: `${DIR}/1792438599150-page.jpg`,
          },
        ],
      },
      {
        id: "t",
        role: "tool",
        text: `{"path":"${DIR}/1792438599200-page.jpg"}`,
        tool: { detail: `${DIR}/1792438599200-page.jpg` },
      },
      { id: "r", role: "reasoning", text: "Maybe 1792438599300-page.jpg" },
      { id: "p", role: "approval", text: "Allow 1792438599400-page.jpg?" },
      {
        id: "a",
        role: "assistant",
        text: `Done.\n\n![Screenshot](<${DIR}/1792438599500-page.jpg>)`,
      },
      { id: "s", role: "system", text: "Earlier: 1792438599600-page.png" },
    ];
    expect(referencedTurnShots(blocks).sort()).toEqual([
      "1792438599100-labelled.jpg",
      "1792438599150-page.jpg",
      "1792438599500-page.jpg",
      "1792438599600-page.png",
    ]);
  });
});

describe("endedTurns", () => {
  it("tidies a chat once it stops working, from when it was first seen", () => {
    const shown: Block = {
      id: "a",
      role: "assistant",
      text: `![After](<${DIR}/1792438599500-after.jpg>)`,
    };
    const chats = [session("s1", [shown]), session("s2")];
    const started = endedTurns(new Map(), new Set(["s1"]), chats, 10_000);
    expect(started.ended).toEqual([]);
    expect([...started.working]).toEqual([
      ["s1", 10_000 - TURN_START_SLACK_MS],
    ]);

    // Still working: the start stays, nothing is tidied.
    const still = endedTurns(
      started.working,
      new Set(["s1", "s2"]),
      chats,
      20_000,
    );
    expect(still.ended).toEqual([]);
    expect([...still.working]).toEqual([
      ["s1", 10_000 - TURN_START_SLACK_MS],
      ["s2", 20_000 - TURN_START_SLACK_MS],
    ]);

    const stopped = endedTurns(still.working, new Set(["s2"]), chats, 30_000);
    expect(stopped.ended).toEqual([
      {
        sessionId: "s1",
        from: 10_000 - TURN_START_SLACK_MS,
        to: 30_000,
        referenced: ["1792438599500-after.jpg"],
      },
    ]);
    expect([...stopped.working]).toEqual([
      ["s2", 20_000 - TURN_START_SLACK_MS],
    ]);
  });

  it("keeps the screenshots of a chat that is no longer loaded", () => {
    const working = new Map([["gone", 1_000]]);
    const result = endedTurns(working, new Set(), [session("other")], 5_000);
    expect(result.ended).toEqual([]);
    expect(result.working.size).toBe(0);
  });
});

describe("tidyTurnShots", () => {
  it("asks the app to tidy, and does nothing outside it", async () => {
    const request = {
      sessionId: "s1",
      from: 1,
      to: 2,
      referenced: ["1-page.jpg"],
    };
    await tidyTurnShots(request);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "turn_shots_tidy",
      request,
    );
    mocks.tauri = false;
    await tidyTurnShots(request);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    mocks.tauri = true;
  });
});
