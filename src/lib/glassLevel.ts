import {
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  STATUS_BAR_OPACITY_MAX,
} from "./appearance";
import { clamp } from "./math";

/**
 * Two sliders set the window's glass. Opacity is how solid the window's own
 * surface is, in percent: 100 is Solid, 5 the most see-through window Aven
 * allows. Translucency is how clearly the desktop shows through it: 100 is
 * clear glass, 0 fully frosted.
 *
 * Both read the workspace's saved opacity and blur, which earlier versions
 * already stored separately, so an existing look reads back unchanged. The
 * former single Glass slider moved both together; the blur barely changed
 * while the dark tint did, so it read as "darker" rather than "more glass".
 */
export const OPACITY_PERCENT_MIN = Math.round(SIDEBAR_OPACITY_MIN * 100);
export const OPACITY_PERCENT_MAX = Math.round(SIDEBAR_OPACITY_MAX * 100);
export const TRANSLUCENCY_MIN = 0;
export const TRANSLUCENCY_MAX = 100;

/** The status bar keeps a little more body than the window, so the default
 *  glass keeps its 65% bar and Solid makes it solid. */
const STATUS_BAR_OPACITY_PER_WINDOW_OPACITY = 1.25;

export type OpacitySettings = {
  opacity: number;
  bodyGlass: boolean;
  statusBarOpacity: number;
};

function wholeIn(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
}

/** The Opacity slider position for a saved window opacity. */
export function opacityPercentFromOpacity(opacity: number): number {
  return wholeIn(
    opacity * 100,
    OPACITY_PERCENT_MIN,
    OPACITY_PERCENT_MAX,
    OPACITY_PERCENT_MAX,
  );
}

/** What one Opacity position sets: Solid shows no desktop behind sessions;
 *  any glass shows it there too. Blur is the Translucency slider's. */
export function glassSettingsForOpacity(percent: number): OpacitySettings {
  const opacity =
    wholeIn(
      percent,
      OPACITY_PERCENT_MIN,
      OPACITY_PERCENT_MAX,
      OPACITY_PERCENT_MAX,
    ) / 100;
  return {
    opacity,
    bodyGlass: opacity < SIDEBAR_OPACITY_MAX,
    statusBarOpacity: Math.min(
      STATUS_BAR_OPACITY_MAX,
      Math.round(opacity * STATUS_BAR_OPACITY_PER_WINDOW_OPACITY * 100) / 100,
    ),
  };
}

export function opacityLabel(percent: number): string {
  return percent >= OPACITY_PERCENT_MAX ? "Solid" : `${percent}%`;
}

/** The Translucency slider position for a saved blur radius. */
export function translucencyFromBlur(blur: number): number {
  const radius = wholeIn(blur, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX, 0);
  return Math.round(TRANSLUCENCY_MAX - (radius / SIDEBAR_BLUR_MAX) * 100);
}

/** The blur radius for a Translucency position: less blur, more shows. */
export function blurForTranslucency(translucency: number): number {
  const value = wholeIn(
    translucency,
    TRANSLUCENCY_MIN,
    TRANSLUCENCY_MAX,
    TRANSLUCENCY_MAX,
  );
  return Math.round(((TRANSLUCENCY_MAX - value) / 100) * SIDEBAR_BLUR_MAX);
}

export function translucencyLabel(translucency: number): string {
  return translucency >= TRANSLUCENCY_MAX ? "Clear" : `${translucency}%`;
}
