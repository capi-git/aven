// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { PaletteAgent } from "./commandPalette";
import {
  pickerModelsFor,
  resetHarnessModelOverlays,
  savePickerModelVisible,
  setHarnessModels,
} from "./models";
import {
  addRaceLane,
  loadRaceLaneChoice,
  nextRaceAgent,
  raceAgentFor,
  raceLaneChoices,
  removeRaceLane,
  replaceRaceLane,
  resolveRaceAgents,
  saveRaceLaneChoice,
  subscribeRaceAgentChoice,
} from "./raceAgents";
import {
  raceAgentNames,
  raceChipLabel,
  raceShortName,
  raceShortNames,
} from "./raceNames";
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
const harnesses = (lanes: readonly PaletteAgent[]) =>
  lanes.map((lane) => lane.harness);

let data: Map<string, string>;
beforeEach(() => {
  data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

it("starts from the current agent and fills to two with another provider", () => {
  expect(harnesses(resolveRaceAgents(available, agent("codex"), []))).toEqual([
    "codex",
    "claude",
  ]);
});

it("uses the saved lanes, skips unavailable and duplicate ones, and stops at four", () => {
  const lanes = resolveRaceAgents(available, agent("claude"), [
    { harness: "claude" },
    { harness: "fx" as never },
    { harness: "cursor" },
    { harness: "cursor" },
    { harness: "grok" },
    { harness: "opencode" },
    { harness: "codex" },
  ]);
  expect(harnesses(lanes)).toEqual(["claude", "cursor", "grok", "opencode"]);
});

it("races two models of one provider, even with only that provider installed", () => {
  const [usual, other] = pickerModelsFor("claude");
  const claude = { harness: "claude" as const, model: usual.id, label: "x" };
  const lanes = resolveRaceAgents([claude], claude, [
    { harness: "claude", model: other.id },
  ]);
  expect(lanes).toEqual([
    claude,
    {
      harness: "claude",
      model: other.id,
      label: `${HARNESS_TITLE.claude} · ${other.name}`,
    },
  ]);
  // Alone, one provider never fills a second lane by itself.
  expect(resolveRaceAgents([claude], claude, [])).toEqual([claude]);
  // The same provider and model twice is one lane.
  expect(
    resolveRaceAgents([claude], claude, [
      { harness: "claude", model: usual.id },
    ]),
  ).toEqual([claude]);
});

it("migrates the choice an earlier version saved, one lane per provider", () => {
  const [, second] = pickerModelsFor("claude");
  data.set("aven.raceAgents.v1", JSON.stringify(["claude", "grok", "claude"]));
  data.set("aven.raceModels.v1", JSON.stringify({ claude: second.id, x: 1 }));
  expect(loadRaceLaneChoice()).toEqual([
    { harness: "claude", model: second.id, perProvider: true },
    { harness: "grok", perProvider: true },
  ]);
  // Its model went with "the other providers": from a Claude chat it never
  // becomes a second Claude lane, as Codex and Claude on main never did.
  expect(
    harnesses(
      resolveRaceAgents(
        [...available, agent("codex")],
        agent("claude"),
        loadRaceLaneChoice(),
      ),
    ),
  ).toEqual(["claude", "grok"]);
  // A provider saved without a model still never doubles this chat's own.
  expect(
    harnesses(
      resolveRaceAgents(available, agent("grok"), [
        { harness: "grok" },
        { harness: "codex" },
      ]),
    ),
  ).toEqual(["grok", "codex"]);
  // Saving writes the new choice and leaves the old keys for older builds.
  saveRaceLaneChoice([{ harness: "codex", model: "gpt-5" }]);
  expect(loadRaceLaneChoice()).toEqual([{ harness: "codex", model: "gpt-5" }]);
  expect(data.get("aven.raceAgents.v1")).toBe(
    JSON.stringify(["claude", "grok", "claude"]),
  );
});

it("keeps a saved model whose provider's list has not loaded here", () => {
  resetHarnessModelOverlays();
  // Cursor lists its models only once asked: race the saved one meanwhile.
  expect(raceAgentFor(available, "cursor", "cursor:other-model")).toEqual({
    harness: "cursor",
    model: "cursor:other-model",
    label: `${HARNESS_TITLE.cursor} · other-model`,
  });
  // Once its list is in and lacks the model, the usual one races.
  setHarnessModels("cursor", [
    { id: "cursor-model", harness: "cursor", name: "Auto" },
  ]);
  expect(raceAgentFor(available, "cursor", "cursor:other-model")).toEqual(
    agent("cursor"),
  );
  resetHarnessModelOverlays();
});

it("ignores a saved choice it cannot read", () => {
  data.set("aven.raceLanes.v2", "{not json");
  expect(loadRaceLaneChoice()).toEqual([]);
  data.set(
    "aven.raceLanes.v2",
    JSON.stringify([{ harness: "codex", model: 3 }, { model: "x" }, "claude"]),
  );
  expect(loadRaceLaneChoice()).toEqual([{ harness: "codex" }]);
});

it("remembers the lanes after this chat's own and announces changes", () => {
  const listener = vi.fn();
  const stop = subscribeRaceAgentChoice(listener);
  saveRaceLaneChoice(
    raceLaneChoices([agent("claude"), agent("cursor"), agent("codex")]),
  );
  expect(loadRaceLaneChoice()).toEqual([
    { harness: "cursor", model: "cursor-model" },
    { harness: "codex", model: "codex-model" },
  ]);
  expect(listener).toHaveBeenCalledOnce();
  stop();
});

it("never goes below two or above four, and keeps this chat's lane", () => {
  const two = [agent("claude"), agent("codex")];
  expect(removeRaceLane(two, 1)).toHaveLength(2);
  const four = [...two, agent("cursor"), agent("grok")];
  expect(addRaceLane(four, agent("opencode"))).toHaveLength(4);
  expect(harnesses(removeRaceLane(four, 3))).toEqual([
    "claude",
    "codex",
    "cursor",
  ]);
  expect(harnesses(removeRaceLane(four, 0))).toEqual(harnesses(four));
  expect(harnesses(addRaceLane(two, agent("cursor")))).toEqual([
    "claude",
    "codex",
    "cursor",
  ]);
  expect(addRaceLane(two, agent("codex"))).toHaveLength(2);
});

it("adds a second model of a provider that is racing already", () => {
  const [usual, second, third] = pickerModelsFor("claude");
  const claude = { harness: "claude" as const, model: usual.id, label: "x" };
  const lanes = [claude, agent("codex")];
  const next = nextRaceAgent([claude, agent("codex")], lanes, "claude");
  expect(next).toEqual({
    harness: "claude",
    model: second.id,
    label: `${HARNESS_TITLE.claude} · ${second.name}`,
  });
  const three = addRaceLane(lanes, next!);
  expect(nextRaceAgent([claude], three, "claude")?.model).toBe(third.id);
  // Changing a lane's model never makes it another lane's twin.
  expect(replaceRaceLane(three, 2, claude)).toEqual(three);
  const moved = replaceRaceLane(three, 2, { ...claude, model: third.id });
  expect(moved[2].model).toBe(third.id);
});

it("races an agent on the model saved for it, and falls back when it's gone", () => {
  const [first, second] = pickerModelsFor("claude");
  const claude = { harness: "claude" as const, model: first.id, label: "x" };
  expect(raceAgentFor([claude], "claude", second.id)).toEqual({
    harness: "claude",
    model: second.id,
    label: `${HARNESS_TITLE.claude} · ${second.name}`,
  });
  // A model the provider's live list no longer has, or one the user hid,
  // is ignored.
  setHarnessModels("claude", [first, second]);
  expect(raceAgentFor([claude], "claude", "retired-model")).toEqual(claude);
  resetHarnessModelOverlays();
  savePickerModelVisible(second.id, false);
  expect(raceAgentFor([claude], "claude", second.id)).toEqual(claude);
});

it("names lanes unambiguously when one provider races twice", () => {
  const opus = {
    harness: "claude" as const,
    model: "opus",
    label: "Claude Code · Opus 4.6",
  };
  const sonnet = {
    harness: "claude" as const,
    model: "sonnet",
    label: "Claude Code · Claude Sonnet 5",
  };
  const codex = {
    harness: "codex" as const,
    model: "g",
    label: "Codex · GPT-5",
  };
  expect(raceAgentNames([opus, codex])).toEqual(["Claude Code", "Codex"]);
  expect(raceAgentNames([opus, sonnet, codex])).toEqual([
    "Claude Code · Opus 4.6",
    "Claude Code · Claude Sonnet 5",
    "Codex",
  ]);
  expect(raceShortNames([opus, codex])).toEqual(["Claude", "Codex"]);
  expect(raceShortNames([opus, sonnet])).toEqual([
    "Claude Opus 4.6",
    "Claude Sonnet 5",
  ]);
  expect(
    raceShortName({
      harness: "grok",
      model: "g",
      label: "Grok Build · Grok 4.6",
    }),
  ).toBe("Grok 4.6");
  expect(raceChipLabel([opus, codex])).toBe(
    "Race · Claude Opus 4.6 · Codex GPT-5",
  );
});
