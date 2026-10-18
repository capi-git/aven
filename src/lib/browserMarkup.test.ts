// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_MARKUP_HISTORY,
  MARKUP_HISTORY_LIMIT,
  beginMarkupMark,
  commitMarkup,
  drawMarkup,
  extendMarkupMark,
  fitMarkupImage,
  hitTestMarkup,
  keepMarkupMark,
  markupArrowHead,
  keepTextInside,
  markupBounds,
  markupGeometry,
  markupKeyAction,
  markupPathData,
  markupPoint,
  markupTextMark,
  moveMarkupMark,
  redoMarkup,
  renderMarkupPng,
  replaceMarkupMark,
  undoMarkup,
  type MarkupShape,
} from "./browserMarkup";

const red = "#ff5a4f";
const style = { color: red, width: 6 };
const line = (id: string, from: [number, number], to: [number, number]) =>
  ({
    id,
    kind: "line",
    ...style,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
  }) satisfies MarkupShape;
const span = (
  id: string,
  kind: "box" | "circle" | "arrow",
  from: [number, number],
  to: [number, number],
) => ({ ...line(id, from, to), kind }) satisfies MarkupShape;

describe("markup keyboard", () => {
  const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  });

  it("maps single letters to tools, case-insensitively", () => {
    expect(
      ["v", "p", "l", "a", "r", "o", "T"].map((letter) =>
        markupKeyAction(key(letter), false),
      ),
    ).toEqual(
      ["select", "pen", "line", "arrow", "box", "circle", "text"].map(
        (tool) => ({ kind: "tool", tool }),
      ),
    );
    expect(markupKeyAction(key("x"), false)).toBeNull();
    expect(markupKeyAction(key("p", { altKey: true }), false)).toBeNull();
    // ⌘P belongs to the app, not the pen.
    expect(markupKeyAction(key("p", { metaKey: true }), false)).toBeNull();
  });

  it("undoes, redoes, deletes and leaves", () => {
    expect(markupKeyAction(key("z", { metaKey: true }), false)).toEqual({
      kind: "undo",
    });
    expect(
      markupKeyAction(key("Z", { metaKey: true, shiftKey: true }), false),
    ).toEqual({ kind: "redo" });
    expect(markupKeyAction(key("z", { ctrlKey: true }), false)).toEqual({
      kind: "undo",
    });
    expect(markupKeyAction(key("Delete"), false)).toEqual({ kind: "delete" });
    expect(markupKeyAction(key("Backspace"), false)).toEqual({
      kind: "delete",
    });
    expect(markupKeyAction(key("Escape"), false)).toEqual({ kind: "exit" });
  });

  it("leaves typing alone except to finish the text", () => {
    expect(markupKeyAction(key("p"), true)).toBeNull();
    expect(markupKeyAction(key("Backspace"), true)).toBeNull();
    expect(markupKeyAction(key("z", { metaKey: true }), true)).toBeNull();
    expect(markupKeyAction(key("Escape"), true)).toEqual({
      kind: "finish-text",
    });
    expect(markupKeyAction(key("Enter"), true)).toEqual({
      kind: "finish-text",
    });
    expect(
      markupKeyAction({ ...key("Enter"), isComposing: true }, true),
    ).toBeNull();
  });
});

describe("markup history", () => {
  it("undoes and redoes whole states, and a new mark drops the redo branch", () => {
    const a = [line("a", [0, 0], [10, 10])];
    const ab = [...a, line("b", [5, 5], [20, 20])];
    let history = commitMarkup(EMPTY_MARKUP_HISTORY, a);
    history = commitMarkup(history, ab);
    history = undoMarkup(history);
    expect(history.present).toBe(a);
    history = undoMarkup(history);
    expect(history.present).toEqual([]);
    expect(undoMarkup(history)).toBe(history);
    history = redoMarkup(history);
    expect(history.present).toBe(a);
    const ac = [...a, line("c", [1, 1], [2, 9])];
    history = commitMarkup(history, ac);
    expect(history.future).toEqual([]);
    expect(redoMarkup(history)).toBe(history);
    expect(commitMarkup(history, history.present)).toBe(history);
  });

  it("keeps a bounded number of undo steps", () => {
    let history = EMPTY_MARKUP_HISTORY;
    for (let index = 0; index < MARKUP_HISTORY_LIMIT + 20; index += 1)
      history = commitMarkup(history, [line(`${index}`, [0, 0], [index, 1])]);
    expect(history.past).toHaveLength(MARKUP_HISTORY_LIMIT);
  });
});

describe("drawing marks", () => {
  it("follows the pointer and drops pen points that barely move", () => {
    let pen = beginMarkupMark("pen", { x: 1, y: 1 }, { id: "p", ...style });
    pen = extendMarkupMark(pen, { x: 1.5, y: 1 }, 2);
    expect(pen.kind === "pen" && pen.points).toHaveLength(1);
    pen = extendMarkupMark(pen, { x: 5, y: 1 }, 2);
    pen = extendMarkupMark(pen, { x: 9, y: 4 }, 2);
    expect(pen.kind === "pen" && pen.points).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 9, y: 4 },
    ]);
    const arrow = extendMarkupMark(
      beginMarkupMark("arrow", { x: 0, y: 0 }, { id: "a", ...style }),
      { x: 40, y: 30 },
      2,
    );
    expect(arrow).toMatchObject({ kind: "arrow", to: { x: 40, y: 30 } });
  });

  it("discards clicks with shape tools but keeps a pen dot", () => {
    const pen = beginMarkupMark("pen", { x: 1, y: 1 }, { id: "p", ...style });
    expect(keepMarkupMark(pen, 4)).toBe(true);
    for (const tool of ["line", "arrow", "box", "circle"] as const) {
      const shape = beginMarkupMark(
        tool,
        { x: 1, y: 1 },
        { id: tool, ...style },
      );
      expect(keepMarkupMark(shape, 4)).toBe(false);
      expect(
        keepMarkupMark(extendMarkupMark(shape, { x: 9, y: 1 }, 1), 4),
      ).toBe(true);
    }
  });

  it("finishes text trimmed, and drops text that is only spaces", () => {
    const mark = markupTextMark({
      id: "t",
      color: red,
      size: 32,
      at: { x: 10, y: 20 },
      text: "  bigger  ",
    });
    expect(mark).toMatchObject({ kind: "text", text: "bigger" });
    expect(mark!.width).toBeGreaterThan(0);
    expect(
      markupTextMark({
        id: "e",
        color: red,
        size: 32,
        at: mark!.at,
        text: " ",
      }),
    ).toBeNull();
  });

  it("moves, replaces and removes one mark without touching the others", () => {
    const a = line("a", [0, 0], [10, 10]);
    const b = span("b", "box", [20, 20], [40, 30]);
    const moved = moveMarkupMark(b, 5, -5);
    expect(moved).toMatchObject({
      from: { x: 25, y: 15 },
      to: { x: 45, y: 25 },
    });
    const shapes = replaceMarkupMark([a, b], "b", moved);
    expect(shapes[0]).toBe(a);
    expect(shapes[1]).toBe(moved);
    expect(replaceMarkupMark(shapes, "a", null)).toEqual([moved]);
  });
});

describe("markup geometry", () => {
  it("shapes an arrow head in proportion to the stroke and stops the shaft inside it", () => {
    const head = markupArrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 6);
    expect(head.tip).toEqual({ x: 100, y: 0 });
    expect(head.left.x).toBeCloseTo(76);
    expect(head.right.x).toBeCloseTo(76);
    expect(head.left.y - head.right.y).toBeCloseTo(24 * 1.1);
    expect(head.shaftEnd.x).toBeCloseTo(88);
    // A short arrow keeps a head no longer than itself.
    const short = markupArrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 6);
    expect(short.left.x).toBeCloseTo(0);
    const geometry = markupGeometry(span("a", "arrow", [0, 0], [100, 0]));
    expect(geometry.stroke).toEqual([
      ["M", 0, 0],
      ["L", 88, 0],
    ]);
    expect(geometry.head?.[0]).toEqual(["M", 100, 0]);
  });

  it("draws boxes with rounded corners and circles inside their drag box", () => {
    const box = markupGeometry(span("b", "box", [50, 40], [10, 0]));
    expect(box.stroke[0]).toEqual(["M", 19, 0]);
    expect(box.stroke.at(-1)).toEqual(["Z"]);
    const circle = markupGeometry(span("c", "circle", [0, 0], [100, 50]));
    expect(circle.stroke[0]).toEqual(["M", 100, 25]);
    expect(circle.stroke[1].slice(-2)).toEqual([50, 50]);
  });

  it("smooths a pen line through its midpoints", () => {
    const pen = {
      id: "p",
      kind: "pen" as const,
      ...style,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(markupPathData(markupGeometry(pen).stroke)).toBe(
      "M 0 0 Q 10 0 10 5 L 10 10",
    );
    expect(markupGeometry({ ...pen, points: [{ x: 3, y: 4 }] }).stroke).toEqual(
      [
        ["M", 3, 4],
        ["L", 3.01, 4],
      ],
    );
  });

  it("bounds marks including their stroke", () => {
    expect(markupBounds(line("l", [10, 10], [30, 20]))).toEqual({
      x: 7,
      y: 7,
      width: 26,
      height: 16,
    });
  });
});

describe("markup hit testing", () => {
  const box = span("box", "box", [100, 100], [200, 160]);
  const circle = span("circle", "circle", [300, 100], [400, 200]);
  const arrow = span("arrow", "arrow", [0, 300], [100, 300]);
  const text = {
    id: "text",
    kind: "text" as const,
    color: red,
    size: 20,
    at: { x: 10, y: 10 },
    text: "Hi",
    width: 30,
  };
  const pen = {
    id: "pen",
    kind: "pen" as const,
    ...style,
    points: [
      { x: 500, y: 500 },
      { x: 520, y: 500 },
    ],
  };
  const shapes: MarkupShape[] = [box, circle, arrow, text, pen];

  it("finds strokes within the tolerance, and nothing on empty space", () => {
    expect(hitTestMarkup(shapes, { x: 150, y: 104 }, 4)).toBe("box");
    expect(hitTestMarkup(shapes, { x: 405, y: 150 }, 4)).toBe("circle");
    expect(hitTestMarkup(shapes, { x: 50, y: 306 }, 4)).toBe("arrow");
    expect(hitTestMarkup(shapes, { x: 82, y: 309 }, 1)).toBe("arrow");
    expect(hitTestMarkup(shapes, { x: 20, y: 20 }, 0)).toBe("text");
    expect(hitTestMarkup(shapes, { x: 510, y: 507 }, 5)).toBe("pen");
    expect(hitTestMarkup(shapes, { x: 700, y: 700 }, 8)).toBeNull();
  });

  it("selects a box or circle by its inside when no ink is near", () => {
    expect(hitTestMarkup(shapes, { x: 150, y: 130 }, 4)).toBe("box");
    expect(hitTestMarkup(shapes, { x: 350, y: 150 }, 4)).toBe("circle");
    expect(hitTestMarkup(shapes, { x: 305, y: 105 }, 1)).toBeNull();
  });

  it("prefers ink over an enclosing mark, then the topmost mark", () => {
    const inside = line("inside", [120, 130], [180, 130]);
    expect(hitTestMarkup([box, inside], { x: 150, y: 131 }, 4)).toBe("inside");
    const over = span("over", "box", [100, 100], [200, 160]);
    expect(hitTestMarkup([box, over], { x: 150, y: 100 }, 4)).toBe("over");
  });
});

describe("markup placement", () => {
  it("fits the picture into the page area from its top-left corner", () => {
    expect(
      fitMarkupImage(
        { width: 600, height: 500 },
        { width: 1200, height: 1000 },
      ),
    ).toEqual({ x: 0, y: 0, width: 600, height: 500, scale: 0.5 });
    expect(
      fitMarkupImage(
        { width: 900, height: 500 },
        { width: 1200, height: 1000 },
      ),
    ).toEqual({ x: 0, y: 0, width: 600, height: 500, scale: 0.5 });
    expect(
      fitMarkupImage({ width: 0, height: 500 }, { width: 1200, height: 1000 }),
    ).toBeNull();
  });

  it("maps pointer positions to image pixels and keeps them on the picture", () => {
    const stage = { left: 100, top: 50, width: 600, height: 500 };
    const image = { width: 1200, height: 1000 };
    expect(markupPoint({ x: 400, y: 300 }, stage, image)).toEqual({
      x: 600,
      y: 500,
    });
    expect(markupPoint({ x: 0, y: 900 }, stage, image)).toEqual({
      x: 0,
      y: 1000,
    });
  });
});

describe("markup export", () => {
  afterEach(() => vi.restoreAllMocks());

  const recorder = () => {
    const calls: unknown[][] = [];
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
      get: (target, name: string) =>
        name in target
          ? target[name]
          : (...args: unknown[]) => calls.push([name, ...args]),
      set: (target, name: string, value) => {
        target[name] = value;
        calls.push([`set ${name}`, value]);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { calls, context };
  };

  it("strokes lines, fills arrow heads and writes text in each mark's colour", () => {
    const { calls, context } = recorder();
    drawMarkup(context, [
      span("a", "arrow", [0, 0], [100, 0]),
      {
        id: "t",
        kind: "text",
        color: "#ffffff",
        size: 32,
        at: { x: 10, y: 20 },
        text: "bigger",
        width: 90,
      },
    ]);
    const names = calls.map(([name]) => name);
    expect(names).toContain("set lineWidth");
    expect(calls).toContainEqual(["set lineCap", "round"]);
    expect(calls).toContainEqual(["set strokeStyle", red]);
    expect(names.filter((name) => name === "stroke")).toHaveLength(2);
    expect(names.filter((name) => name === "fill")).toHaveLength(1);
    expect(calls).toContainEqual(["set fillStyle", "#ffffff"]);
    const text = calls.find(([name]) => name === "fillText")!;
    expect(text.slice(1, 3)).toEqual(["bigger", 10]);
    expect(text[3]).toBeGreaterThan(20);
    expect(names.filter((name) => name === "save")).toHaveLength(2);
    expect(names.filter((name) => name === "restore")).toHaveLength(2);
  });

  it("renders the picture and its marks at full size into one PNG", async () => {
    const { calls, context } = recorder();
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        sizes.push([this.width, this.height]);
        return context;
      } as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback: BlobCallback) =>
        callback(new Blob(["png"], { type: "image/png" })),
    );
    const image = document.createElement("img");
    const png = await renderMarkupPng(image, { width: 1200, height: 800 }, [
      line("l", [0, 0], [10, 10]),
    ]);
    expect(sizes).toEqual([[1200, 800]]);
    expect(calls[0]).toEqual(["drawImage", image, 0, 0, 1200, 800]);
    expect(png).toEqual({
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      width: 1200,
      height: 800,
    });
  });

  it("reports a canvas that cannot draw", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(
      renderMarkupPng(
        document.createElement("img"),
        { width: 2, height: 2 },
        [],
      ),
    ).rejects.toThrow("Could not draw the marked-up page.");
  });
});

describe("keepTextInside", () => {
  const note = (x: number, y: number) =>
    markupTextMark({
      id: "n",
      color: "#ff5a4f",
      size: 16,
      at: { x, y },
      text: "make it bigger",
    })!;

  it("moves a note placed near the right or bottom edge back inside", () => {
    const placed = note(380, 590);
    const kept = keepTextInside(placed, 400, 600, 6);
    const box = markupBounds(kept);
    expect(box.x + box.width).toBeLessThanOrEqual(394);
    expect(box.y + box.height).toBeLessThanOrEqual(594);
    expect(box.x).toBeGreaterThanOrEqual(6);
  });

  it("leaves a note that already fits where it was placed", () => {
    const placed = note(20, 20);
    expect(keepTextInside(placed, 400, 600, 6)).toBe(placed);
  });
});
