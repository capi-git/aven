import { beforeEach, describe, expect, it } from "vitest";
import {
  offerGuidance,
  prepareGuidanceTurn,
  resetGuidanceDelivery,
  resetGuidanceDeliveryState,
  type GuidanceBlock,
} from "./agentGuidanceDelivery";

const BROWSER: GuidanceBlock = {
  kind: "browser",
  full: "<aven-browser>full browser guidance for /a</aven-browser>",
  reminder: "<aven-browser>still applies</aven-browser>",
};
const BROWSER_MOVED: GuidanceBlock = {
  ...BROWSER,
  full: "<aven-browser>full browser guidance for /b</aven-browser>",
};
const GIT: GuidanceBlock = {
  kind: "git",
  full: "<aven-git>commit when done</aven-git>",
  reminder: "<aven-git>Git still applies</aven-git>",
};
const UNAVAILABLE: GuidanceBlock = {
  kind: "browser",
  full: "<aven-browser>unavailable this turn</aven-browser>",
  reminder: "<aven-browser>unavailable this turn</aven-browser>",
  repeat: true,
};

const turn = (text: string, extra: { harness?: "claude" | "codex" } = {}) =>
  prepareGuidanceTurn({
    harness: extra.harness ?? "claude",
    sessionId: "chat",
    cwd: "/project",
    text,
  });

const message = (...blocks: GuidanceBlock[]) =>
  `${blocks.map((block) => offerGuidance(block)).join("\n\n")}\n\nFix it`;

beforeEach(() => resetGuidanceDeliveryState());

describe("standing guidance delivery", () => {
  it("sends the guidance in full once, then a reminder", () => {
    expect(turn(message(BROWSER, GIT)).text).toBe(
      `${BROWSER.full}\n\n${GIT.full}\n\nFix it`,
    );
    expect(turn(message(BROWSER, GIT)).text).toBe(
      `${BROWSER.reminder}\n\n${GIT.reminder}\n\nFix it`,
    );
  });

  it("sends a block in full again when its text changes", () => {
    turn(message(BROWSER, GIT));
    expect(turn(message(BROWSER_MOVED, GIT)).text).toBe(
      `${BROWSER_MOVED.full}\n\n${GIT.reminder}\n\nFix it`,
    );
    expect(turn(message(BROWSER_MOVED, GIT)).text).toBe(
      `${BROWSER.reminder}\n\n${GIT.reminder}\n\nFix it`,
    );
  });

  it("starts over after a reset, another provider or another checkout", () => {
    turn(message(BROWSER));
    resetGuidanceDelivery("chat");
    expect(turn(message(BROWSER)).text).toContain(BROWSER.full);
    expect(turn(message(BROWSER), { harness: "codex" }).text).toContain(
      BROWSER.full,
    );
    expect(
      prepareGuidanceTurn({
        harness: "codex",
        sessionId: "chat",
        cwd: "/project-copy",
        text: message(BROWSER),
      }).text,
    ).toContain(BROWSER.full);
  });

  it("undoes the record when the message never went out", () => {
    const first = turn(message(BROWSER));
    first.rollback();
    expect(turn(message(BROWSER)).text).toContain(BROWSER.full);
  });

  it("keeps a later message's record when an earlier one rolls back", () => {
    const first = turn(message(BROWSER));
    const steer = turn(message(BROWSER, GIT));
    first.rollback();
    expect(steer.text).toContain(BROWSER.reminder);
    expect(turn(message(BROWSER, GIT)).text).toBe(
      `${BROWSER.reminder}\n\n${GIT.reminder}\n\nFix it`,
    );
  });

  it("says unavailability every time and gives the guidance in full after it", () => {
    turn(message(BROWSER));
    expect(turn(message(UNAVAILABLE)).text).toContain(UNAVAILABLE.full);
    expect(turn(message(UNAVAILABLE)).text).toContain(UNAVAILABLE.full);
    expect(turn(message(BROWSER)).text).toContain(BROWSER.full);
  });

  it("leaves provider commands and plain text alone", () => {
    offerGuidance(BROWSER);
    expect(turn("/compact").text).toBe("/compact");
    expect(turn("Fix it").text).toBe("Fix it");
    expect(turn(message(BROWSER)).text).toContain(BROWSER.full);
  });
});
