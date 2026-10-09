import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { hexToHsl, hexToHsv, hslToHex, hsvToHex } from "../lib/colorUtils";
import { clamp } from "../lib/math";

/** Brightness means lightness in the existing HSL workspace spectrum. */
type Coordinates = { h: number; s: number; brightness: number };
type Model = "hsl" | "hsv";
type Surface = "field" | "hue";
type SurfaceEvents = Pick<
  HTMLAttributes<HTMLDivElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onLostPointerCapture"
  | "onKeyDown"
>;

type PickerState = {
  color: Coordinates;
  preview: string;
  entry: string;
  invalid: boolean;
  field: SurfaceEvents;
  hue: SurfaceEvents;
  setEntry: (value: string) => void;
  beginEntry: () => void;
  commitEntry: (raw?: string) => void;
  chooseHex: (value: string) => void;
  setSaturation: (value: number) => void;
  flush: () => void;
};

type Props = {
  value: string;
  model: Model;
  onChange: (value: string) => void;
  onPreview?: (value: string) => void;
  uppercase?: boolean;
  shorthand?: boolean;
  invalidEntry?: "reset" | "error";
  /** End a gesture only when its edited target, workspace, or mode changes. */
  scope?: string;
  children: (picker: PickerState) => ReactNode;
};

function fromHex(value: string, model: Model): Coordinates {
  if (model === "hsl") {
    const color = hexToHsl(value);
    return { h: color.h, s: color.s, brightness: color.l };
  }
  const color = hexToHsv(value);
  return { h: color.h, s: color.s, brightness: color.v };
}

function toHex(color: Coordinates, model: Model) {
  return (model === "hsl" ? hslToHex : hsvToHex)(
    color.h,
    color.s,
    color.brightness,
  );
}

/** Shared color interaction; wrappers retain their existing layouts and color models. */
export function ColorPicker({
  value,
  model,
  onChange,
  onPreview,
  uppercase = false,
  shorthand = false,
  invalidEntry = "reset",
  scope,
  children,
}: Props) {
  const format = (hex: string) => (uppercase ? hex.toUpperCase() : hex);
  const [color, setColor] = useState(() => fromHex(value, model));
  const [entry, setEntryState] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);
  const committed = useRef(value);
  const editing = useRef(false);
  const context = useRef({ scope, model });
  const frame = useRef<number | null>(null);
  const pending = useRef<{ value: string; save: Props["onChange"] } | null>(
    null,
  );
  const gesture = useRef<{
    id: number;
    element: HTMLDivElement;
    bounds: DOMRect;
    surface: Surface;
    origin: Coordinates;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const changedScope =
      context.current.scope !== scope || context.current.model !== model;
    context.current = { scope, model };
    if (changedScope) editing.current = false;
    if (!editing.current) {
      setEntryState(uppercase ? value.toUpperCase() : value);
      setInvalid(false);
    }
    if (
      !changedScope &&
      value.toLowerCase() === committed.current.toLowerCase()
    )
      return;
    committed.current = value;
    setColor(fromHex(value, model));
  }, [value, model, uppercase, scope]);

  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const change = pending.current;
    pending.current = null;
    change?.save(change.value);
  };
  const finish = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.element.hasPointerCapture?.(active.id))
      active.element.releasePointerCapture(active.id);
    flush();
  };
  // A fresh callback can come from an unrelated parent render. Save its old
  // preview without ending the pointer gesture; later moves use the new callback.
  useEffect(() => flush, [onChange]);
  // Actual target/workspace changes and unmounts release capture as well.
  useEffect(() => finish, [scope, model]);

  const update = (next: Coordinates, dragging = false, immediate = false) => {
    setColor(next);
    const hex = toHex(next, model);
    setEntryState(format(hex));
    setInvalid(false);
    committed.current = hex;
    pending.current = { value: hex, save: onChange };
    if (dragging && onPreview) {
      onPreview(hex);
    } else if (immediate) {
      flush();
    } else if (frame.current === null) {
      frame.current = requestAnimationFrame(flush);
    }
  };

  const choose = (clientX: number, clientY: number, immediate = false) => {
    const active = gesture.current;
    if (!active) return;
    active.x = clientX;
    active.y = clientY;
    const x = clamp((clientX - active.bounds.left) / active.bounds.width, 0, 1);
    const y = clamp((clientY - active.bounds.top) / active.bounds.height, 0, 1);
    const next =
      active.surface === "hue"
        ? { ...active.origin, h: Math.round(x * 359) }
        : model === "hsl"
          ? { h: x * 360, s: active.origin.s || 100, brightness: (1 - y) * 100 }
          : {
              h: active.origin.h,
              s: Math.round(x * 100),
              brightness: Math.round((1 - y) * 100),
            };
    update(next, true, immediate);
  };

  const surfaceEvents = (surface: Surface): SurfaceEvents => ({
    onPointerDown: (event) => {
      if (event.button !== 0 || gesture.current) return;
      const element = event.currentTarget;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      element.focus();
      element.setPointerCapture(event.pointerId);
      gesture.current = {
        id: event.pointerId,
        element,
        bounds,
        surface,
        origin: color,
        x: event.clientX,
        y: event.clientY,
      };
      choose(event.clientX, event.clientY, model === "hsl");
    },
    onPointerMove: (event) => {
      if (gesture.current?.id === event.pointerId)
        choose(event.clientX, event.clientY);
    },
    onPointerUp: (event) => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      if (active.x !== event.clientX || active.y !== event.clientY)
        choose(event.clientX, event.clientY);
      finish();
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown: (event) => {
      const step = event.shiftKey ? (surface === "hue" ? 15 : 10) : 1;
      const direction =
        event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowDown"
            ? -1
            : 0;
      const next = { ...color };
      if (surface === "hue" && direction)
        next.h = (next.h + direction * step + 360) % 360;
      else if (surface === "field") {
        if (event.key === "Home") next.brightness = 100;
        else if (event.key === "End") next.brightness = 0;
        else if (!direction) return;
        else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          if (model === "hsl") next.h += direction * step;
          else next.s = clamp(next.s + direction * step, 0, 100);
        } else
          next.brightness = clamp(next.brightness + direction * step, 0, 100);
        if (model === "hsl") next.s ||= 100;
      } else return;
      event.preventDefault();
      event.stopPropagation();
      update(next, false, model === "hsl");
    },
  });

  const commitEntry = (raw = entry) => {
    editing.current = false;
    const digits = raw.trim().replace(/^#/, "");
    if (
      !/^[\da-f]{6}$/i.test(digits) &&
      !(shorthand && /^[\da-f]{3}$/i.test(digits))
    ) {
      if (invalidEntry === "error") setInvalid(true);
      else setEntryState(format(value));
      return;
    }
    const hex = `#${(digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits).toLowerCase()}`;
    flush();
    setColor(fromHex(hex, model));
    setEntryState(format(hex));
    setInvalid(false);
    committed.current = hex;
    if (hex !== value.toLowerCase()) onChange(hex);
  };

  return children({
    color,
    preview: toHex(color, model),
    entry,
    invalid,
    field: surfaceEvents("field"),
    hue: surfaceEvents("hue"),
    flush,
    setEntry: (next) => {
      setEntryState(next);
      setInvalid(false);
    },
    beginEntry: () => {
      editing.current = true;
    },
    commitEntry,
    chooseHex: commitEntry,
    setSaturation: (s) => update({ ...color, s }, false, true),
  });
}
