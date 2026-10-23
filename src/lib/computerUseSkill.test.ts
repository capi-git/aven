import { describe, expect, it } from "vitest";
import {
  COMPUTER_USE_SKILL_BODY,
  COMPUTER_USE_TASK_GUIDANCE,
} from "./computerUseSkill";
import { AVEN_BROWSER_HOST_POLICY } from "./harness/browserHostPolicy";

describe("desktop control permission guidance", () => {
  it("allows observation with Screen Recording while requiring both grants for input", () => {
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "windows and screenshot need desktop control enabled and Screen Recording granted",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "move, click, drag, type, press, scroll and activate need both Screen Recording and Accessibility granted",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "Observation is available with Screen Recording alone even when state is permissionsRequired",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "With `enabled: true` and Screen Recording granted, use `windows` and `screenshot`",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "Use `move`, `click`, `drag`, `type`, `press`, `scroll`, and `activate` only when both Screen Recording and Accessibility are granted and desktop control is enabled",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "If `enabled` is false or `state` is `off`, do not observe or send input",
    );
    for (const instructions of [
      COMPUTER_USE_TASK_GUIDANCE,
      COMPUTER_USE_SKILL_BODY,
    ]) {
      expect(instructions).toContain(
        "Continue authorized observation while Accessibility is missing, but do not send input",
      );
      expect(instructions).toContain(
        "Agent actions never trigger permission prompts",
      );
      expect(instructions).toContain("drag");
      expect(instructions).toContain("durationMs");
      expect(instructions).not.toContain(
        "Proceed only when `state` is `ready`",
      );
    }
  });

  it("prefers background accessibility elements and re-queries stale state", () => {
    for (const instructions of [
      COMPUTER_USE_TASK_GUIDANCE,
      COMPUTER_USE_SKILL_BODY,
    ]) {
      expect(instructions).toContain("appState");
      for (const action of [
        "typeText",
        "setValue",
        "pressKey",
        "selectText",
        "secondaryAction",
      ]) {
        expect(instructions).toContain(action);
      }
      expect(instructions).toContain("stateId");
      expect(instructions).toContain("State changed; call appState again");
      expect(instructions).toContain("uses them up");
      expect(instructions).toContain("ambiguous");
      expect(instructions).toContain("redacted");
      expect(instructions).toMatch(/never guess/i);
    }
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "they do not move the pointer, activate the app or need it frontmost",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "Use coordinates only when the element you need is missing from appState or does not respond",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "Use coordinates only when the element you need is missing from `appState` or does not respond",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      '"action":"appState","windowId":123',
    );
    expect(AVEN_BROWSER_HOST_POLICY).toContain("appState");
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      "call appState again instead of guessing",
    );
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      "call appState again before the next element action",
    );
  });

  it("makes desktop control the next route for Aven's own browser pages, never a reason to give up", () => {
    for (const instructions of [
      COMPUTER_USE_TASK_GUIDANCE,
      COMPUTER_USE_SKILL_BODY,
    ]) {
      // The wording that kept agents off the window holding their own page.
      expect(instructions).not.toContain("Do not substitute desktop control");
      expect(instructions).not.toContain(
        "never guess which instance is the task host",
      );
      expect(instructions).toContain(
        "Aven's window titles name the tab in front",
      );
      expect(instructions).toContain("may be titled with another project");
      expect(instructions).toContain("stopped-here");
      expect(instructions).toMatch(
        /never end with a bare "you'll need to do this"/i,
      );
      // The real safety rules stay.
      expect(instructions).toMatch(/(Act|Stay) within the user's request/);
      expect(instructions).toMatch(
        /Other apps' windows still need the user's request or consent/,
      );
      // Never a way around the upload approval, Aven's own controls, or
      // another site's sign-in and payment.
      expect(instructions).not.toContain("native dialog");
      expect(instructions).toMatch(/file, open, save (and|or) folder dialogs/i);
      expect(instructions).toContain("upload");
      expect(instructions).toMatch(
        /Aven's own interface(: |\s\()settings, other chats,? (and )?approval/,
      );
      expect(instructions).toMatch(
        /sign-in or payment\. Hand that step to the user|sign-in or payment, hand that step to the user/,
      );
    }
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "Desktop control is the next route for a web page in Aven",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "use desktop control inside that page on the Aven window that shows it instead of handing the step back",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "Aven accepts desktop input there only inside the page.",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "Some steps are never done through desktop control:",
    );
    expect(COMPUTER_USE_TASK_GUIDANCE).toContain(
      "ask the user once to turn it on, naming the step it is for",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "## Web pages that need more than the browser actions",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "Put real blockers you find (a paid plan, a missing permission, a sign-in) at the top of your reply",
    );
    expect(COMPUTER_USE_SKILL_BODY).toContain(
      "explain the limitation with a screenshot of the exact spot and one precise next step",
    );
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      "then desktop control inside the page on the Aven window that shows it",
    );
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      "Never operate file, open, save or folder dialogs, or Aven's own interface (settings, other chats, approval bars), through desktop control",
    );
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      'with a "stopped-here" screenshot of the exact spot and one precise next step',
    );
  });

  it("pauses all desktop control while the Mac is locked", () => {
    for (const instructions of [
      COMPUTER_USE_TASK_GUIDANCE,
      COMPUTER_USE_SKILL_BODY,
    ]) {
      expect(instructions).toContain(
        "The Mac is locked. Desktop control is paused until the user unlocks",
      );
      expect(instructions).toContain("The user's Mac session is not on screen");
      expect(instructions).toContain(
        "Keep working in Aven's browser or code, or wait",
      );
      expect(instructions).toMatch(/do not retry in a loop/i);
    }
    expect(AVEN_BROWSER_HOST_POLICY).toContain(
      "While the Mac is locked, desktop actions (observation included) are refused",
    );
  });
});
