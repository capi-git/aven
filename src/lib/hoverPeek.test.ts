import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import type { GitChangedFile } from "./fs";
import {
  activityPeek,
  changesPeek,
  chatPrState,
  chatsToday,
  clearPeekCache,
  lastReplyQuote,
  lastTurnEndedAt,
  peekAge,
  PEEK_FRESH_MS,
  readPeekCache,
  writePeekCache,
} from "./hoverPeek";
import type { PrChecksSummary } from "./prChecks";

const NOW = Date.UTC(2026, 10, 17, 15, 0, 0);
const pr = (state: string) => ({ number: 212, title: "", url: "", state });
const checks = (
  state: PrChecksSummary["state"],
  counts: Partial<PrChecksSummary> = {},
): PrChecksSummary => ({
  state,
  passed: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
  total: 0,
  label: "",
  ...counts,
});

describe("peekAge", () => {
  it("reads now, minutes, hours and days", () => {
    expect(peekAge(NOW - 20_000, NOW)).toBe("now");
    expect(peekAge(NOW - 3 * 60_000, NOW)).toBe("3m");
    expect(peekAge(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(peekAge(NOW - 50 * 3_600_000, NOW)).toBe("2d");
    expect(peekAge(undefined, NOW)).toBe("");
  });
});

describe("chatPrState", () => {
  it("is ready once checks pass or none are reported", () => {
    expect(chatPrState(pr("open"), checks("passing"))?.kind).toBe("ready");
    expect(chatPrState(pr("open"), checks("none"))).toEqual({
      kind: "ready",
      label: "Ready to merge",
    });
  });

  it("names checks still running or failing", () => {
    expect(chatPrState(pr("open"), checks("pending", { pending: 2 }))).toEqual({
      kind: "running",
      label: "2 checks running",
    });
    expect(chatPrState(pr("open"), checks("failing", { failed: 1 }))).toEqual({
      kind: "failing",
      label: "1 check failing",
    });
  });

  it("says nothing without a pull request, unknown checks or a closed one", () => {
    expect(chatPrState(null, null)).toBeNull();
    expect(chatPrState(pr("open"), null)).toBeNull();
    expect(chatPrState(pr("closed"), checks("passing"))).toBeNull();
    expect(chatPrState(pr("merged"), null)?.label).toBe("Merged");
  });
});

describe("changesPeek", () => {
  const file = (relative: string, additions: number, deletions: number) =>
    ({ relative, additions, deletions }) as GitChangedFile;

  it("totals the lines and lists the first few", () => {
    const files = Array.from({ length: 11 }, (_, i) => file(`f${i}`, 2, 1));
    const peek = changesPeek(files);
    expect(peek).toMatchObject({
      files: 11,
      additions: 22,
      deletions: 11,
      more: 3,
    });
    expect(peek.shown).toHaveLength(8);
  });

  it("shows a lone ninth file instead of 'and 1 more'", () => {
    const files = Array.from({ length: 9 }, (_, i) => file(`f${i}`, 1, 0));
    expect(changesPeek(files)).toMatchObject({ more: 0 });
    expect(changesPeek(files).shown).toHaveLength(9);
  });
});

describe("activityPeek", () => {
  const entry = (
    id: string,
    outcome: ActivityEntry["outcome"],
    minutesAgo: number,
    extra: Partial<ActivityEntry> = {},
  ): ActivityEntry => ({
    id,
    sessionId: `s-${id}`,
    outcome,
    title: `Chat ${id}`,
    summary: "",
    cwd: "/p",
    harness: "claude",
    model: "opus",
    createdAt: NOW - minutesAgo * 60_000,
    readAt: null,
    resolvedAt: null,
    ...extra,
  });

  it("lists unread entries, newest first, with their state and age", () => {
    const peek = activityPeek(
      [
        entry("a", "completed", 30),
        entry("b", "approval", 3),
        entry("c", "completed", 1, { readAt: NOW }),
        entry("d", "failed", 10, {
          team: { member: true } as ActivityEntry["team"],
        }),
      ],
      NOW,
    );
    expect(peek.unread).toBe(2);
    expect(peek.rows.map((row) => [row.state, row.end])).toEqual([
      ["needs", "Needs you · 3m"],
      ["ready", "Ready · 30m"],
    ]);
  });
});

describe("lastReplyQuote", () => {
  it("quotes the last reply as plain words", () => {
    expect(
      lastReplyQuote([
        { role: "user", text: "Fix it" },
        { role: "assistant", text: "Looking." },
        { role: "tool", text: "" },
        {
          role: "assistant",
          text: "**Fixed.** The index has `1,284` entries.\n\n```ts\ncode()\n```\n\nThe page loads.",
        },
      ]),
    ).toBe("Fixed. The index has 1,284 entries. The page loads.");
  });

  it("has nothing while a new turn has no reply yet", () => {
    expect(
      lastReplyQuote([
        { role: "assistant", text: "Old reply" },
        { role: "user", text: "Next" },
      ]),
    ).toBe("");
  });

  it("cuts a long reply", () => {
    const quote = lastReplyQuote(
      [{ role: "assistant", text: "a ".repeat(400) }],
      50,
    );
    expect(quote.length).toBeLessThanOrEqual(50);
    expect(quote.endsWith("…")).toBe(true);
  });
});

describe("lastTurnEndedAt", () => {
  it("is when the last turn ended, once it has", () => {
    expect(
      lastTurnEndedAt([
        { role: "user", startedAt: 1_000, durationMs: 500 },
        { role: "assistant" },
      ]),
    ).toBe(1_500);
    expect(lastTurnEndedAt([{ role: "user", startedAt: 1_000 }])).toBe(
      undefined,
    );
  });
});

describe("chatsToday", () => {
  it("counts chats touched since midnight, not archived ones", () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime();
    expect(
      chatsToday(
        [
          { updatedAt: start + 1 },
          { updatedAt: start - 1 },
          { updatedAt: start + 5, archived: true },
        ],
        NOW,
      ),
    ).toBe(1);
  });
});

describe("peek cache", () => {
  afterEach(() => clearPeekCache());

  it("is fresh for a few seconds, then stale but still shown", () => {
    writePeekCache("k", 1, NOW);
    expect(readPeekCache("k", NOW + 1_000)).toEqual({ value: 1, fresh: true });
    expect(readPeekCache("k", NOW + PEEK_FRESH_MS)).toEqual({
      value: 1,
      fresh: false,
    });
    expect(readPeekCache("missing", NOW)).toBeUndefined();
  });
});
