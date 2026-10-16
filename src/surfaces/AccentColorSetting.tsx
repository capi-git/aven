import { useId, useState, type CSSProperties } from "react";
import { accentSwatches, type AccentPreset } from "../lib/accentColors";
import type { ColorScheme } from "../lib/appearance";
import { SETTINGS } from "../lib/settingDefinitions";
import { PresetSwatches, Row } from "./SettingsControls";
import { SettingsColorPicker } from "./SettingsColorPicker";

const ACCENT_ONLY = [{ value: "accent", label: "Accent" }] as const;

/** Palette swatches in the current mode's shades, plus Custom… for any colour. */
export function AccentColorSetting({
  scheme,
  accent,
  selected,
  scopeKey,
  onPreset,
  onCustom,
  onPreviewCustom,
}: {
  scheme: ColorScheme;
  /** The accent in use in this mode. */
  accent: string;
  /** The matching swatch, or null when a custom colour is in use. */
  selected: AccentPreset | null;
  /** Stable workspace/mode identity for the picker's remembered hue. */
  scopeKey: string;
  onPreset: (preset: AccentPreset) => void;
  onCustom: (color: string) => void;
  /** Shows a colour without saving it while a drag is in progress. */
  onPreviewCustom: (color: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const pickerId = useId();
  const swatches = accentSwatches(scheme);
  const custom = selected === null;
  return (
    <>
      <Row {...SETTINGS.accentColor.row}>
        <PresetSwatches
          label={SETTINGS.accentColor.label}
          options={swatches.map((preset) => ({
            value: preset.name,
            label: preset.label,
            swatch: preset.colors[scheme].accent,
          }))}
          value={selected?.name ?? null}
          onChange={(name) => {
            const preset = swatches.find(
              (candidate) => candidate.name === name,
            );
            if (preset) onPreset(preset);
          }}
        />
        <button
          type="button"
          className="settings-button settings-accent-custom"
          aria-expanded={customOpen}
          aria-controls={customOpen ? pickerId : undefined}
          data-checked={custom || undefined}
          title={custom ? `Custom (${accent})` : undefined}
          onClick={() => setCustomOpen((open) => !open)}
        >
          <span
            className="settings-accent-custom-dot"
            style={
              (custom ? { "--swatch": accent } : undefined) as
                CSSProperties | undefined
            }
            aria-hidden
          />
          Custom…
        </button>
      </Row>
      {customOpen ? (
        <div id={pickerId} className="settings-accent-picker">
          <SettingsColorPicker
            scopeKey={scopeKey}
            targets={ACCENT_ONLY}
            target="accent"
            onTarget={() => {}}
            colors={{ accent }}
            onChange={(_, color) => onCustom(color)}
            onPreview={(_, color) => onPreviewCustom(color)}
          />
        </div>
      ) : null}
    </>
  );
}
