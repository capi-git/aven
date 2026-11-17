import { describe, expect, it } from "vitest";
import {
  asksForHelpers,
  changeBar,
  helperClock,
  helperFiles,
  helperLastLine,
  helpersOfTurn,
  helpersTabTitle,
  othersWorkedDuring,
  withHelperPane,
  withOthersWorked,
} from "./helperAgents";
import { leafIds, newTab, type WorkspaceTab } from "./layout";
import type { OrchestrationTask } from "./orchestration";
import type { Block } from "./session";

const task = (sessionId: string, turn?: string) =>
  ({ id: sessionId, sessionId, turn }) as OrchestrationTask;

describe("asking for helpers", () => {
  it("hears a plain request for agents or helpers", () => {
    expect(asksForHelpers("Start two agents side by side to fix it")).toBe(
      true,
    );
    expect(asksForHelpers("Spin up a helper for the tests")).toBe(true);
    expect(asksForHelpers("orchestrate this with two chats")).toBe(true);
    expect(asksForHelpers("Fix the hero heading")).toBe(false);
    expect(asksForHelpers("Which agent wrote this?")).toBe(false);
  });
});

describe("another chat during a turn", () => {
  const turns = [
    { sessionId: "lead", project: "/repo", cwd: "/repo", running: 1 },
    {
      sessionId: "done",
      project: "/repo",
      cwd: "/repo",
      running: 0,
      endedAt: 50,
    },
    { sessionId: "far", project: "/other", cwd: "/other", running: 1 },
  ].map((turn) => ({
    harness: "claude" as const,
    startedAt: 0,
    files: [],
    ...turn,
  }));

  it("counts other chats in the project that worked since it started", () => {
    expect(othersWorkedDuring("lead", "/repo", 40, turns)).toBe(true);
    expect(othersWorkedDuring("lead", "/repo", 60, turns)).toBe(false);
    expect(
      othersWorkedDuring("lead", "/repo/", 60, [
        ...turns,
        { ...turns[1], sessionId: "now", running: 1 },
      ]),
    ).toBe(true);
  });

  it("marks the turn's own message once", () => {
    const blocks: Block[] = [
      { id: "a", role: "user", text: "Ask" },
      { id: "b", role: "user", text: "app", internal: true },
      { id: "c", role: "assistant", text: "Reply" },
    ];
    const marked = withOthersWorked({ blocks }, true);
    expect(marked.blocks[0].othersWorked).toBe(true);
    expect(marked.blocks[1].othersWorked).toBeUndefined();
    expect(withOthersWorked(marked, true)).toBe(marked);
    expect(withOthersWorked({ blocks }, false).blocks).toBe(blocks);
  });
});

describe("the helpers tab", () => {
  const run = { leadId: "lead", tasks: [task("h1"), task("h2")] };

  it("opens beside the lead, then splits for the next helper", () => {
    const tabs: WorkspaceTab[] = [newTab("lead"), newTab("other")];
    const one = withHelperPane(tabs, run, "h1");
    expect(one.map((tab) => leafIds(tab.layout))).toEqual([
      ["lead"],
      ["h1"],
      ["other"],
    ]);
    const two = withHelperPane(one, run, "h2");
    expect(two).toHaveLength(3);
    expect(leafIds(two[1].layout)).toEqual(["h1", "h2"]);
    expect(two[1].layout).toMatchObject({ dir: "right", sizes: [0.5, 0.5] });
    expect(withHelperPane(two, run, "h2")).toBe(two);
  });

  it("is named for how many helpers it holds", () => {
    expect(helpersTabTitle(1)).toBe("1 helper");
    expect(helpersTabTitle(2)).toBe("2 helpers");
  });
});

describe("a helper's card", () => {
  const write = (path: string, additions: number, deletions = 0): Block => ({
    id: `${path}${additions}`,
    role: "tool",
    text: "",
    tool: {
      status: "completed",
      preview: { kind: "write", path, additions, deletions },
    },
  });

  it("sums each file's lines across its writes", () => {
    const files = helperFiles(
      [
        write("/repo/src/hero.css", 4, 1),
        write("/repo/notes.md", 3),
        write("/repo/src/hero.css", 2, 0),
        {
          ...write("/repo/failed.ts", 9),
          tool: {
            status: "failed",
            preview: { kind: "write", path: "/repo/failed.ts" },
          },
        },
      ],
      "/repo",
    );
    expect(files).toEqual([
      {
        path: "/repo/src/hero.css",
        label: "src/hero.css",
        additions: 6,
        deletions: 1,
      },
      { path: "/repo/notes.md", label: "notes.md", additions: 3, deletions: 0 },
    ]);
  });

  it("names a file from the project, by either name of a macOS folder", () => {
    const [file] = helperFiles(
      [write("/private/var/folders/x/project/hero.css", 1)],
      "/var/folders/x/project",
    );
    expect(file.label).toBe("hero.css");
  });

  it("splits the five-segment bar between added and removed lines", () => {
    expect(changeBar(2, 1)).toBe(3);
    expect(changeBar(5, 0)).toBe(5);
    expect(changeBar(100, 1)).toBe(4);
    expect(changeBar(1, 100)).toBe(1);
    expect(changeBar(0, 3)).toBe(0);
    expect(changeBar(0, 0)).toBe(0);
  });

  it("shows the helper's last line, without Markdown marks", () => {
    expect(
      helperLastLine([
        { id: "a", role: "assistant", text: "Earlier" },
        {
          id: "b",
          role: "assistant",
          text: "I changed it.\n\n- **Done**: `hero.css`",
        },
        { id: "c", role: "assistant", text: "  " },
      ]),
    ).toBe("Done: hero.css");
  });

  it("reads its time as minutes and seconds", () => {
    expect(helperClock(6_400)).toBe("0:06");
    expect(helperClock(75_000)).toBe("1:15");
    expect(helperClock(3_725_000)).toBe("1:02:05");
  });

  it("belongs to the reply of the message that started it", () => {
    const run = { tasks: [task("a", "t1"), task("b", "t2"), task("c", "t1")] };
    expect(helpersOfTurn(run, "t1").map((entry) => entry.id)).toEqual([
      "a",
      "c",
    ]);
    expect(helpersOfTurn(run, undefined)).toEqual([]);
  });
});
