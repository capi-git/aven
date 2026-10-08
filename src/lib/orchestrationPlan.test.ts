import { describe, expect, it } from "vitest";
import {
  adoptLateProposal,
  completeOrchestrationProposal,
  hideProposalMarkup,
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
  harness: "codex" as const,
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
  describe("a proposal that arrives after planning ended", () => {
    const failed = completeOrchestrationProposal(draft, "Still investigating");
    const card = { ...proposalBlock("card", failed), streaming: false };
    const tagged = `<aven_proposal>\n${JSON.stringify({
      ...payload,
      tasks: [{ ...task, prompt: "Sign commits with <noreply@example.com>" }],
    })}\n</aven_proposal>`;
    const blocks = [
      { id: "ask", role: "user" as const, text: "Plan it" },
      card,
      { id: "more", role: "user" as const, text: "Also fix the folder" },
      { id: "late", role: "assistant" as const, text: `Ready.\n\n${tagged}` },
    ];

    it("moves the lead's later proposal into the card and out of the chat", () => {
      const adopted = adoptLateProposal(blocks);
      expect(adopted.map((block) => block.id)).toEqual([
        "ask",
        "more",
        "late",
        "card",
      ]);
      expect(adopted[2].text).toBe("Ready.");
      expect(adopted[3].orchestration?.status).toBe("ready");
      expect(adopted[3].orchestration?.tasks[0].prompt).toContain(
        "<noreply@example.com>",
      );
      expect(adopted[3].text).toContain("# Settings");
    });
    it("replaces a reply that was only the proposal", () => {
      const adopted = adoptLateProposal([
        ...blocks.slice(0, 3),
        { id: "late", role: "assistant", text: tagged },
      ]);
      expect(adopted.map((block) => block.id)).toEqual(["ask", "more", "card"]);
    });
    it("adopts native plan output without retaining a second Build action", () => {
      const adopted = adoptLateProposal([
        card,
        {
          id: "native",
          role: "plan",
          text: `Ready.\n${tagged}`,
          plan: { status: "ready", originalText: tagged },
        },
      ]);
      expect(adopted[0]).toEqual({ id: "native", role: "assistant", text: "Ready." });
      expect(adopted[1].orchestration?.status).toBe("ready");
      expect(adoptLateProposal(adopted)).toBe(adopted);
    });
    it("does not resurrect proposals from an earlier turn or a failed continuation", () => {
      const newerTurn = [
        ...blocks,
        { id: "new", role: "user" as const, text: "Never mind, explain this instead" },
        { id: "reply", role: "assistant" as const, text: "Explanation" },
      ];
      expect(adoptLateProposal(newerTurn)).toBe(newerTurn);
      const failedTurn = [
        ...blocks,
        { id: "error", role: "system" as const, text: "Connection lost" },
      ];
      expect(adoptLateProposal(failedTurn)).toBe(failedTurn);
      const stillStreaming = [
        ...blocks,
        { id: "stream", role: "assistant" as const, text: "One more change", streaming: true },
      ];
      expect(adoptLateProposal(stillStreaming)).toBe(stillStreaming);
    });
    it("does not recover an interrupted planning card after persistence", () => {
      const saved = sanitizeSessionForPersist({
        ...newSession("claude", "/repo"),
        blocks: [proposalBlock("card", draft), blocks[3]],
      }).blocks;
      expect(saved[0].orchestration?.status).toBe("invalid");
      expect(adoptLateProposal(saved)).toBe(saved);
    });
    it("leaves ready, started and streaming cards alone", () => {
      const ready = completeOrchestrationProposal(draft, tagged);
      const readyBlocks = [
        { ...proposalBlock("card", ready), streaming: false },
        blocks[3],
      ];
      expect(adoptLateProposal(readyBlocks)).toBe(readyBlocks);
      for (const status of ["planning", "starting", "approved"] as const) {
        const protectedBlocks = [
          card,
          { ...proposalBlock("new-card", { ...ready, status }), streaming: false },
          blocks[3],
        ];
        expect(adoptLateProposal(protectedBlocks)).toBe(protectedBlocks);
      }
      const streaming = [card, { ...blocks[3], streaming: true }];
      expect(adoptLateProposal(streaming)).toBe(streaming);
      const untagged = [card, { ...blocks[3], text: JSON.stringify(payload) }];
      expect(adoptLateProposal(untagged)).toBe(untagged);
    });
    it("shows why a late proposal could not be used", () => {
      const adopted = adoptLateProposal([
        card,
        {
          id: "late",
          role: "assistant",
          text: `<aven_proposal>${JSON.stringify({ ...payload, tasks: [{ ...task, model: "codex:missing" }] })}</aven_proposal>`,
        },
      ]);
      expect(adopted[0].orchestration?.status).toBe("invalid");
      expect(adopted[0].orchestration?.error).toContain(
        "outside the available catalog",
      );
    });
  });
  it("hides proposal markup from chat text, including while it streams", () => {
    expect(hideProposalMarkup("Plain <b>text</b>")).toBe("Plain <b>text</b>");
    expect(
      hideProposalMarkup('Done.\n<aven_proposal>{"title":"x"}</aven_proposal>'),
    ).toBe("Done.");
    expect(hideProposalMarkup('Done.\n<aven_proposal>{"title":"x", "tas')).toBe(
      "Done.",
    );
    expect(hideProposalMarkup("Done.\n<aven_prop")).toBe("Done.");
    expect(hideProposalMarkup("a < b")).toBe("a < b");
    expect(hideProposalMarkup("Use <")).toBe("Use <");
    expect(hideProposalMarkup("Use <a")).toBe("Use <a");
  });
});
