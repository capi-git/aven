import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STREAK_STORAGE_KEY,
  activityStreak,
  completedDays,
  dayKey,
  loadStreakDays,
  noteActiveDay,
  noteActiveDays,
} from "./activityStreak";

const at = (month: number, date: number, hour = 12, minute = 0) =>
  new Date(2026, month - 1, date, hour, minute).getTime();

let storage: Map<string, string>;
let writes: number;

beforeEach(() => {
  storage = new Map();
  writes = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  });
});

describe("days", () => {
  it("names local calendar days, including the minute before midnight", () => {
    expect(dayKey(at(10, 15, 0, 0))).toBe("2026-10-15");
    expect(dayKey(at(10, 15, 23, 59))).toBe("2026-10-15");
    expect(dayKey(at(1, 2, 0, 1))).toBe("2026-01-02");
  });

  it("counts only completed tasks", () => {
    expect(
      completedDays([
        { outcome: "completed", createdAt: at(10, 14, 23, 59) },
        { outcome: "failed", createdAt: at(10, 13) },
        { outcome: "stopped", createdAt: at(10, 12) },
        { outcome: "completed", createdAt: at(10, 15, 0, 1) },
        { outcome: "completed", createdAt: at(10, 15, 9) },
      ]),
    ).toEqual(["2026-10-14", "2026-10-15"]);
  });

  it("remembers days beyond the ledger and writes only when one is new", () => {
    noteActiveDays(["2026-10-01", "2026-10-02"]);
    expect(writes).toBe(1);
    noteActiveDays(["2026-10-02"]);
    noteActiveDay(at(10, 1, 8));
    expect(writes).toBe(1);
    noteActiveDay(at(10, 3, 8));
    expect(loadStreakDays()).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(JSON.parse(storage.get(STREAK_STORAGE_KEY)!).version).toBe(1);
  });

  it("ignores a damaged record", () => {
    storage.set(STREAK_STORAGE_KEY, "{");
    expect(loadStreakDays()).toEqual([]);
    storage.set(
      STREAK_STORAGE_KEY,
      JSON.stringify({ days: ["2026-10-01", 4, "nope"] }),
    );
    expect(loadStreakDays()).toEqual(["2026-10-01"]);
  });
});

describe("streak", () => {
  const days = ["2026-10-11", "2026-10-13", "2026-10-14", "2026-10-15"];

  it("counts consecutive days ending today", () => {
    expect(activityStreak(days, at(10, 15, 9))).toEqual({
      days: 3,
      today: true,
    });
  });

  it("stays alive through today until a whole day passes without a task", () => {
    expect(activityStreak(days.slice(0, 3), at(10, 15, 23, 59))).toEqual({
      days: 2,
      today: false,
    });
    expect(activityStreak(days.slice(0, 3), at(10, 16, 0, 1))).toEqual({
      days: 0,
      today: false,
    });
  });

  it("breaks at a gap", () => {
    expect(activityStreak(["2026-10-11", "2026-10-13"], at(10, 13))).toEqual({
      days: 1,
      today: true,
    });
    expect(activityStreak([], at(10, 13))).toEqual({ days: 0, today: false });
  });

  it("crosses month ends and daylight-saving changes", () => {
    expect(
      activityStreak(
        ["2026-02-27", "2026-02-28", "2026-03-01"],
        at(3, 1, 0, 30),
      ).days,
    ).toBe(3);
    // Clocks change on the last Sunday of October in Europe and the first
    // Sunday of November in the US; either way each day counts once.
    const autumn = [
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ];
    expect(activityStreak(autumn, at(10, 26, 23)).days).toBe(3);
    expect(activityStreak(autumn, at(11, 2, 1)).days).toBe(3);
  });
});
