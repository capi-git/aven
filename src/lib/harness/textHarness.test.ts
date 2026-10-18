import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../session";

const installed = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock("./availability", () => ({
  isHarnessAvailable: (id: HarnessId) => installed.ids.has(id),
}));
vi.mock("./registry", () => ({
  generateHarnessCommitMessage: vi.fn(),
  generateHarnessPrContent: vi.fn(),
  warmupHarnessText: vi.fn(),
}));

const { textModelLabel } = await import("./textHarness");

describe("who writes commit messages", () => {
  beforeEach(() => installed.ids.clear());

  it("names Claude's small model when Claude Code writes", () => {
    installed.ids.add("claude");
    expect(textModelLabel("claude")).toMatch(/^Claude .*Haiku/);
  });

  it("names the agent that actually writes when the chat's can't", () => {
    installed.ids.add("codex");
    expect(textModelLabel("claude")).toMatch(/^Codex /);
    installed.ids.clear();
    installed.ids.add("cursor");
    expect(textModelLabel("claude")).toBe("Cursor");
  });
});
