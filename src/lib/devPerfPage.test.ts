// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserBounds } from "./browser";
import type { BrowserPresentationAdapter } from "./browserPresentation";
import {
  pagePopupResult,
  pagePopupRound,
  recordPageEvents,
  type PageEvent,
} from "./devPerfPage";

const bounds: BrowserBounds = {
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  scale: 1,
};
const layout = (
  asked: number,
  answered: number,
  change: Partial<Extract<PageEvent, { kind: "layout" }>> = {},
): PageEvent => ({
  kind: "layout",
  asked,
  answered,
  visible: true,
  holes: 0,
  shaded: false,
  ...change,
});

describe("what a page does for a popup", () => {
  afterEach(() => document.body.replaceChildren());

  it("records each layout and still picture, then hands the adapter back", async () => {
    const calls: string[] = [];
    const adapter = {
      layout: async () => void calls.push("layout"),
      snapshot: async () => "x".repeat(2048),
    } as unknown as BrowserPresentationAdapter;
    const original = { layout: adapter.layout, snapshot: adapter.snapshot };
    const recorder = recordPageEvents(adapter);
    await adapter.layout("page", bounds, true);
    await adapter.layout(
      "page",
      {
        ...bounds,
        holes: [{ x: 1, y: 2, width: 3, height: 4, radius: 0 }],
        shade: { opacity: 0.4, fadeMs: 120 },
      },
      true,
    );
    await adapter.layout("page", bounds, false);
    expect(await adapter.snapshot("page")).toHaveLength(2048);
    expect(calls).toEqual(["layout", "layout", "layout"]);
    expect(recorder.quiet(0)).toBe(true);
    expect(recorder.quiet(60_000)).toBe(false);
    expect(recorder.take()).toMatchObject([
      { kind: "layout", visible: true, holes: 0, shaded: false },
      { kind: "layout", visible: true, holes: 1, shaded: true },
      { kind: "layout", visible: false, holes: 0, shaded: false },
      { kind: "still", kB: 2, failed: false },
    ]);
    expect(recorder.take()).toEqual([]);
    recorder.stop();
    expect(adapter.layout).toBe(original.layout);
    expect(adapter.snapshot).toBe(original.snapshot);
  });

  it("reads a dialog that hid the page behind a picture", () => {
    const round = pagePopupRound(
      1000,
      [
        { kind: "still", asked: 1004, answered: 1054, kB: 180, failed: false },
        { kind: "picture", at: 1060, shown: true, scale: 0.8 },
        layout(1062, 1070, { visible: false }),
      ],
      2000,
      [layout(2003, 2015), { kind: "picture", at: 2016, shown: false }],
    );
    expect(round).toEqual({
      openMs: 70,
      closeMs: 15,
      how: "hidden",
      stills: 1,
      stillMs: 50,
      stillKB: 180,
      blankMs: 0,
      pictureScale: 0.8,
    });
  });

  it("counts the time a hidden page had no picture beneath it", () => {
    const late = pagePopupRound(
      0,
      [
        layout(80, 84, { visible: false }),
        { kind: "still", asked: 2, answered: 130, kB: 400, failed: false },
        { kind: "picture", at: 140, shown: true },
      ],
      500,
      [layout(501, 510)],
    );
    expect(late).toMatchObject({ how: "hidden", openMs: 84, blankMs: 56 });
    const never = pagePopupRound(0, [layout(80, 84, { visible: false })], 500, [
      layout(501, 510),
    ]);
    expect(never).toMatchObject({ how: "hidden", blankMs: 426, stills: 0 });
  });

  it("reads a page that stayed live: cut for a menu, shaded for a dialog", () => {
    expect(
      pagePopupRound(0, [layout(3, 9, { holes: 1 })], 100, [layout(102, 108)]),
    ).toEqual({
      openMs: 9,
      closeMs: 8,
      how: "cut",
      stills: 0,
      stillMs: 0,
      stillKB: 0,
      blankMs: 0,
    });
    expect(
      pagePopupRound(0, [layout(3, 9, { holes: 1, shaded: true })], 100, [
        layout(101, 104, { holes: 1, shaded: true }),
        layout(105, 109),
      ]),
    ).toMatchObject({ how: "shaded", openMs: 9, closeMs: 9, stills: 0 });
    expect(pagePopupRound(0, [], 100, [])).toMatchObject({
      how: "nothing",
      openMs: null,
      closeMs: null,
    });
  });

  it("sums a popup's rounds for the report", () => {
    const hidden = pagePopupRound(
      0,
      [
        { kind: "still", asked: 4, answered: 54, kB: 180, failed: false },
        { kind: "picture", at: 60, shown: true, scale: 1 },
        layout(62, 70, { visible: false }),
      ],
      100,
      [layout(103, 115)],
    );
    const result = pagePopupResult("command palette", [hidden, hidden]);
    expect(result).toMatchObject({
      popup: "command palette",
      rounds: 2,
      how: "hidden",
      stills: 2,
      stillKB: 180,
      pictureScale: 1,
      openMs: { n: 2, p50: 70, max: 70 },
      closeMs: { n: 2, p50: 15, max: 15 },
      stillMs: { n: 2, p50: 50 },
      blankMs: { n: 2, max: 0 },
    });
    const live = pagePopupResult("tab menu", [
      pagePopupRound(0, [layout(3, 9, { holes: 1 })], 100, [layout(102, 108)]),
    ]);
    expect(live).toMatchObject({ how: "cut", stills: 0 });
    expect(live.stillMs).toBeUndefined();
    expect(live.blankMs).toBeUndefined();
  });
});
