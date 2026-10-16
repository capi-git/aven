import {
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  STATUS_BAR_OPACITY_MAX,
} from "./appearance";
import { clamp } from "./math";

/**
 * One Glass slider stands in for background opacity, blur, "Include
 * workspace" and the status bar tint. Its value is how see-through the window
 * is, in percent: 0 is Solid, and the top of the range is the most
 * transparent window Aven allows (5% opacity).
 */
export const GLASS_LEVEL_MIN = 0;
export const GLASS_LEVEL_MAX = Math.round(
  (SIDEBAR_OPACITY_MAX - SIDEBAR_OPACITY_MIN) * 100,
);

/** One blur pixel for every three points of glass puts Aven's default
 *  (52% opacity, blur 16) exactly on the curve and keeps the most
 *  see-through window at a moderate, cheap-to-composite 32. */
const GLASS_POINTS_PER_BLUR_PIXEL = 3;

/** The status bar keeps a little more body than the window, so the default
 *  glass keeps its 65% bar and Solid makes it solid. */
const STATUS_BAR_OPACITY_PER_WINDOW_OPACITY = 1.25;

export type GlassSettings = {
  opacity: number;
  blur: number;
  bodyGlass: boolean;
  statusBarOpacity: number;
};

/** The slider position for a saved window opacity. Reading it never
 *  rewrites the saved opacity, blur or status bar. */
export function glassLevelFromOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return GLASS_LEVEL_MIN;
  return clamp(
    Math.round((1 - opacity) * 100),
    GLASS_LEVEL_MIN,
    GLASS_LEVEL_MAX,
  );
}

/** Everything one slider position sets together. Solid is opaque with blur
 *  off and no desktop behind sessions; any glass shows the desktop there too,
 *  as "Include workspace" did. */
export function glassSettingsForLevel(level: number): GlassSettings {
  const glass = Number.isFinite(level)
    ? clamp(Math.round(level), GLASS_LEVEL_MIN, GLASS_LEVEL_MAX)
    : GLASS_LEVEL_MIN;
  const opacity = (100 - glass) / 100;
  return {
    opacity,
    blur: Math.round(glass / GLASS_POINTS_PER_BLUR_PIXEL),
    bodyGlass: glass > GLASS_LEVEL_MIN,
    statusBarOpacity: Math.min(
      STATUS_BAR_OPACITY_MAX,
      Math.round(opacity * STATUS_BAR_OPACITY_PER_WINDOW_OPACITY * 100) / 100,
    ),
  };
}

/** The slider's readout: "Solid", or how see-through the window is. */
export function glassLevelLabel(level: number): string {
  return level <= GLASS_LEVEL_MIN ? "Solid" : `${level}%`;
}
