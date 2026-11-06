import { type RefObject, useEffect, useRef } from "react";
import {
  InkField,
  INK_CELL,
  inkPalette,
  type InkPalette,
} from "../lib/inkField";

/** Pressing these is using them, not stirring the ink behind them. */
const NOT_INK =
  "button, a, input, textarea, select, label, [contenteditable], [role='button'], [role='menu'], [role='menuitem'], [role='dialog'], [role='listbox'], [data-ink-ignore]";

function contentRgb(element: Element): [number, number, number] {
  const match = getComputedStyle(element).color.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) return [235, 238, 241];
  return [Number(match[0]), Number(match[1]), Number(match[2])];
}

/** One round dot centred in a `tile`-pixel square: the mask for a cell. */
function dotTile(tile: number): HTMLCanvasElement {
  const dot = document.createElement("canvas");
  dot.width = tile;
  dot.height = tile;
  const context = dot.getContext("2d");
  if (context) {
    context.beginPath();
    context.arc(tile / 2, tile / 2, tile * DOT_RADIUS, 0, Math.PI * 2);
    context.fillStyle = "#000";
    context.fill();
  }
  return dot;
}

/** A cell's dot, as a share of its side: round dots with a gap between. */
const DOT_RADIUS = 0.44;

/**
 * Runs a new chat's ink (`src/lib/inkField.ts`) on `canvas`, stirred by the
 * pointer over `host`. The field paints one pixel per 3px cell into a small
 * buffer; each frame puts it on a second, off-screen canvas, stretches it
 * onto `canvas` at the screen's resolution and cuts every cell to a round
 * dot with a repeating mask. Three canvas calls a frame: no layout, no
 * style, nothing else in the window repaints, and never a square pixel.
 *
 * Frames run only while the ink moves: a move or a press wakes them, and
 * they stop once the field is quiet, while `live` is false (the chat is
 * hidden, has messages, or is fading out) and while the window is hidden.
 * The field is kept across pauses, so a chat shown again picks up where it
 * was; it greets once, when it first has room.
 */
export function useInkField(
  host: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  live: boolean,
): void {
  const fieldRef = useRef<InkField | null>(null);

  useEffect(() => {
    const hostElement = host.current;
    const canvasElement = canvas.current;
    if (!live || !hostElement || !canvasElement) return;
    const context = canvasElement.getContext("2d");
    const cells = document.createElement("canvas");
    const cellContext = cells.getContext("2d");
    if (!context || !cellContext) return;
    const field = (fieldRef.current ??= new InkField());

    let frame = 0;
    let last = 0;
    let rect: DOMRect | null = null;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let palette: InkPalette | null = null;
    let tile = 0;
    let dots: CanvasPattern | null = null;

    const fit = () => {
      rect = hostElement.getBoundingClientRect();
      field.resize(rect.width, rect.height);
      const { cols, rows } = field.cells();
      const nextTile = Math.max(
        INK_CELL,
        Math.round(INK_CELL * (window.devicePixelRatio || 1)),
      );
      if (
        image &&
        image.width === cols &&
        image.height === rows &&
        nextTile === tile
      )
        return;
      if (cols === 0 || rows === 0) {
        image = null;
        pixels = null;
        return;
      }
      tile = nextTile;
      cells.width = cols;
      cells.height = rows;
      canvasElement.width = cols * tile;
      canvasElement.height = rows * tile;
      canvasElement.style.width = `${cols * INK_CELL}px`;
      canvasElement.style.height = `${rows * INK_CELL}px`;
      image = cellContext.createImageData(cols, rows);
      pixels = new Uint32Array(image.data.buffer);
      dots = context.createPattern(dotTile(tile), "repeat");
    };

    const show = () => {
      if (!image || !pixels || !palette) return;
      const { width, height } = canvasElement;
      if (field.paint(pixels, palette) === 0 || !dots) {
        context.clearRect(0, 0, width, height);
        return;
      }
      cellContext.putImageData(image, 0, 0);
      context.globalCompositeOperation = "copy";
      context.imageSmoothingEnabled = false;
      context.drawImage(cells, 0, 0, width, height);
      context.globalCompositeOperation = "destination-in";
      context.fillStyle = dots;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";
    };

    const draw = (time: number) => {
      frame = 0;
      if (document.hidden) {
        last = 0;
        return;
      }
      const dt = last ? (time - last) / 1000 : 1 / 60;
      last = time;
      field.step(dt);
      show();
      if (field.quiet()) {
        last = 0;
        return;
      }
      frame = requestAnimationFrame(draw);
    };

    const wake = () => {
      if (frame || document.hidden || field.quiet()) return;
      // The text colour, once per wake rather than per frame.
      palette = inkPalette(
        contentRgb(hostElement),
        document.documentElement.classList.contains("theme-light"),
      );
      last = 0;
      frame = requestAnimationFrame(draw);
    };

    const local = (event: PointerEvent) => {
      rect ??= hostElement.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top] as const;
    };

    const onEnter = () => {
      rect = hostElement.getBoundingClientRect();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const [x, y] = local(event);
      field.moved(x, y, event.timeStamp || performance.now());
      wake();
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(NOT_INK)) return;
      const [x, y] = local(event);
      field.pressed(x, y);
      wake();
    };
    const onUp = () => {
      if (!field.press) return;
      field.released();
      wake();
    };
    const onLeave = () => field.left();
    const onVisible = () => {
      if (!document.hidden) wake();
    };

    const resizer = new ResizeObserver(() => {
      fit();
      wake();
    });
    fit();
    resizer.observe(hostElement);
    hostElement.addEventListener("pointerenter", onEnter);
    hostElement.addEventListener("pointermove", onMove, { passive: true });
    hostElement.addEventListener("pointerdown", onDown, { passive: true });
    hostElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("blur", onUp);
    document.addEventListener("visibilitychange", onVisible);
    wake();

    return () => {
      cancelAnimationFrame(frame);
      resizer.disconnect();
      hostElement.removeEventListener("pointerenter", onEnter);
      hostElement.removeEventListener("pointermove", onMove);
      hostElement.removeEventListener("pointerdown", onDown);
      hostElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp);
      document.removeEventListener("visibilitychange", onVisible);
      // A hold or a trail never resumes after a pause; the ink itself stays.
      field.settle();
    };
  }, [host, canvas, live]);
}
