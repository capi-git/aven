// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOPPER_GEOMETRY,
  HOPPER_WATCH,
  hopperSpot,
  hopperWatchLoop,
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
const watchCss = readFileSync(
  "src/chrome/HopperMark.watch.css",
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

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
    for (const sheet of [css, watchCss]) {
      const keyframes = [...sheet.matchAll(/@keyframes ([\w-]+)/g)];
      expect(keyframes.length).toBeGreaterThan(3);
      for (const match of keyframes) {
        const body = blockAfter(sheet, match.index!);
        const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(
          (property) => property[1],
        );
        for (const property of properties)
          expect([
            "transform",
            "opacity",
            "animation-timing-function",
          ]).toContain(property);
      }
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

  it("watches by hopping from dot to dot, pausing on each, as the loop says", () => {
    /** Each stop of a keyframes block: its time, and its translate in %. */
    const stops = (name: string) =>
      [
        ...blockAfter(watchCss, watchCss.indexOf(`@keyframes ${name} {`))
          .replace(/\s+/g, " ")
          .matchAll(/([\d.]+)% \{ transform: ([^;]+);/g),
      ].map(([, at, transform]) => {
        const move = /translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(transform);
        const lift = /translateY\((-?[\d.]+)%\)/.exec(transform);
        return {
          at: Number(at),
          x: move ? Number(move[1]) : 0,
          y: move ? Number(move[2]) : lift ? Number(lift[1]) : 0,
        };
      });
    for (const size of ["big", "small"] as const) {
      const geometry = HOPPER_GEOMETRY[size];
      const path = HOPPER_WATCH.path[size];
      const loop = hopperWatchLoop(size);
      const last = geometry.steps - 1;
      // From the box on the bottom step to a grey dot's own centre.
      const at = ([column, row]: readonly [number, number]) => ({
        x: (column - last) * 100,
        y:
          (((row - last) * geometry.cell + geometry.above) / geometry.cell) *
          100,
      });
      const walk: { at: number; x: number; y: number }[] = [];
      const arc: { at: number; x: number; y: number }[] = [
        { at: 0, x: 0, y: 0 },
      ];
      const lift = -(HOPPER_WATCH.arc[size] / (geometry.dotRadius * 2)) * 100;
      let time = 0;
      path.forEach((dot, index) => {
        const leave = time + HOPPER_WATCH.pauses[index];
        walk.push({ at: time, ...at(dot) }, { at: leave, ...at(dot) });
        arc.push(
          { at: leave, x: 0, y: 0 },
          { at: leave + HOPPER_WATCH.hop / 2, x: 0, y: lift },
          { at: leave + HOPPER_WATCH.hop, x: 0, y: 0 },
        );
        time = leave + HOPPER_WATCH.hop;
      });
      walk.push({ at: loop, ...at(path[0]) });
      const suffix = size === "big" ? "" : "-small";
      for (const [name, expected] of [
        [`hopper-watch${suffix}`, walk],
        [`hopper-watch-arc${suffix}`, arc],
      ] as const) {
        const found = stops(name);
        expect(found, name).toHaveLength(expected.length);
        found.forEach((stop, index) => {
          expect(stop.at).toBeCloseTo((expected[index].at / loop) * 100, 2);
          expect(stop.x).toBeCloseTo(expected[index].x, 1);
          expect(stop.y).toBeCloseTo(expected[index].y, 1);
        });
      }
      // Its still frame (Reduce motion) is the loop's first dot.
      const first = at(path[0]);
      expect(size === "big" ? css : smallBlock).toContain(
        `transform: translate(${first.x}%, ${Number(first.y.toFixed(4))}%)`,
      );
    }
    // The loops run as long as the pauses and hops add up to.
    expect(motionBlock).toContain(
      `hopper-watch ${hopperWatchLoop("big")}s infinite`,
    );
    expect(motionBlock).toContain(
      `animation-duration: ${hopperWatchLoop("small")}s`,
    );
  });

  it("starts each agent somewhere else in its watching loop", async () => {
    const mark = await draw({ state: "watching", offset: 2.3 });
    expect(mark.style.getPropertyValue("--hopper-offset")).toBe("-2.3s");
    expect(motionBlock).toContain("animation-delay: var(--hopper-offset, 0s)");
    expect(
      (await draw({ state: "watching" })).getAttribute("style"),
    ).toBeNull();
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
