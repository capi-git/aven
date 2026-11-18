import { describe, expect, it } from "vitest";
import {
  formatGigabytes,
  formatGroup,
  formatMemoryOf,
  formatPercent,
  memoryShare,
} from "./machineStats";

const GB = 1024 ** 3;

describe("machine stats wording", () => {
  it("says memory as Activity Monitor does", () => {
    expect(formatMemoryOf(11.2 * GB, 32 * GB)).toBe("11.2 of 32 GB");
    expect(formatGigabytes(0.42 * GB)).toBe("0.4");
    expect(formatGigabytes(128 * GB)).toBe("128");
  });

  it("gives a group's CPU and memory, or memory alone before CPU is known", () => {
    expect(formatGroup({ cpuPercent: 6.4, memory: 2.1 * GB })).toBe(
      "6% · 2.1 GB",
    );
    expect(formatGroup({ cpuPercent: null, memory: 2 * GB })).toBe("2 GB");
    expect(formatPercent(0.3)).toBe("<1%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("fills the memory bar by share", () => {
    const stats = {
      cpuPercent: 1,
      memoryUsed: 8 * GB,
      memoryTotal: 32 * GB,
      aven: null,
      scripts: null,
    };
    expect(memoryShare(stats)).toBe(25);
    expect(memoryShare({ ...stats, memoryTotal: 0 })).toBe(0);
  });
});

describe("This Mac reply", () => {
  it("keeps only a reading the card can draw", async () => {
    const { parseMachineStats } = await import("./machineStats");
    expect(parseMachineStats(undefined)).toBeNull();
    expect(parseMachineStats({ cpuPercent: 3 })).toBeNull();
    expect(
      parseMachineStats({
        cpuPercent: null,
        memoryUsed: 5,
        memoryTotal: 10,
        aven: { cpuPercent: "x", memory: 2 },
        scripts: "no",
      }),
    ).toEqual({
      cpuPercent: null,
      memoryUsed: 5,
      memoryTotal: 10,
      aven: { cpuPercent: null, memory: 2 },
      scripts: null,
    });
  });
});
