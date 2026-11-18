import { describe, expect, it, vi } from "vitest";
import type { BriefDeps } from "./brief";
import {
  enhancePrompt,
  enhanceSystemPrompt,
  joinEnhancement,
} from "./enhancePrompt";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

const model = { harness: "claude" as const, label: "Claude Haiku" };
const deps = (reply: string | Error): BriefDeps => ({
  model: async () => model,
  generate: async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

describe("prompt enhancement", () => {
  it("keeps the draft word for word and adds under it", () => {
    expect(
      joinEnhancement("Fix the login bug  ", "Done when:\n- tests pass"),
    ).toBe("Fix the login bug\n\nDone when:\n- tests pass");
    // An echoed draft is dropped, and nothing to add leaves it alone.
    expect(joinEnhancement("Fix it", "Fix it\n\nKeep the API.")).toBe(
      "Fix it\n\nKeep the API.",
    );
    expect(joinEnhancement("Fix it", "  ")).toBe("Fix it");
  });

  it("keeps the reply contract after a custom instruction", () => {
    const system = enhanceSystemPrompt("Be brief.");
    expect(system.startsWith("Be brief.")).toBe(true);
    expect(system).toContain(
      "Reply with only the lines to add after their draft",
    );
  });

  it("never throws, and says why it couldn't help", async () => {
    await expect(enhancePrompt("  ", deps("x"))).resolves.toEqual({
      ok: false,
      error: "Write something first.",
    });
    await expect(
      enhancePrompt("Add dark mode", deps("```\nDone when: it toggles\n```")),
    ).resolves.toEqual({
      ok: true,
      text: "Add dark mode\n\nDone when: it toggles",
    });
    await expect(
      enhancePrompt("Add dark mode", deps("")),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      enhancePrompt("Add dark mode", { ...deps(""), model: async () => null }),
    ).resolves.toEqual({
      ok: false,
      error: "Enhancing needs Claude Code or Codex.",
    });
    await expect(
      enhancePrompt("Add dark mode", deps(new Error("timed out"))),
    ).resolves.toEqual({
      ok: false,
      error: "Couldn't enhance: timed out.",
    });
  });
});
