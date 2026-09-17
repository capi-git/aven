import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function hexToHsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (delta) {
    h =
      max === r
        ? ((g - b) / delta) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return {
    h,
    s: delta ? (delta / (1 - Math.abs(2 * l - 1))) * 100 : 0,
    l: l * 100,
  };
}

export function hslToHex(h: number, s: number, l: number) {
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** CSS-only spectrum: no canvas, dependency, or work outside an active gesture. */
export function WorkspaceColorPicker({ label, value, onChange }: Props) {
  const color = hexToHsl(value);
  const [entry, setEntry] = useState(value.toUpperCase());
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);
  const callback = useRef(onChange);
  callback.current = onChange;
  const drag = useRef<{ bounds: DOMRect; saturation: number } | null>(null);
  const pending = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!editing.current) {
      setEntry(value.toUpperCase());
      setInvalid(false);
    }
  }, [value]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current) callback.current(pending.current);
    pending.current = null;
  };
  const choose = (event: PointerEvent<HTMLDivElement>, immediate: boolean) => {
    const gesture = drag.current;
    if (!gesture || !gesture.bounds.width || !gesture.bounds.height) return;
    const x = clamp(
      (event.clientX - gesture.bounds.left) / gesture.bounds.width,
      0,
      1,
    );
    const y = clamp(
      (event.clientY - gesture.bounds.top) / gesture.bounds.height,
      0,
      1,
    );
    pending.current = hslToHex(x * 360, gesture.saturation, (1 - y) * 100);
    if (immediate) flush();
    else if (frame.current === null)
      frame.current = requestAnimationFrame(flush);
  };
  const keyColor = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const h =
      color.h +
      (event.key === "ArrowRight"
        ? step
        : event.key === "ArrowLeft"
          ? -step
          : 0);
    const l =
      event.key === "Home"
        ? 100
        : event.key === "End"
          ? 0
          : color.l +
            (event.key === "ArrowUp"
              ? step
              : event.key === "ArrowDown"
                ? -step
                : 0);
    callback.current(hslToHex(h, color.s || 100, l));
  };
  const commitEntry = () => {
    const normalized = entry.trim().replace(/^#/, "");
    if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(normalized)) {
      setInvalid(true);
      return;
    }
    const full =
      normalized.length === 3
        ? [...normalized].map((n) => n + n).join("")
        : normalized;
    const hex = `#${full.toLowerCase()}`;
    setEntry(hex.toUpperCase());
    setInvalid(false);
    callback.current(hex);
  };
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
        onKeyDown={keyColor}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = {
            bounds: event.currentTarget.getBoundingClientRect(),
            saturation: color.s || 100,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          choose(event, true);
        }}
        onPointerMove={(event) => {
          if (drag.current) choose(event, false);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          choose(event, true);
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          flush();
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          flush();
          drag.current = null;
        }}
      >
        <span
          className="workspace-color-thumb"
          style={{
            left: `${color.h / 3.6}%`,
            top: `${100 - color.l}%`,
            backgroundColor: value,
          }}
        />
      </div>
      <div className="workspace-color-entry">
        <input
          type="color"
          value={value}
          aria-label={`Choose ${label.toLowerCase()} color`}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          aria-label={`${label} hex color`}
          value={entry}
          spellCheck={false}
          maxLength={7}
          aria-invalid={invalid || undefined}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(event) => {
            setEntry(event.target.value);
            setInvalid(false);
          }}
          onBlur={() => {
            editing.current = false;
            commitEntry();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commitEntry();
            }
          }}
        />
        <span className="workspace-color-entry-label">HEX</span>
      </div>
      {invalid ? (
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
            onChange(hslToHex(color.h, Number(event.target.value), color.l))
          }
        />
      </label>
    </div>
  );
}
