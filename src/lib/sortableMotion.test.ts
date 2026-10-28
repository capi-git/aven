// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveCssZoom } from "./drag";
import { MOTION_ROOT_ATTRIBUTE } from "./motion";
import { TAB_RUBBER_BAND } from "./motionTokens";
import { SortableMotion, sortableMotionOffsets } from "./sortableMotion";
import { rubberBand } from "./spring";

describe("sortable visual projection", () => {
  const items = [
    { id: "small", start: 10, size: 80 },
    { id: "large", start: 94, size: 140 },
    { id: "medium", start: 238, size: 100 },
  ];

  it("packs unequal-width siblings into the vacated space while preserving gaps", () => {
    expect([...sortableMotionOffsets(items, "large", 2)]).toEqual([
      ["small", 0],
      ["medium", -144],
      ["large", 104],
    ]);
    expect(items.map((item) => item.start)).toEqual([10, 94, 238]);
  });

  it("projects a move to the first slot and is independent of scroll position", () => {
    const expected = [
      ["medium", -228],
      ["small", 104],
      ["large", 104],
    ];
    expect([...sortableMotionOffsets(items, "medium", 0)]).toEqual(expected);
    expect([
      ...sortableMotionOffsets(
        items.map((item) => ({ ...item, start: item.start - 70 })),
        "medium",
        0,
      ),
    ]).toEqual(expected);
  });

  it("returns zero offsets at the current index and ignores missing sources", () => {
    expect([...sortableMotionOffsets(items, "large", 1).values()]).toEqual([
      0, 0, 0,
    ]);
    expect(sortableMotionOffsets(items, "missing", 1).size).toBe(0);
  });
});

type Played = {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
};
let played: Played[];

beforeEach(() => {
  played = [];
  document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
  // Animations that never finish on their own, as under a native page: only
  // the springs' own timers end them.
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const cancel = vi.fn();
      played.push({ element: this, keyframes, options, cancel });
      return {
        cancel,
        pending: false,
        currentTime: 0,
        finished: Promise.resolve(),
        onfinish: null,
      } as unknown as Animation;
    },
  });
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.style.zoom = "";
  document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const playedOn = (element: Element | null | undefined) =>
  played.filter((entry) => entry.element === element);
const previewOf = () =>
  document.querySelector<HTMLElement>("[data-sortable-preview]");
const layer = (name: string) =>
  previewOf()!.querySelector<HTMLElement>(`[data-sortable-layer="${name}"]`)!;
const lifter = () =>
  previewOf()!.querySelector<HTMLElement>("[data-sortable-lift]")!;
const copyOf = () =>
  previewOf()!.querySelector<HTMLElement>("[data-sortable-copy]")!;
/** The colour a pill layer is painted, on each of its pieces. */
const pillBackground = (name: string) => {
  const colours = [...layer(name).children].map(
    (piece) => (piece as HTMLElement).style.background,
  );
  expect(new Set(colours).size).toBe(1);
  return colours[0];
};

/** A strip of 100px tabs (30px tall, 32px slots) whose visuals draw their transform. */
function tabs(ids: string[], zoom = 1) {
  const strip = document.createElement("div");
  strip.style.zoom = String(zoom);
  document.body.append(strip);
  const lefts = new Map(ids.map((id, index) => [id, index * 100]));
  const nodes = new Map<string, HTMLElement>();
  const visuals = new Map<string, HTMLElement>();
  for (const id of ids) {
    const outer = document.createElement("div");
    const visual = document.createElement("div");
    visual.dataset.sortableMotion = "";
    outer.append(visual);
    strip.append(outer);
    outer.getBoundingClientRect = () =>
      new DOMRect(lefts.get(id)! * zoom, 0, 100 * zoom, 32 * zoom);
    visual.getBoundingClientRect = () => {
      const offset = Number(
        /translate3d\(([-\d.]+)px/.exec(visual.style.transform)?.[1] ?? 0,
      );
      return new DOMRect(
        (lefts.get(id)! + offset) * zoom,
        1 * zoom,
        100 * zoom,
        30 * zoom,
      );
    };
    nodes.set(id, outer);
    visuals.set(id, visual);
  }
  return { strip, nodes, visuals, lefts };
}

describe("sortable motion in a CSS-zoomed titlebar", () => {
  it.each([0.5, 1, 2])(
    "tracks the pointer, shifts siblings, and flies to the new slot at CSS zoom %s",
    (zoom) => {
      const { strip, nodes, visuals, lefts } = tabs(["first", "second"], zoom);
      const motion = new SortableMotion();
      motion.begin(nodes, "first", { x: 50 * zoom, y: 16 * zoom }, "x");
      motion.activate({ x: 160 * zoom, y: 16 * zoom });
      motion.move(
        ["first", "second"],
        { x: 160 * zoom, y: 16 * zoom },
        1,
        true,
      );
      // Client deltas include CSS zoom, but a local transform must not apply
      // that zoom a second time. Native page zoom is absent from both values.
      const preview = previewOf()!;
      expect(preview.style.zoom).toBe(String(zoom));
      expect(preview.style.transform).toBe("translate3d(110px, 1px, 0)");
      expect(preview.style.width).toBe("100px");
      expect(preview.style.height).toBe("30px");
      expect(visuals.get("first")!.style.transform).toBe("");
      expect(visuals.get("first")!.style.opacity).toBe("0");
      expect(visuals.get("second")!.style.transform).toBe(
        "translate3d(-100px, 0, 0)",
      );
      expect(nodes.get("first")!.getBoundingClientRect().left).toBe(0);

      played.length = 0;
      motion.release(strip, nodes);
      motion.land({ kind: "fly", velocity: { x: 0, y: 0 } });
      lefts.set("first", 100);
      lefts.set("second", 0);
      motion.settle(strip, nodes);
      // The copy flies from where it was let go to the first tab's new slot.
      const [flight] = playedOn(preview);
      expect(flight.keyframes[0].transform).toBe("translate3d(110px, 1px, 0)");
      expect(flight.keyframes.at(-1)!.transform).toBe(
        "translate3d(100px, 1px, 0)",
      );
      // The sibling was already drawn where it now stands: nothing to do.
      expect(playedOn(visuals.get("second"))).toEqual([]);
      expect(visuals.get("first")!.style.opacity).toBe("0");
      motion.cancel();
      expect(previewOf()).toBeNull();
      expect(visuals.get("first")!.style.opacity).toBe("");
    },
  );

  it("includes ancestor zoom and cancels the browser preview's root zoom", () => {
    const preview = document.createElement("div");
    preview.style.zoom = "0.5";
    const toolbar = document.createElement("div");
    toolbar.style.zoom = "2";
    const visual = document.createElement("div");
    toolbar.append(visual);
    preview.append(toolbar);
    document.body.append(preview);
    expect(effectiveCssZoom(visual)).toBe(1);
    preview.style.zoom = "1";
    expect(effectiveCssZoom(visual)).toBe(2);
  });

  it("copies the rendered theme and size outside a clipped, counterzoomed strip", () => {
    document.body.style.zoom = "0.5";
    const strip = document.createElement("div");
    strip.style.zoom = "2";
    strip.style.overflow = "hidden";
    const outer = document.createElement("div");
    outer.dataset.surfaceTabId = "first";
    const visual = document.createElement("div");
    visual.dataset.sortableMotion = "";
    visual.style.color = "rgb(120, 180, 255)";
    visual.style.setProperty("--aven-popup", "rgb(12, 15, 22)");
    visual.dataset.sortableGlass = "";
    visual.style.visibility = "inherit";
    visual.style.opacity = "0.75";
    visual.style.borderRadius = "4px";
    const button = document.createElement("button");
    button.id = "tab-button";
    button.dataset.surfaceTabId = "first";
    button.style.fontSize = "12px";
    button.setAttribute("role", "tab");
    button.textContent = "Aven tab";
    visual.append(button);
    outer.append(visual);
    strip.append(outer);
    document.body.append(strip);
    outer.getBoundingClientRect = () => new DOMRect(100, 20, 140, 32);
    visual.getBoundingClientRect = () => new DOMRect(102, 22, 136, 28);
    const nodes = new Map([["first", outer]]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 142, y: 32 }, "x");
    expect(previewOf()).toBeNull();
    button.focus();
    motion.activate({ x: 162, y: 42 });
    motion.move(["first"], { x: 300, y: 120 }, 0, false);
    const preview = previewOf()!;
    const clone = copyOf();
    expect(preview.parentElement).toBe(document.body);
    expect(preview.style.zoom).toBe("2");
    expect(preview.style.width).toBe("136px");
    expect(preview.style.height).toBe("28px");
    expect(preview.style.transform).toBe("translate3d(260px, 110px, 0)");
    // The floating face is a solid layer of its own; the copy carries none.
    expect(preview.style.background).toBe("transparent");
    expect(pillBackground("face")).toBe("rgb(12, 15, 22)");
    expect(clone.style.background).toBe("transparent");
    expect(clone.style.color).toBe("rgb(120, 180, 255)");
    expect(clone.querySelector("button")!.style.fontSize).toBe("12px");
    expect(preview.inert).toBe(true);
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.style.pointerEvents).toBe("none");
    expect(clone.querySelector("button")!.style.pointerEvents).toBe("none");
    expect(
      preview.querySelector(
        "[data-sortable-motion], [data-surface-tab-id], [id]",
      ),
    ).toBeNull();
    expect(outer.style.transform).toBe("");
    expect(visual.style.visibility).toBe("inherit");
    expect(visual.style.opacity).toBe("0");
    expect(document.activeElement).toBe(button);
    motion.cancel();
    expect(previewOf()).toBeNull();
    expect(visual.style.visibility).toBe("inherit");
    expect(visual.style.opacity).toBe("0.75");
    expect(document.activeElement).toBe(button);
  });

  it("moves the dragged tab without rewriting unchanged siblings or drag attributes", () => {
    const { nodes, visuals } = tabs(["first", "second", "third"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 160, y: 16 });
    motion.move([...nodes.keys()], { x: 160, y: 16 }, 1, true);
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { attributes: true, subtree: true });

    motion.move([...nodes.keys()], { x: 170, y: 16 }, 1, true);

    const mutations = observer.takeRecords();
    expect(mutations.length).toBeGreaterThan(0);
    expect(
      mutations.every(
        (record) =>
          record.target === previewOf() && record.attributeName === "style",
      ),
    ).toBe(true);
    expect(previewOf()?.style.transform).toBe("translate3d(120px, 1px, 0)");
    expect(visuals.get("second")!.style.transform).toBe(
      "translate3d(-100px, 0, 0)",
    );
    motion.move([...nodes.keys()], { x: 170, y: 16 }, 1, true);
    expect(observer.takeRecords()).toEqual([]);

    observer.disconnect();
    motion.cancel();
    expect(visuals.get("first")!.style.transform).toBe("");
    expect(visuals.get("second")!.style.transform).toBe("");
    expect(nodes.get("first")!.hasAttribute("data-sortable-moving")).toBe(
      false,
    );
  });

  it("exposes floating preview addition, movement, and removal to native browser occlusion", () => {
    const { nodes } = tabs(["first"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 12 }, "x");
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-native-browser-occluded"],
    });
    motion.activate({ x: 60, y: 12 });
    const preview = document.querySelector<HTMLElement>(
      '[data-native-browser-occluded="true"]',
    )!;
    expect(preview.dataset.sortablePreview).toBe("first");
    expect(
      observer
        .takeRecords()
        .some((record) => [...record.addedNodes].includes(preview)),
    ).toBe(true);
    motion.move(["first"], { x: 350, y: 160 }, 0, false);
    expect(
      observer
        .takeRecords()
        .some(
          (record) =>
            record.target === preview && record.attributeName === "style",
        ),
    ).toBe(true);
    expect(preview.getAttribute("data-native-browser-occluded")).toBe("true");
    motion.cancel();
    expect(
      observer
        .takeRecords()
        .some((record) => [...record.removedNodes].includes(preview)),
    ).toBe(true);
    expect(
      document.querySelector('[data-native-browser-occluded="true"]'),
    ).toBeNull();
    expect(document.body.style.zoom).toBe("");
    observer.disconnect();
  });
});

describe("picking a tab up", () => {
  it("lifts in place: the copy starts over the tab, then catches up with the pointer", () => {
    const { nodes } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 56, y: 16 });
    // Laid out at the pointer, drawn from the tab's own place.
    expect(previewOf()!.style.transform).toBe("translate3d(6px, 1px, 0)");
    const [rise] = playedOn(lifter());
    expect(rise.keyframes[0].transform).toBe(
      "translate3d(-6px, 0px, 0px) scale(1)",
    );
    expect(rise.keyframes.at(-1)!.transform).toBe(
      "translate3d(0px, 0px, 0px) scale(1.02)",
    );
    // The shadow comes in with the lift.
    const [shadow] = playedOn(layer("shadow"));
    expect(shadow.keyframes[0].opacity).toBe("0");
    expect(shadow.keyframes.at(-1)!.opacity).toBe("1");
    motion.cancel();
  });

  it("closes in around the pointer into a compact chip, and smaller over the panes", () => {
    const { nodes, visuals } = tabs(["first", "second"]);
    // A wide tab (400px) whose face holds an icon and a long name.
    const visual = visuals.get("first")!;
    const outer = nodes.get("first")!;
    outer.getBoundingClientRect = () => new DOMRect(0, 0, 400, 32);
    visual.getBoundingClientRect = () => new DOMRect(0, 1, 400, 30);
    visual.dataset.sortableGlass = "";
    visual.style.borderRadius = "6px";
    visual.innerHTML =
      '<span class="icon" style="width:14px;height:14px"></span><span class="name">Tighten the hero layout on small phones</span>';
    const icon = visual.querySelector<HTMLElement>(".icon")!;
    icon.getBoundingClientRect = () => new DOMRect(120, 9, 14, 14);
    // Contents laid out for themselves: the chip's row would be 230px wide.
    const rowWidth = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.sortableChipRow)
          return new DOMRect(
            0,
            0,
            this.style.width.endsWith("px")
              ? Number.parseFloat(this.style.width)
              : 230,
            30,
          );
        if (this.parentElement?.dataset.sortableChipRow)
          return new DOMRect(8, 8, 14, 14);
        return new DOMRect(0, 0, 0, 0);
      });
    const motion = new SortableMotion();
    // Pressed three quarters of the way along the tab.
    motion.begin(nodes, "first", { x: 300, y: 16 }, "x");
    motion.activate({ x: 306, y: 16 });
    rowWidth.mockRestore();
    const chip = previewOf()!.querySelector<HTMLElement>(
      '[data-sortable-chip-row="chip"]',
    )!;
    const tiny = previewOf()!.querySelector<HTMLElement>(
      '[data-sortable-chip-row="tiny"]',
    )!;
    // No wider than the cap, with the pointer three quarters along it.
    expect(chip.style.width).toBe("176px");
    expect(chip.style.left).toBe(`${300 - 0.75 * 176}px`);
    expect(tiny.style.width).toBe("112px");
    // The face's pieces end at the chip's box, the tab's own contents gone.
    const [face] = playedOn(layer("face").children[0]);
    expect(face.keyframes.at(-1)!.transform).toBe(
      `translateX(${300 - 0.75 * 176}px)`,
    );
    const [handover] = playedOn(copyOf());
    expect(handover.keyframes[0].opacity).toBe("1");
    expect(handover.keyframes.at(-1)!.opacity).toBe("0");
    const [shown] = playedOn(chip);
    expect(shown.keyframes.at(-1)!.opacity).toBe("1");
    // Its contents slide from where the tab drew its icon (120px) into it.
    expect(shown.keyframes[0].transform).toBe(
      `translateX(${120 - (300 - 0.75 * 176 + 8)}px)`,
    );
    played.length = 0;
    motion.move(["first", "second"], { x: 306, y: 200 }, 0, false);
    const smaller = playedOn(tiny).at(-1)!;
    expect(smaller.keyframes.at(-1)!.opacity).toBe("1");
    motion.cancel();
  });

  it("rubber-bands up and down along the strip, and pops free when it leaves it", () => {
    const { nodes } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 60, y: 16 });
    motion.move(["first", "second"], { x: 60, y: 28 }, 0, true);
    const banded = 1 + rubberBand(12, 32, TAB_RUBBER_BAND);
    expect(banded).toBeLessThan(1 + 12);
    expect(previewOf()!.style.transform).toBe(
      `translate3d(10px, ${banded}px, 0)`,
    );
    played.length = 0;
    // Out of the strip it follows the pointer, from where the band held it.
    motion.move(["first", "second"], { x: 60, y: 60 }, 0, false);
    expect(previewOf()!.style.transform).toBe("translate3d(10px, 45px, 0)");
    const [pop] = playedOn(lifter());
    // (Its x is still catching up from the pick-up, frozen in this test.)
    expect(pop.keyframes[0].transform).toMatch(
      new RegExp(`^translate3d\\([-\\d.]+px, ${banded - 45}px, 0px\\)`),
    );
    expect(pop.keyframes.at(-1)!.transform).toMatch(
      /^translate3d\([-\d.]+px, 0px, 0px\)/,
    );
    motion.cancel();
  });

  it("lifts, moves and lands without any animation when motion is reduced", () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    const { strip, nodes, visuals } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    const landed = vi.fn();
    motion.onLanded = landed;
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 160, y: 16 });
    motion.move(["first", "second"], { x: 160, y: 30 }, 1, true);
    expect(visuals.get("second")!.style.transform).toBe(
      "translate3d(-100px, 0, 0)",
    );
    motion.release(strip, nodes);
    motion.land({ kind: "fly", velocity: { x: 900, y: 0 } });
    motion.settle(strip, nodes);
    expect(played).toEqual([]);
    expect(previewOf()).toBeNull();
    expect(visuals.get("first")!.style.opacity).toBe("");
    expect(landed).toHaveBeenCalledOnce();
  });
});

describe("letting a tab go", () => {
  it("throws the copy on with the pointer's speed before it comes back", () => {
    const { strip, nodes } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 60, y: 60 });
    motion.move(["first", "second"], { x: 60, y: 60 }, 0, false);
    motion.release(strip, nodes);
    // Let go nowhere while moving right at 1200px/s: it flies home (to 0).
    motion.land({ kind: "fly", velocity: { x: 1200, y: 0 } });
    motion.settle(strip, nodes);
    const [flight] = playedOn(previewOf());
    const xs = flight.keyframes.map((frame) =>
      Number(/translate3d\(([-\d.]+)px/.exec(String(frame.transform))![1]),
    );
    expect(xs[0]).toBe(10);
    expect(Math.max(...xs)).toBeGreaterThan(20);
    expect(xs.at(-1)).toBe(0);
    motion.cancel();
  });

  it("hands over to the tab when it lands, bounded by timers even if no animation finishes", () => {
    vi.useFakeTimers();
    const { strip, nodes, visuals, lefts } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    const landed = vi.fn();
    motion.onLanded = landed;
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 160, y: 16 });
    motion.move(["first", "second"], { x: 160, y: 16 }, 1, true);
    motion.release(strip, nodes);
    motion.land({ kind: "fly", velocity: { x: 0, y: 0 } });
    lefts.set("first", 100);
    lefts.set("second", 0);
    motion.settle(strip, nodes);
    expect(previewOf()).not.toBeNull();
    expect(visuals.get("first")!.style.opacity).toBe("0");
    expect(landed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    // Gone, and the tab is back in its place, exactly once.
    expect(previewOf()).toBeNull();
    expect(visuals.get("first")!.style.opacity).toBe("");
    expect(landed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fades a copy the workspace took where it was let go, and removes it by timer", () => {
    vi.useFakeTimers();
    const { strip, nodes } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 160, y: 200 });
    motion.move(["first", "second"], { x: 160, y: 200 }, 0, false);
    motion.release(strip, nodes);
    motion.land({ kind: "fade" });
    motion.settle(strip, nodes);
    expect(previewOf()).not.toBeNull();
    expect(lifter().style.opacity).toBe("0");
    expect(playedOn(previewOf())).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(previewOf()).toBeNull();
  });

  it("cancels its springs without an unhandled finished rejection", async () => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .animate;
    const { strip, nodes, lefts } = tabs(["first", "second"]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 16 }, "x");
    motion.activate({ x: 160, y: 16 });
    motion.move(["first", "second"], { x: 160, y: 16 }, 1, true);
    motion.release(strip, nodes);
    motion.land({ kind: "fly", velocity: { x: 0, y: 0 } });
    lefts.set("first", 100);
    lefts.set("second", 0);
    motion.settle(strip, nodes);
    motion.cancel();
    // Let any Web Animations finished promise reject. Vitest reports an
    // unhandled rejection here if teardown neglects that promise.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previewOf()).toBeNull();
  });
});

describe("lifted tab face", () => {
  it("paints the rounded tab face, lit and shadowed, without painting its taller motion box", () => {
    const strip = document.createElement("div");
    const outer = document.createElement("div");
    const visual = document.createElement("div");
    visual.dataset.sortableMotion = "first";
    visual.style.height = "32px";
    visual.style.background = "transparent";
    const face = document.createElement("button");
    face.dataset.sortableGlass = "";
    face.style.height = "26px";
    face.style.borderRadius = "6px";
    face.style.borderRight = "1px solid black";
    face.style.setProperty("--aven-popup", "rgb(44, 44, 46)");
    face.style.setProperty(
      "--aven-specular",
      "inset 0 1px 0 rgba(255, 255, 255, 0.13)",
    );
    face.style.setProperty(
      "--aven-tab-lift-shadow",
      "0 8px 20px -6px rgba(0, 0, 0, 0.5)",
    );
    visual.append(face);
    outer.append(visual);
    strip.append(outer);
    document.body.append(strip);
    outer.getBoundingClientRect = () => new DOMRect(0, 0, 140, 32);
    visual.getBoundingClientRect = () => new DOMRect(0, 0, 140, 32);
    face.getBoundingClientRect = () => new DOMRect(0, 3, 140, 26);
    const motion = new SortableMotion();
    motion.begin(new Map([["first", outer]]), "first", { x: 10, y: 10 }, "x");
    motion.activate({ x: 20, y: 10 });
    const preview = previewOf()!;
    const clone = copyOf();
    const clonedFace = clone.querySelector("button")!;
    expect(preview.style.background).toBe("transparent");
    expect(clone.style.background).toBe("transparent");
    expect(clonedFace.style.background).toBe("transparent");
    expect(clonedFace.style.borderRightColor).toBe("transparent");
    expect(face.style.borderRightColor).toBe("black");
    // The face, at the button's own box and corners: solid, lit along its top.
    expect(layer("face").style.top).toBe("3px");
    expect(layer("face").style.height).toBe("26px");
    // In three pieces (rounded caps and a middle), so it can narrow by
    // transforms alone.
    const [left, middle, right] = [...layer("face").children] as HTMLElement[];
    expect(left.style.borderRadius).toBe("6px 0px 0px 6px");
    expect(middle.style.borderRadius).toBe("0px");
    expect(right.style.borderRadius).toBe("0px 6px 6px 0px");
    expect(pillBackground("face")).toBe("rgb(44, 44, 46)");
    expect(middle.style.boxShadow).toBe(
      "inset 0 1px 0 rgba(255, 255, 255, 0.13)",
    );
    expect(layer("shadow").style.boxShadow).toBe(
      "0 8px 20px -6px rgba(0, 0, 0, 0.5)",
    );
    expect(preview.querySelector("[data-sortable-glass]")).toBeNull();
    expect(preview.style.boxShadow).toBe("none");
    motion.cancel();
    strip.remove();
  });
});
