import { describe, expect, it } from "vitest";
import {
  COMPUTER_USE_SKILL_BODY,
  COMPUTER_USE_TASK_GUIDANCE,
} from "./computerUseSkill";

describe("desktop control permission guidance", () => {
  it("allows observation with Screen Recording while requiring both grants for input", () => {
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "windows and screenshot need desktop control enabled and Screen Recording granted",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "move, click, type, press, scroll and activate need both Screen Recording and Accessibility granted",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "Observation is available with Screen Recording alone even when state is permissionsRequired",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "With `enabled: true` and Screen Recording granted, use `windows` and `screenshot`",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "Use `move`, `click`, `type`, `press`, `scroll`, and `activate` only when both Screen Recording and Accessibility are granted and desktop control is enabled",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "If `enabled` is false or `state` is `off`, do not observe or send input",
    );
    for (const instructions of [COMPUTER_USE_TASK_GUIDANCE, COMPUTER_USE_SKILL_BODY]) {
      expect(instructions).toContain(
        "Continue authorized observation while Accessibility is missing, but do not send input",
      );
      expect(instructions).toContain("Agent actions never trigger permission prompts");
      expect(instructions).not.toContain("Proceed only when `state` is `ready`");
    }
  });
});
