// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const orbOf = (mark: HTMLElement) =>
  mark.querySelector<SVGElement>(".thinking-orb")?.dataset.orb;

const css = readFileSync("src/chrome/AgentMark.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("AgentMark", () => {
  it("is a Thinking Orb in a mark's box, hidden from screen readers", async () => {
    const mark = await draw({});
    expect(mark.classList.contains("dot-mark")).toBe(true);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.querySelector(".agent-bob .thinking-orb")).not.toBeNull();
    expect(orbOf(mark)).toBe("idle");
  });

  it("draws each state as its orb", async () => {
    expect(orbOf(await draw({ state: "resting" }))).toBe("idle");
    expect(orbOf(await draw({ state: "watching" }))).toBe("waiting");
    expect(orbOf(await draw({ state: "working" }))).toBe("working");
    expect(orbOf(await draw({ state: "needs" }))).toBe("idle-blink");
    expect(orbOf(await draw({ state: "ready" }))).toBe("idle-blink");
  });

  it("says what the work is while it works, and only then", async () => {
    expect(orbOf(await draw({ state: "working", activity: "reasoning" }))).toBe(
      "reasoning",
    );
    expect(orbOf(await draw({ state: "working", activity: "searching" }))).toBe(
      "searching",
    );
    expect(orbOf(await draw({ state: "working", activity: "using" }))).toBe(
      "using",
    );
    expect(orbOf(await draw({ state: "resting", activity: "using" }))).toBe(
      "idle",
    );
  });

  it("colours what needs you amber and what's ready green", async () => {
    expect(css).toMatch(
      /\.agent-mark\[data-agent="needs"\] \{\s*--agent-face: var\(--aven-needs-you\);/,
    );
    expect(css).toMatch(
      /\.agent-mark\[data-agent="ready"\] \{\s*--agent-face: var\(--agent-ready\);/,
    );
    expect(css).toMatch(/\.agent-mark \{[^}]*color: var\(--agent-face\);/);
    const mark = await draw({ state: "working", tone: "blue" });
    expect(mark.dataset.tone).toBe("blue");
    expect((await draw({ tone: "grey" })).dataset.tone).toBeUndefined();
  });

  it("draws a working or watching orb in plain grey, whatever its colour", async () => {
    // As in Super: working dots are the text colour at 70%, never a tint.
    expect(css).toMatch(
      /--agent-busy: color-mix\(in srgb, var\(--color-content\) 70%, transparent\);/,
    );
    expect(css).toMatch(
      /\.agent-mark:is\(\[data-agent="working"\], \[data-agent="watching"\]\) \{\s*--agent-face: var\(--agent-busy\);\s*\}/,
    );
    // It outranks no status: needs you, ready and a reaction come later.
    const busy = css.indexOf('[data-agent="working"], [data-agent="watching"]');
    expect(busy).toBeLessThan(css.indexOf('.agent-mark[data-agent="needs"]'));
    expect(busy).toBeLessThan(
      css.indexOf('.agent-mark[data-reaction="cheer"]'),
    );
    const mark = await draw({ state: "working", tone: "purple" });
    expect(mark.dataset.agent).toBe("working");
  });

  it("holds its orb still for a reaction, and times the hop", async () => {
    const mark = await draw({ state: "working", reaction: "cheer" });
    expect(mark.dataset.reaction).toBe("cheer");
    expect(orbOf(mark)).toBe("idle");
    expect(mark.style.getPropertyValue("--agent-reaction-ms")).toMatch(/ms$/);
  });

  it("is faint and still for a teammate still to come", async () => {
    const mark = await draw({ state: "working", vacant: true });
    expect(mark.dataset.vacant).toBe("true");
    expect(orbOf(mark)).toBe("idle");
    expect(css).toMatch(
      /\.agent-mark\[data-vacant\] \.agent-bob \{\s*opacity: 0\.3;/,
    );
  });

  it("hops only without Reduce motion, and holds a hop while hidden or resized", () => {
    const motion = css.indexOf(
      "@media (prefers-reduced-motion: no-preference)",
    );
    expect(motion).toBeGreaterThan(-1);
    expect(css.indexOf("animation-name: agent-cheer")).toBeGreaterThan(motion);
    expect(css).toMatch(
      /:root:is\(\[data-hidden\], \.is-resizing, \.is-window-resizing\)\s+\.agent-mark\s+\.agent-bob/,
    );
  });
});
