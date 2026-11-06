// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOTION_ROOT_ATTRIBUTE } from "./motion";
import { FOLLOW_GLIDE_MAX_PX, glideFollow } from "./transcriptMotion";

beforeEach(() =>
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full"),
);
afterEach(() =>
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE),
);

describe("glideFollow", () => {
  it("eases a line's follow and leaves larger jumps alone", () => {
    const calls: Keyframe[][] = [];
    const content = {
      animate: (frames: Keyframe[]) => {
        calls.push(frames);
        return {} as Animation;
      },
    } as unknown as Element;
    expect(glideFollow(content, 23)).toBe(true);
    expect(calls[0][0]).toEqual({ transform: "translateY(23px)" });
    expect(glideFollow(content, 0)).toBe(false);
    expect(glideFollow(content, FOLLOW_GLIDE_MAX_PX + 1)).toBe(false);
    expect(glideFollow(null, 23)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("glideFollow with Reduce motion", () => {
  it("leaves the follow alone", () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    let called = false;
    const content = {
      animate: () => {
        called = true;
        return {} as Animation;
      },
    } as unknown as Element;
    expect(glideFollow(content, 23)).toBe(false);
    expect(called).toBe(false);
  });
});
