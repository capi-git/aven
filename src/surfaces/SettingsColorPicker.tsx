import { useCallback, useRef, type KeyboardEvent } from "react";
import { ColorPicker } from "../chrome/ColorPicker";
import "./SettingsColorPicker.css";

type Target<T extends string> = { value: T; label: string };

/**
 * Choose which color to edit, then drag anywhere in the square for richness
 * and brightness and along the strip for hue. Hue is kept locally so dragging
 * through grey does not forget it.
 */
export function SettingsColorPicker<T extends string>({
  targets,
  target,
  onTarget,
  colors,
  onChange,
  onPreview,
  note,
  scopeKey,
}: {
  targets: readonly Target<T>[];
  target: T;
  onTarget: (target: T) => void;
  colors: Record<T, string>;
  onChange: (target: T, color: string) => void;
  /** Shows a color without saving it, while a drag is in progress. */
  onPreview?: (target: T, color: string) => void;
  note?: string;
  /** Stable workspace/mode identity, separate from callback identity. */
  scopeKey?: string;
}) {
  const targetButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const change = useCallback(
    (color: string) => onChange(target, color),
    [onChange, target],
  );
  const preview = useCallback(
    (color: string) => onPreview?.(target, color),
    [onPreview, target],
  );
  const label = targets.find((item) => item.value === target)?.label ?? "";
  return (
    <ColorPicker
      value={colors[target]}
      model="hsv"
      scope={JSON.stringify([scopeKey, target])}
      onChange={change}
      onPreview={onPreview ? preview : undefined}
    >
      {(picker) => {
        const hsv = picker.color;
        const selectTarget = (next: T) => {
          picker.flush();
          onTarget(next);
        };
        const onTargetKey = (event: KeyboardEvent, index: number) => {
          let next: number;
          if (event.key === "ArrowRight" || event.key === "ArrowDown")
            next = (index + 1) % targets.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
            next = (index - 1 + targets.length) % targets.length;
          else return;
          event.preventDefault();
          selectTarget(targets[next]!.value);
          targetButtons.current[next]?.focus();
        };
        return (
          <div className="settings-color-picker">
            <div className="settings-color-picker__bar">
              <div
                className="settings-color-picker__targets"
                role="radiogroup"
                aria-label="Color to edit"
              >
                {targets.map((item, index) => {
                  const selected = item.value === target;
                  return (
                    <button
                      key={item.value}
                      ref={(node) => {
                        targetButtons.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      className="settings-color-picker__target"
                      onClick={() => selectTarget(item.value)}
                      onKeyDown={(event) => onTargetKey(event, index)}
                    >
                      <span
                        className="settings-color-picker__dot"
                        style={{
                          background: selected
                            ? picker.preview
                            : colors[item.value],
                        }}
                        aria-hidden
                      />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <label className="settings-color-picker__hex">
                <span>Hex</span>
                <input
                  type="text"
                  aria-label={`${label} hex`}
                  value={picker.entry}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={picker.beginEntry}
                  onChange={(event) =>
                    picker.setEntry(event.currentTarget.value)
                  }
                  onBlur={() => picker.commitEntry()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      picker.commitEntry();
                    }
                  }}
                />
              </label>
            </div>
            <div
              className="settings-color-picker__field"
              style={{ ["--picker-hue" as string]: hsv.h }}
              role="slider"
              tabIndex={0}
              aria-label={`${label} richness and brightness`}
              aria-valuetext={`${Math.round(hsv.s)}% richness, ${Math.round(hsv.brightness)}% brightness`}
              aria-valuenow={Math.round(hsv.brightness)}
              aria-valuemin={0}
              aria-valuemax={100}
              {...picker.field}
            >
              <span
                className="settings-color-picker__knob"
                style={{
                  left: `${hsv.s}%`,
                  top: `${100 - hsv.brightness}%`,
                  background: picker.preview,
                }}
              />
            </div>
            <div
              className="settings-color-picker__hue"
              role="slider"
              tabIndex={0}
              aria-label={`${label} hue`}
              aria-valuenow={Math.round(hsv.h)}
              aria-valuemin={0}
              aria-valuemax={359}
              {...picker.hue}
            >
              <span
                className="settings-color-picker__knob"
                style={{
                  left: `${(hsv.h / 359) * 100}%`,
                  background: `hsl(${hsv.h} 100% 50%)`,
                }}
              />
            </div>
            {note ? (
              <p className="settings-color-picker__note">{note}</p>
            ) : null}
          </div>
        );
      }}
    </ColorPicker>
  );
}
