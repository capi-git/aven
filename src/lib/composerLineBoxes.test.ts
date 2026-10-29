// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerLineBoxes, lineBoxProblem } from "./composerLineBoxes";

/**
 * A message box laid out as WebKit lays out the real one at an interface
 * zoom: the field's box and padding, and the overlay's painted line runs.
 * happy-dom has no layout, so the geometry is given.
 */
function box({
  zoom,
  overlayShift = 0,
  overlayExtra = 0,
  lines = 2,
}: {
  zoom: number;
  overlayShift?: number;
  overlayExtra?: number;
  lines?: number;
}) {
  const root = document.createElement("div");
  root.innerHTML = `<div class="composer-highlight">first line second line</div><textarea class="composer-field"></textarea>`;
  document.body.append(root);
  const field = root.querySelector("textarea")!;
  const overlay = root.querySelector<HTMLElement>(".composer-highlight")!;
  const top = 700;
  const lineHeight = 22;
  const padding = 13;
  const height = (padding * 2 + lineHeight * lines) * zoom;
  const rect = (y: number, h: number) =>
    ({
      top: y,
      height: h,
      bottom: y + h,
      left: 0,
      right: 600,
      width: 600,
      x: 0,
      y,
    }) as DOMRect;
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(rect(top, height));
  Object.defineProperty(field, "offsetHeight", { value: height / zoom });
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
    rect(top, height + overlayExtra),
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        lineHeight: `${lineHeight}px`,
        paddingTop: `${padding}px`,
        borderTopWidth: "0px",
      }) as CSSStyleDeclaration,
  );
  // Glyph runs 16.5px tall, centred in each line, as SF Pro at 14px.
  const glyph = 16.49 * zoom;
  const runs = Array.from({ length: lines }, (_, index) =>
    rect(
      top +
        (padding + index * lineHeight) * zoom +
        (lineHeight * zoom - glyph) / 2 +
        overlayShift,
      glyph,
    ),
  );
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue(
    runs as unknown as DOMRectList,
  );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("the field's and the overlay's line boxes", () => {
  it.each([0.8, 1, 1.2])("match at %s interface zoom", (zoom) => {
    const boxes = composerLineBoxes(box({ zoom }))!;
    expect(boxes.overlay).toHaveLength(2);
    expect(boxes.field).toEqual(
      boxes.overlay.map((top) => expect.closeTo(top, 1)),
    );
    expect(lineBoxProblem(boxes)).toBeNull();
  });

  it("names a caret half a line below the words", () => {
    const boxes = composerLineBoxes(box({ zoom: 0.8, overlayShift: -8.8 }))!;
    expect(lineBoxProblem(boxes)).toBe(
      "line 1 is painted 8.8px above the field's line, where the caret is",
    );
  });

  it("names an overlay taller than the field it paints for", () => {
    // The old inline-block field stood on its wrapper's baseline, leaving a
    // gap under it that the overlay (sized to the wrapper) covered.
    const boxes = composerLineBoxes(box({ zoom: 1, overlayExtra: 4.83 }))!;
    expect(lineBoxProblem(boxes)).toMatch(/is not the field's/);
  });

  it("has nothing to say about an empty box", () => {
    expect(composerLineBoxes(box({ zoom: 1, lines: 0 }))).toBeNull();
  });
});
