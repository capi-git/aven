import { describe, expect, it } from "vitest";
import {
  AVOS_TALK_MODEL,
  avosPickChoices,
  avosPickOverride,
  avosTalkModel,
  crewEffortSetting,
} from "./crewModels";
import { parseTalk } from "./crewTalk";
import { CLAUDE_OPUS_5_5_MODEL } from "./models";

describe("the model Avos answers you on", () => {
  const known = () => true;

  it("is a quick one when you haven't picked one for Avos", () => {
    expect(avosTalkModel({ role: "lead" }, known)).toEqual({
      model: AVOS_TALK_MODEL,
    });
  });

  it("is yours when you picked one, or on Codex, or for another helper", () => {
    expect(
      avosTalkModel({ role: "lead", model: "claude:opus-5-5" }, known),
    ).toBeUndefined();
    expect(avosTalkModel({ role: "lead", harness: "codex" }, known)).toBe(
      undefined,
    );
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
    const crew = { members: [{ id: "builder", role: "builder" as const }] };
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
      }),
    ).toBeUndefined();
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
