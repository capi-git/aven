import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SETUP_FAILED,
  SETUP_NO_MODEL,
  proposeTeamSetup,
  setTeamSetupDeps,
  type TeamSetupDeps,
} from "./crewSetup";

const PROJECT = "/Users/me/Pom";
const MODEL = { harness: "claude" as const, label: "Claude Haiku" };

const block = (body: unknown) =>
  `\`\`\`aven-setup\n${JSON.stringify(body)}\n\`\`\``;

function deps(patch: Partial<TeamSetupDeps> = {}) {
  const calls: { system: string; prompt: string }[] = [];
  const made: TeamSetupDeps = {
    model: () => MODEL,
    generate: vi.fn(async (_model, input) => {
      calls.push(input);
      return block({
        teammates: [
          { role: "builder", job: "Builds each card" },
          { role: "keeper", job: "Unknown" },
          { role: "researcher", job: "Reads up on ADHD planning" },
        ],
        ideas: [
          { title: "Make the today list hold five things" },
          {
            title: "What helps people with ADHD plan a day?",
            by: "researcher",
          },
        ],
      });
    }),
    digest: vi.fn(async () => "Top level: src, package.json"),
    timeoutMs: 1_000,
    ...patch,
  };
  setTeamSetupDeps(made);
  return { ...made, calls };
}

afterEach(() => {
  setTeamSetupDeps(null);
  vi.useRealTimers();
});

describe("asking for a team from your description", () => {
  it("asks once, as text only, with your words and the folder's digest, and reads the proposal", async () => {
    const d = deps();
    const found = await proposeTeamSetup(PROJECT, "An ADHD-friendly planner.");
    expect(found).toEqual({
      setup: {
        teammates: [
          { role: "builder", job: "Builds each card" },
          { role: "researcher", job: "Reads up on ADHD planning" },
        ],
        ideas: [
          { title: "Make the today list hold five things" },
          {
            title: "What helps people with ADHD plan a day?",
            by: "researcher",
          },
        ],
      },
    });
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.digest).toHaveBeenCalledWith(PROJECT);
    expect(d.calls[0]!.prompt).toContain("An ADHD-friendly planner.");
    expect(d.calls[0]!.prompt).toContain("Top level: src, package.json");
    expect(d.calls[0]!.system).toContain("no tools and read no files");
  });

  it("says so, in one line, when the model fails, answers badly, or takes too long", async () => {
    deps({
      generate: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    });
    expect(await proposeTeamSetup(PROJECT, "x")).toEqual({
      error: `${SETUP_FAILED} (rate limited)`,
    });
    deps({ generate: vi.fn(async () => "Sure! A Builder and a Checker.") });
    expect(await proposeTeamSetup(PROJECT, "x")).toEqual({
      error: SETUP_FAILED,
    });
    vi.useFakeTimers();
    deps({
      generate: vi.fn(() => new Promise<string>(() => {})),
      timeoutMs: 50,
    });
    const slow = proposeTeamSetup(PROJECT, "x");
    await vi.advanceTimersByTimeAsync(60);
    expect(await slow).toEqual({
      error: `${SETUP_FAILED} (The model took too long to answer.)`,
    });
  });

  it("needs words and a model, and goes on without a digest it couldn't read", async () => {
    deps();
    expect(await proposeTeamSetup(PROJECT, "   ")).toEqual({
      error: "Say what the project is first.",
    });
    deps({ model: () => null });
    expect(await proposeTeamSetup(PROJECT, "x")).toEqual({
      error: SETUP_NO_MODEL,
    });
    const d = deps({
      digest: vi.fn(async () => {
        throw new Error("no folder");
      }),
    });
    expect("setup" in (await proposeTeamSetup(PROJECT, "x"))).toBe(true);
    expect(d.calls[0]!.prompt).not.toContain("<project-digest>");
  });
});
