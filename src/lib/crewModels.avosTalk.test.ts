import { describe, expect, it } from "vitest";
import { AVOS_TALK_MODEL, avosTalkModel } from "./crewModels";

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
