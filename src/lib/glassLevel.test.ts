import { describe, expect, it } from "vitest";
import {
  BODY_GLASS_DEFAULT,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_OPACITY_DEFAULT,
  SIDEBAR_OPACITY_MIN,
  STATUS_BAR_OPACITY_DEFAULT,
} from "./appearance";
import {
  blurForTranslucency,
  glassSettingsForOpacity,
  OPACITY_PERCENT_MAX,
  OPACITY_PERCENT_MIN,
  opacityLabel,
  opacityPercentFromOpacity,
  translucencyFromBlur,
  translucencyLabel,
} from "./glassLevel";

describe("opacity slider", () => {
  it("makes 100% Solid with no desktop behind sessions and a solid status bar", () => {
    expect(OPACITY_PERCENT_MAX).toBe(100);
    expect(glassSettingsForOpacity(100)).toEqual({
      opacity: 1,
      bodyGlass: false,
      statusBarOpacity: 1,
    });
    expect(opacityLabel(100)).toBe("Solid");
  });

  it("reads Aven's default glass back unchanged", () => {
    const percent = opacityPercentFromOpacity(SIDEBAR_OPACITY_DEFAULT);
    expect(percent).toBe(52);
    expect(glassSettingsForOpacity(percent)).toEqual({
      opacity: SIDEBAR_OPACITY_DEFAULT,
      bodyGlass: BODY_GLASS_DEFAULT,
      statusBarOpacity: STATUS_BAR_OPACITY_DEFAULT,
    });
    expect(opacityLabel(percent)).toBe("52%");
  });

  it("stops at the most see-through window Aven allows", () => {
    expect(OPACITY_PERCENT_MIN).toBe(5);
    expect(glassSettingsForOpacity(5)).toEqual({
      opacity: SIDEBAR_OPACITY_MIN,
      bodyGlass: true,
      statusBarOpacity: 0.06,
    });
    expect(glassSettingsForOpacity(-20)).toEqual(glassSettingsForOpacity(5));
    expect(glassSettingsForOpacity(500)).toEqual(glassSettingsForOpacity(100));
    expect(glassSettingsForOpacity(Number.NaN)).toEqual(
      glassSettingsForOpacity(100),
    );
  });

  it("reads every saved opacity back without drift", () => {
    expect(opacityPercentFromOpacity(0)).toBe(5);
    expect(opacityPercentFromOpacity(Number.NaN)).toBe(100);
    for (let p = OPACITY_PERCENT_MIN; p <= OPACITY_PERCENT_MAX; p += 1)
      expect(
        opacityPercentFromOpacity(glassSettingsForOpacity(p).opacity),
      ).toBe(p);
  });
});

describe("translucency slider", () => {
  it("maps clear glass to no blur and fully frosted to the most blur", () => {
    expect(blurForTranslucency(100)).toBe(0);
    expect(blurForTranslucency(0)).toBe(SIDEBAR_BLUR_MAX);
    expect(translucencyLabel(100)).toBe("Clear");
    expect(translucencyLabel(40)).toBe("40%");
    expect(blurForTranslucency(Number.NaN)).toBe(0);
    expect(blurForTranslucency(-5)).toBe(SIDEBAR_BLUR_MAX);
  });

  it("keeps the old Glass slider's saved blur exactly", () => {
    // The old slider stored blur = glass/3; the default glass saved 16 and
    // the most see-through 32. Each reads back to the same blur.
    expect(translucencyFromBlur(SIDEBAR_BLUR_DEFAULT)).toBe(75);
    for (let blur = 0; blur <= SIDEBAR_BLUR_MAX; blur += 1)
      expect(blurForTranslucency(translucencyFromBlur(blur))).toBe(blur);
  });

  it("frosts more as translucency falls", () => {
    let previous = blurForTranslucency(100);
    for (let t = 99; t >= 0; t -= 1) {
      const next = blurForTranslucency(t);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});
