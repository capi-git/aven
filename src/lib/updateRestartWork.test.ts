import { describe, expect, it } from "vitest";
import {
  answerRestartDecision,
  describeRestartWork,
  getRestartDecision,
  hasRestartWork,
  mergeRestartWork,
  NO_RESTART_WORK,
  plainList,
  readWindowWork,
  requestRestartDecision,
  restartWaitReason,
  type RestartWork,
} from "./updateRestartWork";

const agent = (
  title: string,
  project: string,
  state: "working" | "waiting" | "queued" = "working",
) => ({ id: title, title, project, state });

describe("describing work a restart would interrupt", () => {
  it("lists agents, terminals and files in plain words", () => {
    const work: RestartWork = {
      agents: [
        agent("Fix login", "Aven"),
        agent("Review PR", "Cadence"),
        agent("Deploy", "Aven", "waiting"),
        agent("Docs", "", "queued"),
      ],
      terminals: [{ id: "t1", command: "npm" }],
      files: [{ id: "f1", name: "App.tsx", project: "Aven" }],
    };
    expect(describeRestartWork(work)).toEqual([
      "2 agents are working: Fix login (Aven) and Review PR (Cadence)",
      "1 agent is waiting for your answer: Deploy (Aven)",
      "1 agent has messages waiting to send: Docs",
      "1 terminal is running npm",
      "1 file has unsaved changes: App.tsx (Aven)",
    ]);
    expect(hasRestartWork(work)).toBe(true);
    expect(hasRestartWork(NO_RESTART_WORK)).toBe(false);
  });

  it("keeps long lists short", () => {
    expect(plainList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
    expect(plainList(["a", "b"])).toBe("a and b");
    expect(
      describeRestartWork({
        ...NO_RESTART_WORK,
        terminals: [
          { id: "1", command: "npm" },
          { id: "2", command: "npm" },
          { id: "3", command: "vite" },
        ],
      }),
    ).toEqual(["3 terminals are running npm and vite"]);
  });

  it("says what a waiting restart waits for", () => {
    expect(
      restartWaitReason({ ...NO_RESTART_WORK, agents: [agent("a", "")] }),
    ).toBe("your agent finishes");
    expect(
      restartWaitReason({
        ...NO_RESTART_WORK,
        agents: [agent("a", ""), agent("b", "")],
      }),
    ).toBe("your agents finish");
    expect(
      restartWaitReason({
        ...NO_RESTART_WORK,
        terminals: [{ id: "1", command: "npm" }],
      }),
    ).toBe("your terminal command finishes");
    expect(
      restartWaitReason({
        ...NO_RESTART_WORK,
        files: [{ id: "1", name: "a.ts", project: "" }],
      }),
    ).toBe("your file is saved");
    expect(
      restartWaitReason({
        ...NO_RESTART_WORK,
        agents: [agent("a", "")],
        terminals: [{ id: "1", command: "npm" }],
      }),
    ).toBe("your work finishes");
  });
});

describe("reports from other windows", () => {
  it("accepts only well-formed agents and files", () => {
    expect(
      readWindowWork({
        agents: [
          agent("Fix login", "Aven"),
          { id: "x", state: "sleeping" },
          { title: "no id", state: "working" },
          "junk",
        ],
        files: [{ id: "f", name: "" }, null],
      }),
    ).toEqual({
      agents: [agent("Fix login", "Aven")],
      files: [{ id: "f", name: "a file", project: "" }],
    });
    expect(readWindowWork(null)).toEqual({ agents: [], files: [] });
  });

  it("merges windows without listing the same work twice", () => {
    const own = { agents: [agent("Fix login", "Aven")], files: [] };
    const other = {
      agents: [agent("Fix login", "Aven"), agent("Review", "Cadence")],
      files: [{ id: "f", name: "a.ts", project: "" }],
    };
    expect(
      mergeRestartWork(own, [other], [{ id: "t", command: "npm" }]),
    ).toEqual({
      agents: [agent("Fix login", "Aven"), agent("Review", "Cadence")],
      terminals: [{ id: "t", command: "npm" }],
      files: [{ id: "f", name: "a.ts", project: "" }],
    });
  });
});

describe("the restart question", () => {
  it("asks once, shares the answer and clears", async () => {
    const work = { ...NO_RESTART_WORK, agents: [agent("a", "")] };
    const first = requestRestartDecision(work);
    const second = requestRestartDecision(work, true);
    // Asking again from "Restart now" puts stopping first.
    expect(getRestartDecision()).toEqual({ work, now: true });
    answerRestartDecision("wait");
    await expect(first).resolves.toBe("wait");
    await expect(second).resolves.toBe("wait");
    expect(getRestartDecision()).toBeNull();
    answerRestartDecision("stop");
  });
});
