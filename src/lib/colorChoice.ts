/**
 * A colour picked for a surface: "none" keeps its standard look, "accent"
 * follows the workspace accent, and anything else is a #rrggbb colour.
 */
export type ColorChoice = "none" | "accent" | `#${string}`;

export type ColorPreset = { value: ColorChoice; label: string; swatch: string };

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { value: "none", label: "Graphite", swatch: "#8a8f98" },
  { value: "#4f7cff", label: "Ocean", swatch: "#4f7cff" },
  { value: "#12b886", label: "Forest", swatch: "#12b886" },
  { value: "#9b5cff", label: "Plum", swatch: "#9b5cff" },
  { value: "#ff6a3d", label: "Ember", swatch: "#ff6a3d" },
  { value: "#ff5c8a", label: "Rose", swatch: "#ff5c8a" },
  {
    value: "accent",
    label: "Workspace colour",
    swatch: "var(--personal-accent, #5ed9d0)",
  },
];

export function normalizeColorChoice(value: unknown): ColorChoice | null {
  if (value === "none" || value === "accent") return value;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))
    return value.toLowerCase() as ColorChoice;
  return null;
}

export function colorChoiceLabel(value: ColorChoice): string {
  return (
    COLOR_PRESETS.find((preset) => preset.value === value)?.label ?? "Custom"
  );
}
