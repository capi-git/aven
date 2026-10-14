import { describe, expect, it } from "vitest";
import { planComposerSwitch } from "./handoff";
import { HARNESS_LABEL, newSession, type Block, type Session } from "./session";
import {
  withComposerSwitch,
  withHarnessChoice,
  withPlanBuildTarget,
} from "./sessionModelChoice";

const asked: Block[] = [{ id: "u1", role: "user", text: "hey" }];

function session(extra: Partial<Session> = {}): Session {
  return { ...newSession("cursor", "/tmp/project"), ...extra };
}

describe("withHarnessChoice", () => {
  it("renames an unused session after its new provider", () => {
    const next = withHarnessChoice(session(), "claude", "claude:sonnet-5", {});
    expect(next).toMatchObject({
      harness: "claude",
      model: "claude:sonnet-5",
      title: HARNESS_LABEL.claude,
    });
  });

  it("keeps a used session's title under the new provider", () => {
    const used = session({ blocks: asked, title: "Fix the build" });
    expect(withHarnessChoice(used, "claude", "claude:sonnet-5", {}).title).toBe(
      withHarnessChoice(used, "claude", "claude:opus-5", {}).title,
    );
    expect(
      withHarnessChoice(used, "claude", "claude:sonnet-5", {}).title,
    ).toContain("Fix the build");
  });

  it("drops the context window only when the model changes", () => {
    const used = session({ context: { used: 10, window: 100 } });
    expect(withHarnessChoice(used, "cursor", used.model, {}).context).toEqual({
      used: 10,
      window: 100,
    });
    expect(
      withHarnessChoice(used, "cursor", "cursor:other", {}).context,
    ).toEqual({ used: 10 });
  });

  it("forgets the provider's conversation only when the provider changes", () => {
    const used = session({ providerSessionId: "acp-1" });
    expect(
      withHarnessChoice(used, "cursor", "cursor:other", {}).providerSessionId,
    ).toBe("acp-1");
    expect(
      withHarnessChoice(used, "claude", "claude:sonnet-5", {})
        .providerSessionId,
    ).toBeUndefined();
  });
});

describe("withComposerSwitch", () => {
  const pending = {
    from: "cursor" as const,
    fromModel: "cursor:composer-2",
    fromSettings: {},
    fromProviderSessionId: "acp-1",
  };

  it("arms a pending switch", () => {
    expect(
      withComposerSwitch(session(), { kind: "arm", pending }).pendingSwitch,
    ).toEqual(pending);
  });

  it("reverts to the original provider's conversation", () => {
    const next = withComposerSwitch(session({ pendingSwitch: pending }), {
      kind: "revert",
      restoreProviderSessionId: "acp-1",
    });
    expect(next.pendingSwitch).toBeUndefined();
    expect(next.providerSessionId).toBe("acp-1");
    expect(
      withComposerSwitch(session({ providerSessionId: "x" }), {
        kind: "revert",
      }).providerSessionId,
    ).toBeUndefined();
  });

  it("clears a pending switch on an empty session and leaves model changes alone", () => {
    expect(
      withComposerSwitch(session({ pendingSwitch: pending }), {
        kind: "empty",
        forget: "cursor",
      }).pendingSwitch,
    ).toBeUndefined();
    const same = session({ pendingSwitch: pending });
    expect(withComposerSwitch(same, { kind: "model" })).toBe(same);
  });
});

describe("withPlanBuildTarget", () => {
  it("arms a switch when a used session builds with another provider", () => {
    const used = session({ blocks: asked, providerSessionId: "acp-1" });
    const next = withPlanBuildTarget(used, {
      harness: "claude",
      model: "claude:sonnet-5",
    });
    expect(next.harness).toBe("claude");
    expect(next.pendingSwitch).toEqual(
      (planComposerSwitch(used, "claude") as { pending: unknown }).pending,
    );
    expect(next.providerSessionId).toBeUndefined();
  });
});
