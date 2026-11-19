import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exhaustedResetAt, parseCodexRateLimits } from "../rateLimits";
import { codexUsageLimit, mapCodexNotification } from "./codexProtocol";

// Local time, so "Try again at 3:40 PM." reads the same in any time zone.
const NOW = new Date(2026, 10, 19, 13, 0, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/**
 * The shape assumed for a reached limit, from Codex app-server's v2
 * protocol: an `error` notification carrying a `TurnError` whose
 * `codexErrorInfo` is "usageLimitExceeded", and Codex core's message for
 * `UsageLimitReachedError` ("… Try again at 3:40 PM." on the same day,
 * "… Try again at Nov 20th, 2026 9:05 AM." on another). Not captured from
 * a live account.
 */
const LIMIT_MESSAGE =
  "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:40 PM.";

describe("Codex usage limit", () => {
  it("holds the chat until the time its error names, then fails the turn", () => {
    const resetsAt = new Date(2026, 10, 19, 15, 40).getTime();
    expect(
      mapCodexNotification("error", {
        error: {
          message: LIMIT_MESSAGE,
          codexErrorInfo: "usageLimitExceeded",
          additionalDetails: null,
        },
        willRetry: false,
        threadId: "thread",
        turnId: "turn",
      }).events,
    ).toEqual([
      { type: "turn.waiting", set: { usageLimit: { resetsAt } } },
      { type: "session.error", message: LIMIT_MESSAGE },
    ]);
  });

  it("reads a reset on another day", () => {
    expect(
      codexUsageLimit(
        "You've hit your usage limit. Try again at Nov 20th, 2026 9:05 AM.",
        { codexErrorInfo: "usageLimitExceeded" },
        NOW,
      ),
    ).toEqual({ resetsAt: new Date(2026, 10, 20, 9, 5).getTime() });
  });

  it("reads an older build's countdown", () => {
    expect(
      codexUsageLimit(
        "You've hit your usage limit. Upgrade to Plus or try again in 2 hours 5 minutes.",
        { codexErrorInfo: { usageLimitExceeded: {} } },
        NOW,
      ),
    ).toEqual({ resetsAt: NOW + 2 * 3_600_000 + 5 * 60_000 });
  });

  it("takes a reset time the error carries over its words", () => {
    expect(
      codexUsageLimit(
        LIMIT_MESSAGE,
        {
          codexErrorInfo: {
            usageLimitExceeded: { resetsAt: NOW / 1000 + 600 },
          },
        },
        NOW,
      ),
    ).toEqual({ resetsAt: NOW + 600_000 });
  });

  it("is reached with no time when Codex gives none", () => {
    expect(
      codexUsageLimit(
        "You've hit your usage limit. Try again later.",
        { codexErrorInfo: "usageLimitExceeded" },
        NOW,
      ),
    ).toEqual({});
  });

  it("knows the limit by its words when no info comes with it", () => {
    expect(codexUsageLimit(LIMIT_MESSAGE, {}, NOW)).not.toBeNull();
    expect(
      codexUsageLimit("stream disconnected", { codexErrorInfo: "other" }, NOW),
    ).toBeNull();
  });

  it("holds the chat from a failed turn's error too", () => {
    const events = mapCodexNotification("turn/completed", {
      threadId: "thread",
      turn: {
        id: "turn",
        status: "failed",
        error: { message: LIMIT_MESSAGE, codexErrorInfo: "usageLimitExceeded" },
      },
    }).events;
    expect(events).toContainEqual({
      type: "turn.waiting",
      set: {
        usageLimit: { resetsAt: new Date(2026, 10, 19, 15, 40).getTime() },
      },
    });
  });

  it("passes on the account's usage as Codex pushes it", () => {
    const params = {
      rateLimits: {
        primary: {
          usedPercent: 100,
          windowDurationMins: 300,
          resetsAt: NOW / 1000 + 1_800,
        },
        secondary: {
          usedPercent: 40,
          windowDurationMins: 10_080,
          resetsAt: NOW / 1000 + 86_400,
        },
      },
    };
    const mapped = mapCodexNotification("account/rateLimits/updated", params);
    expect(mapped.events).toEqual([]);
    expect(exhaustedResetAt(parseCodexRateLimits(mapped.rateLimits), NOW)).toBe(
      NOW + 1_800_000,
    );
  });
});

describe("exhaustedResetAt", () => {
  it("waits for every full window, and ignores ones with room", () => {
    const window = (usedPercent: number, resetsAt: number | null) => ({
      usedPercent,
      windowMinutes: 300,
      resetsAt,
    });
    const limits = {
      provider: "codex" as const,
      session: window(100, NOW + 60_000),
      weekly: window(100, NOW + 3_600_000),
      updatedAt: NOW,
      error: null,
      status: "ok" as const,
    };
    expect(exhaustedResetAt(limits, NOW)).toBe(NOW + 3_600_000);
    expect(
      exhaustedResetAt({ ...limits, weekly: window(50, NOW + 1) }, NOW),
    ).toBe(NOW + 60_000);
    expect(
      exhaustedResetAt(
        { ...limits, session: window(99, NOW + 1), weekly: null },
        NOW,
      ),
    ).toBeUndefined();
    expect(exhaustedResetAt(null, NOW)).toBeUndefined();
  });
});
