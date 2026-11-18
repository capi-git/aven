import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCost,
  CHAT_COST_KEY,
  costSummary,
  dayKey,
  emptyLedger,
  formatUsd,
  loadCostLedger,
  recordClaudeCost,
  turnCost,
} from "./chatCost";

// Wednesday 2026-11-18, midday local time.
const WED = new Date(2026, 10, 18, 12).getTime();
const DAY = 86_400_000;

describe("turnCost", () => {
  it("is the rise in the process's running total", () => {
    expect(turnCost(1.5, 1.2, undefined)).toBeCloseTo(0.3);
  });

  it("counts a fresh process's first total in full", () => {
    expect(turnCost(0.4, undefined, undefined)).toBe(0.4);
    // Below the saved total: the new process started from zero.
    expect(turnCost(0.4, undefined, 2)).toBe(0.4);
  });

  it("carries on from a saved total a resumed process restored", () => {
    expect(turnCost(2.5, undefined, 2)).toBeCloseTo(0.5);
  });

  it("ignores a missing or broken total", () => {
    expect(turnCost(Number.NaN, 1, 1)).toBe(0);
    expect(turnCost(-1, undefined, undefined)).toBe(0);
  });
});

describe("costSummary", () => {
  it("sums today by chat, most spent first, and the week since Monday", () => {
    let ledger = emptyLedger();
    ledger = addCost(ledger, "a", 0.32, WED);
    ledger = addCost(ledger, "b", 0.84, WED);
    ledger = addCost(ledger, "a", 0.61, WED);
    ledger = addCost(ledger, "c", 5, WED - DAY * 2); // Monday
    ledger = addCost(ledger, "d", 7, WED - DAY * 3); // last Sunday
    const summary = costSummary(ledger, WED);
    expect(summary.byChat.map((row) => row.chatId)).toEqual(["a", "b"]);
    expect(summary.today).toBeCloseTo(1.77);
    expect(summary.week).toBeCloseTo(6.77);
  });

  it("forgets days past two weeks and says nothing for an empty day", () => {
    let ledger = addCost(emptyLedger(), "old", 3, WED - DAY * 20);
    ledger = addCost(ledger, "new", 1, WED);
    expect(Object.keys(ledger.days)).toEqual([dayKey(WED)]);
    expect(costSummary(emptyLedger(), WED)).toEqual({
      today: 0,
      byChat: [],
      week: 0,
    });
  });
});

describe("formatUsd", () => {
  it("shows cents, and a floor under one cent", () => {
    expect(formatUsd(1.77)).toBe("$1.77");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,235");
  });
});

describe("recordClaudeCost", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  it("saves each turn's rise under the chat and today", () => {
    let last = recordClaudeCost("chat", 0.5, undefined, WED);
    last = recordClaudeCost("chat", 0.75, last, WED);
    expect(last).toBe(0.75);
    const saved = JSON.parse(localStorage.getItem(CHAT_COST_KEY)!);
    expect(saved.days[dayKey(WED)].chat).toBeCloseTo(0.75);
    expect(saved.totals.chat).toBe(0.75);
    expect(costSummary(loadCostLedger(), WED).today).toBeCloseTo(0.75);
  });

  it("keeps the last total when a result carries no price", () => {
    expect(recordClaudeCost("chat", undefined, 0.3, WED)).toBe(0.3);
    expect(localStorage.getItem(CHAT_COST_KEY)).toBeNull();
  });
});
