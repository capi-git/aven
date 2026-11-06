import { describe, expect, it } from "vitest";
import { INK_CHARGE, InkField, inkPalette, inked, packRgba } from "./inkField";

const FRAME = 1 / 30;

function field(width = 600, height = 400) {
  const ink = new InkField();
  ink.resize(width, height, false);
  return ink;
}

describe("new chat ink", () => {
  it("halftones a tone into exactly that share of cells", () => {
    let on = 0;
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) if (inked(col, row, 0.25)) on++;
    expect(on).toBe(4);
    expect(inked(0, 0, 0)).toBe(false);
    expect(inked(3, 3, 1)).toBe(true);
  });

  it("greets once with a soft ring when it first has room", () => {
    const ink = new InkField();
    ink.resize(0, 0);
    expect(ink.quiet()).toBe(true);
    ink.resize(800, 500);
    expect(ink.ripples).toHaveLength(1);
    expect(ink.quiet()).toBe(false);
    ink.resize(900, 500);
    expect(ink.ripples).toHaveLength(1);
  });

  it("inks a trail behind the pointer, then fades to sleep", () => {
    const ink = field();
    expect(ink.quiet()).toBe(true);
    expect(ink.moved(100, 100, 0)).toBe(true);
    ink.moved(300, 120, 33);
    ink.step(FRAME);
    expect(ink.peak).toBeGreaterThan(0.3);
    for (let i = 0; i < 400 && !ink.quiet(); i++) ink.step(FRAME);
    expect(ink.quiet()).toBe(true);
  });

  it("bursts harder after a longer hold, and a charged burst echoes", () => {
    const ink = field();
    ink.pressed(300, 200);
    ink.released();
    const tap = ink.ripples[0]!.strength;
    expect(ink.ripples).toHaveLength(1);
    ink.ripples = [];
    ink.pressed(300, 200);
    ink.press!.held = INK_CHARGE;
    ink.released();
    expect(ink.ripples[0]!.strength).toBeGreaterThan(tap);
    expect(ink.ripples).toHaveLength(2);
  });

  it("charges while held and follows the pointer", () => {
    const ink = field();
    ink.pressed(200, 200);
    for (let i = 0; i < 12; i++) ink.step(FRAME);
    expect(ink.press!.held).toBeCloseTo(12 * FRAME, 5);
    ink.moved(260, 210, 400);
    expect(ink.press).toMatchObject({ x: 260, y: 210 });
    expect(ink.peak).toBeGreaterThan(0);
  });

  it("lets go without a burst when it settles", () => {
    const ink = field();
    ink.pressed(200, 200);
    ink.moved(220, 200, 16);
    ink.settle();
    expect(ink.press).toBeNull();
    expect(ink.pointer).toBeNull();
    expect(ink.splats).toHaveLength(0);
    ink.released();
    expect(ink.ripples).toHaveLength(0);
  });

  it("never steps further than a frame's worth at once", () => {
    const ink = field();
    ink.moved(100, 100, 0);
    ink.moved(140, 100, 16);
    ink.step(5);
    expect(ink.time).toBeCloseTo(0.05, 5);
    ink.step(Number.NaN);
    ink.step(0);
    expect(ink.time).toBeCloseTo(0.05, 5);
  });

  it("paints a sparse grey halftone, and nothing once quiet", () => {
    const ink = field(300, 150);
    const palette = inkPalette([235, 238, 241], false);
    const { cols, rows } = ink.cells();
    expect([cols, rows]).toEqual([100, 50]);
    const pixels = new Uint32Array(cols * rows);
    expect(ink.paint(pixels, palette)).toBe(0);

    ink.moved(20, 75, 0);
    ink.moved(280, 75, 60);
    ink.step(FRAME);
    const inkedCells = ink.paint(pixels, palette);
    expect(inkedCells).toBeGreaterThan(0);
    // Coverage stays sparse: never a solid fill, even on the trail.
    expect(inkedCells / pixels.length).toBeLessThan(0.5);
    const allowed = new Set([0, ...palette.ink, ...palette.lit]);
    for (const pixel of pixels) expect(allowed.has(pixel)).toBe(true);

    for (let i = 0; i < 400 && !ink.quiet(); i++) ink.step(FRAME);
    expect(ink.paint(pixels, palette)).toBe(0);
    expect(pixels.every((pixel) => pixel === 0)).toBe(true);
  });

  it("uses the text colour, faint, and a little stronger on light surfaces", () => {
    const dark = inkPalette([235, 238, 241], false);
    const light = inkPalette([28, 28, 30], true);
    const alpha = (pixel: number) => pixel >>> 24;
    const red = (pixel: number) => pixel & 0xff;
    for (const pixel of [...dark.ink, ...dark.lit]) {
      expect(red(pixel)).toBe(235);
      expect(alpha(pixel)).toBeLessThan(0.6 * 255);
    }
    expect(alpha(light.ink[0])).toBeGreaterThan(alpha(dark.ink[0]));
    expect(packRgba(1, 2, 3, 1)).toBe(0xff030201);
  });
});
