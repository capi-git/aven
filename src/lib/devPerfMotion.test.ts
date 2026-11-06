// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkMotion, recordMotion } from "./devPerfMotion";

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function tab(id: string, left: () => number) {
  const slot = document.createElement("div");
  slot.dataset.motionSlot = id;
  slot.getBoundingClientRect = () => new DOMRect(left(), 8, 120, 28);
  return slot;
}

it("records keyed elements each frame and lists what jumped", () => {
  const strip = document.createElement("div");
  strip.className = "aven-tab-strip";
  let x = 0;
  strip.append(
    tab("a", () => x),
    tab("b", () => 200),
  );
  document.body.append(strip);
  const recorder = recordMotion("tabs");
  const run = () => frames.splice(0).forEach((callback) => callback(0));
  for (let frame = 0; frame < 4; frame += 1) run();
  x = 90;
  for (let frame = 0; frame < 4; frame += 1) run();
  recorder.input({ label: "reorder" });
  const trace = recorder.stop();
  expect(trace.frames.length).toBe(8);
  expect(Object.keys(trace.frames[0].els).sort()).toEqual(["tab:a", "tab:b"]);
  expect(trace.parents).toMatchObject({ "tab:a": "tabs", "tab:b": "tabs" });
  const result = checkMotion(trace);
  expect(
    result.findings.map((finding) => [finding.kind, finding.element]),
  ).toEqual([["jump", "tab:a"]]);
});

it("leaves out what is laid out but hidden", () => {
  const strip = document.createElement("div");
  strip.className = "aven-tab-strip";
  const hidden = tab("a", () => 0);
  hidden.style.visibility = "hidden";
  strip.append(hidden);
  document.body.append(strip);
  const recorder = recordMotion("hidden");
  frames.splice(0).forEach((callback) => callback(0));
  expect(recorder.stop().frames[0].els).toEqual({});
});
