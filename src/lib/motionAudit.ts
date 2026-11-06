// What a person would notice go wrong in a recorded move, after Rune's
// motion audit (github.com/anomalyco/rune, scripts/motion-audit/analyze.py,
// MIT, © 2026 Anomaly). The speed test records, every frame of a scripted
// move, where each keyed element is drawn and how opaque it is; this reads
// that record and lists pop-ins and pop-outs, jumps (also beside something
// that came or went), steps, overshoot, jiggle, wrong-way starts, stalls,
// exits cut short and motion that never settles. A move can say what it
// should do (`instant`, `follow`, `smooth`, `leaves`), which adds its own
// findings and makes the cuts an instant move asks for intended.

/** x, y, width, height and opacity of one element on one frame. */
export type MotionSample = readonly [
  x: number,
  y: number,
  width: number,
  height: number,
  opacity: number,
];

export type MotionFrame = {
  /** ms since the recording started. */
  t: number;
  /** Elements drawn this frame, by key. */
  els: Record<string, MotionSample>;
};

export type MotionExpectation = "instant" | "follow" | "smooth" | "leaves";

export type MotionInput = {
  /** ms since the recording started. */
  t: number;
  label: string;
  expect?: MotionExpectation[];
  /** The key (or part of one) the expectation is about. */
  element?: string;
  /** `instant`: only keys containing this. */
  scope?: string;
  /** `follow`: how far the pointer moves over `dur` ms. */
  dx?: number;
  dy?: number;
  dur?: number;
  /** `follow`: where the pointer was, when known (ms, px). */
  pointer?: { t: number; x: number; y: number }[];
  /** Findings this move means to cause, each with why. */
  allow?: { kinds: MotionFindingKind[]; reason: string };
};

export type MotionTrace = {
  name: string;
  width: number;
  height: number;
  frames: MotionFrame[];
  inputs: MotionInput[];
  /** Each element's parent key, for neighbours that jump. */
  parents?: Record<string, string | undefined>;
  /**
   * Stand-ins that take over from an element and hand back to it (a dragged
   * tab's floating copy): they come and go at full opacity by design.
   */
  handoffs?: readonly string[];
};

export type MotionFindingKind =
  | "pop-in"
  | "pop-out"
  | "appear-then-jump"
  | "cut-exit"
  | "jump"
  | "sibling-jump"
  | "step"
  | "overshoot"
  | "jiggle"
  | "reversal"
  | "stall"
  | "never-settles"
  | "not-instant"
  | "lags-hand"
  | "snap"
  | "wrong-exit"
  | "expect-missing";

export type MotionFinding = {
  kind: MotionFindingKind;
  element: string;
  /** Frame index, or the first and last. */
  at: string;
  detail: string;
};

/** Below this an element can't be seen. */
const VISIBLE_OPACITY = 0.01;
/** At or above this an element that comes or goes at once pops. */
const POP_OPACITY = 0.5;
/** A one-frame change this large (px) is a jump. */
const JUMP_PX = 12;
const STALL_PX = 0.5;
const STALL_SHARE = 0.25;
/** Frames at rest a motion bridges. */
const SEG_GAP = 2;
/** Motion still running this long after the last input never settles (ms). */
const SETTLE_MS = 1000;
/** How long after an input its expectation is judged (ms). */
const INSTANT_WINDOW_MS = 600;
const SMOOTH_WINDOW_MS = 1200;
const FOLLOW_WINDOW_MS = 10_000;
/** A dragged thing this far from where the pointer took it lags the hand. */
const FOLLOW_SLACK_PX = 6;

type Edge = 0 | 1 | 2 | 3;
const EDGE_NAMES = ["x", "y", "w", "h"] as const;

type Row = { k: number; s: MotionSample };

export function auditMotion(trace: MotionTrace): MotionFinding[] {
  const { frames, width: W, height: H } = trace;
  const parents = trace.parents ?? {};
  const findings: MotionFinding[] = [];
  const history = new Map<string, Row[]>();
  const births = new Map<number, string[]>();
  const deaths = new Map<number, { key: string; last: MotionSample }[]>();
  const times = frames.map((frame) => frame.t);
  const inputFrames = new Set<number>();
  const frameAt = (t: number) => {
    let index = 0;
    while (index + 1 < frames.length && frames[index + 1].t <= t) index += 1;
    return index;
  };

  for (const input of trace.inputs) inputFrames.add(frameAt(input.t) + 1);
  frames.forEach((frame, k) => {
    for (const [key, sample] of Object.entries(frame.els)) {
      let rows = history.get(key);
      if (!rows) {
        rows = [];
        history.set(key, rows);
        if (k > 0) push(births, k, key);
      }
      rows.push({ k, s: sample });
    }
    if (k === 0) return;
    for (const key of Object.keys(frames[k - 1].els)) {
      if (!(key in frame.els)) {
        push(deaths, k, { key, last: frames[k - 1].els[key] });
      }
    }
  });

  const seen = (s: MotionSample) =>
    s[4] > VISIBLE_OPACITY &&
    s[2] * s[3] >= 1 &&
    s[0] < W &&
    s[1] < H &&
    s[0] + s[2] > 0 &&
    s[1] + s[3] > 0;

  // Comes or goes at once.
  const handoffs = new Set(trace.handoffs ?? []);
  for (const [k, keys] of births) {
    for (const key of keys) {
      if (!handoffs.has(key) && topLevel(key, keys, parents)) {
        const rows = (history.get(key) ?? []).filter((row) => row.k >= k);
        const [first, next] = rows;
        if (!first || first.s[4] < POP_OPACITY || !seen(first.s)) continue;
        if (first.s[2] * first.s[3] < 4) continue;
        const grows =
          next &&
          (Math.abs(next.s[2] - first.s[2]) > 0.5 ||
            Math.abs(next.s[3] - first.s[3]) > 0.5 ||
            Math.abs(next.s[4] - first.s[4]) > 0.01);
        if (grows) continue;
        const moved =
          next &&
          (Math.abs(next.s[0] - first.s[0]) > JUMP_PX ||
            Math.abs(next.s[1] - first.s[1]) > JUMP_PX);
        findings.push({
          kind: moved ? "appear-then-jump" : "pop-in",
          element: key,
          at: String(k),
          detail: moved
            ? `appeared at (${round(first.s[0])},${round(first.s[1])}), then jumped to (${round(next.s[0])},${round(next.s[1])})`
            : `appeared at opacity ${first.s[4]} with no transition`,
        });
      }
    }
  }
  for (const [k, gone] of deaths) {
    const keys = gone.map((item) => item.key);
    for (const { key, last } of gone) {
      if (handoffs.has(key) || !topLevel(key, keys, parents) || !seen(last))
        continue;
      findings.push({
        kind: last[4] >= POP_OPACITY ? "pop-out" : "cut-exit",
        element: key,
        at: String(k),
        detail:
          last[4] >= POP_OPACITY
            ? `went at opacity ${round(last[4], 2)} with no transition`
            : `went at opacity ${round(last[4], 2)}, before its fade reached 0`,
      });
    }
  }

  // Parents whose children came or went, by frame.
  const changed = new Map<number, Set<string | undefined>>();
  for (const [k, keys] of births)
    for (const key of keys) addTo(changed, k, parents[key]);
  for (const [k, gone] of deaths)
    for (const { key } of gone) addTo(changed, k, parents[key]);

  for (const [key, rows] of history) {
    if (rows.length < 3) continue;
    const parentRows = parents[key] ? history.get(parents[key]!) : undefined;
    const parentAt = new Map(parentRows?.map((row) => [row.k, row.s]));
    for (const edge of [0, 1, 2, 3] as Edge[]) {
      const label = EDGE_NAMES[edge];
      const step = (i: number) =>
        i > 0 && i < rows.length && rows[i].k === rows[i - 1].k + 1
          ? rows[i].s[edge] - rows[i - 1].s[edge]
          : 0;
      // One-frame moves.
      for (let i = 1; i < rows.length; i += 1) {
        const d = step(i);
        if (Math.abs(d) < JUMP_PX) continue;
        if (!seen(rows[i].s) || !seen(rows[i - 1].s)) continue;
        // Rides its parent: the parent reports it.
        const k = rows[i].k;
        const pa = parentAt.get(k - 1);
        const pb = parentAt.get(k);
        if (pa && pb && edge < 2 && Math.abs(pb[edge] - pa[edge] - d) < 0.5)
          continue;
        const before = step(i - 1);
        const after = step(i + 1);
        let kind: MotionFindingKind | null = null;
        if (Math.abs(before) < 1 && Math.abs(after) < 1)
          kind = changed.get(k)?.has(parents[key]) ? "sibling-jump" : "jump";
        else if (
          Math.abs(d) >
          3 * Math.max(Math.abs(before), Math.abs(after), 1)
        )
          kind = "step";
        if (!kind) continue;
        findings.push({
          kind,
          element: key,
          at: String(k),
          detail: `${label} ${round(rows[i - 1].s[edge])} → ${round(rows[i].s[edge])} (${signed(d)}px) in one frame; frames around it ${signed(before)}/${signed(after)}`,
        });
      }
      // Each motion's shape.
      let segment: number[] = [];
      const close = (end: boolean) => {
        if (segment.length >= 4)
          shape(key, rows, edge, segment, findings, seen, times);
        if (end) segment = [];
      };
      for (let i = 1; i < rows.length; i += 1) {
        const gap = rows[i].k - rows[i - 1].k;
        const moving =
          gap <= SEG_GAP + 1 &&
          Math.abs(rows[i].s[edge] - rows[i - 1].s[edge]) > 0.01;
        if (moving) {
          // An input starts a new motion: a drag's end and the flight that
          // follows a release are two moves, judged apart.
          if (segment.length && inputFrames.has(rows[i].k)) close(true);
          segment.push(i);
          if (i === rows.length - 1) close(true);
          continue;
        }
        const last = segment.at(-1);
        if (
          last != null &&
          rows[i].k - rows[last].k <= SEG_GAP &&
          i < rows.length - 1
        )
          continue;
        close(true);
      }
    }
  }

  // Still moving long after the last input.
  const lastInput = Math.max(0, ...trace.inputs.map((input) => input.t));
  const end = frames.at(-1)?.t ?? 0;
  if (end - lastInput > SETTLE_MS && frames.length > 2) {
    const tail = frames.filter((frame) => frame.t > lastInput + SETTLE_MS);
    const moving = new Map<string, number>();
    for (let index = 1; index < tail.length; index += 1) {
      for (const [key, sample] of Object.entries(tail[index].els)) {
        const before = tail[index - 1].els[key];
        if (before && differs(before, sample))
          moving.set(key, (moving.get(key) ?? 0) + 1);
      }
    }
    const busiest = [...moving].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (busiest.length && tail.length > 1) {
      const lastFrame = tail.at(-1)!;
      const stillMoving = busiest.some(([key]) => {
        const before = tail.at(-2)!.els[key];
        const after = lastFrame.els[key];
        return before && after && differs(before, after);
      });
      if (stillMoving)
        findings.push({
          kind: "never-settles",
          element: busiest.map(([key]) => key).join(", "),
          at: `${frames.length - tail.length}–${frames.length - 1}`,
          detail: `still moving ${round((end - lastInput) / 1000, 1)} s after the last input`,
        });
    }
  }

  return [...expectations(trace, history, deaths, frameAt, findings)];
}

function shape(
  key: string,
  rows: Row[],
  edge: Edge,
  segment: number[],
  findings: MotionFinding[],
  seen: (s: MotionSample) => boolean,
  times: readonly number[],
) {
  if (segment.every((i) => !seen(rows[i].s))) return;
  const values = [
    rows[segment[0] - 1].s[edge],
    ...segment.map((i) => rows[i].s[edge]),
  ];
  const start = values[0];
  const rest = values.at(-1)!;
  const travel = rest - start;
  const label = EDGE_NAMES[edge];
  const k0 = rows[segment[0]].k;
  const k1 = rows[segment.at(-1)!].k;
  const at = `${k0}–${k1}`;
  const signs: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    if (Math.abs(d) > 0.05) signs.push(Math.sign(d));
  }
  let reversals = 0;
  for (let i = 1; i < signs.length; i += 1)
    if (signs[i] !== signs[i - 1]) reversals += 1;
  const past =
    Math.abs(travel) > 0.5
      ? Math.max(0, ...values.map((v) => (v - rest) * Math.sign(travel)))
      : 0;
  const before = findings.length;
  if (past > 1) {
    findings.push({
      kind: "overshoot",
      element: key,
      at,
      detail: `${label} ${round(start)} → ${round(rest)} goes ${round(past)}px past its end (${Math.round((100 * past) / Math.abs(travel))}%)`,
    });
  } else if (reversals >= 2) {
    const amplitude = Math.max(...values) - Math.min(...values);
    if (amplitude > 0.5)
      findings.push({
        kind: "jiggle",
        element: key,
        at,
        detail: `${label} turns back ${reversals} times over ${round(amplitude)}px`,
      });
  } else if (reversals === 1) {
    const back =
      Math.abs(travel) > 0.5
        ? Math.max(...values.map((v) => (start - v) * Math.sign(travel)))
        : Math.max(...values.map((v) => Math.abs(v - start)));
    if (back > 1)
      findings.push({
        kind: "reversal",
        element: key,
        at,
        detail:
          Math.abs(travel) > 0.5
            ? `${label} ${round(start)} → ${round(rest)} heads ${round(back)}px the wrong way first`
            : `${label} goes ${round(back)}px out and back`,
      });
  }
  if (findings.length !== before || Math.abs(travel) <= 0.5) return;
  // A speed dip a spring never has: slower than both neighbours, then faster.
  const sign = Math.sign(travel);
  // Speeds per a frame's worth of time, so a frame drawn late (real frames
  // aren't evenly spaced) doesn't read as the motion slowing.
  const stamps = [rows[segment[0] - 1].k, ...segment.map((i) => rows[i].k)].map(
    (k) => times[k],
  );
  const spans = stamps.slice(1).map((t, i) => t - stamps[i]);
  const frame = median(spans) || 1;
  const speed = (i: number) =>
    ((values[i] - values[i - 1]) / Math.max(spans[i - 1], 1)) * frame;
  for (let m = 2; m < values.length - 1; m += 1) {
    const u = [speed(m - 1), speed(m), speed(m + 1)].map((d) => d * sign);
    const floor = Math.min(u[0], u[2]);
    if (
      floor <= STALL_PX ||
      u[1] >= floor - Math.max(STALL_PX, STALL_SHARE * floor)
    )
      continue;
    findings.push({
      kind: "stall",
      element: key,
      at: String(rows[segment[0] - 1 + m].k),
      detail: `${label} speed ${round(u[0], 1)} → ${round(u[1], 1)} → ${round(u[2], 1)} px a frame`,
    });
    return;
  }
}

function expectations(
  trace: MotionTrace,
  history: Map<string, Row[]>,
  deaths: Map<number, { key: string; last: MotionSample }[]>,
  frameAt: (t: number) => number,
  findings: MotionFinding[],
): MotionFinding[] {
  const out: MotionFinding[] = [];
  const instant: { k0: number; k1: number; scope: string }[] = [];
  const times = trace.inputs.map((input) => input.t).sort((a, b) => a - b);
  const windowFrom = (t: number, cap: number) => {
    const k0 = frameAt(t);
    const next = times.find((other) => other > t + 1e-6);
    const k1 = Math.min(
      next == null ? trace.frames.length : frameAt(next),
      frameAt(t + cap) + 1,
      trace.frames.length,
    );
    return [k0, Math.max(k1, k0 + 1)] as const;
  };
  const find = (part: string, k0: number, k1: number) =>
    [...history.keys()]
      .filter(
        (key) =>
          key.includes(part) &&
          history.get(key)!.some((row) => row.k >= k0 - 1 && row.k < k1),
      )
      .sort((a, b) => a.length - b.length)[0];
  for (const input of trace.inputs) {
    for (const expect of input.expect ?? []) {
      if (expect === "instant") {
        const scope = input.scope ?? "";
        const [k0, k1] = windowFrom(input.t, INSTANT_WINDOW_MS);
        instant.push({ k0, k1, scope });
        for (const [key, rows] of history) {
          if (!key.includes(scope)) continue;
          const moving = rows
            .filter(
              (row, i) =>
                i > 0 &&
                row.k >= k0 &&
                row.k < k1 &&
                rows[i - 1].k === row.k - 1 &&
                differs(rows[i - 1].s, row.s),
            )
            .map((row) => row.k);
          const late = moving.filter(
            (k) => k >= k0 + 2 && moving.includes(k - 1),
          );
          if (late.length)
            out.push({
              kind: "not-instant",
              element: key,
              at: `${late[0]}–${late.at(-1)}`,
              detail: `${input.label}: still changing ${late.length + 1} frames in a row (expected a cut)`,
            });
        }
        continue;
      }
      const part = input.element ?? "";
      const [k0, k1] = windowFrom(
        input.t,
        expect === "follow" ? FOLLOW_WINDOW_MS : SMOOTH_WINDOW_MS,
      );
      const key = find(part, k0, k1);
      if (!key) {
        out.push({
          kind: "expect-missing",
          element: part,
          at: String(k0),
          detail: `${input.label}: nothing named ${part} to check "${expect}" on`,
        });
        continue;
      }
      const rows = history
        .get(key)!
        .filter((row) => row.k >= k0 - 1 && row.k < k1);
      if (expect === "follow") {
        // A drag's element moves with the pointer: judged by its centre,
        // since a lifted tab may also change size about the pointer.
        const dur = Math.max(
          input.dur ??
            (input.pointer?.length
              ? input.pointer.at(-1)!.t - input.pointer[0].t
              : 300),
          1,
        );
        const hand = (t: number): [number, number] => {
          const path = input.pointer;
          if (path?.length) {
            if (t <= path[0].t) return [path[0].x, path[0].y];
            for (let i = 1; i < path.length; i += 1) {
              if (path[i].t < t) continue;
              const a = path[i - 1];
              const b = path[i];
              const share = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
              return [a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share];
            }
            const last = path.at(-1)!;
            return [last.x, last.y];
          }
          const share = Math.max(0, Math.min(1, (t - input.t) / dur));
          return [(input.dx ?? 0) * share, (input.dy ?? 0) * share];
        };
        const moving = input.pointer?.length
          ? [
              Math.abs(input.pointer.at(-1)!.x - input.pointer[0].x) > 1,
              Math.abs(input.pointer.at(-1)!.y - input.pointer[0].y) > 1,
            ]
          : [!!input.dx, !!input.dy];
        // Where the element has gone since the drag began, against where the
        // pointer has, allowing two frames for the pointer's events to land.
        const frame =
          median(
            trace.frames.slice(1).map((f, n) => f.t - trace.frames[n].t),
          ) || 16;
        const centre = (sample: MotionSample, axis: 0 | 1) =>
          sample[axis] + sample[axis + 2] / 2;
        const first = rows.find((row) => trace.frames[row.k].t >= input.t);
        let off = 0;
        let worst = 0;
        let started = false;
        for (const row of rows) {
          const t = trace.frames[row.k].t;
          if (!first || t <= trace.frames[first.k].t) continue;
          if (t > input.t + dur) break;
          let lag = 0;
          for (const axis of [0, 1] as const) {
            if (!moving[axis]) continue;
            const actual = centre(row.s, axis) - centre(first.s, axis);
            if (Math.abs(actual) > 0.5) started = true;
            const base = trace.frames[first.k].t;
            const miss = Math.min(
              ...[0, frame, 2 * frame].map((shift) =>
                Math.abs(
                  actual -
                    (hand(Math.max(base, t - shift))[axis] - hand(base)[axis]),
                ),
              ),
            );
            lag = Math.max(lag, miss);
          }
          if (lag > FOLLOW_SLACK_PX) {
            off += 1;
            worst = Math.max(worst, lag);
          }
        }
        if (!started)
          out.push({
            kind: "lags-hand",
            element: key,
            at: String(k0),
            detail: `${input.label}: doesn't move while the pointer drags it`,
          });
        else if (off >= 2)
          out.push({
            kind: "lags-hand",
            element: key,
            at: String(k0),
            detail: `${input.label}: ${round(worst)}px off the pointer at worst, on ${off} frames; a drag follows the hand`,
          });
        continue;
      }
      if (expect === "smooth") {
        let worst: [string, number, number, number] | null = null;
        for (const edge of [0, 1, 2, 3] as Edge[]) {
          const values = rows.map((row) => row.s[edge]);
          const total = (values.at(-1) ?? 0) - (values[0] ?? 0);
          if (Math.abs(total) <= JUMP_PX) continue;
          const steps = values.slice(1).map((v, i) => v - values[i]);
          const big = steps.reduce(
            (a, b) => (Math.abs(b) > Math.abs(a) ? b : a),
            0,
          );
          const moving = steps.filter((s) => Math.abs(s) > 0.05).length;
          if (
            (Math.abs(big) > 0.5 * Math.abs(total) || moving < 3) &&
            (!worst || Math.abs(big) > Math.abs(worst[1]))
          )
            worst = [EDGE_NAMES[edge], big, total, moving];
        }
        if (worst)
          out.push({
            kind: "snap",
            element: key,
            at: String(k0),
            detail: `${input.label}: ${worst[0]} covers ${signed(worst[1])}px of its ${signed(worst[2])}px move in one frame (${worst[3]} moving frames)`,
          });
        continue;
      }
      if (expect === "leaves") {
        const parents = trace.parents ?? {};
        const leaves = (other: string) => {
          for (const [k, gone] of deaths)
            if (k >= k0 && k < k1 && gone.some((item) => item.key === other))
              return true;
          const ops = (history.get(other) ?? [])
            .filter((row) => row.k >= k0 - 1 && row.k < k1)
            .map((row) => row.s[4]);
          return (
            ops.length > 0 &&
            ops[0] > POP_OPACITY &&
            ops.at(-1)! <= VISIBLE_OPACITY
          );
        };
        const others = [...history.keys()].filter(
          (other) =>
            other !== key && parents[other] === parents[key] && leaves(other),
        );
        if (!leaves(key) || others.length)
          out.push({
            kind: "wrong-exit",
            element: key,
            at: String(k0),
            detail: `${input.label}: expected ${key} to leave; ${leaves(key) ? "" : "it stays and "}${others.slice(0, 3).join(", ") || "nothing"} ${others.length === 1 ? "leaves" : "leave"}`,
          });
      }
    }
  }
  // What an instant input asks to cut isn't a finding.
  const cuts = new Set<MotionFindingKind>([
    "pop-in",
    "pop-out",
    "appear-then-jump",
    "jump",
    "step",
    "sibling-jump",
    "cut-exit",
  ]);
  const intended = (finding: MotionFinding) => {
    if (!cuts.has(finding.kind)) return false;
    const k = Number.parseInt(finding.at, 10);
    return instant.some(
      ({ k0, k1, scope }) =>
        k >= k0 && k <= k1 && finding.element.includes(scope),
    );
  };
  // What a move says it means to cause, with its reason.
  const allowed = trace.inputs
    .filter((input) => input.allow)
    .map((input) => ({
      kinds: new Set(input.allow!.kinds),
      ...(([k0, k1]) => ({ k0, k1 }))(windowFrom(input.t, SMOOTH_WINDOW_MS)),
    }));
  const meant = (finding: MotionFinding) => {
    const k = Number.parseInt(finding.at, 10);
    return allowed.some(
      ({ kinds, k0, k1 }) => kinds.has(finding.kind) && k >= k0 && k <= k1,
    );
  };
  return [...findings.filter((finding) => !intended(finding)), ...out].filter(
    (finding) => !meant(finding),
  );
}

function topLevel(
  key: string,
  keys: readonly string[],
  parents: Record<string, string | undefined>,
) {
  let parent = parents[key];
  const set = new Set(keys);
  while (parent) {
    if (set.has(parent)) return false;
    parent = parents[parent];
  }
  return true;
}

function differs(a: MotionSample, b: MotionSample) {
  return (
    Math.abs(a[0] - b[0]) > 0.01 ||
    Math.abs(a[1] - b[1]) > 0.01 ||
    Math.abs(a[2] - b[2]) > 0.01 ||
    Math.abs(a[3] - b[3]) > 0.01 ||
    Math.abs(a[4] - b[4]) > 0.001
  );
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function round(value: number, digits = 0) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function signed(value: number) {
  const r = round(value, 1);
  return r > 0 ? `+${r}` : String(r);
}
