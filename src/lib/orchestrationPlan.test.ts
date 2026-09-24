import { describe, expect, it } from "vitest";
import {
  completeOrchestrationProposal,
  orchestrationPlanningPrompt,
  proposalBlock,
  restoreOrchestrationProposal,
  validateProposedTasks,
  type OrchestrationProposal,
} from "./orchestrationPlan";
import { newSession } from "./session";
import { sanitizeSessionForPersist } from "./sessionStore";
import { stopStreaming } from "./harness/apply";

const draft: OrchestrationProposal = {
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  request: "Build settings",
  author: { harness: "claude", model: "claude:test", name: "Lead" },
  settings: {
    choices: [{ harness: "codex", model: "codex:test", name: "Worker" }],
    maxWorkers: 2,
  },
  status: "planning",
  title: "Planning",
  summary: "",
  tasks: [],
};
const task = {
  id: "ui",
  title: "Settings UI",
  prompt: "Build the view",
  harness: "codex",
  model: "codex:test",
  files: ["src/settings"],
  dependsOn: [],
};
const payload = {
  title: "Settings",
  summary: "Build the view, then validate",
  tasks: [task],
};

describe("orchestration proposals", () => {
  it("prompts the current lead with the available model catalog and no execution authority", () => {
    const prompt = orchestrationPlanningPrompt(draft.request, draft.settings);
    expect(prompt).toContain("do not edit files, start workers");
    expect(prompt).toContain('"model":"codex:test"');
    expect(prompt).toContain("until the user confirms");
    expect(prompt).toContain("<aven_proposal>");
    expect(prompt).not.toContain("monocode_proposal");
    expect(prompt).toContain("fewest useful tasks");
    expect(prompt).toContain("Do not ask the user to assemble a team");
    expect(prompt).toContain("disjoint files");
    expect(prompt).toContain("acceptance checks");
  });
  it("turns the lead's structured response into a ready card without changing the discovered catalog", () => {
    const result = completeOrchestrationProposal(
      draft,
      `Commentary\n<aven_proposal>${JSON.stringify({ ...payload, settings: { choices: [] } })}</aven_proposal>`,
    );
    expect(result.status).toBe("ready");
    expect(result.tasks).toEqual(payload.tasks);
    expect(result.settings).toEqual(draft.settings);
    expect(result.author).toEqual(draft.author);
  });
  it("accepts historical proposal tags without treating mismatched tags as complete", () => {
    const result = completeOrchestrationProposal(
      draft,
      `Commentary\n<monocode_proposal>${JSON.stringify(payload)}</monocode_proposal>`,
    );
    expect(result.status).toBe("ready");
    expect(result.tasks).toEqual(payload.tasks);
    expect(
      completeOrchestrationProposal(
        draft,
        `<aven_proposal>${JSON.stringify(payload)}</monocode_proposal>`,
      ).status,
    ).toBe("invalid");
  });
  it("accepts fenced JSON and rejects prose or a model outside the available catalog", () => {
    expect(
      completeOrchestrationProposal(
        draft,
        "```json\n" + JSON.stringify(payload) + "\n```",
      ).status,
    ).toBe("ready");
    expect(
      completeOrchestrationProposal(draft, "I will implement it now").status,
    ).toBe("invalid");
    const invalid = completeOrchestrationProposal(
      draft,
      JSON.stringify({
        ...payload,
        tasks: [{ ...task, model: "codex:unselected" }],
      }),
    );
    expect(invalid.status).toBe("invalid");
    expect(invalid.error).toContain("available catalog");
    expect(invalid.tasks).toEqual([]);
  });
  it("uses assistant assignments when the native plan contains only prose", () => {
    const result = completeOrchestrationProposal(draft, [
      "I'll investigate the current editor first.",
      `Commentary\n<aven_proposal>${JSON.stringify(payload)}</aven_proposal>`,
    ]);
    expect(result.status).toBe("ready");
    expect(result.tasks).toEqual(payload.tasks);
  });
  it("skips unrelated fenced objects and preserves JSON string contents", () => {
    const proposal = {
      ...payload,
      summary: 'Review {details} and the "draft".',
      tasks: [{ ...task, prompt: "Keep the literal ``` marker" }],
    };
    const result = completeOrchestrationProposal(
      draft,
      '```json\n{"note":"investigation"}\n```\n' +
        `<aven_proposal>${JSON.stringify(proposal)}</aven_proposal>`,
    );
    expect(result.status).toBe("ready");
    expect(result.tasks).toEqual(proposal.tasks);
  });
  it("reports provider limits instead of parsing earlier commentary", () => {
    const limit =
      "You've hit your session limit · resets 11:50am (America/Los_Angeles)";
    const result = completeOrchestrationProposal(
      draft,
      "I'll investigate first.\n" + limit,
    );
    expect(result.status).toBe("invalid");
    expect(result.error).toBe(limit);
    expect(result.tasks).toEqual([]);
    expect(
      completeOrchestrationProposal(draft, JSON.stringify(payload), limit)
        .error,
    ).toBe(limit);
  });
  it.each([
    "",
    "I'll investigate the editor first.",
    '<aven_proposal>{"title":',
    "<aven_proposal>{invalid}</aven_proposal>",
  ])(
    "keeps missing or malformed proposals non-executable without raw parser errors: %s",
    (response) => {
      const result = completeOrchestrationProposal(
        { ...draft, tasks: [task] },
        response,
      );
      expect(result.status).toBe("invalid");
      expect(result.error).toContain("complete assignment proposal");
      expect(result.error).not.toMatch(/JSON|Unexpected/);
      expect(result.tasks).toEqual([]);
    },
  );
  it("replaces saved parser errors with a readable retry explanation", () => {
    const saved = {
      ...draft,
      status: "invalid" as const,
      error:
        'Could not prepare the assignment card: JSON Parse error: Unexpected identifier "I"',
    };
    expect(restoreOrchestrationProposal(saved).error).toContain(
      "complete assignment proposal",
    );
    expect(
      restoreOrchestrationProposal({ ...saved, error: "Connection lost" })
        .error,
    ).toBe("Connection lost");
  });
  it("validates cycles, unknown dependencies and path escapes before execution", () => {
    const settings = draft.settings;
    expect(() =>
      validateProposedTasks([{ ...task, dependsOn: ["ui"] }], settings),
    ).toThrow("cycle");
    expect(() =>
      validateProposedTasks([{ ...task, dependsOn: ["missing"] }], settings),
    ).toThrow("unknown assignment");
    expect(() =>
      validateProposedTasks([{ ...task, files: ["../outside"] }], settings),
    ).toThrow("project-relative");
    expect(() => validateProposedTasks([task, task], settings)).toThrow(
      "unique",
    );
    expect(
      validateProposedTasks(
        [
          { ...task, dependsOn: ["data"] },
          { ...task, id: "data" },
        ],
        settings,
      ),
    ).toHaveLength(2);
  });
  it("keeps model edits and assignments through persistence", () => {
    const proposal = completeOrchestrationProposal(
      draft,
      JSON.stringify(payload),
    );
    proposal.tasks[0].prompt = "User edited the instructions";
    const session = {
      ...newSession("claude", "/repo"),
      blocks: [proposalBlock("proposal", proposal)],
    };
    expect(sanitizeSessionForPersist(session).blocks[0].orchestration).toEqual(
      proposal,
    );
  });
  it("makes interrupted planning non-executable on stop and reload", () => {
    const session = {
      ...newSession("claude", "/repo"),
      busy: true,
      blocks: [proposalBlock("proposal", draft)],
    };
    expect(stopStreaming(session).blocks[0].orchestration?.status).toBe(
      "invalid",
    );
    expect(
      sanitizeSessionForPersist(session).blocks[0].orchestration?.status,
    ).toBe("invalid");
  });
});
