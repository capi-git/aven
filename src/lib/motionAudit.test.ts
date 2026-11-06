import { describe, expect, it } from "vitest";
import {
  auditMotion,
  type MotionFrame,
  type MotionInput,
  type MotionSample,
} from "./motionAudit";

const FRAME = 1000 / 60;

/** A trace from per-frame samples of each element (undefined: not drawn). */
function trace(
  tracks: Record<string, (MotionSample | undefined)[]>,
  inputs: MotionInput[] = [],
  parents: Record<string, string> = {},
) {
  const length = Math.max(...Object.values(tracks).map((t) => t.length));
  const frames: MotionFrame[] = Array.from({ length }, (_, k) => ({
    t: k * FRAME,
    els: Object.fromEntries(
      Object.entries(tracks)
        .filter(([, track]) => track[k])
        .map(([key, track]) => [key, track[k]!]),
    ),
  }));
  return auditMotion({
    name: "test",
    width: 1000,
    height: 800,
    frames,
    inputs,
    parents,
  });
}

const still = (x: number, n: number, opacity = 1): MotionSample[] =>
  Array.from({ length: n }, () => [x, 100, 80, 20, opacity] as const);
/** An eased move from `a` to `b` over `n` frames, then rest. */
const eased = (a: number, b: number, n: number, rest = 4): MotionSample[] => [
  ...Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    return [a + (b - a) * (1 - (1 - t) ** 3), 100, 80, 20, 1] as const;
  }),
  ...still(b, rest),
];
const kinds = (findings: { kind: string }[]) => findings.map((f) => f.kind);

describe("auditMotion", () => {
  it("lets a stand-in come and go, and a move allow what it means", () => {
    const frames: MotionFrame[] = [
      ...still(0, 2).map((s, k) => ({ t: k * FRAME, els: { real: s } })),
      ...still(0, 4).map((s, k) => ({ t: (k + 2) * FRAME, els: { copy: s } })),
    ];
    expect(
      auditMotion({
        name: "t",
        width: 900,
        height: 600,
        frames,
        inputs: [],
        handoffs: ["copy", "real"],
      }),
    ).toEqual([]);
    const over = [0, 60, 110, 140, 150, 148, 146, 145, 145, 145].map(
      (x) => [x, 100, 80, 20, 1] as const,
    );
    expect(
      trace({ sheet: over }, [
        {
          t: 0,
          label: "flick",
          allow: { kinds: ["overshoot"], reason: "a flick lands past" },
        },
      ]),
    ).toEqual([]);
  });

  it("passes a smooth, eased move", () => {
    expect(trace({ tab: eased(0, 200, 12) })).toEqual([]);
  });

  it("flags something that appears or goes at full opacity", () => {
    const findings = trace({
      card: [undefined, undefined, ...still(10, 6), undefined, undefined],
    });
    expect(kinds(findings)).toEqual(["pop-in", "pop-out"]);
  });

  it("lets something fade in and out", () => {
    const fade = (k: number) => [10, 100, 80, 20, k] as const;
    const findings = trace({
      card: [
        undefined,
        fade(0),
        fade(0.4),
        fade(0.8),
        fade(1),
        fade(1),
        fade(0.5),
        fade(0),
        undefined,
      ],
    });
    expect(findings).toEqual([]);
  });

  it("flags an exit cut short mid-fade", () => {
    const fade = (k: number) => [10, 100, 80, 20, k] as const;
    const findings = trace({
      card: [fade(1), fade(1), fade(0.7), fade(0.3), undefined],
    });
    expect(kinds(findings)).toEqual(["cut-exit"]);
  });

  it("flags a jump, and a neighbour's jump when something came beside it", () => {
    expect(kinds(trace({ tab: [...still(0, 4), ...still(120, 4)] }))).toEqual([
      "jump",
    ]);
    const findings = trace(
      {
        a: [...still(0, 4), ...still(80, 4)],
        b: [undefined, undefined, undefined, undefined, ...still(0, 4)],
      },
      [],
      { a: "strip", b: "strip" },
    );
    expect(kinds(findings)).toContain("sibling-jump");
  });

  it("flags overshoot and jiggle", () => {
    const over = [0, 60, 110, 140, 150, 148, 146, 145, 145, 145].map(
      (x) => [x, 100, 80, 20, 1] as const,
    );
    expect(kinds(trace({ sheet: over }))).toEqual(["overshoot"]);
    const wobble = [0, 50, 100, 98, 102, 99, 101, 100, 100, 100].map(
      (x) => [x, 100, 80, 20, 1] as const,
    );
    expect(kinds(trace({ sheet: wobble }))).toContain("overshoot");
  });

  it("flags a stall: a speed dip a spring never has", () => {
    const stall = [0, 20, 40, 42, 62, 82, 95, 100, 100, 100].map(
      (x) => [x, 100, 80, 20, 1] as const,
    );
    expect(kinds(trace({ tab: stall }))).toContain("stall");
  });

  it("flags motion still running long after the last input", () => {
    const creep: MotionSample[] = Array.from({ length: 150 }, (_, k) => [
      k * 0.5,
      100,
      80,
      20,
      1,
    ]);
    const findings = trace({ dot: creep }, [{ t: 0, label: "start" }]);
    expect(kinds(findings)).toContain("never-settles");
  });

  it("checks what a move expects", () => {
    // Instant: Settings opens in a cut, so its pop-in is intended, but a
    // fade that runs on is not.
    const opens = trace({ settings: [undefined, ...still(0, 6)] }, [
      {
        t: FRAME,
        label: "open Settings",
        expect: ["instant"],
        scope: "settings",
      },
    ]);
    expect(opens).toEqual([]);
    const fades = trace(
      {
        settings: [
          undefined,
          ...[0.2, 0.4, 0.6, 0.8, 1, 1].map(
            (o) => [0, 0, 800, 600, o] as const,
          ),
        ],
      },
      [
        {
          t: FRAME,
          label: "open Settings",
          expect: ["instant"],
          scope: "settings",
        },
      ],
    );
    expect(kinds(fades)).toEqual(["not-instant"]);
    // Smooth: a sidebar that snaps in one frame.
    const snaps = trace({ sidebar: [...still(-240, 3), ...still(0, 6)] }, [
      {
        t: 3 * FRAME,
        label: "show sidebar",
        expect: ["smooth"],
        element: "sidebar",
      },
    ]);
    expect(kinds(snaps)).toContain("snap");
    // Follow: a dragged copy that trails the pointer.
    const lag = Array.from(
      { length: 12 },
      (_, k) => [k * 4, 100, 80, 20, 1] as const,
    );
    const drag = trace({ "tab-copy": lag }, [
      {
        t: 0,
        label: "drag tab",
        expect: ["follow"],
        element: "tab-copy",
        dx: 120,
        dur: 11 * FRAME,
      },
    ]);
    expect(kinds(drag)).toEqual(["lags-hand"]);
    // One that rides the pointer a frame behind its events still follows.
    const pointer = Array.from({ length: 12 }, (_, k) => ({
      t: k * FRAME,
      x: k * 10,
      y: 0,
    }));
    const behind = Array.from(
      { length: 12 },
      (_, k) => [Math.max(0, k - 1) * 10 - 40, 100, 80, 20, 1] as const,
    );
    const rides = trace({ "tab-copy": behind }, [
      {
        t: 0,
        label: "drag tab",
        expect: ["follow"],
        element: "tab-copy",
        pointer,
      },
    ]);
    expect(rides).toEqual([]);
    // Leaves: the closed tab goes, not its neighbour.
    const wrong = trace(
      {
        "tab:a": still(0, 6),
        "tab:b": [...still(90, 3), undefined, undefined, undefined],
      },
      [
        {
          t: 2 * FRAME,
          label: "close a",
          expect: ["leaves"],
          element: "tab:a",
        },
      ],
      { "tab:a": "tabs", "tab:b": "tabs" },
    );
    expect(kinds(wrong)).toContain("wrong-exit");
  });
});

describe("motions split at inputs", () => {
  it("judges a drag and the flight after letting go apart", () => {
    // Dragged past where it lands, then let go: it flies back. Not an
    // overshoot, since the hand took it there.
    const path = [0, 40, 80, 120, 160, 200, 190, 182, 180, 180, 180, 180];
    const findings = auditMotion({
      name: "drag",
      width: 900,
      height: 600,
      frames: path.map((x, k) => ({
        t: k * FRAME,
        els: { copy: [x, 0, 80, 20, 1] },
      })),
      inputs: [{ t: 5 * FRAME, label: "let go" }],
    });
    expect(findings).toEqual([]);
  });
});
