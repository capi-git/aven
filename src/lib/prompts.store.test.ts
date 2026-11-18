// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommitMessagePrompt, buildPrContentPrompt } from "./gitText";
import { agentGitInstructions } from "./gitPreference";
import {
  loadCustomPrompt,
  loadPrompt,
  promptDefinition,
  promptStorageKey,
  PROMPT_IDS,
  PROMPTS,
  savePrompt,
  subscribePrompts,
} from "./prompts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("prompts store", () => {
  it("lists every action once, in Super's two groups, with a default", () => {
    expect(new Set(PROMPT_IDS).size).toBe(PROMPTS.length);
    expect(PROMPTS.filter((p) => p.group === "Git").map((p) => p.id)).toEqual([
      "create-pr",
      "commit-push",
      "commit",
      "resolve-conflicts",
      "fix-checks",
      "investigate-blocker",
      "fix-review",
    ]);
    for (const prompt of PROMPTS)
      expect(prompt.defaultText.trim()).not.toBe("");
  });

  it("uses the default until a custom text is saved, under an aven. key", () => {
    expect(loadCustomPrompt("fix-checks")).toBeNull();
    expect(loadPrompt("fix-checks")).toBe(
      promptDefinition("fix-checks").defaultText,
    );
    savePrompt("fix-checks", "  Fix the build.  ");
    expect(promptStorageKey("fix-checks")).toBe("aven.prompt.fix-checks");
    expect(values.get("aven.prompt.fix-checks")).toBe("Fix the build.");
    expect(loadPrompt("fix-checks")).toBe("Fix the build.");
  });

  it("goes back to the default for empty text, the default itself, or a reset", () => {
    savePrompt("commit", "Custom");
    savePrompt("commit", "   ");
    expect(loadCustomPrompt("commit")).toBeNull();
    savePrompt("commit", "Custom");
    savePrompt("commit", promptDefinition("commit").defaultText);
    expect(values.has("aven.prompt.commit")).toBe(false);
    savePrompt("commit", "Custom");
    savePrompt("commit", null);
    expect(loadCustomPrompt("commit")).toBeNull();
  });

  it("tells listeners here and in other windows", () => {
    const listener = vi.fn();
    const stop = subscribePrompts(listener);
    savePrompt("review-replies", "Reply kindly.");
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.prompt.review-replies" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    savePrompt("review-replies", null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("falls back to the default when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPrompt("create-pr")).toBe(
      promptDefinition("create-pr").defaultText,
    );
    expect(() => savePrompt("create-pr", "x")).not.toThrow();
  });
});

describe("prompts in use", () => {
  const commitInput = {
    branch: "feat/x",
    stagedSummary: "M a.ts",
    stagedPatch: "+1",
  };
  const prInput = {
    baseBranch: "main",
    headBranch: "feat/x",
    commitSummary: "Add x",
    diffSummary: "a.ts | 1 +",
    diffPatch: "+1",
  };

  it("replaces only the commit message instruction; the reply format stays", () => {
    savePrompt("commit-message", "Write the subject in French.");
    const prompt = buildCommitMessagePrompt({
      ...commitInput,
      includeBranch: true,
    });
    expect(prompt.startsWith("Write the subject in French.")).toBe(true);
    expect(prompt).not.toContain("You write concise git commit messages.");
    expect(prompt).toContain(
      "Return a JSON object with keys: subject, body, branch.",
    );
    expect(prompt).toContain("Reply with JSON only.");
    expect(prompt).toContain("Branch: feat/x");
  });

  it("replaces only the pull request instruction", () => {
    expect(buildPrContentPrompt(prInput)).toContain(
      "You write source control change request content.",
    );
    savePrompt("create-pr", "Title in sentence case.");
    const prompt = buildPrContentPrompt(prInput);
    expect(prompt.startsWith("Title in sentence case.")).toBe(true);
    expect(prompt).toContain("Return a JSON object with keys: title, body.");
    expect(prompt).toContain("Base branch: main");
  });

  it("rewords the Commit finish preference", () => {
    expect(agentGitInstructions("commit")).toContain("Do not push");
    savePrompt("commit", "Commit with a Conventional Commits subject.");
    expect(agentGitInstructions("commit")).toMatch(
      /^<aven-git>Commit with a Conventional Commits subject\. This is the user's standing preference/,
    );
  });
});
