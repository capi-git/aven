import { describe, expect, it } from "vitest";
import type { DevPreview } from "./devPreviews";
import type { RaceRecord } from "./race";
import { racePreviewLabel, racePreviewTitle } from "./racePreviews";

const race = (patch: Partial<RaceRecord> = {}): RaceRecord => ({
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix it",
  createdAt: 1,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [
    {
      sessionId: "lane-0",
      harness: "claude",
      model: "m",
      label: "Claude Code · Opus",
      path: "/data/races/r1/0",
      branch: "aven/race/r1-0",
    },
    {
      sessionId: "lane-1",
      harness: "codex",
      model: "m",
      label: "Codex · GPT-6.1-Sol",
      path: "/data/races/r1/1",
      branch: "aven/race/r1-1",
    },
  ],
  ...patch,
});

const preview = (patch: Partial<DevPreview>): DevPreview =>
  ({
    key: "k",
    project: "/work/site",
    cwd: "/work/site",
    folder: "/work/site",
    url: "http://localhost:5173/",
    label: "site",
    port: 5173,
    status: "live",
    source: "agent",
    ...patch,
  }) as DevPreview;

describe("a race agent's page", () => {
  it("says whose version it shows, by the agent that started its server", () => {
    const previews = [
      preview({
        url: "http://localhost:5174/",
        port: 5174,
        sessionId: "lane-1",
      }),
    ];
    expect(
      racePreviewLabel("http://127.0.0.1:5174/settings", previews, [race()]),
    ).toBe("Codex's version");
    expect(racePreviewTitle("Site", "Codex's version")).toBe(
      "Site · Codex's version",
    );
  });

  it("knows a server run from inside a lane's copy, whoever started it", () => {
    const previews = [
      preview({
        source: "terminal",
        cwd: "/data/races/r1/0/web",
        folder: "/data/races/r1/0/web",
      }),
    ];
    expect(racePreviewLabel("http://localhost:5173/", previews, [race()])).toBe(
      "Claude's version",
    );
  });

  it("says nothing for the project's own server, a stopped one or a race that ended", () => {
    expect(
      racePreviewLabel("http://localhost:5173/", [preview({})], [race()]),
    ).toBeUndefined();
    const lane = [preview({ sessionId: "lane-1" })];
    expect(
      racePreviewLabel("http://localhost:5173/", lane, [
        race({ state: "kept" }),
      ]),
    ).toBeUndefined();
    expect(
      racePreviewLabel(
        "http://localhost:5173/",
        [preview({ sessionId: "lane-1", status: "stale" })],
        [race()],
      ),
    ).toBeUndefined();
    expect(racePreviewLabel("about:blank", lane, [race()])).toBeUndefined();
    expect(racePreviewTitle("Site")).toBe("Site");
  });
});
