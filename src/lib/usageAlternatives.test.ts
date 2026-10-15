import { describe, expect, it } from "vitest";
import type { AgentModel } from "./models";
import type { HarnessId } from "./session";
import {
  accountHeadroom,
  lighterModel,
  modelWeight,
  usageAlternatives,
} from "./usageAlternatives";
import type { UsageForecastSnapshot, UsageWarning } from "./usageHistory";

const NOW = new Date("2026-10-15T12:00:00Z").getTime();
const HOUR = 3_600_000;

const model = (harness: HarnessId, id: string, name: string): AgentModel => ({
  id: `${harness}:${id}`,
  harness,
  name,
});
const CLAUDE = [
  model("claude", "sonnet-5", "Claude Sonnet 5"),
  model("claude", "opus-5.5", "Claude Opus 5.5"),
  model("claude", "fable-5", "Claude Fable 5"),
  model("claude", "sonnet-4.6", "Sonnet 4.6"),
  model("claude", "haiku-4.5", "Haiku 4.5"),
];
const CODEX = [
  model("codex", "gpt-5.5", "GPT-5.5"),
  model("codex", "gpt-5.5-pro", "GPT-5.5 Pro"),
  model("codex", "gpt-5.4-mini", "GPT-5.4 Mini"),
];
const catalog = (harness: HarnessId) =>
  harness === "claude" ? CLAUDE : harness === "codex" ? CODEX : [];

const warning = (provider: "claude" | "codex"): UsageWarning => ({
  provider,
  kind: "session",
  unseen: true,
  pace: {
    kind: "session",
    used: 70,
    perHour: 30,
    hitAt: NOW + HOUR,
    resetsAt: NOW + 3 * HOUR,
    from: NOW - HOUR,
    to: NOW,
    lastRiseAt: NOW,
    samples: 5,
  },
});

function forecasts(
  codexSession: number | null,
  codexWeekly = 30,
): UsageForecastSnapshot {
  return {
    at: NOW,
    warnings: { claude: warning("claude") },
    providers: {
      claude: {
        latest: { session: { at: NOW, used: 70, resetsAt: NOW + 3 * HOUR } },
        paces: {},
      },
      ...(codexSession == null
        ? {}
        : {
            codex: {
              latest: {
                session: {
                  at: NOW,
                  used: codexSession,
                  resetsAt: NOW + 2 * HOUR,
                },
                weekly: {
                  at: NOW,
                  used: codexWeekly,
                  resetsAt: NOW + 72 * HOUR,
                },
              },
              paces: {},
            },
          }),
    },
  };
}

function alternatives(
  input: Partial<Parameters<typeof usageAlternatives>[0]> = {},
) {
  return usageAlternatives({
    harness: "claude",
    current: CLAUDE[1],
    forecasts: forecasts(12),
    now: NOW,
    isAvailable: () => true,
    catalog,
    preferred: (harness) =>
      harness === "codex" ? "codex:gpt-5.5" : "claude:sonnet-5",
    title: (harness) => (harness === "claude" ? "Claude Code" : "Codex"),
    ...input,
  });
}

describe("lighter models", () => {
  it("ranks models by their names", () => {
    expect(CLAUDE.map(modelWeight)).toEqual([1, 2, 2, 1, 0]);
    expect(CODEX.map(modelWeight)).toEqual([1, 2, 0]);
  });

  it("steps down one size, preferring the provider's choice and then catalog order", () => {
    expect(lighterModel(CLAUDE[1], CLAUDE)?.name).toBe("Claude Sonnet 5");
    expect(lighterModel(CLAUDE[1], CLAUDE, "claude:sonnet-4.6")?.name).toBe(
      "Sonnet 4.6",
    );
    expect(lighterModel(CLAUDE[0], CLAUDE)?.name).toBe("Haiku 4.5");
    expect(lighterModel(CLAUDE[4], CLAUDE)).toBeNull();
    expect(lighterModel(CODEX[0], CODEX)?.name).toBe("GPT-5.4 Mini");
  });
});

describe("headroom", () => {
  it("needs every known window below 80%", () => {
    const snapshot = forecasts(12, 30);
    expect(accountHeadroom(snapshot.providers.codex, undefined, NOW)).toEqual({
      kind: "weekly",
      used: 30,
    });
    const full = forecasts(12, 85);
    expect(accountHeadroom(full.providers.codex, undefined, NOW)).toBeNull();
    expect(accountHeadroom(undefined, undefined, NOW)).toBeNull();
  });

  it("counts a window that has reset since as empty", () => {
    const snapshot = forecasts(95, 30);
    expect(
      accountHeadroom(snapshot.providers.codex, undefined, NOW + 2 * HOUR),
    ).toEqual({ kind: "weekly", used: 30 });
  });

  it("has none while that account is warning too", () => {
    const snapshot = forecasts(12);
    expect(
      accountHeadroom(snapshot.providers.codex, warning("codex"), NOW),
    ).toBeNull();
  });
});

describe("alternatives", () => {
  it("offers another installed account with room, then a lighter model", () => {
    expect(alternatives()).toEqual([
      {
        kind: "provider",
        harness: "codex",
        model: "codex:gpt-5.5",
        label: "Switch to Codex",
        detail: "Continue with Codex · GPT-5.5 (70% of its weekly limit left)",
      },
      {
        kind: "model",
        harness: "claude",
        model: "claude:sonnet-5",
        label: "Use Claude Sonnet 5",
        detail: "Switch to Claude Sonnet 5, which uses less of the limit",
      },
    ]);
  });

  it("leaves out accounts that are not installed, unknown or nearly full", () => {
    const onlyModel = [
      alternatives({ isAvailable: (harness) => harness === "claude" }),
      alternatives({ forecasts: forecasts(null) }),
      alternatives({ forecasts: forecasts(85) }),
    ];
    for (const options of onlyModel)
      expect(options.map((option) => option.kind)).toEqual(["model"]);
  });

  it("offers nothing lighter than the lightest model", () => {
    expect(
      alternatives({ current: CLAUDE[4] }).map((option) => option.kind),
    ).toEqual(["provider"]);
  });

  it("falls back to the first model when the preferred one is missing", () => {
    const [codex] = alternatives({ preferred: () => "codex:gone" });
    expect(codex.model).toBe("codex:gpt-5.5");
  });
});
