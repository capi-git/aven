import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDiagonal,
  Circle,
  LineStraight,
  MousePointer,
  Pen,
  Square,
  Type,
  Undo2,
  X,
  type IconComponent,
} from "../chrome/icons";
import {
  EMPTY_MARKUP_HISTORY,
  MARKUP_COLORS,
  MARKUP_DEFAULT_COLOR,
  MARKUP_FONT_FAMILY,
  MARKUP_STROKE_WIDTH,
  MARKUP_TEXT_LINE_HEIGHT,
  MARKUP_TEXT_SIZE,
  MARKUP_TOOLS,
  beginMarkupMark,
  commitMarkup,
  extendMarkupMark,
  fitMarkupImage,
  hitTestMarkup,
  keepMarkupMark,
  markupBounds,
  markupGeometry,
  markupKeyAction,
  markupPathData,
  markupPoint,
  markupTextBaseline,
  markupTextMark,
  measureMarkupText,
  moveMarkupMark,
  redoMarkup,
  renderMarkupPng,
  replaceMarkupMark,
  undoMarkup,
  type MarkupLine,
  type MarkupPng,
  type MarkupPoint,
  type MarkupShape,
  type MarkupSize,
  type MarkupTool,
} from "../lib/browserMarkup";
import type { BrowserMarkupImage } from "../hooks/useBrowserMarkup";
import { MOD, SHIFT } from "../lib/platform";
import "./BrowserMarkup.css";

const TOOL_ICONS: Record<MarkupTool, IconComponent> = {
  select: MousePointer,
  pen: Pen,
  line: LineStraight,
  arrow: ArrowDiagonal,
  box: Square,
  circle: Circle,
  text: Type,
};

/** Pointer slop in CSS pixels: picking a mark, a real drag, a pen step. */
const PICK_SLOP = 6;
const DRAG_SLOP = 3;
const PEN_STEP = 1;

type Drag =
  | { kind: "draw"; pointer: number; shape: MarkupLine }
  | {
      kind: "move";
      pointer: number;
      id: string;
      origin: MarkupPoint;
      dx: number;
      dy: number;
    };

type TextEdit = {
  id: string;
  at: MarkupPoint;
  value: string;
  size: number;
  color: string;
};

const newId = () => crypto.randomUUID();

/** One finished mark. Unchanged marks skip rendering while another is drawn. */
const MarkView = memo(function MarkView({ shape }: { shape: MarkupShape }) {
  if (shape.kind === "text")
    return (
      <text
        x={shape.at.x}
        y={shape.at.y + markupTextBaseline(shape.size)}
        fill={shape.color}
        fontFamily={MARKUP_FONT_FAMILY}
        fontSize={shape.size}
        fontWeight={700}
        style={{ whiteSpace: "pre" }}
      >
        {shape.text}
      </text>
    );
  const geometry = markupGeometry(shape);
  return (
    <g
      stroke={shape.color}
      strokeWidth={shape.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={markupPathData(geometry.stroke)} fill="none" />
      {geometry.head ? (
        <path d={markupPathData(geometry.head)} fill={shape.color} />
      ) : null}
    </g>
  );
});

export type BrowserMarkupProps = {
  image: BrowserMarkupImage;
  /** The live page is hidden behind the picture; the tools may open. */
  ready: boolean;
  /** Closing: only the picture stays until the live page is back. */
  leaving: boolean;
  /** Attach the finished picture, which `render` draws on demand. */
  onSend: (render: () => Promise<MarkupPng>) => Promise<void>;
  onClose: () => void;
};

/**
 * The frozen page with its marks and tools. Marks live in image pixels, so
 * they scale with the picture as the pane resizes and export at its full
 * resolution.
 */
export function BrowserMarkup({
  image,
  ready,
  leaving,
  onSend,
  onClose,
}: BrowserMarkupProps) {
  const root = useRef<HTMLDivElement>(null);
  const ink = useRef<SVGSVGElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [area, setArea] = useState<MarkupSize | null>(null);
  // Image pixels per CSS pixel when the picture first showed at 100%:
  // strokes and text keep that size relative to the picture afterwards.
  const pixelRatio = useRef<number | null>(null);
  const [tool, setTool] = useState<MarkupTool>("pen");
  const [color, setColor] = useState(MARKUP_DEFAULT_COLOR);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [history, setHistory] = useState(EMPTY_MARKUP_HISTORY);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const textEdit = useRef<TextEdit | null>(null);
  const [text, setText] = useState<TextEdit | null>(null);
  const [sending, setSending] = useState(false);
  const shapes = history.present;
  const tools = ready && !leaving;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width >= 1 && rect.height >= 1 && pixelRatio.current === null)
        pixelRatio.current = Math.max(
          image.width / rect.width,
          image.height / rect.height,
        );
      setArea((previous) =>
        previous?.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [image.width, image.height]);

  // An unmeasured area (not laid out yet) shows the picture at one CSS
  // pixel per image pixel until the first measurement.
  const fit =
    (area && fitMarkupImage(area, image)) ?? fitMarkupImage(image, image)!;
  /** Image pixels per CSS pixel as the picture shows right now. */
  const perCssPixel = 1 / fit.scale;
  const ratio = () =>
    pixelRatio.current ??
    (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

  useEffect(() => {
    if (tools) root.current?.focus({ preventScroll: true });
  }, [tools]);

  const editId = text?.id;
  useLayoutEffect(() => {
    if (editId) textInput.current?.focus({ preventScroll: true });
  }, [editId]);

  const setDrag = (next: Drag | null) => {
    drag.current = next;
    setDragView(next);
  };

  const addMark = (mark: MarkupShape) =>
    setHistory((previous) =>
      commitMarkup(previous, [...previous.present, mark]),
    );

  /** Commit the text being typed; empty text simply disappears. */
  const finishText = useCallback(() => {
    const edit = textEdit.current;
    if (!edit) return null;
    textEdit.current = null;
    setText(null);
    const mark = markupTextMark({
      id: edit.id,
      color: edit.color,
      size: edit.size,
      at: edit.at,
      text: edit.value,
    });
    if (mark)
      setHistory((previous) =>
        commitMarkup(previous, [...previous.present, mark]),
      );
    return mark;
  }, []);

  const focusPicture = () => root.current?.focus({ preventScroll: true });

  const chooseTool = (next: MarkupTool) => {
    finishText();
    setTool(next);
    setPaletteOpen(false);
    if (next !== "select") setSelected(null);
    focusPicture();
  };

  const pickColor = (next: string) => {
    setColor(next);
    setPaletteOpen(false);
    if (textEdit.current) {
      const edit = { ...textEdit.current, color: next };
      textEdit.current = edit;
      setText(edit);
      textInput.current?.focus({ preventScroll: true });
      return;
    }
    // A selected mark takes the new colour, as one undoable step.
    if (selected)
      setHistory((previous) => {
        const mark = previous.present.find((shape) => shape.id === selected);
        return mark && mark.color !== next
          ? commitMarkup(
              previous,
              replaceMarkupMark(previous.present, selected, {
                ...mark,
                color: next,
              }),
            )
          : previous;
      });
    focusPicture();
  };

  const undo = () => {
    if (drag.current) return;
    finishText();
    setHistory(undoMarkup);
    focusPicture();
  };
  const redo = () => {
    if (drag.current) return;
    setHistory(redoMarkup);
  };
  const removeSelected = () => {
    if (!selected || drag.current) return;
    setHistory((previous) =>
      commitMarkup(
        previous,
        replaceMarkupMark(previous.present, selected, null),
      ),
    );
    setSelected(null);
  };

  const send = async () => {
    if (!tools || sending) return;
    const typed = finishText();
    const marks = typed ? [...shapes, typed] : shapes;
    setPaletteOpen(false);
    setSending(true);
    try {
      await onSend(async () => {
        // No marks: the captured picture already is the PNG to send.
        if (!marks.length)
          return {
            dataUrl: image.src,
            width: image.width,
            height: image.height,
          };
        const source = picture.current;
        if (!source) throw new Error("The page picture is not ready yet.");
        return renderMarkupPng(source, image, marks);
      });
    } finally {
      setSending(false);
    }
  };

  const pointFrom = (event: { clientX: number; clientY: number }) => {
    const rect = ink.current?.getBoundingClientRect();
    return markupPoint(
      { x: event.clientX, y: event.clientY },
      rect && rect.width > 0 && rect.height > 0
        ? rect
        : { left: fit.x, top: fit.y, width: fit.width, height: fit.height },
      image,
    );
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !tools || sending || drag.current) return;
    setPaletteOpen(false);
    // A click away finishes the text being typed, and does nothing else.
    if (finishText()) {
      focusPicture();
      return;
    }
    const point = pointFrom(event);
    if (tool === "text") {
      const edit = {
        id: newId(),
        at: {
          x: point.x,
          y: Math.max(
            0,
            point.y -
              (MARKUP_TEXT_SIZE * ratio() * MARKUP_TEXT_LINE_HEIGHT) / 2,
          ),
        },
        value: "",
        size: MARKUP_TEXT_SIZE * ratio(),
        color,
      };
      textEdit.current = edit;
      setText(edit);
      return;
    }
    focusPicture();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that already ended cannot be captured; the drag still ends.
    }
    if (tool === "select") {
      const id = hitTestMarkup(shapes, point, PICK_SLOP * perCssPixel);
      setSelected(id);
      if (id)
        setDrag({
          kind: "move",
          pointer: event.pointerId,
          id,
          origin: point,
          dx: 0,
          dy: 0,
        });
      return;
    }
    setDrag({
      kind: "draw",
      pointer: event.pointerId,
      shape: beginMarkupMark(tool, point, {
        id: newId(),
        color,
        width: MARKUP_STROKE_WIDTH * ratio(),
      }),
    });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    const point = pointFrom(event);
    if (current.kind === "draw") {
      const shape = extendMarkupMark(
        current.shape,
        point,
        PEN_STEP * perCssPixel,
      );
      if (shape !== current.shape) setDrag({ ...current, shape });
    } else
      setDrag({
        ...current,
        dx: point.x - current.origin.x,
        dy: point.y - current.origin.y,
      });
  };

  const endDrag = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    setDrag(null);
    if (cancelled) return;
    if (current.kind === "draw") {
      if (keepMarkupMark(current.shape, DRAG_SLOP * perCssPixel))
        addMark(current.shape);
      return;
    }
    if (!current.dx && !current.dy) return;
    setHistory((previous) => {
      const mark = previous.present.find((shape) => shape.id === current.id);
      return mark
        ? commitMarkup(
            previous,
            replaceMarkupMark(
              previous.present,
              current.id,
              moveMarkupMark(mark, current.dx, current.dy),
            ),
          )
        : previous;
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!tools) return;
    const action = markupKeyAction(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      },
      !!textEdit.current,
    );
    if (!action || sending) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "finish-text") {
      finishText();
      focusPicture();
    } else if (action.kind === "exit") {
      if (paletteOpen) setPaletteOpen(false);
      else onClose();
    } else if (action.kind === "undo") undo();
    else if (action.kind === "redo") redo();
    else if (action.kind === "delete") removeSelected();
    else chooseTool(action.tool);
  };

  const shown =
    dragView?.kind === "move"
      ? shapes.map((shape) =>
          shape.id === dragView.id
            ? moveMarkupMark(shape, dragView.dx, dragView.dy)
            : shape,
        )
      : shapes;
  const selection = selected
    ? shown.find((shape) => shape.id === selected)
    : undefined;
  const outline = selection ? markupBounds(selection) : null;
  const pad = 4 * perCssPixel;
  const count = shapes.length;

  return (
    <div
      ref={root}
      className="browser-markup"
      role="group"
      aria-label="Page being marked up"
      tabIndex={-1}
      data-leaving={leaving || undefined}
      onKeyDown={onKeyDown}
    >
      <div
        className="browser-markup-stage"
        style={{
          left: fit.x,
          top: fit.y,
          width: fit.width,
          height: fit.height,
        }}
      >
        <img
          ref={picture}
          className="browser-markup-image"
          src={image.src}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        {leaving ? null : (
          <svg
            ref={ink}
            className="browser-markup-ink"
            data-tool={tool}
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={
              count === 1
                ? "Page picture with 1 mark"
                : `Page picture with ${count} marks`
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endDrag(event, false)}
            onPointerCancel={(event) => endDrag(event, true)}
            // Keep focus where it is: a click here places text or a mark.
            onMouseDown={(event) => event.preventDefault()}
          >
            {shown.map((shape) => (
              <MarkView key={shape.id} shape={shape} />
            ))}
            {dragView?.kind === "draw" ? (
              <MarkView shape={dragView.shape} />
            ) : null}
            {outline ? (
              // Light dashes over a dark edge show on any page colour.
              <g className="browser-markup-selection">
                {["shade", "light"].map((edge) => (
                  <rect
                    key={edge}
                    data-edge={edge}
                    x={outline.x - pad}
                    y={outline.y - pad}
                    width={outline.width + pad * 2}
                    height={outline.height + pad * 2}
                    rx={pad}
                  />
                ))}
              </g>
            ) : null}
          </svg>
        )}
        {text && !leaving ? (
          <input
            ref={textInput}
            className="browser-markup-text"
            aria-label="Text mark"
            value={text.value}
            spellCheck={false}
            autoComplete="off"
            style={{
              left: text.at.x * fit.scale,
              top: text.at.y * fit.scale,
              width:
                (measureMarkupText(text.value || "M", text.size) + text.size) *
                fit.scale,
              height: text.size * MARKUP_TEXT_LINE_HEIGHT * fit.scale,
              color: text.color,
              fontFamily: MARKUP_FONT_FAMILY,
              fontSize: text.size * fit.scale,
              lineHeight: MARKUP_TEXT_LINE_HEIGHT,
            }}
            onChange={(event) => {
              const edit = textEdit.current;
              if (!edit) return;
              const next = { ...edit, value: event.target.value };
              textEdit.current = next;
              setText(next);
            }}
            onBlur={() => finishText()}
          />
        ) : null}
      </div>
      {tools ? (
        <div className="browser-markup-bar">
          <div
            className="browser-markup-toolbar"
            role="toolbar"
            aria-label="Mark up tools"
            // Clicks keep focus on the picture, or on the text being typed,
            // so shortcuts keep working and a colour can change that text.
            onMouseDown={(event) => event.preventDefault()}
          >
            {MARKUP_TOOLS.map(({ tool: id, label, key }) => {
              const Icon = TOOL_ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  className="browser-markup-tool aven-press"
                  aria-label={label}
                  title={
                    id === "select"
                      ? `${label} (${key}) · drag to move, Delete to remove`
                      : `${label} (${key})`
                  }
                  aria-pressed={tool === id}
                  onClick={() => chooseTool(id)}
                >
                  <Icon size={18} />
                </button>
              );
            })}
            <span className="browser-markup-divider" aria-hidden="true" />
            <div className="browser-markup-colors">
              <button
                type="button"
                className="browser-markup-tool aven-press"
                aria-label="Colour"
                title="Colour"
                aria-haspopup="true"
                aria-expanded={paletteOpen}
                onClick={() => setPaletteOpen((open) => !open)}
              >
                <span
                  className="browser-markup-swatch"
                  style={{ background: color }}
                />
              </button>
              {paletteOpen ? (
                <div
                  className="browser-markup-palette"
                  role="radiogroup"
                  aria-label="Colours"
                >
                  {MARKUP_COLORS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      className="browser-markup-tool aven-press"
                      aria-label={label}
                      title={label}
                      aria-checked={value === color}
                      onClick={() => pickColor(value)}
                    >
                      <span
                        className="browser-markup-swatch"
                        style={{ background: value }}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="browser-markup-tool aven-press"
              aria-label="Undo"
              title={`Undo (${MOD}Z) · Redo (${SHIFT}${MOD}Z)`}
              disabled={!history.past.length && !text}
              onClick={undo}
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              className="browser-markup-send aven-press"
              aria-busy={sending || undefined}
              disabled={sending}
              title="Attach this picture to the chat beside the page"
              onClick={() => void send()}
            >
              Send to chat
            </button>
            <span className="browser-markup-divider" aria-hidden="true" />
            <button
              type="button"
              className="browser-markup-tool aven-press"
              aria-label="Close mark up"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
