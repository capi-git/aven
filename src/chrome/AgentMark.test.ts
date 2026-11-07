// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_DOT,
  AGENT_DOT_SMALL,
  AGENT_DOTS,
  agentCells,
} from "../lib/agentMark";
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
const motionBlock = blockAfter(
  css,
  css.indexOf("@media (prefers-reduced-motion: no-preference)"),
);

/** A cell's centre in the dots' 100-unit square: [x, y]. */
const centre = ([row, column]: [number, number]) => [
  10 + column * 20,
  10 + row * 20,
];

describe("AgentMark", () => {
  it("draws its head, the faint rest of the grid, its eyes and a light", async () => {
    const mark = await draw({});
    expect(mark.classList.contains("dot-mark")).toBe(true);
    expect(
      mark.querySelector(".agent-body .agent-head")!.getAttribute("d"),
    ).toBe(AGENT_DOTS.head);
    expect(
      mark.querySelector(".agent-body .agent-grid")!.getAttribute("d"),
    ).toBe(AGENT_DOTS.grid);
    expect(
      mark.querySelector(".agent-eyes .agent-eye")!.getAttribute("d"),
    ).toBe(AGENT_DOTS.eyes);
    expect(mark.querySelector(".agent-bob > .agent-light")).not.toBeNull();
    expect(mark.dataset.agent).toBe("still");
    // A label's eyes are open and nothing moves.
    expect(mark.querySelector<HTMLElement>(".agent-eyes")!.dataset.mood).toBe(
      "open",
    );
    expect(mark.querySelector(".agent-key")).toBeNull();
  });

  it("shows each mood in its eyes, and a lit foot while it works", async () => {
    const mood = async (state: Parameters<typeof AgentMark>[0]["state"]) => {
      const mark = await draw({ state });
      return {
        eyes: mark.querySelector<HTMLElement>(".agent-eyes")!.dataset.mood,
        key: !!mark.querySelector(".agent-key"),
      };
    };
    expect(await mood("resting")).toEqual({ eyes: "closed", key: false });
    expect(await mood("watching")).toEqual({ eyes: "open", key: false });
    expect(await mood("working")).toEqual({ eyes: "squint", key: true });
    expect(await mood("needs")).toEqual({ eyes: "wide", key: false });
    expect(rule(css, '.agent-eyes[data-mood="wide"] .agent-eye')).toContain(
      "var(--aven-needs-you)",
    );
    expect(rule(css, '.agent-eyes[data-mood="closed"] .agent-eye')).toContain(
      "opacity",
    );
  });

  it("says its colour and role as attributes, wears nothing, and leaves Grey plain", async () => {
    let mark = await draw({ state: "working", tone: "blue", outfit: "hat" });
    expect(mark.dataset.tone).toBe("blue");
    expect(mark.dataset.outfit).toBe("hat");
    expect(mark.querySelectorAll("path")).toHaveLength(3);
    mark = await draw({ tone: "grey", outfit: "tick" });
    expect(mark.dataset.tone).toBeUndefined();
  });

  it("draws its outline alone, faint, for a teammate still to come", async () => {
    const mark = await draw({ vacant: true, outfit: "headset" });
    expect(mark.querySelector(".agent-eyes")).toBeNull();
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

  it("draws its dots as the other dot marks do, bigger when small", () => {
    const sizes = (block: string, selector: string, dot: number) => {
      const own = rule(block, selector);
      expect(own).toContain(`--agent-dot: ${dot};`);
      expect(own).toContain(`--agent-size: ${dot}%;`);
      expect(own).toContain(`--agent-inset: ${dot / 2}%;`);
      // Its lit foot steps two cells, in its own widths.
      expect(own).toContain(
        `--agent-step: ${Number(((40 / dot) * 100).toFixed(3))}%;`,
      );
    };
    sizes(css, ".agent-mark", AGENT_DOT);
    // The mark is its own container: a size query styles what's inside it.
    sizes(smallBlock, ".agent-bob", AGENT_DOT_SMALL);
    const marks = readFileSync("src/chrome/DotMark.css", "utf8");
    expect(marks).toContain(`--dot-mark-dot: ${AGENT_DOT};`);
    expect(marks).toContain(`--dot-mark-dot: ${AGENT_DOT_SMALL};`);
  });

  it("puts its light on the antenna's dot and the lit foot on its left foot", () => {
    const [lightX, lightY] = centre(agentCells("l")[0]!);
    const light = rule(css, ".agent-light");
    expect(light).toContain(`left: calc(${lightX}% - var(--agent-inset))`);
    expect(light).toContain(`top: calc(${lightY}% - var(--agent-inset))`);
    const feet = agentCells("h").filter(([row]) => row === 4);
    expect(feet).toHaveLength(2);
    const [footX, footY] = centre(feet[0]!);
    // Its own rule, after the one it shares with the light.
    const key = blockAfter(css, css.lastIndexOf("\n.agent-key {"));
    expect(key).toContain(`left: calc(${footX}% - var(--agent-inset))`);
    expect(key).toContain(`top: calc(${footY}% - var(--agent-inset))`);
    expect(centre(feet[1]!)[0]! - footX).toBe(40);
    // Its eyes blink about the row they sit on.
    const [, eyeY] = centre(agentCells("e")[0]!);
    expect(
      /\n\.agent-eyes \{\s*transform-origin: ([^;]+);/.exec(css)?.[1],
    ).toBe(`50% ${eyeY}%`);
  });

  it("moves as far as before: a 6-unit bounce, a 2.6-unit look, a step a foot on", () => {
    const pct = (part: number) => `${Number(((part / 64) * 100).toFixed(6))}%`;
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
    expect(frames("agent-type")).toContain("translateX(var(--agent-step))");
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
});
