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
      motion.move(
        ["first", "second"],
        { x: 160 * zoom, y: 15 * zoom },
        1,
        true,
      );

      // Client deltas include CSS zoom, but a local transform must not apply
      // that zoom a second time. Native page zoom is absent from both values.
      expect(visuals.get("first")!.style.transform).toBe(
        "translate3d(110px, 0, 0)",
      );
      expect(visuals.get("second")!.style.transform).toBe(
        "translate3d(-100px, 0, 0)",
      );
      expect(visuals.get("first")!.getBoundingClientRect().left).toBe(
        110 * zoom,
      );
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
    motion.move([...nodes.keys()], { x: 160, y: 15 }, 1, true);
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { attributes: true, subtree: true });

    motion.move([...nodes.keys()], { x: 170, y: 15 }, 1, true);

    const mutations = observer.takeRecords();
    expect(mutations.length).toBeGreaterThan(0);
    expect(
      mutations.every(
        (record) =>
          record.target === visuals.get("first") &&
          record.attributeName === "style",
      ),
    ).toBe(true);
    expect(visuals.get("first")!.style.transform).toBe(
      "translate3d(120px, 0, 0)",
    );
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
});
