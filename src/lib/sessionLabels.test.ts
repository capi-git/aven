import { afterEach, describe, expect, it } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "./models";
import type { Session } from "./session";
import {
  compactModelNames,
  sessionModelIdentity,
  sessionModelName,
  sessionModelNames,
  sessionPaneLabel,
} from "./sessionLabels";

const session = (patch: Partial<Session> = {}): Session => ({
  id: "session",
  harness: "codex",
  model: "codex:local-model",
  modelSettings: {},
  runtimeMode: "full-access",
  title: "codex",
  cwd: "/qa",
  blocks: [],
  ...patch,
});

afterEach(resetHarnessModelOverlays);

describe("truthful session labels", () => {
  it("uses the exact live catalog name for a model id or native id", () => {
    setHarnessModels("codex", [
      {
        id: "codex:local-model",
        nativeId: "local-model",
        name: "Local Model 2",
        harness: "codex",
      },
    ]);
    expect(sessionPaneLabel(session())).toEqual({
      headline: "Local Model 2",
      model: "",
      tooltip: "Local Model 2",
    });
    expect(sessionModelName({ harness: "codex", model: "local-model" })).toBe(
      "Local Model 2",
    );
  });

  it("keeps a long provider prefix out of the compact label while retaining its full catalog name in the tooltip", () => {
    setHarnessModels("claude", [
      {
        id: "claude:qa-model",
        harness: "claude",
        name: "Claude Code QA Model",
      },
    ]);
    expect(
      sessionPaneLabel(
        session({
          harness: "claude",
          title: "claude",
          model: "claude:qa-model",
        }),
      ),
    ).toEqual({
      headline: "QA Model",
      model: "",
      tooltip: "Claude Code QA Model",
    });
    expect(
      compactModelNames(["Claude Code QA Model", "Codex Another Model"]),
    ).toBe("QA Model + Another Model");
  });

  it("does not label an unknown saved model as the current default or a prefix match", () => {
    setHarnessModels("codex", [
      { id: "codex:local-model", name: "Current default", harness: "codex" },
    ]);
    expect(
      sessionModelName({
        harness: "codex",
        model: "codex:local-model-experimental",
      }),
    ).toBe("local-model-experimental");
    expect(
      sessionModelName({ harness: "claude", model: "claude:local-model" }),
    ).toBe("local-model");
    expect(sessionModelName({ harness: "codex", model: "" })).toBe("Codex");
  });

  it("preserves a useful task title and adds its selected model", () => {
    expect(
      sessionPaneLabel(session({ title: "codex · Repair browser" })),
    ).toEqual({
      headline: "Repair browser",
      model: "local-model",
      tooltip: "Repair browser · local-model",
    });
    expect(sessionPaneLabel(session({ title: "  " })).headline).toBe(
      "local-model",
    );
    expect(sessionPaneLabel(session({ title: "New session" })).headline).toBe(
      "local-model",
    );
  });

  it("keeps the running model visible when the composer has a pending provider switch", () => {
    const pending = session({
      harness: "claude",
      model: "claude:next-model",
      busy: true,
      blocks: [
        {
          id: "turn",
          role: "user",
          text: "Run",
          startedAt: 1,
          turnModel: { harness: "codex", model: "codex:running-model" },
        },
      ],
      pendingSwitch: {
        from: "codex",
        fromModel: "codex:running-model",
        fromSettings: {},
      },
    });
    expect(sessionModelIdentity(pending)).toEqual({
      harness: "codex",
      model: "codex:running-model",
    });
    expect(sessionModelName(sessionModelIdentity(pending))).toBe(
      "running-model",
    );
    expect(
      sessionModelName(sessionModelIdentity({ ...pending, busy: false })),
    ).toBe("next-model");
  });

  it("uses the captured turn model through same-provider picker changes and steered messages", () => {
    const working = session({
      model: "codex:next-model",
      busy: true,
      blocks: [
        {
          id: "turn",
          role: "user",
          text: "Run",
          startedAt: 1,
          turnModel: { harness: "codex", model: "codex:running-model" },
        },
        { id: "steer", role: "user", text: "Also check tabs" },
      ],
    });
    expect(sessionModelName(sessionModelIdentity(working))).toBe(
      "running-model",
    );
    expect(
      sessionModelName(sessionModelIdentity({ ...working, busy: false })),
    ).toBe("next-model");
  });

  it("marks legacy live-turn selections explicitly instead of guessing their running model", () => {
    const legacy = session({ busy: true });
    expect(sessionModelName(sessionModelIdentity(legacy))).toBe(
      "Selected: local-model",
    );
    expect(
      sessionModelName(
        sessionModelIdentity({
          ...legacy,
          blocks: [
            {
              id: "old",
              role: "user",
              text: "Done",
              startedAt: 1,
              durationMs: 100,
              turnModel: { harness: "codex", model: "old-model" },
            },
          ],
        }),
      ),
    ).toBe("Selected: local-model");
  });

  it("deduplicates repeated models without losing focused-first order or the full model list", () => {
    const names = sessionModelNames([
      { harness: "codex", model: "focused" },
      { harness: "codex", model: "other" },
      { harness: "codex", model: "focused" },
      { harness: "claude", model: "third" },
    ]);
    expect(names).toEqual(["focused", "other", "third"]);
    expect(compactModelNames(names)).toBe("focused +2 models");
    expect(compactModelNames(names.slice(0, 2))).toBe("focused + other");
  });
});
