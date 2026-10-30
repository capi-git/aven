// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CROSS_ROWS,
  GRID_PATH,
  TICK_ROWS,
  litPath,
  sigilByKey,
} from "../lib/dotSigils";
import { DotMark, type DotMarkState } from "./DotMark";

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

async function draw(props: Parameters<typeof DotMark>[0]) {
  await act(async () => root.render(createElement(DotMark, props)));
  return host.querySelector<HTMLElement>(".dot-mark")!;
}

const paths = () =>
  [...host.querySelectorAll("path")].map((path) => path.getAttribute("class"));

describe("DotMark", () => {
  it("draws a still sigil as one small SVG of two paths", async () => {
    const mark = await draw({ sigil: "checker" });
    expect(mark.dataset.state).toBe("still");
    expect(mark.dataset.sigil).toBe("checker");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll("svg")).toHaveLength(1);
    expect(paths()).toEqual(["dot-mark-grid", "dot-mark-lit"]);
    expect(host.querySelector(".dot-mark-grid")?.getAttribute("d")).toBe(
      GRID_PATH,
    );
    expect(host.querySelector(".dot-mark-lit")?.getAttribute("d")).toBe(
      litPath(sigilByKey("checker")!.rows),
    );
    // No colour of its own: the stylesheet strokes it in the text colour.
    expect(host.querySelector("svg")?.getAttribute("fill")).toBeNull();
    expect(host.querySelector("svg")?.getAttribute("stroke")).toBeNull();
    expect(host.querySelector(".dot-mark-status")).toBeNull();
  });

  it("sweeps by diagonal while working, with the grid's faint sweep under it", async () => {
    const mark = await draw({ sigil: "builder", state: "working" });
    expect(mark.dataset.state).toBe("working");
    const grid = [...host.querySelectorAll<SVGElement>(".dot-mark-grid-d")];
    expect(grid).toHaveLength(9);
    expect(grid.map((path) => path.style.getPropertyValue("--d"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    const lit = [...host.querySelectorAll<SVGElement>(".dot-mark-lit-d")];
    // Only the diagonals the Builder's two blocks reach: 0-2 and 6-8.
    expect(lit.map((path) => path.style.getPropertyValue("--d"))).toEqual([
      "0",
      "1",
      "2",
      "6",
      "7",
      "8",
    ]);
    expect(host.querySelector(".dot-mark-lit")).toBeNull();
  });

  it("reshapes into a tick or a cross, with a status dot, and back", async () => {
    let mark = await draw({ sigil: "scout", state: "done" });
    expect(host.querySelector(".dot-mark-lit")?.getAttribute("d")).toBe(
      litPath(TICK_ROWS),
    );
    // The sigil fades as the tick arrives.
    expect(host.querySelector(".dot-mark-was")?.getAttribute("d")).toBe(
      litPath(sigilByKey("scout")!.rows),
    );
    expect(host.querySelector(".dot-mark-status")).not.toBeNull();
    mark = await draw({ sigil: "scout", state: "error" });
    expect(mark.dataset.state).toBe("error");
    expect(host.querySelector(".dot-mark-lit")?.getAttribute("d")).toBe(
      litPath(CROSS_ROWS),
    );
    await draw({ sigil: "scout", state: "needs" });
    expect(host.querySelector(".dot-mark-lit")?.getAttribute("d")).toBe(
      litPath(sigilByKey("scout")!.rows),
    );
    expect(host.querySelector(".dot-mark-was")).toBeNull();
    expect(host.querySelector(".dot-mark-status")).not.toBeNull();
    await draw({ sigil: "scout", state: "idle" });
    expect(host.querySelector(".dot-mark-status")).toBeNull();
  });

  it("shows a completed or failed turn's reaction as the tick or the cross", async () => {
    let mark = await draw({ sigil: "spiral", reaction: "cheer" });
    expect(mark.dataset.state).toBe("done");
    expect(mark.dataset.reaction).toBe("cheer");
    expect(mark.style.getPropertyValue("--dot-mark-reaction-ms")).toBe("900ms");
    mark = await draw({ sigil: "spiral", reaction: "slump", reactionId: "a" });
    expect(mark.dataset.state).toBe("error");
    const first = mark;
    mark = await draw({ sigil: "spiral", reaction: "slump", reactionId: "b" });
    // A new reaction starts its motion again.
    expect(mark).not.toBe(first);
    mark = await draw({ sigil: "spiral", reaction: "nod" });
    expect(mark.dataset.state).toBe("still");
    expect(mark.dataset.reaction).toBe("nod");
  });

  it("keeps the whole grid in a square frame, and no frame elsewhere", async () => {
    let mark = await draw({ sigil: "corner", frame: "square" });
    expect(mark.dataset.frame).toBe("square");
    expect(host.querySelector(".dot-mark-grid")?.getAttribute("d")).toBe(
      GRID_PATH,
    );
    mark = await draw({ sigil: "corner" });
    expect(mark.hasAttribute("data-frame")).toBe(false);
  });

  it("draws an unknown sigil as an empty grid rather than failing", async () => {
    const mark = await draw({ sigil: "nope" });
    expect(mark.dataset.sigil).toBe("custom");
    expect(host.querySelector(".dot-mark-lit")?.getAttribute("d")).toBe("");
  });
});

describe("DotMark.css", () => {
  const css = readFileSync("src/chrome/DotMark.css", "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const states: DotMarkState[] = ["idle", "working", "needs"];

  it("animates only opacity and transform", () => {
    for (const [, body] of css.matchAll(
      /@keyframes [\w-]+\s*\{([\s\S]*?)\n\}/g,
    ))
      for (const [, property] of body.matchAll(/([a-z-]+)\s*:/g))
        expect(["opacity", "transform"]).toContain(property);
  });

  it("moves nothing with reduced motion", () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(
        css,
      )?.[1];
    expect(reduced).toBeDefined();
    expect(reduced).not.toContain("animation");
    // Every repeating animation waits for motion to be allowed.
    const moving =
      /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/.exec(
        css,
      )?.[1];
    for (const state of states)
      expect(moving).toContain(`[data-state="${state}"]`);
    const outside = css.replace(moving ?? "", "");
    expect(outside).not.toMatch(/animation:/);
  });

  it("strokes its dots in the text colour, hides the grid when small", () => {
    expect(css).toMatch(/stroke: currentColor;/);
    expect(css).toMatch(/color: var\(--dot-mark-ink, var\(--color-content\)\)/);
    const small = /@container \(max-width: [\d.]+px\)\s*\{([\s\S]*?)\n\}/.exec(
      css,
    )?.[1];
    // Every mark but a square-framed one drops its grid when small.
    expect(small).toMatch(
      /:not\(\[data-frame="square"\]\) \.dot-mark-grid,\s*\.dot-mark:not\(\[data-frame="square"\]\) \.dot-mark-grid-d\s*\{\s*display: none;/,
    );
  });

  it("colours only the status dot, from the theme's status tokens", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const token of [
      "var(--aven-needs-you)",
      "var(--color-emerald-400)",
      "var(--aven-danger-text)",
    ])
      expect(css).toContain(token);
  });
});
