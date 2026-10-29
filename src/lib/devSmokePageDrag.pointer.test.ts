// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { setCssZoomRectsForTests, type CssZoomRects } from "./drag";
import { pressPoint } from "./devSmokeLoneTab";
import {
  describeDragEnd,
  describeHit,
  dragSceneLines,
  earlyEndProblem,
  focusTarget,
  pressMissProblem,
  type DragEnvironment,
} from "./devSmokePageDrag";

/**
 * A strip tab at an interface zoom (80% by default): the strip's CSS zoom
 * cancels it (1.25 at 80%, 1/1.2 at 120%), so the tab, 400 to 520 of the
 * strip's own pixels, is drawn at that many times those in the viewport.
 * Older WebKit reports its own pixels.
 */
function stripTab(engine: CssZoomRects, id = "chat", ui = 0.8) {
  setCssZoomRectsForTests(engine);
  const tab = document.createElement("div");
  tab.dataset.surfaceTabId = id;
  const zoom = 1 / ui;
  Object.defineProperty(tab, "currentCSSZoom", { value: zoom });
  const reported = engine === "legacy" ? 1 : zoom;
  tab.getBoundingClientRect = () =>
    new DOMRect(400 * reported, 8 * reported, 120 * reported, 24 * reported);
  return tab;
}

describe("where the real-app check presses a tab", () => {
  afterEach(() => setCssZoomRectsForTests(undefined));

  it.each(
    (["standard", "legacy"] as const).flatMap((engine) =>
      [0.8, 1.2].map((ui) => [engine, ui] as const),
    ),
  )(
    "presses a CSS-zoomed strip tab at its middle as drawn, on %s CSS zoom at %s",
    (engine, ui) => {
      // Its middle as legacy WebKit reports it, (460, 20), is another tab
      // at 80% (further left) and at 120% (further right): at 80% the
      // macOS 15 runner dragged and dropped that one.
      const { x, y } = pressPoint(stripTab(engine, "chat", ui));
      expect(x).toBeCloseTo(460 / ui);
      expect(y).toBeCloseTo(20 / ui);
    },
  );

  it("passes a press that lands on the tab or inside it", () => {
    const tab = stripTab("standard");
    const label = document.createElement("span");
    tab.append(label);
    expect(pressMissProblem(tab, { x: 575, y: 25 }, tab)).toBeNull();
    expect(pressMissProblem(tab, { x: 575, y: 25 }, label)).toBeNull();
  });

  it("names where a press would land instead, and the tab at its reported middle", () => {
    const tab = stripTab("legacy");
    const other = stripTab("legacy", "1a001aee");
    expect(
      pressMissProblem(tab, { x: 575, y: 25 }, other, {
        point: { x: 460, y: 20 },
        hit: other,
      }),
    ).toBe(
      "a press at the middle of the tab chat, (575, 25) on legacy CSS zoom, would land on the tab 1a001aee; at its middle as reported, (460, 20), is the tab 1a001aee",
    );
    expect(pressMissProblem(tab, { x: 575, y: 25 }, null)).toMatch(
      /would land on nothing$/,
    );
  });

  it("describes a pane, or any other element, by what names it", () => {
    const pane = document.createElement("div");
    pane.dataset.workspaceSurface = "browser-1";
    const body = document.createElement("div");
    body.className = "workspace-stage-body other";
    pane.append(body);
    expect(describeHit(body)).toBe("the pane browser-1");
    const bar = document.createElement("header");
    bar.className = "workspace-status-bar";
    expect(describeHit(bar)).toBe("header.workspace-status-bar");
  });
});

describe("what a failed drag over a page lists", () => {
  const environment: DragEnvironment = {
    focused: true,
    windowKey: true,
    zoomRects: "legacy",
    currentCSSZoom: false,
    uiScale: 0.8,
    stripZoom: 1.25,
    window: { width: 1600, height: 1000 },
    devicePixelRatio: 1,
    screen: { width: 1920, height: 1080 },
    panes: [
      {
        id: "browser-8000",
        box: { left: 0, top: 50, right: 1600, bottom: 1000 },
      },
    ],
    page: { left: 0, top: 82, right: 1600, bottom: 1000 },
    strip: [
      {
        id: "1a001aee",
        reported: { left: 300, top: 8, right: 420, bottom: 32 },
        box: { left: 375, top: 10, right: 525, bottom: 40 },
      },
      {
        id: "browser-8000",
        reported: { left: 0, top: 0, right: 0, bottom: 0 },
        box: { left: 0, top: 0, right: 0, bottom: 0 },
      },
    ],
  };

  it("lists the zoom model, the window, the drag, its intent and the layout", () => {
    expect(
      dragSceneLines(environment, {
        what: "drop after crossing the page's tab",
        dragged: "chat",
        lifted: ["1a001aee"],
        press: { x: 575.4, y: 25 },
        via: { x: 725, y: 25 },
        drop: { x: 1408, y: 541 },
        intent: "right of the pane browser-8000",
        focus: ["textarea.composer-field lost focus"],
        end: "a release, with the page focused",
        before: '[["browser-8000"]]',
        after: '[["browser-8000"],["1a001aee"]]',
      }),
    ).toEqual([
      "zoom: legacy CSS zoom (the probe's), currentCSSZoom absent; interface 80%, strip zoom 1.25",
      "window: 1600×1000 CSS px, 1280×800 pt at 1x; screen 1920×1080 pt; key, the page focused",
      "drag (drop after crossing the page's tab): pressed the tab chat at (575, 25), crossed (725, 25), let go at (1408, 541); the workspace lifted 1a001aee",
      "intent at release: right of the pane browser-8000; ended by a release, with the page focused; focus: textarea.composer-field lost focus",
      'layout: [["browser-8000"]] to [["browser-8000"],["1a001aee"]]',
      "panes: browser-8000 0,50 1600×950; the page's host 0,82 1600×918",
      "strip: 1a001aee 375–525 (reported 300–420); browser-8000 0–0",
    ]);
  });

  it("lists the engine and window alone before any drag", () => {
    const lines = dragSceneLines(
      {
        ...environment,
        focused: false,
        windowKey: null,
        stripZoom: null,
        panes: [],
        page: null,
        strip: [],
      },
      null,
    );
    expect(lines).toEqual([
      "zoom: legacy CSS zoom (the probe's), currentCSSZoom absent; interface 80%, strip zoom none",
      "window: 1600×1000 CSS px, 1280×800 pt at 1x; screen 1920×1080 pt; key unknown, the page not focused",
      "panes: none",
      "strip: none",
    ]);
  });
});

describe("what ended a drag the check was carrying", () => {
  it("is nothing the workspace recorded before the press", () => {
    expect(earlyEndProblem(null, 100)).toBeNull();
    expect(
      earlyEndProblem({ how: "Escape", focused: true, at: 99 }, 100),
    ).toBeNull();
  });

  it("names what the workspace ended it on, and whether the page had focus", () => {
    expect(earlyEndProblem({ how: "blur", focused: false, at: 140 }, 100)).toBe(
      "the workspace ended the drag itself, on the window's blur, with the page not focused",
    );
    expect(
      describeDragEnd({ how: "lostpointercapture", focused: true, at: 0 }),
    ).toBe("lost pointer capture, with the page focused");
    expect(describeDragEnd({ how: "cancel", focused: true, at: 0 })).toBe(
      "a new press or its bar going away, with the page focused",
    );
  });

  it("tells the window's blur from an element's", () => {
    const field = document.createElement("textarea");
    field.className = "composer-field ring";
    expect(focusTarget(field)).toBe("textarea.composer-field");
    expect(focusTarget(window)).toBe("the window");
  });
});
