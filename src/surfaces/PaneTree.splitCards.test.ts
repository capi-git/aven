import { describe, expect, it } from "vitest";
import { splitPaneBox } from "./PaneTree";

describe("splitPaneBox", () => {
  it("keeps a single pane flush", () => {
    expect(splitPaneBox({ x: 0, y: 0, w: 1, h: 1 }, false)).toEqual({
      left: "0%",
      top: "0%",
      width: "100%",
      height: "100%",
    });
  });

  it("steps in by half the gap only where a pane meets another", () => {
    expect(splitPaneBox({ x: 0, y: 0, w: 0.5, h: 1 }, true)).toEqual({
      left: "calc(0% + 0px)",
      top: "calc(0% + 0px)",
      width: "calc(50% - 3px)",
      height: "calc(100% - 0px)",
    });
    expect(splitPaneBox({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, true)).toEqual({
      left: "calc(50% + 3px)",
      top: "calc(50% + 3px)",
      width: "calc(50% - 3px)",
      height: "calc(50% - 3px)",
    });
  });
});
