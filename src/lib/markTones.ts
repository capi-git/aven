import { hexToHsl } from "./colorUtils";
import { SIGIL_CRITTERS, appearanceSigil } from "./dotSigils";
import type { ProjectAppearance } from "./projectAppearance";
import {
  TAB_GROUP_COLORS,
  saveTabGroupColor,
  saveTabGroupMascot,
} from "./tabGroups";

/**
 * The colour a mark's lit dots take. Grey is the theme's text colour, the
 * plain mark; the others are the `--aven-mark-*` theme tokens, tuned for
 * dark and light.
 */
export type MarkTone =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "teal"
  | "orange";

/**
 * The mark colours, in `TAB_GROUP_COLORS` order: a colour saved for a
 * project before marks (its index) is the mark colour at the same place.
 */
export const MARK_TONES: readonly { tone: MarkTone; label: string }[] = [
  { tone: "grey", label: "Grey" },
  { tone: "blue", label: "Blue" },
  { tone: "red", label: "Red" },
  { tone: "yellow", label: "Yellow" },
  { tone: "green", label: "Green" },
  { tone: "pink", label: "Pink" },
  { tone: "purple", label: "Purple" },
  { tone: "teal", label: "Teal" },
  { tone: "orange", label: "Orange" },
];

/**
 * A swatch's colour, from the theme: Grey's is the text colour toned down,
 * so it reads as grey beside the colours (its mark is the plain one).
 */
export function markToneColor(tone: MarkTone): string {
  return tone === "grey"
    ? "color-mix(in srgb, var(--color-content) 55%, transparent)"
    : `var(--aven-mark-${tone})`;
}

/** Where Grey sits among the choices; saving it keeps the mark plain. */
export const GREY_TONE_INDEX = 0;

const PALETTE_HUES = TAB_GROUP_COLORS.map((color) => {
  const match = /^hsl\((\d+)/.exec(color);
  return match ? Number(match[1]) : 0;
});

/**
 * A custom colour saved before marks, as the nearest mark colour: a washed
 * out, near-black or near-white one reads as Grey, any other by its hue.
 */
export function nearestToneIndex(hex: string): number {
  const { h, s, l } = hexToHsl(hex);
  if (!Number.isFinite(h) || s < 18 || l < 12 || l > 92) return GREY_TONE_INDEX;
  let best = 1;
  let bestDistance = Infinity;
  for (let index = 1; index < PALETTE_HUES.length; index++) {
    const apart = Math.abs(h - PALETTE_HUES[index]) % 360;
    const distance = Math.min(apart, 360 - apart);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/** What a saved colour choice reads from: a pick, a custom colour, or none. */
export type ToneChoice = {
  colorIndex: number | null;
  customColor?: string | null;
  /** The colour shown when nothing is picked; Grey when not given. */
  automaticColorIndex?: number;
};

/** The place in `MARK_TONES` a saved choice shows. */
export function markToneIndex(choice: ToneChoice): number {
  const valid = (index: number | null | undefined): index is number =>
    index != null &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < MARK_TONES.length;
  if (choice.customColor && /^#[0-9a-f]{6}$/i.test(choice.customColor))
    return nearestToneIndex(choice.customColor);
  if (valid(choice.colorIndex)) return choice.colorIndex;
  if (valid(choice.automaticColorIndex)) return choice.automaticColorIndex;
  return GREY_TONE_INDEX;
}

/** The colour a saved choice gives its mark. */
export function markTone(choice: ToneChoice): MarkTone {
  return MARK_TONES[markToneIndex(choice)].tone;
}

/**
 * A project's mark colour: the one picked for it (before marks too), or
 * the one worked out from its name, so every project has its own.
 */
export function appearanceTone(
  appearance: Pick<
    ProjectAppearance,
    "colorIndex" | "customColor" | "automaticColorIndex"
  >,
): MarkTone {
  return markTone(appearance);
}

/**
 * Picks a project's mark colour, saved where its colour was kept before
 * marks. A project that never picked a mark shows one worked out from its
 * colour, so the one it shows is kept first: only the colour changes.
 */
export function saveProjectTone(
  appearance: Pick<
    ProjectAppearance,
    | "key"
    | "mascot"
    | "mascotOverride"
    | "colorIndex"
    | "customColor"
    | "automaticColorIndex"
  >,
  index: number,
): void {
  if (index < 0 || index >= MARK_TONES.length) return;
  if (!appearance.mascotOverride) {
    const shown = appearanceSigil(appearance).key;
    saveTabGroupMascot(appearance.key, SIGIL_CRITTERS[shown] ?? shown);
  }
  saveTabGroupColor(appearance.key, index);
}
