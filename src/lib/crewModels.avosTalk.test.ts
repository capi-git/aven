import { describe, expect, it } from "vitest";
import {
  AVOS_MODEL,
  avosPickChoices,
  avosPickOverride,
  avosTalkModel,
  builderRunsOn,
  crewEffortSetting,
  helperRunsOn,
} from "./crewModels";
import { parseTalk } from "./crewTalk";
import { CLAUDE_OPUS_5_5_MODEL } from "./models";

describe("the model Avos answers you on", () => {
  const known = () => true;

  it("is Opus 5.5 at Medium when you haven't picked one for Avos", () => {
    expect(avosTalkModel({ role: "lead" }, known)).toEqual({
      model: AVOS_MODEL,
      effort: "medium",
    });
  });

  it("is yours when you picked one, or on Codex, or for another helper", () => {
    expect(
      avosTalkModel(
        { role: "lead", model: "claude:opus-5-5", chosen: true },
        known,
      ),
    ).toBeUndefined();
    expect(
      avosTalkModel({ role: "lead", harness: "codex", chosen: true }, known),
    ).toBe(undefined);
    // A model Aven gave it when it started isn't yours: Opus 5.5 still.
    expect(
      avosTalkModel({ role: "lead", model: "claude:haiku" }, known),
    ).toEqual({ model: AVOS_MODEL, effort: "medium" });
    expect(avosTalkModel({ role: "builder" }, known)).toBeUndefined();
  });

  it("falls back to your usual model where the quick one isn't there", () => {
    expect(avosTalkModel({ role: "lead" }, () => false)).toBeUndefined();
  });
});

describe("Let Avos choose", () => {
  const efforts = (id: string) =>
    crewEffortSetting("claude", id)?.options.map((option) => option.value) ??
    [];

  it("lists the Builder's newest models with their own efforts, until you pick yourself", () => {
    const crew = {
      members: [{ id: "builder", role: "builder" as const }],
      helperModel: "avos" as const,
    };
    const text = avosPickChoices(crew, () => [
      { id: CLAUDE_OPUS_5_5_MODEL.id },
      { id: "claude:sonnet-5" },
    ])!;
    expect(text).toContain(
      `- ${CLAUDE_OPUS_5_5_MODEL.id} (${efforts(CLAUDE_OPUS_5_5_MODEL.id).join(", ")})`,
    );
    expect(text).toContain("Use only these, by id");
    expect(
      avosPickChoices({
        members: [{ id: "builder", role: "builder", chosen: true }],
        helperModel: "avos",
      }),
    ).toBeUndefined();
    // Avos picks only once you let it: the default is a model you can see.
    expect(avosPickChoices({ members: crew.members })).toBeUndefined();
    expect(avosPickChoices({ members: [] })).toBeUndefined();
  });

  it("uses Avos's pick for a job only while you've let it choose", () => {
    const pick = { model: CLAUDE_OPUS_5_5_MODEL.id, effort: "high" };
    expect(avosPickOverride({}, pick)).toEqual(pick);
    expect(avosPickOverride({ chosen: true }, pick)).toBeUndefined();
    expect(avosPickOverride({}, undefined)).toBeUndefined();
    expect(avosPickOverride(undefined, pick)).toBeUndefined();
  });

  it("reads Avos's pick from its cards", () => {
    const said = parseTalk(
      'On it.\n```aven-talk\n{"line": "On it.", "cards": [{"title": "Fix tab drag", "size": "small", "model": "claude:opus-5-5", "effort": "high"}]}\n```',
    );
    expect(said.cards[0]).toMatchObject({
      title: "Fix tab drag",
      model: "claude:opus-5-5",
      effort: "high",
    });
  });
});

describe("what helpers run on", () => {
  it("is Opus 5.5 at Medium until you pick, yours once you do, none when Avos picks", () => {
    expect(helperRunsOn({})).toEqual({
      model: CLAUDE_OPUS_5_5_MODEL.id,
      effort: "medium",
    });
    expect(
      helperRunsOn({ helperModel: { model: "claude:opus-5", effort: "high" } }),
    ).toEqual({ model: "claude:opus-5", effort: "high" });
    expect(helperRunsOn({ helperModel: "avos" })).toBeUndefined();
  });

  it("sets a Builder's job unless the card or you set it", () => {
    expect(builderRunsOn({}, {}, {})).toEqual({
      model: CLAUDE_OPUS_5_5_MODEL.id,
      effort: "medium",
    });
    expect(builderRunsOn({}, { chosen: true }, {})).toBeUndefined();
    expect(
      builderRunsOn({}, {}, { override: { model: "claude:opus-5" } }),
    ).toEqual({ model: "claude:opus-5" });
    expect(builderRunsOn({ helperModel: "avos" }, {}, {})).toBeUndefined();
  });

  it("uses Avos's pick for a job only while you've let it choose", () => {
    const pick = { model: CLAUDE_OPUS_5_5_MODEL.id, effort: "high" };
    expect(avosPickOverride({}, pick, {})).toBeUndefined();
    expect(avosPickOverride({}, pick, { helperModel: "avos" })).toEqual(pick);
  });
});
