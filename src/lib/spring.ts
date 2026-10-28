/**
 * A small spring for gesture-driven motion, after Apple's fluid interfaces
 * (WWDC 2018): two parameters instead of mass, stiffness and damping.
 *
 * - `damping`: 1 settles without overshooting; below 1 overshoots a little.
 * - `response`: roughly how many seconds the value takes to get most of the
 *   way to its target. Not a duration: how long a spring runs follows from
 *   both parameters, the distance and the speed it starts with.
 *
 * The motion is the closed-form solution, so a spring can be asked where it
 * is and how fast it is moving at any moment. That is what makes it
 * interruptible: a new target starts from the value on screen *and* its
 * velocity, so a reversal curves instead of stopping dead.
 *
 * `SpringAnimator` plays springs as Web Animations (keyframes sampled from
 * the solution), so the compositor draws every frame and the main thread is
 * free while it runs. Every run is bounded by a timer: WebKit can hold back
 * an animation's finish while a native Chromium page covers the window, and
 * nothing here waits for `onfinish` alone.
 */

export type Spring = {
  /** 1 is critically damped (no overshoot); below 1 overshoots. */
  damping: number;
  /** Seconds to get most of the way to the target. */
  response: number;
};

export type SpringState = { value: number; velocity: number };

/** How long past its end a sampled spring may run before a timer ends it. */
export const SPRING_BOUND_SLACK_MS = 50;
/** No spring runs longer than this, however far or fast it starts. */
export const SPRING_MAX_MS = 600;
/** Keyframes per second when a spring is played as a Web Animation. */
export const SPRING_SAMPLE_HZ = 60;

/**
 * Where a spring that starts at `from` with `velocity` (units per second)
 * towards `to` is, and how fast it is moving, `t` seconds later.
 */
export function springAt(
  spring: Spring,
  from: number,
  to: number,
  velocity: number,
  t: number,
): SpringState {
  if (t <= 0) return { value: from, velocity };
  const omega = (2 * Math.PI) / Math.max(1e-3, spring.response);
  const zeta = Math.max(0, spring.damping);
  const x0 = from - to;
  const v0 = velocity;
  if (Math.abs(zeta - 1) < 1e-6) {
    const decay = Math.exp(-omega * t);
    const b = v0 + omega * x0;
    return {
      value: to + (x0 + b * t) * decay,
      velocity: (v0 - omega * b * t) * decay,
    };
  }
  if (zeta < 1) {
    const a = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + a * x0) / wd;
    const decay = Math.exp(-a * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      value: to + decay * (x0 * cos + b * sin),
      velocity: decay * (v0 * cos - (a * b + x0 * wd) * sin),
    };
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  const c1 = x0 - c2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return {
    value: to + c1 * e1 + c2 * e2,
    velocity: c1 * r1 * e1 + c2 * r2 * e2,
  };
}

/**
 * Seconds until the spring stays within `precision` of its target and
 * slower than `precision` per 50 ms, capped at `SPRING_MAX_MS`. Zero when it
 * is already at rest there.
 */
export function springSettleTime(
  spring: Spring,
  from: number,
  to: number,
  velocity: number,
  precision: number,
): number {
  const limit = SPRING_MAX_MS / 1000;
  const still = (state: SpringState) =>
    Math.abs(state.value - to) <= precision &&
    Math.abs(state.velocity) * 0.05 <= precision;
  if (still({ value: from, velocity })) return 0;
  const step = 1 / 240;
  let settled = 0;
  for (let t = step; t <= limit; t += step) {
    if (!still(springAt(spring, from, to, velocity, t))) settled = 0;
    else if (!settled) settled = t;
  }
  return settled || limit;
}

/**
 * The progress curve of a spring from rest, sampled for CSS `linear()`, and
 * the duration that curve runs. Progress may pass 1 when the spring
 * overshoots.
 */
export function springCurve(
  spring: Spring,
  {
    points = 24,
    precision = 0.002,
  }: { points?: number; precision?: number } = {},
): { easing: string; ms: number } {
  const seconds = springSettleTime(spring, 0, 1, 0, precision);
  const values: string[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (seconds * i) / points;
    const value = i === points ? 1 : springAt(spring, 0, 1, 0, t).value;
    values.push(String(Math.round(value * 10000) / 10000));
  }
  return {
    easing: `linear(${values.join(", ")})`,
    ms: Math.round(seconds * 1000),
  };
}

/**
 * Rubber-banding past a soft edge (Apple's formula): the further past it,
 * the less the element follows. `dimension` is the size the stretch is
 * measured against; `constant` 0.55 is UIScrollView's.
 */
export function rubberBand(
  offset: number,
  dimension: number,
  constant = 0.55,
): number {
  if (dimension <= 0) return 0;
  const sign = Math.sign(offset);
  const distance = Math.abs(offset);
  return (
    (sign * distance * dimension * constant) / (dimension + constant * distance)
  );
}

/** One value's run: from where, how fast, to where, on which spring. */
export type SpringRun = {
  spring: Spring;
  from: number;
  velocity: number;
  to: number;
  /** Close enough to the target to stop, in the value's own units. */
  precision: number;
};

/**
 * Samples several springs together, `SPRING_SAMPLE_HZ` times a second, until
 * the slowest settles. Null when every one is already at rest at its target.
 * The last sample is exactly the targets.
 */
export function sampleSprings<K extends string>(
  runs: Readonly<Record<K, SpringRun>>,
): {
  ms: number;
  samples: Array<{ offset: number; values: Record<K, number> }>;
} | null {
  const keys = Object.keys(runs) as K[];
  let seconds = 0;
  for (const key of keys) {
    const run = runs[key];
    seconds = Math.max(
      seconds,
      springSettleTime(
        run.spring,
        run.from,
        run.to,
        run.velocity,
        run.precision,
      ),
    );
  }
  if (seconds <= 0) return null;
  const steps = Math.max(2, Math.ceil(seconds * SPRING_SAMPLE_HZ));
  const samples: Array<{ offset: number; values: Record<K, number> }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (seconds * i) / steps;
    const values = {} as Record<K, number>;
    for (const key of keys) {
      const run = runs[key];
      values[key] =
        i === steps
          ? run.to
          : springAt(run.spring, run.from, run.to, run.velocity, t).value;
    }
    samples.push({ offset: i / steps, values });
  }
  return { ms: Math.round(seconds * 1000), samples };
}

/** Keyframes for one element drawn from several springs (see `sampleSprings`). */
export function springKeyframes<K extends string>(
  runs: Readonly<Record<K, SpringRun>>,
  render: (values: Readonly<Record<K, number>>) => Keyframe,
): { keyframes: Keyframe[]; ms: number } | null {
  const sampled = sampleSprings(runs);
  if (!sampled) return null;
  return {
    ms: sampled.ms,
    keyframes: sampled.samples.map(({ offset, values }) => ({
      ...render(values),
      offset,
    })),
  };
}

/**
 * A pointer's speed from its last few moves, in px per second: the change
 * across the moves within `window` ms of the newest. Zero after a pause, so
 * a pointer held still before letting go throws nothing.
 */
export class PointerVelocity {
  private samples: Array<{ x: number; y: number; t: number }> = [];
  private readonly window: number;

  constructor(window: number) {
    this.window = window;
  }

  add(x: number, y: number, t: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) this.samples = [];
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > this.window)
      this.samples.shift();
  }

  /** The speed at `now`; zero when the newest move is older than the window. */
  velocity(now: number): { x: number; y: number } {
    const samples = this.samples;
    const last = samples[samples.length - 1];
    if (!last || samples.length < 2 || now - last.t > this.window)
      return { x: 0, y: 0 };
    const first = samples.find((s) => last.t - s.t <= this.window) ?? last;
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  reset() {
    this.samples = [];
  }
}

/** A value's spring: where it starts, where it goes and how. */
export type SpringChannel = {
  spring: Spring;
  /** Close enough to the target to stop, in the value's own units. */
  precision: number;
};

type Segment = {
  from: number;
  velocity: number;
  to: number;
  spring: Spring;
};

type Run = {
  started: number;
  ms: number;
  animations: Animation[];
  timer: ReturnType<typeof setTimeout>;
};

/** What each element draws for a set of channel values. */
export type SpringRender<K extends string> = (
  values: Readonly<Record<K, number>>,
) => ReadonlyArray<readonly [Element, Keyframe]>;

/**
 * Named values, each on its own spring (2D motion is two springs, so x and y
 * keep their own speeds), drawn by `render` onto one or more elements as one
 * Web Animation per element. `to()` retargets from what is drawn now with
 * its velocity; `jump()` sets values without motion. The element's own style
 * always holds the targets, so a run that is cancelled, held back or ended
 * by its timer leaves everything at rest where it was going.
 */
export class SpringAnimator<K extends string> {
  private segments: Record<K, Segment>;
  private run: Run | null = null;
  private settledHandlers: Array<() => void> = [];
  private readonly channels: Readonly<Record<K, SpringChannel>>;
  private readonly render: SpringRender<K>;
  private readonly applyRest: (values: Readonly<Record<K, number>>) => void;

  /**
   * `rest` writes the values the elements hold when nothing is running
   * (their own style); by default, what `render` draws for them.
   */
  constructor(
    channels: Readonly<Record<K, SpringChannel>>,
    initial: Readonly<Record<K, number>>,
    render: SpringRender<K>,
    rest?: (values: Readonly<Record<K, number>>) => void,
  ) {
    this.channels = channels;
    this.render = render;
    this.applyRest =
      rest ??
      ((values) => {
        for (const [element, frame] of render(values))
          applyFrame(element as HTMLElement, frame);
      });
    this.segments = {} as Record<K, Segment>;
    for (const key of this.keys())
      this.segments[key] = {
        from: initial[key],
        velocity: 0,
        to: initial[key],
        spring: channels[key].spring,
      };
  }

  private keys(): K[] {
    return Object.keys(this.channels) as K[];
  }

  /** Seconds into the current run, from what the compositor is drawing. */
  private elapsed(): number {
    const run = this.run;
    if (!run) return 0;
    const animation = run.animations[0];
    const time =
      animation &&
      !animation.pending &&
      typeof animation.currentTime === "number"
        ? animation.currentTime
        : performance.now() - run.started;
    return Math.max(0, Math.min(run.ms, time)) / 1000;
  }

  /** Each value now, with its velocity. */
  state(): Record<K, SpringState> {
    const t = this.elapsed();
    const out = {} as Record<K, SpringState>;
    for (const key of this.keys()) {
      const s = this.segments[key];
      out[key] =
        this.run && t > 0
          ? springAt(s.spring, s.from, s.to, s.velocity, t)
          : {
              value: this.run ? s.from : s.to,
              velocity: this.run ? s.velocity : 0,
            };
    }
    return out;
  }

  /** Where each value is going. */
  targets(): Record<K, number> {
    const out = {} as Record<K, number>;
    for (const key of this.keys()) out[key] = this.segments[key].to;
    return out;
  }

  get running(): boolean {
    return this.run !== null;
  }

  /**
   * Sends some values to new targets (others keep going where they were),
   * each from where it is drawn now and at its current speed, unless
   * `velocity` gives one (a gesture's release speed). `springs` swaps a
   * channel's spring for this run. `instant` puts everything at its target.
   */
  to(
    targets: Partial<Record<K, number>>,
    options: {
      velocity?: Partial<Record<K, number>>;
      springs?: Partial<Record<K, Spring>>;
      from?: Partial<Record<K, number>>;
      instant?: boolean;
    } = {},
  ): void {
    const now = this.state();
    this.cancelRun();
    for (const key of this.keys()) {
      const s = this.segments[key];
      const target = targets[key] ?? s.to;
      s.from = options.from?.[key] ?? now[key].value;
      s.velocity = options.velocity?.[key] ?? now[key].velocity;
      s.to = target;
      s.spring =
        options.springs?.[key] ??
        (targets[key] !== undefined ? this.channels[key].spring : s.spring);
    }
    if (options.instant) {
      this.rest();
      return;
    }
    this.play();
  }

  /** Puts values somewhere at once, with no motion and no speed. */
  jump(values: Partial<Record<K, number>>): void {
    const now = this.state();
    this.cancelRun();
    for (const key of this.keys()) {
      const s = this.segments[key];
      const value = values[key] ?? now[key].value;
      s.from = value;
      s.to = value;
      s.velocity = 0;
    }
    this.rest();
  }

  /** Ends the motion where it was going. */
  finish(): void {
    if (!this.run) return;
    this.cancelRun();
    this.rest();
  }

  /** Stops every animation without touching the elements' own style. */
  cancel(): void {
    this.cancelRun();
    this.settledHandlers = [];
  }

  /** Runs once when the values come to rest (at once if they are). */
  onSettle(handler: () => void): void {
    if (!this.run) handler();
    else this.settledHandlers.push(handler);
  }

  private cancelRun() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    clearTimeout(run.timer);
    for (const animation of run.animations) animation.cancel();
  }

  private rest() {
    const values = this.targets();
    for (const key of this.keys()) {
      const s = this.segments[key];
      s.from = s.to;
      s.velocity = 0;
    }
    this.applyRest(values);
    const handlers = this.settledHandlers;
    this.settledHandlers = [];
    for (const handler of handlers) handler();
  }

  private play() {
    const keys = this.keys();
    const sampled = sampleSprings(
      Object.fromEntries(
        keys.map((key) => [
          key,
          { ...this.segments[key], precision: this.channels[key].precision },
        ]),
      ) as Record<K, SpringRun>,
    );
    if (!sampled) {
      this.rest();
      return;
    }
    const { ms } = sampled;
    const frames = new Map<Element, Keyframe[]>();
    for (const { offset, values } of sampled.samples)
      for (const [element, frame] of this.render(values)) {
        let list = frames.get(element);
        if (!list) frames.set(element, (list = []));
        list.push({ ...frame, offset });
      }
    // The elements' own style holds where they are going.
    this.applyRest(this.targets());
    const animations: Animation[] = [];
    for (const [element, list] of frames) {
      if (typeof (element as HTMLElement).animate !== "function") continue;
      // An element whose channels are not moving this run (only one value
      // was retargeted) holds still in its own style: no animation for it.
      if (list.every((frame) => sameFrame(frame, list[0]))) continue;
      animations.push(
        element.animate(list, { duration: ms, easing: "linear", fill: "none" }),
      );
    }
    const run: Run = {
      started: performance.now(),
      ms,
      animations,
      timer: setTimeout(() => {
        if (this.run !== run) return;
        this.cancelRun();
        this.rest();
      }, ms + SPRING_BOUND_SLACK_MS),
    };
    this.run = run;
    for (const animation of animations) {
      // Cancelling rejects `finished`; that is normal cleanup here.
      void animation.finished?.catch(() => {});
      animation.onfinish = () => {
        if (this.run !== run) return;
        this.cancelRun();
        this.rest();
      };
    }
  }
}

/** The same properties at the same values, whatever their offsets. */
function sameFrame(a: Keyframe, b: Keyframe): boolean {
  for (const key of Object.keys(a))
    if (key !== "offset" && a[key] !== b[key]) return false;
  return true;
}

const KEBAB = /[A-Z]/g;

/** Writes a keyframe's properties as the element's own style. */
export function applyFrame(element: HTMLElement, frame: Keyframe) {
  for (const [name, value] of Object.entries(frame)) {
    if (name === "offset" || name === "easing" || name === "composite")
      continue;
    const property = name.replace(KEBAB, (c) => `-${c.toLowerCase()}`);
    const text = value == null ? "" : String(value);
    if (element.style.getPropertyValue(property) !== text)
      element.style.setProperty(property, text);
  }
}
