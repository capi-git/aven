import { describe, expect, it } from "vitest";
import {
  lastEndedRun,
  runDuration,
  runningRowEnd,
  scriptRunPort,
  type ScriptRun,
} from "./projectScripts";

const NOW = 1_800_000_000_000;
const run = (change: Partial<ScriptRun>): ScriptRun => ({
  key: "run:/p:Dev",
  kind: "run",
  name: "Dev",
  command: "npm run dev",
  cwd: "/p",
  state: "running",
  code: null,
  output: "",
  ...change,
});

describe("run card wording", () => {
  it("says how long a run has gone on", () => {
    expect(runDuration(NOW - 30_000, NOW)).toBe("30s");
    expect(runDuration(NOW - 41 * 60_000, NOW)).toBe("41m");
    expect(runDuration(NOW - 125 * 60_000, NOW)).toBe("2h 5m");
    expect(runDuration(NOW - 120 * 60_000, NOW)).toBe("2h");
    expect(runDuration(undefined, NOW)).toBe("");
  });

  it("puts the announced port before the time, when there is one", () => {
    const vite = run({
      startedAt: NOW - 41 * 60_000,
      output:
        "\u001b[32m  VITE v6.0.0\u001b[0m\n\n  ➜  Local:   http://localhost:5173/\n",
    });
    expect(scriptRunPort(vite)).toBe(5173);
    expect(runningRowEnd(vite, NOW)).toBe(":5173 · 41m");
    const tests = run({ startedAt: NOW - 12 * 60_000, output: "PASS 3\n" });
    expect(scriptRunPort(tests)).toBeNull();
    expect(runningRowEnd(tests, NOW)).toBe("12m");
  });

  it("finds the run that ended last", () => {
    const passed = run({ key: "a", state: "done", endedAt: NOW - 1000 });
    const failed = run({ key: "b", state: "failed", endedAt: NOW - 5000 });
    expect(lastEndedRun([failed, run({}), passed])).toBe(passed);
    expect(lastEndedRun([run({})])).toBeUndefined();
  });
});
