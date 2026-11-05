// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_TONES } from "../lib/markTones";
import {
  STACK_FAN_DEGREES,
  STACK_FAN_ORIGIN,
  STACK_PAGES,
  rotationDegrees,
} from "../lib/stackMark";
import { StackMark } from "./StackMark";

const css = readFileSync("src/chrome/StackMark.css", "utf8");
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function draw(props: Parameters<typeof StackMark>[0]) {
  await act(async () => root.render(createElement(StackMark, props)));
}

const stack = () => container.querySelector<HTMLElement>(".stack-mark")!;

describe("the Stack", () => {
  it("draws three pages, back to front, in a 64-unit box", async () => {
    await draw({ tone: "green" });
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 64 64",
    );
    const pages = [...container.querySelectorAll("rect")].map((rect) => ({
      part: rect.getAttribute("class"),
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
      radius: Number(rect.getAttribute("rx")),
    }));
    expect(pages).toEqual([
      {
        part: "stack-mark-back",
        x: 14,
        y: 8,
        width: 36,
        height: 30,
        radius: 5,
      },
      {
        part: "stack-mark-middle",
        x: 10,
        y: 15,
        width: 44,
        height: 32,
        radius: 5.5,
      },
      {
        part: "stack-mark-front",
        x: 6,
        y: 23,
        width: 52,
        height: 33,
        radius: 6,
      },
    ]);
    expect(STACK_PAGES.map((page) => page.part)).toEqual([
      "back",
      "middle",
      "front",
    ]);
  });

  it("takes its project's colour from the theme, never an inline one", async () => {
    await draw({ tone: "teal" });
    expect(stack().dataset.tone).toBe("teal");
    expect(container.innerHTML).not.toMatch(/style=|fill="#/);
    // Grey is the plain mark: no tone of its own.
    await draw({ tone: "grey" });
    expect(stack().hasAttribute("data-tone")).toBe(false);
    await draw({});
    expect(stack().hasAttribute("data-tone")).toBe(false);
  });

  it("has a theme colour for each tone but Grey", () => {
    for (const { tone } of MARK_TONES) {
      if (tone === "grey") continue;
      expect(css).toContain(
        `.stack-mark[data-tone="${tone}"] {\n  color: var(--aven-mark-${tone});`,
      );
    }
    // Grey tones the whole mark down at once, so no page shows through.
    expect(css).toMatch(
      /\.stack-mark:not\(\[data-tone\]\) \{\s*opacity: 0\.6;/,
    );
    expect(css).toMatch(/\.stack-mark-back \{\s*opacity: 0\.32;/);
    expect(css).toMatch(/\.stack-mark-middle \{\s*opacity: 0\.6;/);
  });

  it("fans its back pages only while the project is open", async () => {
    await draw({ tone: "blue" });
    expect(stack().hasAttribute("data-open")).toBe(false);
    await draw({ tone: "blue", open: true });
    expect(stack().hasAttribute("data-open")).toBe(true);
    // The stylesheet turns them, around the front page's bottom middle.
    expect(css).toContain(
      `.stack-mark[data-open] .stack-mark-back {\n  transform: rotate(${STACK_FAN_DEGREES.back}deg);`,
    );
    expect(css).toContain(
      `.stack-mark[data-open] .stack-mark-middle {\n  transform: rotate(${STACK_FAN_DEGREES.middle}deg);`,
    );
    expect(css).toContain(
      `transform-origin: ${STACK_FAN_ORIGIN.x}px ${STACK_FAN_ORIGIN.y}px;`,
    );
    expect(css).toContain("transform-box: view-box;");
  });

  it("eases the fan on a duration Reduce motion zeroes, and nothing else moves", () => {
    expect(css).toContain(
      "transition: transform var(--aven-motion-glide) var(--aven-ease-spring);",
    );
    expect(css).not.toMatch(/animation|@keyframes/);
    // Only the transform moves.
    expect(css.match(/transition:[^;]+;/g)).toEqual([
      "transition: transform var(--aven-motion-glide) var(--aven-ease-spring);",
    ]);
  });
});

describe("reading a page's turn", () => {
  it("reads matrices as browsers report a rotate()", () => {
    const turn = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
      return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 3.2, -1.5)`;
    };
    expect(rotationDegrees(turn(-14))).toBeCloseTo(-14, 5);
    expect(rotationDegrees(turn(-6))).toBeCloseTo(-6, 5);
    expect(rotationDegrees("none")).toBe(0);
    expect(rotationDegrees("")).toBe(0);
    expect(
      rotationDegrees(
        "matrix3d(0.97, -0.24, 0, 0, 0.24, 0.97, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
      ),
    ).toBeCloseTo(-13.9, 1);
    expect(rotationDegrees("rotate(-14deg)")).toBeNull();
    expect(rotationDegrees("matrix(1, 0, 0)")).toBeNull();
  });
});
