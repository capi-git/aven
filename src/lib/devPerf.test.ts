import { describe, expect, it } from "vitest";
import { processUse, spread, type ProcessSample } from "./devPerf";

function sample(
  pid: number,
  ppid: number,
  name: string,
  cpuMs: number,
  idleWakeups: number,
  footprintMB: number,
): ProcessSample {
  return {
    pid,
    ppid,
    name,
    cpuNs: cpuMs * 1e6,
    idleWakeups,
    interruptWakeups: 0,
    footprint: footprintMB * 1024 * 1024,
  };
}

describe("spread", () => {
  it("reports the median, 95th percentile and worst value", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(spread(values)).toEqual({ n: 100, p50: 50, p95: 95, max: 100 });
    expect(spread([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
  });
});

describe("processUse", () => {
  it("counts Aven's own processes and keeps what it started apart", () => {
    const before = {
      at: 0,
      processes: [
        sample(10, 0, "aven", 100, 10, 80),
        sample(20, 10, "com.apple.WebKit.WebContent", 50, 0, 150),
        sample(30, 10, "Aven Dev Helper (Renderer)", 0, 0, 60),
        sample(40, 10, "python3", 0, 0, 12),
      ],
    };
    const after = {
      at: 2_000,
      processes: [
        sample(10, 0, "aven", 300, 30, 82),
        sample(20, 10, "com.apple.WebKit.WebContent", 250, 10, 160),
        sample(30, 10, "Aven Dev Helper (Renderer)", 100, 0, 70),
        sample(40, 10, "python3", 900, 0, 14),
      ],
    };
    const use = processUse(before, after);
    // 200 + 200 + 100 ms of CPU over 2 s is 25% of one core.
    expect(use.cpuPct).toBe(25);
    expect(use.idleWakeupsPerSec).toBe(15);
    expect(use.footprintMB).toBe(312);
    expect(use.startedFootprintMB).toBe(14);
    expect(Object.keys(use.byKind).sort()).toEqual([
      "browser-renderer",
      "main",
      "webkit-content",
    ]);
    expect(use.busiest).toMatchObject({ name: "aven", cpuPct: 10 });
  });
});
