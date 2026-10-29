import { expect, it } from "vitest";
import { PIXEL_FONT_HEIGHT, pixelTextPath } from "./pixelFont";

it("draws capitals five pixels wide with a pixel between, and spaces as gaps", () => {
  const { width, d } = pixelTextPath("MODEL");
  expect(width).toBe(5 * 5 + 4);
  expect(d).toMatch(/^M0 0h1v1h-1z/);
  expect(pixelTextPath("I").width).toBe(3);
  expect(pixelTextPath("A A").width).toBe(5 + 1 + 3 + 5);
  expect(PIXEL_FONT_HEIGHT).toBe(7);
});

it("reads lowercase as capitals and leaves out what it cannot draw", () => {
  expect(pixelTextPath("room").d).toBe(pixelTextPath("ROOM").d);
  expect(pixelTextPath("").width).toBe(0);
});
