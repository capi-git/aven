import { describe, expect, it } from "vitest";
import { COMPOSER_MAX_HEIGHT, resizeComposer } from "./composerResize";

function field(scrollHeight: number, height = "") {
  return { style: { height }, scrollHeight };
}

describe("resizeComposer", () => {
  it("fits the text up to the composer's maximum height", () => {
    const el = field(88);
    resizeComposer(el);
    expect(el.style.height).toBe("88px");

    const tall = field(400);
    resizeComposer(tall);
    expect(tall.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it.each([
    [88, 140],
    [140, 88],
    [160, 400],
  ])(
    "keeps the composer's space while measuring from %i to %i",
    (height, nextHeight) => {
      const wrapper = { style: { minHeight: "20px" }, offsetHeight: height };
      const style = { height: `${height}px` };
      let measured = false;
      const el = {
        style,
        parentElement: wrapper,
        get scrollHeight() {
          if (style.height === "auto") {
            // Reading layout here must not briefly hand the transcript a
            // taller viewport, which would clamp its scroll offset.
            expect(wrapper.style.minHeight).toBe(`${height}px`);
            measured = true;
          }
          return nextHeight;
        },
      };
      resizeComposer(el);
      expect(measured).toBe(true);
      expect(style.height).toBe(
        `${Math.min(nextHeight, COMPOSER_MAX_HEIGHT)}px`,
      );
      expect(wrapper.style.minHeight).toBe("20px");
    },
  );

  it("leaves the height alone when the field has no layout box", () => {
    const wrapper = { style: { minHeight: "20px" }, offsetHeight: 0 };
    const el = { ...field(0, "88px"), parentElement: wrapper };
    resizeComposer(el);
    expect(el.style.height).toBe("88px");
    expect(wrapper.style.minHeight).toBe("20px");
  });
});
