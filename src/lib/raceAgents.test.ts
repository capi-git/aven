// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { PaletteAgent } from "./commandPalette";
import { pickerModelsFor, savePickerModelVisible } from "./models";
import {
  loadRaceAgentChoice,
  loadRaceModelChoice,
  resolveRaceAgents,
  saveRaceAgentChoice,
  saveRaceModelChoice,
  subscribeRaceAgentChoice,
  toggleRaceAgent,
  withRaceModels,
} from "./raceAgents";
import { HARNESS_TITLE } from "./session";

const agent = (harness: PaletteAgent["harness"]): PaletteAgent => ({
  harness,
  model: `${harness}-model`,
  label: harness,
});
const available = [
  agent("claude"),
  agent("codex"),
  agent("cursor"),
  agent("grok"),
  agent("opencode"),
];

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

it("starts from the current agent and fills to two", () => {
  expect(
    resolveRaceAgents(available, agent("codex"), []).map((a) => a.harness),
  ).toEqual(["codex", "claude"]);
});

it("uses the saved choice, skips unavailable and duplicate agents, and stops at four", () => {
  const lanes = resolveRaceAgents(available, agent("claude"), [
    "claude",
    "fx",
    "cursor",
    "grok",
    "opencode",
    "codex",
  ]);
  expect(lanes.map((a) => a.harness)).toEqual([
    "claude",
    "cursor",
    "grok",
    "opencode",
  ]);
});

it("never goes below two or above four when toggling", () => {
  const two = [agent("claude"), agent("codex")];
  expect(toggleRaceAgent(two, agent("codex"))).toHaveLength(2);
  const four = [...two, agent("cursor"), agent("grok")];
  expect(toggleRaceAgent(four, agent("opencode"))).toHaveLength(4);
  expect(toggleRaceAgent(four, agent("grok")).map((a) => a.harness)).toEqual([
    "claude",
    "codex",
    "cursor",
  ]);
  expect(toggleRaceAgent(two, agent("cursor")).map((a) => a.harness)).toEqual([
    "claude",
    "codex",
    "cursor",
  ]);
});

it("remembers the choice and announces changes", () => {
  const listener = vi.fn();
  const stop = subscribeRaceAgentChoice(listener);
  saveRaceAgentChoice(["cursor", "codex"]);
  expect(loadRaceAgentChoice()).toEqual(["cursor", "codex"]);
  expect(listener).toHaveBeenCalledOnce();
  stop();
});

it("races an agent on the model picked for it, and falls back when it's gone", () => {
  const [first, second] = pickerModelsFor("claude");
  const listener = vi.fn();
  const stop = subscribeRaceAgentChoice(listener);
  saveRaceModelChoice("claude", second.id);
  stop();
  expect(listener).toHaveBeenCalledOnce();
  expect(loadRaceModelChoice()).toEqual({ claude: second.id });
  const claude = { harness: "claude" as const, model: first.id, label: "x" };
  expect(withRaceModels([claude, agent("codex")])).toEqual([
    {
      harness: "claude",
      model: second.id,
      label: `${HARNESS_TITLE.claude} · ${second.name}`,
    },
    agent("codex"),
  ]);
  // A model the provider no longer lists, or one the user hid, is ignored.
  expect(withRaceModels([claude], { claude: "retired-model" })).toEqual([
    claude,
  ]);
  savePickerModelVisible(second.id, false);
  expect(withRaceModels([claude])).toEqual([claude]);
});
