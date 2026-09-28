import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "./harness/types";
import {
  proposalBlock,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "./orchestrationPlan";
import { createOrchestrationProposalStream } from "./orchestrationProposalStream";
import { newSession, type Session } from "./session";

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
const response = `<aven_proposal>${JSON.stringify({
  title: "Settings",
  summary: "Build and validate the settings view",
  tasks: [
    {
      id: "ui",
      title: "Settings UI",
      prompt: "Build the view",
      harness: "codex",
      model: "codex:test",
      files: ["src/settings"],
      dependsOn: [],
    },
  ],
})}</aven_proposal>`;
const completed: HarnessEvent = { type: "message.completed" };

function setup() {
  const stream = createOrchestrationProposalStream("proposal", draft);
  const session: Session = {
    ...newSession("claude", "/repo"),
    id: "lead",
    blocks: [
      { id: "request", role: "user", text: draft.request },
      proposalBlock("proposal", draft),
    ],
  };
  return { stream, session };
}

describe("orchestration proposal callbacks after turn settlement", () => {
  it("keeps a partial response across turn settlement and fills the original card once completed", () => {
    const { stream, session } = setup();
    const split = Math.floor(response.length / 2);
    stream.consume({ type: "message.delta", text: response.slice(0, split) });
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    expect(incomplete.blocks[1].orchestration?.status).toBe("invalid");

    const delta: HarnessEvent = {
      type: "message.delta",
      text: response.slice(split),
    };
    stream.consume(delta);
    expect(stream.recover(incomplete, delta)).toBe(incomplete);
    stream.consume(completed);
    const recovered = stream.recover(incomplete, completed);
    expect(recovered.blocks).toHaveLength(2);
    expect(recovered.blocks[1]).toMatchObject({
      id: "proposal",
      streaming: false,
      orchestration: { status: "ready", title: "Settings" },
    });
    expect(recovered.blocks[1].text).not.toContain("<aven_proposal>");
    expect(stream.recover(recovered, completed)).toBe(recovered);
    // Replaying the same state updater must produce the same card identity.
    expect(stream.recover(incomplete, completed).blocks[1].orchestration).toBe(
      recovered.blocks[1].orchestration,
    );
  });

  it("waits for a complete native plan and handles its authoritative replacement", () => {
    const { stream, session } = setup();
    stream.consume({
      type: "plan",
      text: "Partial commentary",
      streaming: true,
    });
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    const streaming: HarnessEvent = {
      type: "plan",
      text: response,
      streaming: true,
    };
    stream.consume(streaming);
    expect(stream.recover(incomplete, streaming)).toBe(incomplete);
    const final: HarnessEvent = {
      type: "plan",
      text: response,
      streaming: false,
    };
    stream.consume(final);
    expect(
      stream.recover(incomplete, final).blocks[1].orchestration?.status,
    ).toBe("ready");
  });

  it("combines native plan deltas arriving before and after settlement", () => {
    const { stream, session } = setup();
    stream.consume({
      type: "plan",
      text: response.slice(0, 50),
      append: true,
      streaming: true,
    });
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    const final: HarnessEvent = {
      type: "plan",
      text: response.slice(50),
      append: true,
    };
    stream.consume(final);
    expect(
      stream.recover(incomplete, final).blocks[1].orchestration?.status,
    ).toBe("ready");
  });

  it("leaves an unfinished late response recoverable for the next completed message", () => {
    const { stream, session } = setup();
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    stream.consume({
      type: "message.delta",
      text: "Still gathering assignments.",
    });
    stream.consume(completed);
    expect(stream.recover(incomplete, completed)).toBe(incomplete);
    stream.consume({ type: "message.delta", text: response });
    stream.consume(completed);
    expect(
      stream.recover(incomplete, completed).blocks[1].orchestration?.status,
    ).toBe("ready");
  });

  it("does not recover before the planning turn settles", () => {
    const { stream, session } = setup();
    stream.consume({ type: "message.delta", text: response });
    stream.consume(completed);
    expect(stream.recover(session, completed)).toBe(session);
    expect(stream.finish().status).toBe("ready");
  });

  it.each(["ready", "starting", "approved", "invalid"] as const)(
    "does not overwrite a card that has been changed to %s",
    (status) => {
      const { stream, session } = setup();
      const initial = stream.finish();
      const changed = withOrchestrationProposal(session, "proposal", {
        ...initial,
        status,
      });
      stream.consume({ type: "message.delta", text: response });
      stream.consume(completed);
      expect(stream.recover(changed, completed)).toBe(changed);
    },
  );

  it("does not resurrect a removed card or overwrite a newer proposal or user turn", () => {
    for (const later of [
      { id: "new-request", role: "user" as const, text: "Do something else" },
      proposalBlock("new-proposal", { ...draft, status: "invalid" }),
    ]) {
      const { stream, session } = setup();
      const incomplete = withOrchestrationProposal(
        session,
        "proposal",
        stream.finish(),
      );
      stream.consume({ type: "message.delta", text: response });
      stream.consume(completed);
      const changed = { ...incomplete, blocks: [...incomplete.blocks, later] };
      expect(stream.recover(changed, completed)).toBe(changed);
      const removed = { ...incomplete, blocks: [] };
      expect(stream.recover(removed, completed)).toBe(removed);
    }
  });

  it.each(["at settlement", "after settlement"])(
    "rejects provider failure %s",
    (timing) => {
      const { stream, session } = setup();
      const incomplete = withOrchestrationProposal(
        session,
        "proposal",
        stream.finish(
          timing === "at settlement" ? "Provider failed" : undefined,
        ),
      );
      if (timing === "after settlement")
        stream.consume({ type: "session.error", message: "Provider failed" });
      stream.consume({ type: "message.delta", text: response });
      stream.consume(completed);
      expect(stream.recover(incomplete, completed)).toBe(incomplete);
    },
  );

  it("remembers provider failure text even when a native plan snapshot replaces it", () => {
    const { stream, session } = setup();
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    const failure: HarnessEvent = {
      type: "plan",
      text: "Usage limit exceeded",
    };
    stream.consume(failure);
    expect(stream.recover(incomplete, failure)).toBe(incomplete);
    const final: HarnessEvent = { type: "plan", text: response };
    stream.consume(final);
    expect(stream.recover(incomplete, final)).toBe(incomplete);
  });

  it("revokes an untouched recovered card if its provider reports failure after completing the message", () => {
    const { stream, session } = setup();
    const incomplete = withOrchestrationProposal(
      session,
      "proposal",
      stream.finish(),
    );
    stream.consume({ type: "message.delta", text: response });
    stream.consume(completed);
    const ready = stream.recover(incomplete, completed);
    expect(ready.blocks[1].orchestration?.status).toBe("ready");

    const failure: HarnessEvent = {
      type: "session.error",
      message: "Provider failed",
    };
    expect(stream.consume(failure)).toBe(false);
    const rejected = stream.recover(ready, failure);
    expect(rejected.blocks[1].orchestration).toMatchObject({
      status: "invalid",
      tasks: [],
      error: "Provider failed",
    });
    expect(stream.recover(ready, failure).blocks[1].orchestration).toBe(
      rejected.blocks[1].orchestration,
    );
    stream.consume({ type: "message.delta", text: response });
    stream.consume(completed);
    expect(stream.recover(rejected, completed)).toBe(rejected);
  });

  it.each(["ready", "starting", "approved"] as const)(
    "does not revoke a recovered card that the user has changed to %s",
    (status) => {
      const { stream, session } = setup();
      const incomplete = withOrchestrationProposal(
        session,
        "proposal",
        stream.finish(),
      );
      stream.consume({ type: "message.delta", text: response });
      stream.consume(completed);
      const ready = stream.recover(incomplete, completed);
      const changed = withOrchestrationProposal(ready, "proposal", {
        ...ready.blocks[1].orchestration!,
        status,
      });
      const failure: HarnessEvent = {
        type: "session.error",
        message: "Provider failed",
      };
      stream.consume(failure);
      expect(stream.recover(changed, failure)).toBe(changed);
    },
  );

  it("bounds both response channels and fails closed on an oversized response", () => {
    for (const event of [
      { type: "message.delta" as const, text: "x".repeat(200_001) },
      { type: "plan" as const, text: "x".repeat(200_001) },
    ]) {
      const { stream, session } = setup();
      stream.consume(event);
      const result = stream.finish();
      expect(result.status).toBe("invalid");
      expect(result.error).toContain("too large");
      const incomplete = withOrchestrationProposal(session, "proposal", result);
      const replacement: HarnessEvent = { type: "plan", text: response };
      stream.consume(replacement);
      expect(stream.recover(incomplete, replacement)).toBe(incomplete);
    }
  });
});
