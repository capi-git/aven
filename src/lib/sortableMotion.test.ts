// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveCssZoom } from "./drag";
import { SortableMotion, sortableMotionOffsets } from "./sortableMotion";

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

describe("sortable motion in a CSS-zoomed titlebar", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.style.zoom = "";
    vi.restoreAllMocks();
  });

  it.each([0.5, 1, 2])(
    "tracks the pointer, shifts siblings, and settles at CSS zoom %s",
    (zoom) => {
      const strip = document.createElement("div");
      strip.style.zoom = String(zoom);
      document.body.append(strip);
      const positions = { first: 0, second: 100 };
      const nodes = new Map<string, HTMLElement>();
      const visuals = new Map<string, HTMLElement>();
      const animations = new Map<string, ReturnType<typeof vi.fn>>();
      for (const id of ["first", "second"] as const) {
        const outer = document.createElement("div");
        const visual = document.createElement("div");
        visual.dataset.sortableMotion = "";
        outer.append(visual);
        strip.append(outer);
        outer.getBoundingClientRect = () =>
          new DOMRect(positions[id] * zoom, 0, 100 * zoom, 30 * zoom);
        visual.getBoundingClientRect = () => {
          const offset = Number(
            /translate3d\(([-\d.]+)px/.exec(visual.style.transform)?.[1] ?? 0,
          );
          return new DOMRect(
            (positions[id] + offset) * zoom,
            0,
            100 * zoom,
            30 * zoom,
          );
        };
        const animate = vi.fn(() => ({
          cancel: vi.fn(),
          onfinish: null,
          oncancel: null,
        }));
        visual.animate = animate as unknown as HTMLElement["animate"];
        nodes.set(id, outer);
        visuals.set(id, visual);
        animations.set(id, animate);
      }
      const motion = new SortableMotion();
      motion.begin(nodes, "first", { x: 50 * zoom, y: 15 * zoom }, "x");
      motion.activate({ x: 160 * zoom, y: 15 * zoom });
      motion.move(
        ["first", "second"],
        { x: 160 * zoom, y: 15 * zoom },
        1,
        true,
      );

      // Client deltas include CSS zoom, but a local transform must not apply
      // that zoom a second time. Native page zoom is absent from both values.
      const preview = document.querySelector<HTMLElement>(
        "[data-sortable-preview]",
      )!;
      expect(preview.style.zoom).toBe(String(zoom));
      expect(preview.style.transform).toBe("translate3d(110px, 0px, 0)");
      expect(preview.style.width).toBe("100px");
      expect(preview.style.height).toBe("30px");
      expect(visuals.get("first")!.style.transform).toBe("");
      expect(visuals.get("first")!.style.opacity).toBe("0");
      expect(visuals.get("second")!.style.transform).toBe(
        "translate3d(-100px, 0, 0)",
      );
      expect(motion.capture().get("first")?.left).toBe(110 * zoom);
      expect(nodes.get("first")!.getBoundingClientRect().left).toBe(0);

      const captured = motion.capture();
      motion.reset();
      positions.first = 100;
      positions.second = 0;
      motion.settle(captured, nodes);
      expect(animations.get("first")).toHaveBeenCalledWith(
        [{ transform: "translate3d(10px, 0px, 0)" }, { transform: "none" }],
        expect.any(Object),
      );
      expect(animations.get("second")).not.toHaveBeenCalled();
      motion.cancel();
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
    visual.style.setProperty("--aven-tab-drag-surface", "rgb(12, 15, 22)");
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
    expect(document.querySelector("[data-sortable-preview]")).toBeNull();
    button.focus();
    motion.activate({ x: 162, y: 42 });
    motion.move(["first"], { x: 300, y: 120 }, 0, false);
    const preview = document.querySelector<HTMLElement>(
      "[data-sortable-preview]",
    )!;
    const clone = preview.firstElementChild as HTMLElement;
    expect(preview.parentElement).toBe(document.body);
    expect(preview.style.zoom).toBe("2");
    expect(preview.style.width).toBe("136px");
    expect(preview.style.height).toBe("28px");
    expect(preview.style.transform).toBe("translate3d(260px, 110px, 0)");
    expect(preview.style.background).toBe("rgb(12, 15, 22)");
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
    expect(motion.capture().get("first")).toEqual({ left: 260, top: 110 });
    expect(outer.style.transform).toBe("");
    expect(visual.style.visibility).toBe("inherit");
    expect(visual.style.opacity).toBe("0");
    expect(document.activeElement).toBe(button);
    motion.cancel();
    expect(document.querySelector("[data-sortable-preview]")).toBeNull();
    expect(visual.style.visibility).toBe("inherit");
    expect(visual.style.opacity).toBe("0.75");
    expect(document.activeElement).toBe(button);
  });

  it("moves the dragged tab without rewriting unchanged siblings or drag attributes", () => {
    const nodes = new Map<string, HTMLElement>();
    const visuals = new Map<string, HTMLElement>();
    for (const [index, id] of ["first", "second", "third"].entries()) {
      const outer = document.createElement("div");
      const visual = document.createElement("div");
      visual.dataset.sortableMotion = "";
      outer.append(visual);
      document.body.append(outer);
      const bounds = () => new DOMRect(index * 100, 0, 100, 30);
      outer.getBoundingClientRect = bounds;
      visual.getBoundingClientRect = bounds;
      nodes.set(id, outer);
      visuals.set(id, visual);
    }
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 50, y: 15 }, "x");
    motion.activate({ x: 160, y: 15 });
    motion.move([...nodes.keys()], { x: 160, y: 15 }, 1, true);
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { attributes: true, subtree: true });

    motion.move([...nodes.keys()], { x: 170, y: 15 }, 1, true);

    const mutations = observer.takeRecords();
    expect(mutations.length).toBeGreaterThan(0);
    expect(
      mutations.every(
        (record) =>
          record.target === document.querySelector("[data-sortable-preview]") &&
          record.attributeName === "style",
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>("[data-sortable-preview]")?.style
        .transform,
    ).toBe("translate3d(120px, 0px, 0)");
    expect(visuals.get("second")!.style.transform).toBe(
      "translate3d(-100px, 0, 0)",
    );
    motion.move([...nodes.keys()], { x: 170, y: 15 }, 1, true);
    expect(observer.takeRecords()).toEqual([]);

    observer.disconnect();
    motion.cancel();
    expect(visuals.get("first")!.style.transform).toBe("");
    expect(nodes.get("first")!.hasAttribute("data-sortable-moving")).toBe(
      false,
    );
  });

  it("measures all destination tabs before starting settle animations", () => {
    const events: string[] = [];
    const nodes = new Map<string, HTMLElement>();
    for (const [index, id] of ["first", "second"].entries()) {
      const outer = document.createElement("div");
      const visual = document.createElement("div");
      visual.dataset.sortableMotion = "";
      outer.append(visual);
      document.body.append(outer);
      visual.getBoundingClientRect = () => {
        events.push(`read ${id}`);
        return new DOMRect(index * 100, 0, 100, 30);
      };
      visual.animate = vi.fn(() => {
        events.push(`animate ${id}`);
        return { cancel: vi.fn(), onfinish: null, oncancel: null };
      }) as unknown as HTMLElement["animate"];
      nodes.set(id, outer);
    }
    const motion = new SortableMotion();
    motion.settle(
      new Map([
        ["first", { left: 100, top: 0 }],
        ["second", { left: 0, top: 0 }],
      ]),
      nodes,
    );
    expect(events).toEqual([
      "read first",
      "read second",
      "animate first",
      "animate second",
    ]);
    motion.cancel();
  });

  it("cancels real settling animations without an unhandled finished rejection", async () => {
    const outer = document.createElement("div");
    const visual = document.createElement("div");
    visual.dataset.sortableMotion = "";
    outer.append(visual);
    document.body.append(outer);
    visual.getBoundingClientRect = () => new DOMRect(0, 0, 100, 30);
    const animate = vi.spyOn(visual, "animate");
    const motion = new SortableMotion();
    motion.settle(
      new Map([["first", { left: 100, top: 0 }]]),
      new Map([["first", outer]]),
    );
    const animation = animate.mock.results[0].value as Animation;
    expect(animation.playState).toBe("running");
    motion.cancel();
    // Let the actual Web Animations finished promise reject. Vitest reports
    // an unhandled rejection here if teardown neglects that promise.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(animation.playState).toBe("idle");
    expect(visual.style.transform).toBe("");
  });

  it("exposes floating preview addition, movement, and removal to native browser occlusion", () => {
    const outer = document.createElement("div");
    const visual = document.createElement("div");
    visual.dataset.sortableMotion = "";
    outer.append(visual);
    document.body.append(outer);
    outer.getBoundingClientRect = () => new DOMRect(100, 0, 140, 32);
    visual.getBoundingClientRect = outer.getBoundingClientRect;
    const nodes = new Map([["first", outer]]);
    const motion = new SortableMotion();
    motion.begin(nodes, "first", { x: 150, y: 12 }, "x");
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-native-browser-occluded"],
    });
    motion.activate({ x: 160, y: 12 });
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
    motion.reset();
    motion.finishReset();
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
