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
  GLASS_LEVEL_MAX,
  GLASS_LEVEL_MIN,
  glassLevelFromOpacity,
  glassLevelLabel,
  glassSettingsForLevel,
} from "./glassLevel";

describe("glass level", () => {
  it("makes Solid an opaque window with blur off, no desktop behind sessions and a solid status bar", () => {
    expect(GLASS_LEVEL_MIN).toBe(0);
    expect(glassSettingsForLevel(0)).toEqual({
      opacity: 1,
      blur: 0,
      bodyGlass: false,
      statusBarOpacity: 1,
    });
    expect(glassLevelLabel(0)).toBe("Solid");
  });

  it("puts Aven's default glass exactly on the curve", () => {
    const level = glassLevelFromOpacity(SIDEBAR_OPACITY_DEFAULT);
    expect(level).toBe(48);
    expect(glassSettingsForLevel(level)).toEqual({
      opacity: SIDEBAR_OPACITY_DEFAULT,
      blur: SIDEBAR_BLUR_DEFAULT,
      bodyGlass: BODY_GLASS_DEFAULT,
      statusBarOpacity: STATUS_BAR_OPACITY_DEFAULT,
    });
    expect(glassLevelLabel(level)).toBe("48%");
  });

  it("stops at the most see-through window Aven allows", () => {
    expect(GLASS_LEVEL_MAX).toBe(95);
    expect(glassSettingsForLevel(GLASS_LEVEL_MAX)).toEqual({
      opacity: SIDEBAR_OPACITY_MIN,
      blur: 32,
      bodyGlass: true,
      statusBarOpacity: 0.06,
    });
    expect(glassSettingsForLevel(500)).toEqual(
      glassSettingsForLevel(GLASS_LEVEL_MAX),
    );
    expect(glassSettingsForLevel(-20)).toEqual(glassSettingsForLevel(0));
    expect(glassSettingsForLevel(Number.NaN)).toEqual(glassSettingsForLevel(0));
  });

  it("grows blur and thins the status bar as the window becomes more see-through", () => {
    let previous = glassSettingsForLevel(GLASS_LEVEL_MIN);
    for (let level = 1; level <= GLASS_LEVEL_MAX; level += 1) {
      const next = glassSettingsForLevel(level);
      expect(next.opacity).toBeLessThan(previous.opacity);
      expect(next.blur).toBeGreaterThanOrEqual(previous.blur);
      expect(next.blur).toBeLessThanOrEqual(SIDEBAR_BLUR_MAX);
      expect(next.statusBarOpacity).toBeLessThanOrEqual(
        previous.statusBarOpacity,
      );
      expect(next.bodyGlass).toBe(true);
      previous = next;
    }
  });

  it("maps a middle position and common saved opacities to sensible pairs", () => {
    expect(glassSettingsForLevel(30)).toEqual({
      opacity: 0.7,
      blur: 10,
      bodyGlass: true,
      statusBarOpacity: 0.88,
    });
    // A 35% window (blur 11 and a 21% bar saved separately) reads as 65%
    // glass; only moving the slider replaces those with 22 and 44%.
    expect(glassLevelFromOpacity(0.35)).toBe(65);
    expect(glassSettingsForLevel(65)).toEqual({
      opacity: 0.35,
      blur: 22,
      bodyGlass: true,
      statusBarOpacity: 0.44,
    });
    expect(glassLevelFromOpacity(0.15)).toBe(85);
  });

  it("reads every saved opacity back to the slider without drift", () => {
    expect(glassLevelFromOpacity(1)).toBe(0);
    expect(glassLevelFromOpacity(0.05)).toBe(GLASS_LEVEL_MAX);
    expect(glassLevelFromOpacity(0)).toBe(GLASS_LEVEL_MAX);
    expect(glassLevelFromOpacity(Number.NaN)).toBe(0);
    for (let level = 0; level <= GLASS_LEVEL_MAX; level += 1)
      expect(glassLevelFromOpacity(glassSettingsForLevel(level).opacity)).toBe(
        level,
      );
  });
});
