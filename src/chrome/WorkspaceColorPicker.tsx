import { ColorPicker } from "./ColorPicker";
export { hexToHsl, hslToHex } from "../lib/colorUtils";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** The workspace keeps its hue/lightness spectrum and saturation control. */
export function WorkspaceColorPicker({ label, value, onChange }: Props) {
  return (
    <ColorPicker
      value={value}
      model="hsl"
      onChange={onChange}
      uppercase
      shorthand
      invalidEntry="error"
    >
      {(picker) => {
        const color = picker.color;
        return (
          <div className="workspace-color-picker">
            <div
              className="workspace-color-spectrum"
              role="slider"
              tabIndex={0}
              aria-label={`${label} color spectrum`}
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(color.h)}
              aria-valuetext={`${value}; arrow keys adjust hue and brightness`}
              {...picker.field}
            >
              <span
                className="workspace-color-thumb"
                style={{
                  left: `${color.h / 3.6}%`,
                  top: `${100 - color.brightness}%`,
                  backgroundColor: value,
                }}
              />
            </div>
            <div className="workspace-color-entry">
              <input
                type="color"
                value={value}
                aria-label={`Choose ${label.toLowerCase()} color`}
                onChange={(event) => picker.chooseHex(event.target.value)}
              />
              <input
                type="text"
                aria-label={`${label} hex color`}
                value={picker.entry}
                spellCheck={false}
                maxLength={7}
                aria-invalid={picker.invalid || undefined}
                onFocus={picker.beginEntry}
                onChange={(event) => picker.setEntry(event.target.value)}
                onBlur={() => picker.commitEntry()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    picker.commitEntry();
                  }
                }}
              />
              <span className="workspace-color-entry-label">HEX</span>
            </div>
            {picker.invalid ? (
              <p className="workspace-color-error" role="alert">
                Enter a hex color such as #000000.
              </p>
            ) : null}
            <label className="workspace-theme-slider">
              <span>Intensity</span>
              <output>{Math.round(color.s)}%</output>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(color.s)}
                aria-label={`${label} intensity`}
                onChange={(event) =>
                  picker.setSaturation(Number(event.target.value))
                }
              />
            </label>
          </div>
        );
      }}
    </ColorPicker>
  );
}
