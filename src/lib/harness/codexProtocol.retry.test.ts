import { describe, expect, it } from "vitest";
import { mapCodexNotification } from "./codexProtocol";

describe("Codex retries", () => {
  it("keeps its status row and says the turn waits on the retry", () => {
    expect(
      mapCodexNotification("error", {
        error: {
          message: "Reconnecting... 2/5",
          codexErrorInfo: {
            responseStreamDisconnected: { httpStatusCode: null },
          },
        },
        willRetry: true,
        threadId: "thread",
        turnId: "turn",
      }).events,
    ).toEqual([
      { type: "status", text: "Reconnecting... 2/5" },
      {
        type: "turn.waiting",
        set: { retry: { attempt: 2, reason: "connection" } },
      },
    ]);
  });

  it.each([
    ["serverOverloaded", "busy"],
    ["usageLimitExceeded", "rate-limit"],
    ["internalServerError", "server"],
  ])("names a %s retry", (codexErrorInfo, reason) => {
    expect(
      mapCodexNotification("error", {
        error: { message: "Retrying", codexErrorInfo },
        willRetry: true,
      }).events[1],
    ).toEqual({ type: "turn.waiting", set: { retry: { reason } } });
  });

  it("leaves a failure that will not be retried as an error", () => {
    expect(
      mapCodexNotification("error", {
        error: { message: "Quota exceeded" },
        willRetry: false,
      }).events,
    ).toEqual([{ type: "session.error", message: "Quota exceeded" }]);
  });
});
