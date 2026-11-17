import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Only a message the user wrote, or a send they pressed a button for, ends
 * their Stop on a chat's use of other tabs and its declined requests
 * (`prepareAgentBrowserPrompt`'s `typed`). Every such send in the app marks
 * itself `typed: true`; automatic ones (bots' wake-ups, a lead's workers,
 * automations, auto-continue) never do.
 */
const app = readFileSync("src/App.tsx", "utf8");

/** The source of the first `onSubmit(…)` call after `anchor`. */
function sendAfter(anchor: string) {
  const at = app.indexOf(anchor);
  if (at < 0) throw new Error(`Missing ${anchor}`);
  const call = app.indexOf("onSubmit(", at);
  let depth = 0;
  for (let index = call + "onSubmit".length; index < app.length; index++) {
    if (app[index] === "(") depth++;
    else if (app[index] === ")" && --depth === 0)
      return app.slice(call, index + 1);
  }
  throw new Error(`Unclosed onSubmit after ${anchor}`);
}

describe("sends the user made", () => {
  it.each([
    ["the chat's message box", "const onChatSubmit = useCallback("],
    ["a message to a bot", "sendAsUsual: ("],
    ["Build on a plan", "const onBuildPlan = useCallback("],
    [
      "an answer to an expired question",
      "const onQuestionReply = useCallback(",
    ],
    ["Retry on an orchestration", "retry: (leadId: string, blockId: string)"],
    ["Retry on a race lane", "retry: async (race, lane)"],
  ])("%s ends the user's Stop", (_, anchor) => {
    expect(sendAfter(anchor)).toContain("typed: true");
  });

  it.each([
    // Its words are Aven's, not yours.
    ["Ask the agent to stop a second server", "useDuplicateServerMessenger("],
    ["auto-continue", "onSubmit(id, CONTINUE_PROMPT)"],
    ["a lead's worker", "managed: true"],
    ["an automation", "const startScheduledAgent = "],
  ])("%s does not", (_, anchor) => {
    const at = app.indexOf(anchor);
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 400)).not.toContain("typed: true");
  });
});

describe("the message you typed keeps its mark", () => {
  /** The source of the block from `anchor` to the next `return` after it. */
  const from = (anchor: string, length = 1600) => {
    const at = app.indexOf(anchor);
    if (at < 0) throw new Error(`Missing ${anchor}`);
    return app.slice(at, at + length);
  };

  it("on a new turn and on one steered into a running turn", () => {
    // Steered: the cards passed to appendSteerUser.
    expect(from("if (current.busy && !pendingSwitch) {")).toMatch(
      /const cards = \{[^}]*typedTurn\(options\)/,
    );
    // A new turn: the cards passed to appendUser.
    expect(from("const cards = {\n        ...(rawCommand")).toContain(
      "...typedTurn(options)",
    );
  });

  it("once you edit a queued message, it's yours", () => {
    expect(from("const onEditQueuedMessage = useCallback(")).toContain(
      "typed: true",
    );
  });
});
