/**
 * Marking up a frozen browser page: the marks, their undo history, hit
 * testing, keyboard shortcuts, and the geometry the on-screen layer and the
 * exported picture share. Every coordinate is in pixels of the captured
 * image, so marks keep their place when the pane resizes and export at the
 * picture's full resolution.
 */

export type MarkupTool =
  "select" | "pen" | "line" | "arrow" | "box" | "circle" | "text";

export type MarkupDrawingTool = Exclude<MarkupTool, "select" | "text">;

export const MARKUP_TOOLS: readonly {
  tool: MarkupTool;
  label: string;
  key: string;
}[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "pen", label: "Pen", key: "P" },
  { tool: "line", label: "Line", key: "L" },
  { tool: "arrow", label: "Arrow", key: "A" },
  { tool: "box", label: "Box", key: "R" },
  { tool: "circle", label: "Circle", key: "O" },
  { tool: "text", label: "Text", key: "T" },
];

export const MARKUP_COLORS: readonly { value: string; label: string }[] = [
  { value: "#ff5a4f", label: "Red" },
  { value: "#ffb224", label: "Amber" },
  { value: "#30c85e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#ffffff", label: "White" },
];
export const MARKUP_DEFAULT_COLOR = MARKUP_COLORS[0].value;

/** Stroke width and text size, in CSS pixels, with the picture at 100%. */
export const MARKUP_STROKE_WIDTH = 3;
export const MARKUP_TEXT_SIZE = 16;
/**
 * Not the system font: its letter spacing changes with size, so text typed
 * on screen, drawn into the scaled layer and exported at full size would
 * each come out a different width. Helvetica Neue scales evenly.
 */
export const MARKUP_FONT_FAMILY =
  '"Helvetica Neue", Helvetica, Arial, sans-serif';
/** A text mark's line box, as a multiple of its size. */
export const MARKUP_TEXT_LINE_HEIGHT = 1.2;
/** Undo keeps this many earlier states. */
export const MARKUP_HISTORY_LIMIT = 100;

export type MarkupPoint = { x: number; y: number };
export type MarkupRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type MarkupSize = { width: number; height: number };

type MarkBase = { id: string; color: string };
export type MarkupStroke = MarkBase & {
  kind: "pen";
  width: number;
  points: MarkupPoint[];
};
export type MarkupSpan = MarkBase & {
  kind: "line" | "arrow" | "box" | "circle";
  width: number;
  from: MarkupPoint;
  to: MarkupPoint;
};
export type MarkupText = MarkBase & {
  kind: "text";
  size: number;
  /** Top-left corner of the text's line box. */
  at: MarkupPoint;
  text: string;
  /** Measured advance width, for selection and hit testing. */
  width: number;
};
export type MarkupShape = MarkupStroke | MarkupSpan | MarkupText;
export type MarkupLine = MarkupStroke | MarkupSpan;

// --- Paths shared by the SVG layer and the exported canvas ---------------

export type MarkupPathOp =
  | ["M", number, number]
  | ["L", number, number]
  | ["Q", number, number, number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

export type MarkupGeometry = {
  /** Stroked with the mark's width, round caps and joins. */
  stroke: MarkupPathOp[];
  /** Filled and stroked: an arrow's head. */
  head?: MarkupPathOp[];
};

const round = (value: number) => Math.round(value * 100) / 100;

export function markupPathData(ops: readonly MarkupPathOp[]): string {
  return ops
    .map(([command, ...values]) =>
      [command, ...values.map((value) => round(value))].join(" "),
    )
    .join(" ");
}

type PathTarget = Pick<
  CanvasRenderingContext2D,
  "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath"
>;

export function traceMarkupPath(
  target: PathTarget,
  ops: readonly MarkupPathOp[],
) {
  for (const op of ops) {
    if (op[0] === "M") target.moveTo(op[1], op[2]);
    else if (op[0] === "L") target.lineTo(op[1], op[2]);
    else if (op[0] === "Q") target.quadraticCurveTo(op[1], op[2], op[3], op[4]);
    else if (op[0] === "C")
      target.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]);
    else target.closePath();
  }
}

const distance = (a: MarkupPoint, b: MarkupPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const midpoint = (a: MarkupPoint, b: MarkupPoint): MarkupPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** The rectangle two drag corners span, in either direction. */
export function markupSpanRect(from: MarkupPoint, to: MarkupPoint): MarkupRect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * A solid arrow head that grows with the stroke, and never outgrows a short
 * arrow. The shaft stops inside the head so its round cap stays hidden.
 */
export function markupArrowHead(
  from: MarkupPoint,
  to: MarkupPoint,
  width: number,
) {
  const length = distance(from, to);
  const ux = length ? (to.x - from.x) / length : 1;
  const uy = length ? (to.y - from.y) / length : 0;
  const headLength = Math.min(width * 4, length);
  const halfWidth = headLength * 0.55;
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };
  return {
    tip: to,
    left: { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
    right: { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
    shaftEnd: midpoint(base, to),
    halfWidth,
  };
}

function penPath(points: readonly MarkupPoint[]): MarkupPathOp[] {
  const [first] = points;
  if (!first) return [];
  // A round-capped zero-length segment is not drawn everywhere; nudge a dot.
  if (points.length === 1)
    return [
      ["M", first.x, first.y],
      ["L", first.x + 0.01, first.y],
    ];
  if (points.length === 2)
    return [
      ["M", first.x, first.y],
      ["L", points[1].x, points[1].y],
    ];
  // Smooth through the midpoints, so a hand-drawn line has no corners.
  const ops: MarkupPathOp[] = [["M", first.x, first.y]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const end = midpoint(control, points[index + 1]);
    ops.push(["Q", control.x, control.y, end.x, end.y]);
  }
  const last = points[points.length - 1];
  ops.push(["L", last.x, last.y]);
  return ops;
}

function roundedRectPath(rect: MarkupRect, radius: number): MarkupPathOp[] {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  return [
    ["M", x + r, y],
    ["L", right - r, y],
    ["Q", right, y, right, y + r],
    ["L", right, bottom - r],
    ["Q", right, bottom, right - r, bottom],
    ["L", x + r, bottom],
    ["Q", x, bottom, x, bottom - r],
    ["L", x, y + r],
    ["Q", x, y, x + r, y],
    ["Z"],
  ];
}

/** Four cubic arcs: within a fraction of a pixel of a true ellipse. */
function ellipsePath(rect: MarkupRect): MarkupPathOp[] {
  const k = 0.5522847498;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry],
    ["C", cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
    ["C", cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry],
    ["C", cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy],
    ["Z"],
  ];
}

export function markupGeometry(shape: MarkupLine): MarkupGeometry {
  if (shape.kind === "pen") return { stroke: penPath(shape.points) };
  const { from, to } = shape;
  if (shape.kind === "line")
    return {
      stroke: [
        ["M", from.x, from.y],
        ["L", to.x, to.y],
      ],
    };
  if (shape.kind === "arrow") {
    const head = markupArrowHead(from, to, shape.width);
    return {
      stroke: [
        ["M", from.x, from.y],
        ["L", head.shaftEnd.x, head.shaftEnd.y],
      ],
      head: [
        ["M", head.tip.x, head.tip.y],
        ["L", head.left.x, head.left.y],
        ["L", head.right.x, head.right.y],
        ["Z"],
      ],
    };
  }
  const rect = markupSpanRect(from, to);
  if (shape.kind === "box")
    return { stroke: roundedRectPath(rect, shape.width * 1.5) };
  return { stroke: ellipsePath(rect) };
}

// --- Text ------------------------------------------------------------------

export function markupFont(size: number): string {
  return `700 ${round(size)}px ${MARKUP_FONT_FAMILY}`;
}

let measuring: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
  if (measuring !== undefined) return measuring;
  try {
    measuring =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  } catch {
    measuring = null;
  }
  return measuring;
}

/** The text's advance width at `size`, estimated when nothing can measure. */
export function measureMarkupText(text: string, size: number): number {
  const context = measureContext();
  if (context) {
    context.font = markupFont(size);
    const width = context.measureText(text).width;
    if (Number.isFinite(width) && width >= 0) return width;
  }
  return text.length * size * 0.6;
}

/**
 * How far below the line box's top the text sits on its baseline. A CSS
 * line box centres the font's ascent and descent, so the typed text and the
 * finished mark share one baseline.
 */
export function markupTextBaseline(size: number): number {
  const lineHeight = size * MARKUP_TEXT_LINE_HEIGHT;
  const context = measureContext();
  if (context) {
    context.font = markupFont(size);
    const metrics = context.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (
      Number.isFinite(ascent) &&
      Number.isFinite(descent) &&
      ascent > 0 &&
      descent >= 0
    )
      return (lineHeight - ascent - descent) / 2 + ascent;
  }
  return size * 0.95;
}

/** A finished text mark, or null when nothing but spaces was typed. */
export function markupTextMark(mark: {
  id: string;
  color: string;
  size: number;
  at: MarkupPoint;
  text: string;
}): MarkupText | null {
  const text = mark.text.trim();
  if (!text) return null;
  return {
    ...mark,
    kind: "text",
    text,
    width: measureMarkupText(text, mark.size),
  };
}

// --- Drawing ---------------------------------------------------------------

/** Start a drag-drawn mark at `point`. */
export function beginMarkupMark(
  tool: MarkupDrawingTool,
  point: MarkupPoint,
  style: { id: string; color: string; width: number },
): MarkupLine {
  if (tool === "pen") return { ...style, kind: "pen", points: [{ ...point }] };
  return { ...style, kind: tool, from: { ...point }, to: { ...point } };
}

/** Follow the pointer; a pen drops points closer than `minStep` together. */
export function extendMarkupMark(
  shape: MarkupLine,
  point: MarkupPoint,
  minStep: number,
): MarkupLine {
  if (shape.kind !== "pen") return { ...shape, to: { ...point } };
  const last = shape.points[shape.points.length - 1];
  if (last && distance(last, point) < minStep) return shape;
  return { ...shape, points: [...shape.points, { ...point }] };
}

/** A click with a shape tool draws nothing; a pen click leaves a dot. */
export function keepMarkupMark(shape: MarkupShape, minDrag: number): boolean {
  if (shape.kind === "pen") return shape.points.length > 0;
  if (shape.kind === "text") return shape.text.trim().length > 0;
  if (shape.kind === "line" || shape.kind === "arrow")
    return distance(shape.from, shape.to) >= minDrag;
  return (
    Math.abs(shape.to.x - shape.from.x) >= minDrag ||
    Math.abs(shape.to.y - shape.from.y) >= minDrag
  );
}

export function moveMarkupMark(
  shape: MarkupShape,
  dx: number,
  dy: number,
): MarkupShape {
  const move = (point: MarkupPoint) => ({ x: point.x + dx, y: point.y + dy });
  if (shape.kind === "pen") return { ...shape, points: shape.points.map(move) };
  if (shape.kind === "text") return { ...shape, at: move(shape.at) };
  return { ...shape, from: move(shape.from), to: move(shape.to) };
}

/** Replace one mark, or remove it with `null`; other marks keep identity. */
export function replaceMarkupMark(
  shapes: readonly MarkupShape[],
  id: string,
  next: MarkupShape | null,
): MarkupShape[] {
  const result: MarkupShape[] = [];
  for (const shape of shapes) {
    if (shape.id !== id) result.push(shape);
    else if (next) result.push(next);
  }
  return result;
}

/** What a mark covers, including its stroke. */
export function markupBounds(shape: MarkupShape): MarkupRect {
  if (shape.kind === "text")
    return {
      x: shape.at.x,
      y: shape.at.y,
      width: Math.max(shape.width, shape.size / 2),
      height: shape.size * MARKUP_TEXT_LINE_HEIGHT,
    };
  const points = shape.kind === "pen" ? shape.points : [shape.from, shape.to];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const reach =
    shape.width / 2 +
    (shape.kind === "arrow"
      ? markupArrowHead(shape.from, shape.to, shape.width).halfWidth
      : 0);
  const left = Math.min(...xs) - reach;
  const top = Math.min(...ys) - reach;
  return {
    x: left,
    y: top,
    width: Math.max(...xs) + reach - left,
    height: Math.max(...ys) + reach - top,
  };
}

// --- Hit testing -----------------------------------------------------------

function segmentDistance(p: MarkupPoint, a: MarkupPoint, b: MarkupPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function rectDistance(p: MarkupPoint, rect: MarkupRect) {
  const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function rectOutlineDistance(p: MarkupPoint, rect: MarkupRect) {
  const outside = rectDistance(p, rect);
  if (outside > 0) return outside;
  return Math.min(
    p.x - rect.x,
    rect.x + rect.width - p.x,
    p.y - rect.y,
    rect.y + rect.height - p.y,
  );
}

function ellipseRatio(p: MarkupPoint, rect: MarkupRect) {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return Number.POSITIVE_INFINITY;
  return Math.hypot((p.x - (rect.x + rx)) / rx, (p.y - (rect.y + ry)) / ry);
}

/** Distance from `p` to an ellipse's outline, measured along its centre ray. */
function ellipseOutlineDistance(p: MarkupPoint, rect: MarkupRect) {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0)
    return segmentDistance(
      p,
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    );
  const ratio = ellipseRatio(p, rect);
  const fromCentre = Math.hypot(p.x - (rect.x + rx), p.y - (rect.y + ry));
  if (ratio === 0) return Math.min(rx, ry);
  return fromCentre * Math.abs(1 - 1 / ratio);
}

function triangleContains(
  p: MarkupPoint,
  a: MarkupPoint,
  b: MarkupPoint,
  c: MarkupPoint,
) {
  const side = (u: MarkupPoint, v: MarkupPoint) =>
    (p.x - v.x) * (u.y - v.y) - (u.x - v.x) * (p.y - v.y);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** How far `p` is from a mark's ink; zero on or inside it. */
export function markupDistance(shape: MarkupShape, p: MarkupPoint): number {
  if (shape.kind === "text") return rectDistance(p, markupBounds(shape));
  let ink: number;
  if (shape.kind === "pen") {
    const points = shape.points;
    ink = points.length === 1 ? distance(p, points[0]) : Infinity;
    for (let index = 1; index < points.length; index += 1)
      ink = Math.min(ink, segmentDistance(p, points[index - 1], points[index]));
  } else if (shape.kind === "line") {
    ink = segmentDistance(p, shape.from, shape.to);
  } else if (shape.kind === "arrow") {
    const head = markupArrowHead(shape.from, shape.to, shape.width);
    ink = triangleContains(p, head.tip, head.left, head.right)
      ? 0
      : segmentDistance(p, shape.from, shape.to);
  } else if (shape.kind === "box") {
    ink = rectOutlineDistance(p, markupSpanRect(shape.from, shape.to));
  } else {
    ink = ellipseOutlineDistance(p, markupSpanRect(shape.from, shape.to));
  }
  return Math.max(0, ink - shape.width / 2);
}

function markupContains(shape: MarkupShape, p: MarkupPoint): boolean {
  if (shape.kind === "box")
    return rectDistance(p, markupSpanRect(shape.from, shape.to)) === 0;
  if (shape.kind === "circle")
    return ellipseRatio(p, markupSpanRect(shape.from, shape.to)) <= 1;
  return false;
}

/**
 * The mark under `p`, topmost first. Ink within `tolerance` wins; failing
 * that, the inside of a box or circle selects it.
 */
export function hitTestMarkup(
  shapes: readonly MarkupShape[],
  p: MarkupPoint,
  tolerance: number,
): string | null {
  for (let index = shapes.length - 1; index >= 0; index -= 1)
    if (markupDistance(shapes[index], p) <= tolerance) return shapes[index].id;
  for (let index = shapes.length - 1; index >= 0; index -= 1)
    if (markupContains(shapes[index], p)) return shapes[index].id;
  return null;
}

// --- Undo history ----------------------------------------------------------

export type MarkupHistory = {
  past: MarkupShape[][];
  present: MarkupShape[];
  future: MarkupShape[][];
};

export const EMPTY_MARKUP_HISTORY: MarkupHistory = {
  past: [],
  present: [],
  future: [],
};

/** Record a new state; anything undone before it can no longer be redone. */
export function commitMarkup(
  history: MarkupHistory,
  present: MarkupShape[],
): MarkupHistory {
  if (present === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-MARKUP_HISTORY_LIMIT),
    present,
    future: [],
  };
}

export function undoMarkup(history: MarkupHistory): MarkupHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoMarkup(history: MarkupHistory): MarkupHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-MARKUP_HISTORY_LIMIT),
    present: next,
    future,
  };
}

// --- Placement on screen -----------------------------------------------------

/** Where the picture sits in the page area: CSS pixels, and CSS px per image px. */
export type MarkupFit = MarkupRect & { scale: number };

/**
 * Show the whole picture as large as the page area allows, from its top-left
 * corner like the page it replaces. Marks scale with it.
 */
export function fitMarkupImage(
  area: MarkupSize,
  image: MarkupSize,
): MarkupFit | null {
  if (
    !(area.width >= 1) ||
    !(area.height >= 1) ||
    !(image.width > 0) ||
    !(image.height > 0)
  )
    return null;
  const scale = Math.min(area.width / image.width, area.height / image.height);
  return {
    x: 0,
    y: 0,
    width: image.width * scale,
    height: image.height * scale,
    scale,
  };
}

/** A pointer position in image pixels, kept on the picture. */
export function markupPoint(
  client: MarkupPoint,
  stage: Pick<DOMRect, "left" | "top" | "width" | "height">,
  image: MarkupSize,
): MarkupPoint {
  const x = stage.width
    ? ((client.x - stage.left) * image.width) / stage.width
    : 0;
  const y = stage.height
    ? ((client.y - stage.top) * image.height) / stage.height
    : 0;
  return {
    x: Math.max(0, Math.min(image.width, x)),
    y: Math.max(0, Math.min(image.height, y)),
  };
}

// --- Keyboard ----------------------------------------------------------------

export type MarkupKeyAction =
  | { kind: "tool"; tool: MarkupTool }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "delete" }
  | { kind: "exit" }
  | { kind: "finish-text" };

const TOOL_KEYS = new Map(
  MARKUP_TOOLS.map(({ tool, key }) => [key.toLowerCase(), tool]),
);

/**
 * V P L A R O T pick tools, ⌘Z undoes, ⇧⌘Z redoes, Delete removes the
 * selected mark and Esc leaves. While typing a text mark, only Enter and Esc
 * mean anything here: both finish the text.
 */
export function markupKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  > & { isComposing?: boolean },
  typing: boolean,
): MarkupKeyAction | null {
  if (event.isComposing) return null;
  const command = event.metaKey || event.ctrlKey;
  if (typing)
    return (event.key === "Escape" || event.key === "Enter") &&
      !command &&
      !event.altKey
      ? { kind: "finish-text" }
      : null;
  if (event.altKey) return null;
  if (command) {
    if (event.key.toLowerCase() !== "z") return null;
    return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
  }
  if (event.key === "Escape") return { kind: "exit" };
  if (event.key === "Delete" || event.key === "Backspace")
    return { kind: "delete" };
  const tool = TOOL_KEYS.get(event.key.toLowerCase());
  return tool ? { kind: "tool", tool } : null;
}

// --- Export --------------------------------------------------------------------

/** Draw marks over a canvas that already holds the picture, at image scale. */
export function drawMarkup(
  context: CanvasRenderingContext2D,
  shapes: readonly MarkupShape[],
) {
  for (const shape of shapes) {
    context.save();
    if (shape.kind === "text") {
      context.font = markupFont(shape.size);
      context.fillStyle = shape.color;
      context.textBaseline = "alphabetic";
      context.fillText(
        shape.text,
        shape.at.x,
        shape.at.y + markupTextBaseline(shape.size),
      );
    } else {
      const geometry = markupGeometry(shape);
      context.strokeStyle = shape.color;
      context.fillStyle = shape.color;
      context.lineWidth = shape.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      traceMarkupPath(context, geometry.stroke);
      context.stroke();
      if (geometry.head) {
        context.beginPath();
        traceMarkupPath(context, geometry.head);
        context.fill();
        context.stroke();
      }
    }
    context.restore();
  }
}

export type MarkupPng = { dataUrl: string; width: number; height: number };

function canvasDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  if (typeof canvas.toBlob !== "function")
    return Promise.resolve(canvas.toDataURL("image/png"));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the marked-up page."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new Error("Could not encode the marked-up page."));
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

/** One PNG of the picture and its marks, at the picture's full resolution. */
export async function renderMarkupPng(
  image: CanvasImageSource,
  size: MarkupSize,
  shapes: readonly MarkupShape[],
): Promise<MarkupPng> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the marked-up page.");
    context.drawImage(image, 0, 0, size.width, size.height);
    drawMarkup(context, shapes);
    const dataUrl = await canvasDataUrl(canvas);
    if (!dataUrl.startsWith("data:image/png;base64,"))
      throw new Error("Could not encode the marked-up page.");
    return { dataUrl, width: size.width, height: size.height };
  } finally {
    // Release the full-size bitmap now rather than at garbage collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}
