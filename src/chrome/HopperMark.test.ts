// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOPPER_GEOMETRY,
  hopperSpot,
  type HopperGeometry,
} from "../lib/hopper";
import { HopperMark } from "./HopperMark";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function draw(props: Parameters<typeof HopperMark>[0]) {
  await act(async () => root.render(createElement(HopperMark, props)));
  return host.querySelector<HTMLElement>(".hopper-mark")!;
}

const css = readFileSync("src/chrome/HopperMark.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the block that opens at the first `{` after `from`. */
function blockAfter(text: string, from: number): string {
  const open = text.indexOf("{", from);
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === "{") depth++;
    else if (text[at] === "}" && --depth === 0) return text.slice(open + 1, at);
  }
  throw new Error("unbalanced CSS");
}

/** A rule's declarations, by its exact selector, in `text`. */
function rule(text: string, selector: string): string {
  const at = text.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return blockAfter(text, at);
}

const smallBlock = blockAfter(
  css,
  css.indexOf("@container (max-width: 23.5px)"),
);
const motionBlock = blockAfter(
  css,
  css.indexOf("@media (prefers-reduced-motion: no-preference)"),
);

/** A share of `whole` as CSS writes it here: up to six decimals. */
const pct = (part: number, whole: number) =>
  `${Number(((part / whole) * 100).toFixed(6))}%`;

/** The dot's box (one step across, on the bottom step) and the dot in it. */
function placement(geometry: HopperGeometry) {
  const bottom = hopperSpot(geometry, geometry.steps - 1);
  const half = geometry.cell / 2;
  const inset = (geometry.cell - geometry.dotRadius * 2) / 2;
  return {
    walk: [
      `left: ${pct(bottom.x - half, 64)}`,
      `top: ${pct(bottom.y - half, 64)}`,
      `width: ${pct(geometry.cell, 64)}`,
      `height: ${pct(geometry.cell, 64)}`,
    ],
    dot: [
      `left: ${pct(inset, geometry.cell)}`,
      `top: ${pct(inset, geometry.cell)}`,
      `width: ${pct(geometry.dotRadius * 2, geometry.cell)}`,
      `height: ${pct(geometry.dotRadius * 2, geometry.cell)}`,
    ],
    top: `translate(-${(geometry.steps - 1) * 100}%, -${(geometry.steps - 1) * 100}%)`,
  };
}

describe("HopperMark", () => {
  it("draws the steps as one still path per size, and the dot on its own", async () => {
    const mark = await draw({});
    expect(mark.classList.contains("dot-mark")).toBe(true);
    const big = mark.querySelector(".hopper-steps-big")!.getAttribute("d")!;
    const small = mark.querySelector(".hopper-steps-small")!.getAttribute("d")!;
    // Rise: 1 + 2 + 3 + 4 + 5 dots, and three steps below 24px.
    expect(big.match(/h0/g)).toHaveLength(15);
    expect(small.match(/h0/g)).toHaveLength(6);
    expect(big.startsWith("M13 21h0")).toBe(true);
    expect(mark.querySelectorAll(".hopper-walk > .hopper-dot")).toHaveLength(1);
    expect(mark.dataset.hopper).toBe("still");
  });

  it("says its state and colour as attributes, and leaves Grey plain", async () => {
    let mark = await draw({ state: "working", tone: "blue" });
    expect(mark.dataset.hopper).toBe("working");
    expect(mark.dataset.tone).toBe("blue");
    mark = await draw({ state: "needs", tone: "grey" });
    expect(mark.dataset.hopper).toBe("needs");
    expect(mark.dataset.tone).toBeUndefined();
  });

  it("draws the steps alone for a teammate still to come", async () => {
    const mark = await draw({ vacant: true });
    expect(mark.querySelector(".hopper-dot")).toBeNull();
    expect(mark.querySelector(".hopper-steps")).not.toBeNull();
  });

  it("times a reaction by the shared reaction lengths", async () => {
    const mark = await draw({ reaction: "cheer", reactionId: "turn-1" });
    expect(mark.dataset.reaction).toBe("cheer");
    expect(mark.style.getPropertyValue("--hopper-reaction-ms")).toBe("900ms");
  });

  it("places the dot where the geometry says, big and small", () => {
    const big = placement(HOPPER_GEOMETRY.big);
    const small = placement(HOPPER_GEOMETRY.small);
    for (const line of big.walk)
      expect(rule(css, ".hopper-walk")).toContain(line);
    for (const line of big.dot)
      expect(rule(css, ".hopper-dot")).toContain(line);
    for (const line of small.walk)
      expect(rule(smallBlock, ".hopper-walk")).toContain(line);
    for (const line of small.dot)
      expect(rule(smallBlock, ".hopper-dot")).toContain(line);
    expect(css).toContain(big.top);
    expect(smallBlock).toContain(small.top);
    // A step's dot is its stroke's width.
    expect(rule(css, ".hopper-steps-big")).toContain(
      `stroke-width: ${HOPPER_GEOMETRY.big.stepRadius * 2}`,
    );
    expect(rule(css, ".hopper-steps-small")).toContain(
      `stroke-width: ${HOPPER_GEOMETRY.small.stepRadius * 2}`,
    );
  });

  it("hops as high as the geometry says, in its own size", () => {
    const lift = (name: string) =>
      Number(
        /translateY\(-([\d.]+)%\)/.exec(
          blockAfter(css, css.indexOf(`@keyframes ${name} `)),
        )![1],
      );
    const { big, small } = HOPPER_GEOMETRY;
    expect(lift("hopper-hop")).toBeCloseTo(
      (big.jump / (big.dotRadius * 2)) * 100,
      0,
    );
    expect(lift("hopper-hop-small")).toBeCloseTo(
      (small.jump / (small.dotRadius * 2)) * 100,
      0,
    );
    expect(lift("hopper-bounce")).toBe(lift("hopper-hop"));
    expect(lift("hopper-bounce-small")).toBe(lift("hopper-hop-small"));
  });

  it("animates only transform and opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes ([\w-]+)/g)];
    expect(keyframes.length).toBeGreaterThan(8);
    for (const match of keyframes) {
      const body = blockAfter(css, match.index!);
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(
        (property) => property[1],
      );
      for (const property of properties)
        expect(["transform", "opacity", "animation-timing-function"]).toContain(
          property,
        );
    }
  });

  it("moves only without Reduce motion, and holds still while hidden or resized", () => {
    const outside = css.replace(motionBlock, "");
    expect(outside).not.toMatch(/animation(-name)?\s*:/);
    expect(motionBlock).toContain("hopper-climb 3s linear infinite");
    expect(motionBlock).toContain("hopper-climb-small 1.8s linear infinite");
    const pause = css.slice(css.lastIndexOf(":root:is("));
    for (const flag of [
      "[data-hidden]",
      ".is-resizing",
      ".is-window-resizing",
      '[data-workspace-stage][data-resizing="true"]',
    ])
      expect(pause).toContain(flag);
    expect(pause).toContain("animation-play-state: paused");
  });

  it("climbs one step every 0.6s", () => {
    const { big, small } = HOPPER_GEOMETRY;
    // Each cycle: a 0.3s fade on the bottom step, a hop per step, and a 0.3s
    // fade on the top one.
    expect(0.3 + (big.steps - 1) * 0.6 + 0.3).toBeCloseTo(3);
    expect(0.3 + (small.steps - 1) * 0.6 + 0.3).toBeCloseTo(1.8);
    // The keyframes where it is highest: one per hop.
    const peaks = (name: string) =>
      /((?:[\d.]+%,?\s*)+)\{\s*transform: translateY\(-/
        .exec(blockAfter(css, css.indexOf(`@keyframes ${name} `)))![1]
        .match(/[\d.]+%/g);
    expect(peaks("hopper-hop")).toHaveLength(big.steps - 1);
    expect(peaks("hopper-hop-small")).toHaveLength(small.steps - 1);
  });
});
