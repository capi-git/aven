// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_GEOMETRY, AGENT_SMALL_SCALE } from "../lib/agentMark";
import { AgentMark } from "./AgentMark";

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

async function draw(props: Parameters<typeof AgentMark>[0]) {
  await act(async () => root.render(createElement(AgentMark, props)));
  return host.querySelector<HTMLElement>(".agent-mark")!;
}

const css = readFileSync("src/chrome/AgentMark.css", "utf8").replace(
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
const dressedBlock = blockAfter(
  css,
  css.indexOf("@container (min-width: 27.5px)"),
);
const motionBlock = blockAfter(
  css,
  css.indexOf("@media (prefers-reduced-motion: no-preference)"),
);

/** A share of the 64-unit box (or of `whole`), as CSS writes it here. */
const pct = (part: number, whole = 64) =>
  `${Number(((part / whole) * 100).toFixed(6))}%`;

/** Where a circle of radius `r` at (`x`, `y`) sits, as an HTML box. */
const placed = (x: number, y: number, r: number) => [
  `left: ${pct(x - r)}`,
  `top: ${pct(y - r)}`,
  `width: ${pct(2 * r)}`,
  `height: ${pct(2 * r)}`,
];

describe("AgentMark", () => {
  it("draws a head, its face plate, bolts, an antenna and a light", async () => {
    const mark = await draw({});
    expect(mark.classList.contains("dot-mark")).toBe(true);
    for (const part of [
      ".agent-body .agent-head",
      ".agent-body .agent-plate",
      ".agent-body .agent-bolts",
      ".agent-body .agent-stalk",
      ".agent-bob > .agent-light",
      ".agent-bob > .agent-eyes",
    ])
      expect(mark.querySelector(part), part).not.toBeNull();
    expect(mark.dataset.agent).toBe("still");
    // A label's eyes are open and nothing moves.
    expect(mark.querySelector<HTMLElement>(".agent-eyes")!.dataset.mood).toBe(
      "open",
    );
    expect(mark.querySelector(".agent-key")).toBeNull();
    expect(mark.querySelector(".agent-z")).toBeNull();
  });

  it("shows each mood in its eyes, with keys while it works and a z at rest", async () => {
    const mood = async (state: Parameters<typeof AgentMark>[0]["state"]) => {
      const mark = await draw({ state });
      return {
        eyes: mark.querySelector<HTMLElement>(".agent-eyes")!.dataset.mood,
        key: !!mark.querySelector(".agent-key"),
        keys: !!mark.querySelector(".agent-keys"),
        z: !!mark.querySelector(".agent-z"),
      };
    };
    expect(await mood("resting")).toEqual({
      eyes: "closed",
      key: false,
      keys: false,
      z: true,
    });
    expect(await mood("watching")).toMatchObject({ eyes: "open", key: false });
    expect(await mood("working")).toEqual({
      eyes: "squint",
      key: true,
      keys: true,
      z: false,
    });
    expect(await mood("needs")).toMatchObject({ eyes: "wide", key: false });
  });

  it("says its colour and outfit as attributes, and leaves Grey plain", async () => {
    let mark = await draw({ state: "working", tone: "blue", outfit: "hat" });
    expect(mark.dataset.tone).toBe("blue");
    expect(mark.dataset.outfit).toBe("hat");
    expect(mark.hasAttribute("data-hatted")).toBe(true);
    expect(mark.querySelectorAll(".agent-outfit .agent-hat")).toHaveLength(2);
    mark = await draw({ tone: "grey", outfit: "tick" });
    expect(mark.dataset.tone).toBeUndefined();
    expect(mark.hasAttribute("data-hatted")).toBe(false);
    expect(mark.querySelector(".agent-outfit .agent-badge")).not.toBeNull();
    mark = await draw({});
    expect(mark.querySelector(".agent-outfit")).toBeNull();
  });

  it("draws its outline alone, faint, for a teammate still to come", async () => {
    const mark = await draw({ vacant: true, outfit: "headset" });
    expect(mark.querySelector(".agent-eyes")).toBeNull();
    expect(mark.querySelector(".agent-outfit")).toBeNull();
    expect(mark.querySelector(".agent-head")).not.toBeNull();
    expect(rule(css, ".agent-mark[data-vacant] .agent-bob")).toContain(
      "opacity",
    );
  });

  it("times a reaction by the shared lengths, and starts each agent elsewhere in its loops", async () => {
    let mark = await draw({ reaction: "cheer", reactionId: "turn-1" });
    expect(mark.dataset.reaction).toBe("cheer");
    expect(mark.style.getPropertyValue("--agent-reaction-ms")).toBe("900ms");
    mark = await draw({ state: "watching", phase: 1.7 });
    expect(mark.style.getPropertyValue("--agent-phase")).toBe("-1.7s");
    expect(
      (await draw({ state: "watching" })).getAttribute("style"),
    ).toBeNull();
  });

  it("places its light, lamp, nub and key where the geometry says", () => {
    const { light, lamp, nub, keys } = AGENT_GEOMETRY;
    for (const line of placed(light.x, light.y, light.r))
      expect(rule(css, ".agent-light")).toContain(line);
    for (const line of placed(light.x, light.y, light.r * AGENT_SMALL_SCALE))
      expect(rule(smallBlock, ".agent-light")).toContain(line);
    for (const line of placed(lamp.x, lamp.y, lamp.r))
      expect(
        rule(dressedBlock, '.agent-mark[data-outfit="hat"] .agent-light'),
      ).toContain(line);
    for (const line of placed(nub.x, nub.y, nub.r))
      expect(
        rule(dressedBlock, '.agent-mark[data-outfit="beret"] .agent-light'),
      ).toContain(line);
    for (const line of placed(keys.xs[0], keys.y, keys.r))
      expect(rule(css, ".agent-key")).toContain(line);
    // Its eyes blink about the line they sit on.
    expect(
      /\n\.agent-eyes \{\s*transform-origin: ([^;]+);/.exec(css)?.[1],
    ).toBe(`50% ${pct(AGENT_GEOMETRY.eyes.y)}`);
  });

  it("moves as far as the mock-up: a 6-unit bounce, a 2.6-unit look, a key 4 units on", () => {
    const frames = (name: string) =>
      blockAfter(css, css.indexOf(`@keyframes ${name} `));
    expect(frames("agent-bounce")).toContain(`translateY(-${pct(6)})`);
    expect(frames("agent-busy")).toContain(`translateY(-${pct(1.4)})`);
    expect(frames("agent-doze")).toContain(`translateY(${pct(0.4)})`);
    expect(frames("agent-doze")).toContain(`translateY(${pct(1.6)})`);
    expect(frames("agent-look")).toContain(`translateX(-${pct(2.6)})`);
    expect(frames("agent-look")).toContain(`translateX(${pct(2.6)})`);
    // A blink at each turn of its look.
    expect(frames("agent-look").match(/scaleY\(0\.12\)/g)).toHaveLength(2);
    const step = AGENT_GEOMETRY.keys.xs[1] - AGENT_GEOMETRY.keys.xs[0];
    expect(frames("agent-type")).toContain(
      `translateX(${pct(step, AGENT_GEOMETRY.keys.r * 2)})`,
    );
  });

  it("animates only transform and opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes ([\w-]+)/g)];
    expect(keyframes.length).toBeGreaterThan(8);
    for (const match of keyframes) {
      const body = blockAfter(css, match.index!);
      for (const [, property] of body.matchAll(/([a-z-]+)\s*:/g))
        expect(["transform", "opacity", "animation-timing-function"]).toContain(
          property,
        );
    }
  });

  it("moves only without Reduce motion, and holds still while hidden or resized", () => {
    const outside = css.replace(motionBlock, "");
    expect(outside).not.toMatch(/animation(-name)?\s*:/);
    const pause = css.slice(css.lastIndexOf(":root:is("));
    for (const flag of [
      "[data-hidden]",
      ".is-resizing",
      ".is-window-resizing",
      '[data-workspace-stage][data-resizing="true"]',
    ])
      expect(pause).toContain(flag);
    expect(pause).toContain(
      ":is(.agent-bob, .agent-eyes, .agent-light, .agent-key)",
    );
    expect(pause).toContain("animation-play-state: paused");
  });

  it("drops its bolts and outfit when small, and dresses at 28px and up", () => {
    expect(rule(smallBlock, ".agent-bolts,\n  .agent-eye-big")).toContain(
      "display: none",
    );
    expect(rule(smallBlock, ".agent-stalk")).toContain(
      `stroke-width: ${Number((2.6 * AGENT_SMALL_SCALE).toFixed(2))}`,
    );
    expect(dressedBlock).toContain(".agent-outfit");
    expect(
      rule(dressedBlock, ".agent-mark[data-hatted] .agent-stalk"),
    ).toContain("display: none");
    // Outside a container query, no outfit shows.
    expect(rule(css, ".agent-outfit")).toContain("display: none");
  });
});
