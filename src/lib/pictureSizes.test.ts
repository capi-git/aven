import { afterEach, describe, expect, it } from "vitest";
import {
  forgetPictureSizes,
  pictureSize,
  rememberPictureSize,
} from "./pictureSizes";

const loaded = (naturalWidth: number, naturalHeight: number) =>
  ({ naturalWidth, naturalHeight }) as HTMLImageElement;

describe("pictureSizes", () => {
  afterEach(() => forgetPictureSizes());

  it("remembers a loaded picture's natural size by its key", () => {
    expect(pictureSize("/shots/a.png")).toBeUndefined();
    const size = rememberPictureSize("/shots/a.png", loaded(2400, 1500));
    expect(size).toEqual({ width: 2400, height: 1500 });
    expect(pictureSize("/shots/a.png")).toBe(size);
  });

  it("keeps the same entry for the same size, and replaces a changed one", () => {
    const first = rememberPictureSize("/shots/a.png", loaded(2400, 1500));
    expect(rememberPictureSize("/shots/a.png", loaded(2400, 1500))).toBe(first);
    expect(rememberPictureSize("/shots/a.png", loaded(1200, 900))).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it("ignores a picture with no size", () => {
    expect(rememberPictureSize("/shots/a.png", loaded(0, 0))).toBeUndefined();
    expect(pictureSize("/shots/a.png")).toBeUndefined();
  });

  it("forgets the oldest pictures past its limit", () => {
    for (let index = 0; index <= 500; index += 1)
      rememberPictureSize(`/shots/${index}.png`, loaded(10, 10));
    expect(pictureSize("/shots/0.png")).toBeUndefined();
    expect(pictureSize("/shots/500.png")).toBeDefined();
  });
});
