// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_ROOT_ATTRIBUTE } from "./motion";
import {
  StripMorph,
  planStripMorph,
  type MorphBox,
  type MorphPart,
  type MorphSnapshot,
} from "./stripMorph";

const box = (left: number, width: number): MorphBox => ({
  left,
  top: 4,
  width,
  height: 26,
});
const content = (left: number, width: number, entry: string): MorphPart => ({
  box: box(left, width),
  entry,
  kind: "content",
  radius: "6px",
});
const fill = (left: number, width: number, entry: string): MorphPart => ({
  box: box(left, width),
  entry,
  kind: "fill",
  radius: "",
});
const snapshot = (
  entries: Record<string, MorphBox>,
  parts: Record<string, MorphPart> = {},
): MorphSnapshot => ({
  entries: new Map(Object.entries(entries)),
  parts: new Map(Object.entries(parts)),
});

describe("planning a strip morph", () => {
  it("moves entries that stayed from where they were drawn, with their speed", () => {
    const before = snapshot({
      a: box(0, 200),
      b: box(150, 200),
      c: box(400, 200),
    });
    const after = snapshot({
      a: box(0, 200),
      b: box(200, 200),
      c: box(400, 200),
    });
    const { steps, origins } = planStripMorph(before, after, {
      velocity: new Map([["b", 320]]),
    });
    expect(steps).toEqual([{ kind: "entry", id: "b", dx: -50, velocity: 320 }]);
    // Still entries need no step, but the highlight can glide from them.
    expect(origins.get("a")).toEqual(box(0, 200));
  });

  it("leaves what something else carries home to it", () => {
    const before = snapshot(
      { a: box(300, 200) },
      { "tab:a": content(300, 200, "a") },
    );
    const after = snapshot(
      { a: box(0, 200) },
      { "tab:a": content(0, 200, "a") },
    );
    expect(
      planStripMorph(before, after, { exclude: new Set(["entry:a", "tab:a"]) })
        .steps,
    ).toEqual([]);
  });

  it("combines in one motion: the pill grows out of the tab it joined, each segment from its preview", () => {
    // Armed over hero (0–200), the preview drew hero's half and page's half.
    const before = snapshot(
      { hero: box(0, 200), page: box(400, 200), fix: box(200, 200) },
      {
        "fill:hero": fill(0, 200, "hero"),
        "tab:hero": content(2, 97, "hero"),
        "tab:page": content(101, 97, "hero"),
        "tab:fix": content(200, 200, "fix"),
      },
    );
    // After: [split | fix] across 600px.
    const after = snapshot(
      { split: box(0, 300), fix: box(300, 300) },
      {
        "fill:split": fill(0, 300, "split"),
        "tab:hero": content(2, 147, "split"),
        "tab:page": content(151, 147, "split"),
        "tab:fix": content(300, 300, "fix"),
      },
    );
    const { steps, origins } = planStripMorph(before, after);
    expect(steps).toEqual([
      { kind: "entry", id: "fix", dx: -100, velocity: 0 },
      { kind: "fill", key: "fill:split", dx: 0, scale: 200 / 300 },
      // Centres 50.5 → 75.5 and 149.5 → 224.5; each opens from its old width.
      { kind: "content", key: "tab:hero", dx: -25, clip: 25 },
      { kind: "content", key: "tab:page", dx: -75, clip: 25 },
      // fix moves by its left edge and widens; its centred name moves by its
      // centre (300 → 450), so it glides the other 50px within the tab.
      { kind: "content", key: "tab:fix", dx: -50, clip: 50 },
    ]);
    // The highlight under the new split glides from the tab it grew out of.
    expect(origins.get("split")).toEqual(box(0, 200));
  });

  it("separates in one motion: each segment's content glides into its own tab", () => {
    const before = snapshot(
      { split: box(0, 300) },
      {
        "fill:split": fill(0, 300, "split"),
        "tab:a": content(2, 147, "split"),
        "tab:b": content(151, 147, "split"),
      },
    );
    const after = snapshot(
      { a: box(0, 150), b: box(150, 150) },
      { "tab:a": content(0, 150, "a"), "tab:b": content(150, 150, "b") },
    );
    expect(planStripMorph(before, after).steps).toEqual([
      { kind: "content", key: "tab:a", dx: 0.5, clip: 1.5 },
      { kind: "content", key: "tab:b", dx: -0.5, clip: 1.5 },
    ]);
  });

  it("fades in only what was nowhere before", () => {
    const before = snapshot({ a: box(0, 200) });
    const after = snapshot(
      { a: box(0, 200), fresh: box(200, 200) },
      { "tab:fresh": content(200, 200, "fresh") },
    );
    expect(planStripMorph(before, after).steps).toEqual([
      { kind: "appear", key: "entry:fresh", entry: true },
    ]);
  });
});

describe("playing a strip morph", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute(MOTION_ROOT_ATTRIBUTE);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function strip(lefts: Record<string, number>) {
    const container = document.createElement("div");
    const nodes = new Map<string, HTMLElement>();
    for (const id of Object.keys(lefts)) {
      const outer = document.createElement("div");
      const visual = document.createElement("div");
      visual.dataset.sortableMotion = "";
      outer.append(visual);
      container.append(outer);
      visual.getBoundingClientRect = () => {
        const shift = Number(
          /translate3d\(([-\d.]+)px/.exec(visual.style.transform)?.[1] ?? 0,
        );
        return new DOMRect(lefts[id] + shift, 4, 200, 26);
      };
      nodes.set(id, outer);
    }
    document.body.append(container);
    return { container, nodes };
  }

  it("measures everything before it animates anything, and ends at rest in its own style", () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    const lefts = { a: 0, b: 200 };
    const { container, nodes } = strip(lefts);
    const events: string[] = [];
    for (const [id, node] of nodes) {
      const visual = node.firstElementChild as HTMLElement;
      const read = visual.getBoundingClientRect.bind(visual);
      visual.getBoundingClientRect = () => {
        events.push(`read ${id}`);
        return read();
      };
      visual.animate = vi.fn(() => {
        events.push(`animate ${id}`);
        return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
      }) as unknown as HTMLElement["animate"];
    }
    const morph = new StripMorph();
    morph.capture(container, nodes);
    lefts.a = 200;
    lefts.b = 0;
    events.length = 0;
    morph.play(container, nodes);
    expect(events).toEqual(["read a", "read b", "animate a", "animate b"]);
    const visual = nodes.get("a")!.firstElementChild as HTMLElement;
    const [frames] = vi.mocked(visual.animate).mock.calls[0];
    expect((frames as Keyframe[])[0].transform).toBe(
      "translate3d(-200px, 0, 0)",
    );
    expect((frames as Keyframe[]).at(-1)!.transform).toBe(
      "translate3d(0px, 0, 0)",
    );
    // The element's own style is untouched at rest, during the run and after.
    expect(visual.style.transform).toBe("");
    vi.advanceTimersByTime(1000);
    expect(visual.style.transform).toBe("");
    expect(morph.takeOrigin("a")).toEqual(box(0, 200));
    expect(morph.takeOrigin("a")).toBeNull();
  });

  it("measures but moves nothing when motion is reduced", () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "reduce");
    const lefts = { a: 0, b: 200 };
    const { container, nodes } = strip(lefts);
    const animate = vi.fn();
    for (const node of nodes.values())
      (node.firstElementChild as HTMLElement).animate =
        animate as unknown as HTMLElement["animate"];
    const morph = new StripMorph();
    morph.capture(container, nodes);
    lefts.a = 200;
    lefts.b = 0;
    morph.play(container, nodes);
    expect(animate).not.toHaveBeenCalled();
  });

  it("moves only parts mid-drag, and leaves parts that move on their own", () => {
    document.documentElement.setAttribute(MOTION_ROOT_ATTRIBUTE, "full");
    const lefts = { split: 0, other: 300 };
    const { container, nodes } = strip(lefts);
    const visual = nodes.get("split")!.firstElementChild as HTMLElement;
    const segment = document.createElement("button");
    segment.dataset.morph = "tab:a";
    let segmentLeft = 0;
    segment.getBoundingClientRect = () => new DOMRect(segmentLeft, 6, 140, 22);
    const own = document.createElement("span");
    own.dataset.morphOwn = "";
    const preview = document.createElement("span");
    preview.dataset.morph = "tab:b";
    preview.getBoundingClientRect = () => new DOMRect(150, 6, 40, 22);
    own.append(preview);
    visual.append(segment, own);
    const animated: Element[] = [];
    for (const element of [
      segment,
      preview,
      visual,
      nodes.get("other")!.firstElementChild!,
    ])
      (element as HTMLElement).animate = vi.fn(() => {
        animated.push(element);
        return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
      }) as unknown as HTMLElement["animate"];
    const morph = new StripMorph();
    morph.capture(container, nodes, [], { partsOnly: true });
    // The split makes room: its segment narrows and the other entry moves.
    segmentLeft = -20;
    lefts.other = 320;
    preview.getBoundingClientRect = () => new DOMRect(170, 6, 40, 22);
    morph.play(container, nodes);
    expect(animated).toEqual([segment]);
  });
});
