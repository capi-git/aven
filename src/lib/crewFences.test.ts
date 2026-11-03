import { describe, expect, it } from "vitest";
import { crewFenceView, isCrewFence } from "./crewFences";

const body = (value: unknown) => JSON.stringify(value);

describe("which fences are the team's", () => {
  it("knows the team's fences by name, whatever the case", () => {
    for (const fence of [
      "aven-handoff",
      "aven-verdict",
      "aven-ideas",
      "aven-goal",
      "aven-tasks",
      "aven-findings",
      "aven-mockup",
      "aven-memory",
      "AVEN-HANDOFF",
    ])
      expect(isCrewFence(fence), fence).toBe(true);
    expect(isCrewFence("json")).toBe(false);
    expect(isCrewFence("aven")).toBe(false);
  });
});

describe("what a fence shows in the chat", () => {
  it("counts ideas, each with its size and why", () => {
    expect(
      crewFenceView(
        "aven-ideas",
        body({
          ideas: [
            { title: "Dark mode", size: "small", why: "Night use" },
            { title: "Pause and resume", size: "medium" },
          ],
        }),
      ),
    ).toEqual({
      kind: "ideas",
      label: "2 ideas",
      items: [
        { title: "Dark mode", detail: "small · Night use" },
        { title: "Pause and resume", detail: "medium" },
      ],
    });
    expect(crewFenceView("aven-ideas", body({ ideas: [] }))).toBeNull();
  });

  it("shows a handoff's summary, what ran and how to check; a question as a question", () => {
    expect(
      crewFenceView(
        "aven-handoff",
        body({
          summary: "A switch in Settings.",
          howToCheck: ["Open Settings", "Reload", "Toggle", "Fourth step"],
          ran: [
            { command: "pnpm test", ok: true },
            { command: "pnpm lint", ok: false },
          ],
        }),
      ),
    ).toEqual({
      kind: "handoff",
      label: "Handed over",
      line: "A switch in Settings.",
      items: [
        { title: "ran pnpm test, pnpm lint (failed)" },
        { title: "Open Settings" },
        { title: "Reload" },
        { title: "Toggle" },
      ],
    });
    expect(
      crewFenceView(
        "aven-handoff",
        body({ summary: "", question: "Light or dark first?" }),
      ),
    ).toEqual({
      kind: "handoff",
      label: "Asks you",
      line: "Light or dark first?",
      items: [],
    });
    expect(crewFenceView("aven-handoff", "{nope")).toBeNull();
  });

  it("shows a verdict as Passed or its must-fix items with where", () => {
    expect(
      crewFenceView(
        "aven-verdict",
        body({ pass: true, summary: "All good.", mustFix: [], later: [] }),
      ),
    ).toEqual({
      kind: "verdict",
      label: "Passed",
      line: "All good.",
      items: [],
    });
    expect(
      crewFenceView(
        "aven-verdict",
        body({
          pass: true,
          mustFix: [
            { text: "Reload forgets the choice", where: "theme.ts:41" },
            { text: "No focus ring" },
          ],
        }),
      ),
    ).toEqual({
      kind: "verdict",
      label: "2 must-fix",
      items: [
        { title: "Reload forgets the choice", detail: "theme.ts:41" },
        { title: "No focus ring" },
      ],
    });
  });

  it("shows a goal as met, as next cards, or as nothing left", () => {
    expect(
      crewFenceView("aven-goal", body({ met: true, summary: "Done." })),
    ).toEqual({ kind: "goal", label: "Goal met", line: "Done.", items: [] });
    expect(
      crewFenceView(
        "aven-goal",
        body({
          met: false,
          next: [{ title: "Timer screen", why: "First thing you see" }],
        }),
      ),
    ).toEqual({
      kind: "goal",
      label: "Next for the goal",
      items: [{ title: "Timer screen", detail: "First thing you see" }],
    });
    expect(crewFenceView("aven-goal", body({ met: false, next: [] }))).toEqual({
      kind: "goal",
      label: "Nothing left to plan",
      items: [],
    });
    expect(crewFenceView("aven-goal", "not json")).toBeNull();
  });

  it("shows tasks for the team with their goal, and a goal alone", () => {
    expect(
      crewFenceView(
        "aven-tasks",
        body({
          tasks: ["Timer screen", { title: "Pause", why: "Breaks" }],
          goal: "Build the Pom app",
        }),
      ),
    ).toEqual({
      kind: "tasks",
      label: "2 cards for the team",
      line: "Goal: Build the Pom app",
      items: [{ title: "Timer screen" }, { title: "Pause", detail: "Breaks" }],
    });
    expect(
      crewFenceView("aven-tasks", body({ tasks: [], goal: "Ship it" })),
    ).toEqual({
      kind: "tasks",
      label: "A goal for the team",
      line: "Goal: Ship it",
      items: [],
    });
    expect(crewFenceView("aven-tasks", body({ tasks: [] }))).toBeNull();
  });

  it("counts findings with their sources, and keeps notes to one quiet line", () => {
    expect(
      crewFenceView(
        "aven-findings",
        body({
          summary: "Timers help focus.",
          findings: [
            { text: "25 minutes is common", source: "https://x.test/a" },
            { text: "Breaks matter" },
          ],
          ideas: ["Add a break timer"],
        }),
      ),
    ).toEqual({
      kind: "findings",
      label: "2 findings",
      line: "Timers help focus.",
      items: [
        { title: "25 minutes is common", detail: "https://x.test/a" },
        { title: "Breaks matter" },
      ],
    });
    expect(crewFenceView("aven-memory", "Anything it wrote here.")).toEqual({
      kind: "memory",
      label: "Updated its notes",
      items: [],
    });
    expect(crewFenceView("aven-mockup", body({ file: "x" }))).toBeNull();
    expect(crewFenceView("json", body({}))).toBeNull();
  });
});
