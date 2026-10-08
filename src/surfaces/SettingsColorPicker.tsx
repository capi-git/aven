import { clamp } from "../lib/math";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { hexToHsv, hsvToHex, type Hsv } from "../lib/colorUtils";
import "./SettingsColorPicker.css";


const toHex = ({ h, s, v }: Hsv) => hsvToHex(h, s, v);

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
}: {
  targets: readonly Target<T>[];
  target: T;
  onTarget: (target: T) => void;
  colors: Record<T, string>;
  onChange: (target: T, color: string) => void;
  /** Shows a color without saving it, while a drag is in progress. */
  onPreview?: (target: T, color: string) => void;
  note?: string;
}) {
  const value = colors[target];
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const committed = useRef(value);
  const frame = useRef(0);
  const pending = useRef<{
    target: T;
    color: string;
    save: (target: T, color: string) => void;
  } | null>(null);
  const targetButtons = useRef<(HTMLButtonElement | null)[]>([]);

  // Follow outside changes (another target, reset, another window) without
  // replacing the hue the user was dragging with when the colors match.
  useEffect(() => {
    setHex(value);
    if (value.toLowerCase() === committed.current.toLowerCase()) return;
    committed.current = value;
    setHsv(hexToHsv(value));
  }, [value]);

  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const change = pending.current;
    pending.current = null;
    if (change) change.save(change.target, change.color);
  };

  // A different mode or workspace saves elsewhere; finish the old drag first.
  useEffect(() => flush, [onChange]);

  const update = (next: Hsv, dragging = false) => {
    setHsv(next);
    const color = toHex(next);
    setHex(color);
    committed.current = color;
    // Keep the save for the mode and workspace the change started in.
    pending.current = { target, color, save: onChange };
    // A drag only previews; saving (which every window hears) waits for release.
    if (dragging && onPreview) {
      onPreview(target, color);
      return;
    }
    // Other changes save at most once per frame.
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };

  const selectTarget = (next: T) => {
    // A drag still waiting for its frame belongs to the previous color.
    flush();
    onTarget(next);
  };

  const drag =
    (apply: (x: number, y: number) => Hsv) =>
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      element.focus();
      const move = (clientX: number, clientY: number) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        update(
          apply(
            clamp((clientX - rect.left) / rect.width, 0, 1),
            clamp((clientY - rect.top) / rect.height, 0, 1),
          ),
          true,
        );
      };
      move(event.clientX, event.clientY);
      const onMove = (moveEvent: globalThis.PointerEvent) =>
        move(moveEvent.clientX, moveEvent.clientY);
      const onUp = () => {
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerup", onUp);
        element.removeEventListener("pointercancel", onUp);
        flush();
      };
      element.addEventListener("pointermove", onMove);
      element.addEventListener("pointerup", onUp);
      element.addEventListener("pointercancel", onUp);
    };

  const onFieldKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: hsv.s - step },
      ArrowRight: { s: hsv.s + step },
      ArrowUp: { v: hsv.v + step },
      ArrowDown: { v: hsv.v - step },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = { ...hsv, ...move };
    update({ h: next.h, s: clamp(next.s, 0, 100), v: clamp(next.v, 0, 100) });
  };

  const onHueKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 15 : 1;
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? step
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -step
          : 0;
    if (!delta) return;
    event.preventDefault();
    update({ ...hsv, h: (hsv.h + delta + 360) % 360 });
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

  const commitHex = () => {
    const digits = hex.trim().replace(/^#/, "");
    if (!/^[\da-f]{6}$/i.test(digits)) {
      setHex(value);
      return;
    }
    const color = `#${digits.toLowerCase()}`;
    if (color === value.toLowerCase()) {
      setHex(value);
      return;
    }
    committed.current = color;
    setHsv(hexToHsv(color));
    onChange(target, color);
  };

  const label = targets.find((item) => item.value === target)?.label ?? "";

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
                    background: selected ? toHex(hsv) : colors[item.value],
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
            value={hex}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setHex(event.currentTarget.value)}
            onBlur={commitHex}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitHex();
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
        aria-valuetext={`${Math.round(hsv.s)}% richness, ${Math.round(hsv.v)}% brightness`}
        aria-valuenow={Math.round(hsv.v)}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={drag((x, y) => ({
          h: hsv.h,
          s: Math.round(x * 100),
          v: Math.round((1 - y) * 100),
        }))}
        onKeyDown={onFieldKey}
      >
        <span
          className="settings-color-picker__knob"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            background: toHex(hsv),
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
        onPointerDown={drag((x) => ({
          ...hsv,
          h: Math.round(x * 359),
        }))}
        onKeyDown={onHueKey}
      >
        <span
          className="settings-color-picker__knob"
          style={{
            left: `${(hsv.h / 359) * 100}%`,
            background: `hsl(${hsv.h} 100% 50%)`,
          }}
        />
      </div>
      {note ? <p className="settings-color-picker__note">{note}</p> : null}
    </div>
  );
}
