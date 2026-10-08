import { hsvToHex } from "../lib/colorUtils";
import { ColorPicker } from "./ColorPicker";
import { Pipette } from "./icons";

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorSwatchRow({
  colors,
  colorIndex,
  customColor,
  customPickerOpen,
  customHighlighted,
  onPickIndex,
  onToggleCustom,
}: {
  colors: readonly string[];
  colorIndex: number | null | undefined;
  customColor: string | null | undefined;
  customPickerOpen: boolean;
  customHighlighted?: boolean;
  onPickIndex: (index: number) => void;
  onToggleCustom?: () => void;
}) {
  const pipetteActive =
    customHighlighted ?? (customColor != null || customPickerOpen);
  return (
    <div className="flex items-center justify-between gap-1 px-0.5">
      {colors.map((color, index) => {
        const selected =
          customColor == null &&
          (colorIndex === index || (colorIndex == null && index === 0));
        return (
          <button
            key={color}
            type="button"
            title={`Color ${index + 1}`}
            aria-label={`Color ${index + 1}`}
            aria-pressed={selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPickIndex(index)}
            className="grid size-5 place-items-center rounded-full"
          >
            <span
              className={`size-3.5 rounded-full ${
                selected
                  ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent"
                  : ""
              }`}
              style={{ background: color }}
            />
          </button>
        );
      })}
      <button
        type="button"
        title="Custom color"
        aria-label="Custom color"
        aria-expanded={customPickerOpen}
        aria-pressed={customColor != null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleCustom}
        className="grid size-5 place-items-center rounded-full"
      >
        <span
          className={`grid size-3.5 place-items-center overflow-hidden rounded-full ${
            pipetteActive
              ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent"
              : ""
          }`}
          style={
            customColor
              ? { background: customColor }
              : {
                  background:
                    "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                }
          }
        >
          {!customColor ? (
            <Pipette
              className="size-2 text-white drop-shadow-sm"
              strokeWidth={2.25}
            />
          ) : null}
        </span>
      </button>
    </div>
  );
}

export function ColorPickerPopover({ value, onChange }: Props) {
  return (
    <ColorPicker value={value} model="hsv" onChange={onChange}>
      {(picker) => {
        const hsv = picker.color;
        const preview = picker.preview;
        const hueColor = hsvToHex(hsv.h, 100, 100);
        return (
          <div className="mt-2 rounded-lg border border-content/10 bg-content/5 p-2">
            <div
              role="slider"
              aria-label="Saturation and brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.s)}
              className="relative h-28 w-full cursor-crosshair touch-none rounded-md"
              style={{
                background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
              }}
              tabIndex={0}
              {...picker.field}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
                style={{
                  left: `${hsv.s}%`,
                  top: `${100 - hsv.brightness}%`,
                  background: preview,
                }}
              />
            </div>

            <div
              role="slider"
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              className="relative mt-2 h-3 w-full cursor-ew-resize touch-none rounded-full"
              style={{
                background:
                  "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
              tabIndex={0}
              {...picker.hue}
            >
              <span
                className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
                style={{
                  left: `${(hsv.h / 360) * 100}%`,
                  background: hueColor,
                }}
              />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span
                className="size-7 shrink-0 rounded-md border border-content/10"
                style={{ background: preview }}
                aria-hidden
              />
              <input
                type="text"
                value={picker.entry}
                spellCheck={false}
                aria-label="Hex color"
                onFocus={picker.beginEntry}
                onChange={(event) => {
                  const raw = event.target.value;
                  picker.setEntry(raw);
                  if (/^#?[0-9a-fA-F]{6}$/.test(raw.trim()))
                    picker.commitEntry(raw);
                }}
                onBlur={() => picker.commitEntry()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    picker.commitEntry();
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-content/10 bg-content/5 px-2 py-1 font-mono text-[12px] text-content outline-none ring-accent/40 focus:ring-1"
              />
            </div>
          </div>
        );
      }}
    </ColorPicker>
  );
}
