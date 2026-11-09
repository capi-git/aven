// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avosHelperMarks, type AvosHelperMark } from "../lib/avos";
import { newCrew, type Crew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { AvosHelperMarks } from "./AvosHelperMarks";

const PATH = "/Users/me/holo";
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const mark = (id: string, state: AvosHelperMark["state"] = "working") =>
  ({ id, role: "builder", state }) as AvosHelperMark;

describe("Avos's helpers beside it", () => {
  it("lists quick helpers as working, and nobody while Avos is off", () => {
    const crew: Crew = {
      ...newCrew(PATH, 1),
      on: true,
      onAt: 1,
      members: [{ id: "lead", role: "lead" }],
      helpers: [{ id: "h1", role: "helper", helperOf: "lead" }],
    };
    expect(avosHelperMarks(crew)).toEqual([
      { id: "h1", role: "helper", state: "working" },
    ]);
    expect(avosHelperMarks({ ...crew, on: false })).toEqual([]);
  });

  it("shows three faces at most, then +N, each with its state", async () => {
    await act(async () =>
      root.render(
        createElement(AvosHelperMarks, {
          path: PATH,
          helpers: [mark("a"), mark("b"), mark("c", "ready"), mark("d")],
        }),
      ),
    );
    const faces = [
      ...container.querySelectorAll<HTMLElement>("[data-avos-helper-mark]"),
    ];
    expect(faces.map((face) => face.dataset.state)).toEqual([
      "working",
      "working",
      "ready",
    ]);
    expect(container.querySelector(".avos-helper-more")?.textContent).toBe(
      "+1",
    );
    expect(
      container
        .querySelector("[data-avos-helpers]")
        ?.getAttribute("aria-label"),
    ).toBe("4 helpers at work");
  });

  it("draws nothing with no helpers at work", async () => {
    await act(async () =>
      root.render(createElement(AvosHelperMarks, { path: PATH, helpers: [] })),
    );
    expect(container.innerHTML).toBe("");
  });

  it("pops a new one out from Avos's side, by transform and opacity, only with motion on", () => {
    const css = readFileSync("src/chrome/AvosHelperMarks.css", "utf8");
    const motion = css.slice(
      css.indexOf("@media (prefers-reduced-motion: no-preference)"),
    );
    expect(motion).toContain("animation: avos-helper-pop");
    const keyframes = css.slice(css.indexOf("@keyframes avos-helper-pop"));
    for (const [, property] of keyframes.matchAll(/([a-z-]+)\s*:/g))
      expect(["opacity", "transform"]).toContain(property);
    // Outside the motion block, nothing animates.
    expect(css.slice(0, css.indexOf("@media"))).not.toMatch(/animation\s*:/);
  });
});
