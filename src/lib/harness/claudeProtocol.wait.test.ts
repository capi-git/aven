import { describe, expect, it } from "vitest";
import { claudeWaitEvent } from "./claudeProtocol";

const NOW = 1_800_000_000_000;

/** `system/api_retry` as Claude Code 2.1.x writes it to stream-json. */
function apiRetry(patch: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "api_retry",
    attempt: 1,
    max_retries: 10,
    retry_delay_ms: 20_000,
    error_status: 529,
    error: "overloaded",
    uuid: "4f2c8a8e-0000-4000-8000-000000000001",
    session_id: "sess_1",
    ...patch,
  };
}

/** `rate_limit_event` as Claude Code 2.1.x writes it to stream-json. */
function rateLimit(info: Record<string, unknown>) {
  return {
    type: "rate_limit_event",
    rate_limit_info: info,
    uuid: "4f2c8a8e-0000-4000-8000-000000000002",
    session_id: "sess_1",
  };
}

describe("claudeWaitEvent", () => {
  it("reads a retry's try, delay and cause", () => {
    expect(claudeWaitEvent(apiRetry(), NOW)).toEqual({
      type: "turn.waiting",
      set: { retry: { attempt: 1, retryAt: NOW + 20_000, reason: "busy" } },
    });
  });

  it.each([
    [{ error: "rate_limit", error_status: 429 }, "rate-limit"],
    [{ error: "server_error", error_status: 500 }, "server"],
    [{ error: "unknown", error_status: 503 }, "server"],
    [{ error: "unknown", error_status: null }, "connection"],
    [
      {
        error: "unknown",
        error_status: null,
        no_response: { waited_ms: 30_000, retry_wait_ms: 60_000 },
      },
      "no-response",
    ],
  ])("names the cause of %o", (patch, reason) => {
    expect(claudeWaitEvent(apiRetry(patch), NOW)?.set?.retry?.reason).toBe(
      reason,
    );
  });

  it("keeps what it can from a retry with missing fields", () => {
    expect(
      claudeWaitEvent({ type: "system", subtype: "api_retry" }, NOW),
    ).toEqual({ type: "turn.waiting", set: { retry: {} } });
  });

  it("holds requests back only for a rejection with no overage", () => {
    expect(
      claudeWaitEvent(
        rateLimit({
          status: "rejected",
          resetsAt: 1_800_003_600,
          rateLimitType: "five_hour",
        }),
        NOW,
      ),
    ).toEqual({
      type: "turn.waiting",
      set: { usageLimit: { resetsAt: 1_800_003_600_000 } },
    });
    expect(claudeWaitEvent(rateLimit({ status: "rejected" }), NOW)).toEqual({
      type: "turn.waiting",
      set: { usageLimit: {} },
    });
  });

  it.each([
    { status: "allowed" },
    { status: "allowed_warning", utilization: 0.9, resetsAt: 1_800_003_600 },
    { status: "rejected", overageStatus: "allowed", isUsingOverage: true },
    { status: "rejected", overageStatus: "allowed_warning" },
  ])("clears the usage limit for %o", (info) => {
    expect(claudeWaitEvent(rateLimit(info), NOW)).toEqual({
      type: "turn.waiting",
      clear: ["usageLimit"],
    });
  });

  it("ignores everything else", () => {
    expect(claudeWaitEvent({ type: "rate_limit_event" }, NOW)).toBeUndefined();
    expect(
      claudeWaitEvent({ type: "system", subtype: "status" }, NOW),
    ).toBeUndefined();
    expect(claudeWaitEvent({ type: "assistant" }, NOW)).toBeUndefined();
  });
});
