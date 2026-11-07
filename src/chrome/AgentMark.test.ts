// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_GLASS,
  AGENT_STATE_FACES,
  agentFacePaths,
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

const motionBlock = blockAfter(
  css,
  css.indexOf("@media (prefers-reduced-motion: no-preference)"),
);

describe("AgentMark", () => {
  it("is a screen: its glass, its face, its frame and glow", async () => {
    const mark = await draw({ state: "watching" });
    expect(mark.classList.contains("dot-mark")).toBe(true);
    expect(
      mark.querySelector(".agent-body .agent-head")!.getAttribute("d"),
    ).toBe(AGENT_GLASS);
    expect(mark.dataset.face).toBe("squares");
    const faces = [...mark.querySelectorAll(".agent-eyes .agent-face")];
    // One face, the same shapes at every size.
    expect(faces.map((face) => face.getAttribute("class"))).toEqual([
      "agent-face agent-face-large",
    ]);
    expect(faces[0]!.querySelector(".agent-eye")!.getAttribute("d")).toBe(
      agentFacePaths("large", "squares").lit,
    );
    expect(mark.querySelector(".agent-ring")).not.toBeNull();
    expect(mark.querySelector(".agent-glow")).not.toBeNull();
    // Only working runs a light round its edge.
    expect(mark.querySelector(".agent-comet")).toBeNull();
  });

  it("shows a face for each state, and a light round its edge while it works", async () => {
    const shown = async (state: Parameters<typeof AgentMark>[0]["state"]) => {
      const mark = await draw({ state });
      return {
        face: mark.dataset.face,
        cursor: !!mark.querySelector(".agent-cursor"),
        comet: !!mark.querySelector(".agent-comet"),
      };
    };
    expect(await shown("still")).toEqual({
      face: "squares",
      cursor: false,
      comet: false,
    });
    expect(await shown("resting")).toEqual({
      face: "prompt",
      cursor: true,
      comet: false,
    });
    expect(await shown("working")).toEqual({
      face: "narrow",
      cursor: false,
      comet: true,
    });
    expect(await shown("needs")).toMatchObject({ face: "chevron" });
    expect(await shown("ready")).toMatchObject({ face: "squares" });
    for (const [state, face] of Object.entries(AGENT_STATE_FACES))
      expect((await draw({ state: state as never })).dataset.face).toBe(face);
  });

  it("colours what needs you amber and what's ready green, framed and tinted", () => {
    expect(rule(css, '.agent-mark[data-agent="needs"]')).toContain(
      "--agent-face: var(--aven-needs-you)",
    );
    expect(rule(css, '.agent-mark[data-agent="ready"]')).toContain(
      "--agent-face: var(--agent-ready)",
    );
    const framed = rule(
      css,
      '.agent-mark:is([data-agent="needs"], [data-agent="ready"]) .agent-ring',
    );
    expect(framed).toContain("opacity: 1");
    expect(framed).toContain("box-shadow: inset 0 0 0");
  });

  it("puts on a happy face for a done turn, and red eyes for a failed one", async () => {
    expect(
      (await draw({ reaction: "cheer", reactionId: "t1" })).dataset.face,
    ).toBe("happy");
    expect(
      (await draw({ reaction: "slump", reactionId: "t2" })).dataset.face,
    ).toBe("squares");
    expect(rule(css, '.agent-mark[data-reaction="cheer"]')).toContain(
      "--agent-face: var(--agent-happy)",
    );
  });

  it("says its colour and role as attributes, and leaves Grey plain", async () => {
    let mark = await draw({ state: "working", tone: "blue", outfit: "hat" });
    expect(mark.dataset.tone).toBe("blue");
    expect(mark.dataset.outfit).toBe("hat");
    mark = await draw({ tone: "grey", outfit: "tick" });
    expect(mark.dataset.tone).toBeUndefined();
  });

  it("draws its screen alone, faint, for a teammate still to come", async () => {
    const mark = await draw({ vacant: true, state: "working" });
    expect(mark.querySelector(".agent-eyes")).toBeNull();
    expect(mark.querySelector(".agent-comet")).toBeNull();
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

  it("draws the same face at every size, its dots bolder when small, its glass from 36px", () => {
    const sizes = (from: string) =>
      /stroke-width: ([\d.]+)/.exec(
        from === "small"
          ? rule(css, ".agent-face")
          : blockAfter(css, css.indexOf(`@container (min-width: ${from})`)),
      )?.[1];
    expect(Number(sizes("small"))).toBeGreaterThan(Number(sizes("19.5px")));
    expect(Number(sizes("19.5px"))).toBeGreaterThan(Number(sizes("35.5px")));
    const large = blockAfter(
      css,
      css.indexOf("@container (min-width: 35.5px)"),
    );
    expect(rule(large, ".agent-glass")).toContain("display: inline");
  });

  it("gives each state its own motion", () => {
    for (const [selector, name] of [
      ['.agent-mark[data-agent="resting"] .agent-cursor', "agent-blink"],
      ['.agent-mark[data-agent="watching"] .agent-eyes', "agent-look"],
      ['.agent-mark[data-agent="working"] .agent-eyes', "agent-scan"],
      ['.agent-mark[data-agent="working"] .agent-comet', "agent-spin"],
      ['.agent-mark[data-agent="needs"] .agent-eyes', "agent-nudge"],
      ['.agent-mark[data-agent="needs"] .agent-ring', "agent-breathe"],
      ['.agent-mark[data-agent="ready"] .agent-eyes', "agent-wink"],
    ] as const)
      expect(rule(motionBlock, selector), selector).toContain(
        `animation: ${name} `,
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
    for (const part of [
      ".agent-eyes",
      ".agent-cursor",
      ".agent-comet",
      ".agent-ring",
    ])
      expect(pause).toContain(part);
    expect(pause).toContain("animation-play-state: paused");
  });
});
