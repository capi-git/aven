/**
 * A new chat's ink. The pointer stirs ink through a small smoke field that
 * drifts, curls and fades; holding charges a vortex that pulls the ink into a
 * spiral, and letting go bursts it outward as a shockwave. It is drawn as a
 * halftone: 3px cells, each on or off through a 4×4 Bayer matrix, so it reads
 * as texture rather than a coloured wash.
 *
 * Adapted from MonoCode's empty-session canvas (`crates/monocode-gpui/src/
 * ink_field.rs` and `visuals/dither.rs` at 5a31951, MIT, see NOTICE). Aven's
 * ink is grey, in the interface's own text colour; MonoCode's was tinted.
 *
 * Pure and DOM-free: positions are CSS pixels from the field's top left,
 * time is seconds, and `paint` fills a cell-per-pixel buffer the caller puts
 * on a canvas. The caller stops its frame loop once `quiet()` is true.
 */

/** Side of a smoke cell; the halftone samples the field every 3px. */
export const INK_FIELD = 6;
/** Side of a halftone cell. */
export const INK_CELL = 3;
/** Seconds of holding that fully charge a burst. */
export const INK_CHARGE = 1.2;
/** The longest step a frame takes, so a stalled frame never explodes. */
export const INK_MAX_STEP = 0.05;

/**
 * How much of a cell's tone becomes coverage. Below 1, so the halftone stays
 * sparse and never fills in solid. A little above MonoCode's (0.55 and 0.5):
 * grey ink reads fainter than its tinted ink did.
 */
const INK_COVERAGE = 0.7;
const LIT_COVERAGE = 0.6;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Whether the cell at (col, row) is inked for `tone`. Thresholds sit halfway
 * between steps, so a tone of 0.25 inks exactly a quarter.
 */
export function inked(col: number, row: number, tone: number): boolean {
  return tone > (BAYER4[(row & 3) * 4 + (col & 3)]! + 0.5) / 16;
}

type Splat = { x: number; y: number; vx: number; vy: number };
type Ripple = { x: number; y: number; age: number; strength: number };
type Press = { x: number; y: number; held: number };

function rippleLife(ripple: Ripple) {
  return 0.7 + 0.7 * ripple.strength;
}

function rippleBand(ripple: Ripple) {
  return 7 + 12 * ripple.strength;
}

/** The ring's radius and how strongly it still shows, once it has started. */
function rippleFront(ripple: Ripple): [number, number] | null {
  if (ripple.age < 0) return null;
  const life = rippleLife(ripple);
  const t = Math.min(ripple.age / life, 1);
  const reach = (260 + 300 * ripple.strength) * life * 0.5;
  return [
    reach * (1 - (1 - t) ** 3),
    Math.min(ripple.strength, 1) * (1 - t) ** 1.5,
  ];
}

function pressCharge(press: Press) {
  return Math.min(press.held / INK_CHARGE, 1);
}

/** The field at fractional cell coordinates, interpolated between cells. */
function sample(
  field: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
): number {
  const cx = Math.min(Math.max(x, 0), cols - 1.001);
  const cy = Math.min(Math.max(y, 0), rows - 1.001);
  const c = cx | 0;
  const r = cy | 0;
  const fx = cx - c;
  const fy = cy - r;
  const i = r * cols + c;
  const top = field[i]! + (field[i + 1]! - field[i]!) * fx;
  const bottom =
    field[i + cols]! + (field[i + cols + 1]! - field[i + cols]!) * fx;
  return top + (bottom - top) * fy;
}

/** Colours for `paint`, packed as the canvas's RGBA bytes (little-endian). */
export type InkPalette = {
  /** Three tones of resting ink, faintest first. */
  ink: readonly [number, number, number];
  /** Three tones of the brighter ink in a ring or the held orb. */
  lit: readonly [number, number, number];
};

/** Packs a colour as one little-endian `Uint32` of an `ImageData` buffer. */
export function packRgba(r: number, g: number, b: number, alpha: number) {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Grey ink in the interface's text colour. Light surfaces get a touch more,
 * as dark ink on white reads fainter.
 */
export function inkPalette(
  rgb: readonly [number, number, number],
  light: boolean,
): InkPalette {
  const boost = light ? 1.1 : 1;
  const tone = (alpha: number) =>
    packRgba(rgb[0], rgb[1], rgb[2], alpha * boost);
  return {
    ink: [tone(0.16), tone(0.23), tone(0.3)],
    lit: [tone(0.22), tone(0.3), tone(0.38)],
  };
}

function level(tone: number) {
  return Math.min(Math.max(tone * 3, 0), 2) | 0;
}

export class InkField {
  width = 0;
  height = 0;
  cols = 0;
  rows = 0;
  ink = new Float32Array(0);
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  private scratch = new Float32Array(0);
  splats: Splat[] = [];
  pointer: { x: number; y: number; at: number } | null = null;
  press: Press | null = null;
  ripples: Ripple[] = [];
  peak = 0;
  time = 0;
  greeted = false;

  /** Nothing left to move or draw: the caller can stop its frames. */
  quiet(): boolean {
    return (
      this.peak < 0.01 &&
      this.ripples.length === 0 &&
      this.press === null &&
      this.splats.length === 0
    );
  }

  /**
   * Fits the field to its box, clearing it when the grid changes. The first
   * size with any width greets with a soft ring, a hint the space is alive.
   */
  resize(width: number, height: number, greet = true): void {
    this.width = width;
    this.height = height;
    const cols = Math.ceil(width / INK_FIELD) + 1;
    const rows = Math.ceil(height / INK_FIELD) + 1;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      const cells = cols * rows;
      this.ink = new Float32Array(cells);
      this.vx = new Float32Array(cells);
      this.vy = new Float32Array(cells);
      this.scratch = new Float32Array(cells);
      this.peak = 0;
    }
    if (greet && !this.greeted && width > 0) {
      this.greeted = true;
      this.ripples.push({
        x: width / 2,
        y: height * 0.38,
        age: 0,
        strength: 0.2,
      });
    }
  }

  /** Records a pointer move at `now` (ms). Returns whether it woke the field. */
  moved(x: number, y: number, now: number): boolean {
    const woke = this.quiet();
    const last = this.pointer;
    if (last) {
      const dt = Math.max((now - last.at) / 1000, 1 / 240);
      const dx = x - last.x;
      const dy = y - last.y;
      const vx = Math.min(Math.max(dx / dt, -3000), 3000);
      const vy = Math.min(Math.max(dy / dt, -3000), 3000);
      const steps = Math.min(
        Math.max(Math.ceil(Math.hypot(dx, dy) / 3), 1),
        200,
      );
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.splats.push({ x: last.x + dx * t, y: last.y + dy * t, vx, vy });
      }
    }
    this.pointer = { x, y, at: now };
    if (this.press) {
      this.press.x = x;
      this.press.y = y;
    }
    return woke;
  }

  pressed(x: number, y: number): boolean {
    const woke = this.quiet();
    this.press = { x, y, held: 0 };
    return woke;
  }

  released(): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    const charge = pressCharge(press);
    const strength = 0.3 + 0.7 * charge;
    this.ripples.push({ x: press.x, y: press.y, age: 0, strength });
    // A charged burst echoes.
    if (charge > 0.4)
      this.ripples.push({
        x: press.x,
        y: press.y,
        age: -0.14,
        strength: strength * 0.55,
      });
  }

  left(): void {
    this.pointer = null;
  }

  /** Lets go of everything at once: no burst, no trail. */
  settle(): void {
    this.press = null;
    this.pointer = null;
    this.splats = [];
  }

  /**
   * Visits the cells within `radius` of (x, y) with their offset and a
   * falloff from 1 at the centre to 0 at the edge.
   */
  private around(
    x: number,
    y: number,
    radius: number,
    visit: (i: number, dx: number, dy: number, weight: number) => void,
  ) {
    const c0 = Math.max(Math.floor((x - radius) / INK_FIELD), 0);
    const c1 = Math.min(Math.ceil((x + radius) / INK_FIELD), this.cols - 1);
    const r0 = Math.max(Math.floor((y - radius) / INK_FIELD), 0);
    const r1 = Math.min(Math.ceil((y + radius) / INK_FIELD), this.rows - 1);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = (col + 0.5) * INK_FIELD - x;
        const dy = (row + 0.5) * INK_FIELD - y;
        const d = Math.hypot(dx, dy);
        if (d < radius) {
          const w = 1 - d / radius;
          visit(row * this.cols + col, dx, dy, w * w);
        }
      }
    }
  }

  /** Moves the field on by `dt` seconds. */
  step(dt: number): void {
    const t = Math.min(dt, INK_MAX_STEP);
    if (this.cols === 0 || this.quiet() || !(t > 0)) return;
    this.time += t;
    const { ink, vx, vy, scratch, cols, rows } = this;

    // Trails: ink thickens with speed and inherits the pointer's motion.
    // A little wider and denser than MonoCode's (6 + v × 0.006 up to 16,
    // and 0.28), so a grey trail reads as a wisp rather than a dotted line.
    const splats = this.splats;
    this.splats = [];
    for (const s of splats) {
      const radius = Math.min(9 + Math.hypot(s.vx, s.vy) * 0.008, 22);
      this.around(s.x, s.y, radius, (i, _dx, _dy, w) => {
        ink[i]! += (1 - ink[i]!) * w * 0.34;
        vx[i]! += (s.vx * 0.45 - vx[i]!) * w * 0.5;
        vy[i]! += (s.vy * 0.45 - vy[i]!) * w * 0.5;
      });
    }

    // Holding spins a vortex that drinks nearby ink, shedding two arms.
    const press = this.press;
    if (press) {
      press.held += t;
      const charge = pressCharge(press);
      const reach = 40 + 80 * charge;
      const spin = 140 + 320 * charge;
      const blend = Math.min(t * 8, 1);
      this.around(press.x, press.y, reach, (i, dx, dy, w) => {
        const d = Math.max(Math.hypot(dx, dy), 1);
        const tx = (-dy / d) * spin * w;
        const ty = (dx / d) * spin * w;
        const pull = 70 * w;
        const share = blend * Math.sqrt(w);
        vx[i]! += (tx - (dx / d) * pull - vx[i]!) * share;
        vy[i]! += (ty - (dy / d) * pull - vy[i]!) * share;
      });
      for (const arm of [0, Math.PI]) {
        const a = this.time * (5 + 6 * charge) + arm;
        const r = reach * 0.55;
        this.around(
          press.x + Math.cos(a) * r,
          press.y + Math.sin(a) * r,
          7,
          (i, _dx, _dy, w) => {
            ink[i]! += (1 - ink[i]!) * w * 0.5;
          },
        );
      }
    }

    // Shockwaves shove the ink outward and leave a faint wake.
    for (const ripple of this.ripples) {
      const front = rippleFront(ripple);
      if (!front) continue;
      const [radius, amp] = front;
      const band = rippleBand(ripple);
      this.around(ripple.x, ripple.y, radius + band * 2.5, (i, dx, dy) => {
        const d = Math.max(Math.hypot(dx, dy), 1);
        const g = Math.exp(-(((d - radius) / band) ** 2)) * amp;
        if (g > 0.02) {
          const push = 800 * ripple.strength * g * t;
          vx[i]! += (dx / d) * push;
          vy[i]! += (dy / d) * push;
          ink[i]! += (1 - ink[i]!) * g * 3 * t;
        }
      });
    }
    this.ripples = this.ripples.filter((ripple) => {
      ripple.age += t;
      return ripple.age < rippleLife(ripple);
    });

    // A slow curl keeps resting smoke wandering.
    const time = this.time;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (ink[i]! > 0.01) {
          const x = col * INK_FIELD;
          const y = row * INK_FIELD;
          const a =
            (Math.sin(x * 0.021 + time * 0.37) +
              Math.cos(y * 0.027 - time * 0.29) +
              Math.sin((x + y) * 0.013 + time * 0.21)) *
            1.4;
          vx[i]! += Math.cos(a) * 45 * t;
          vy[i]! += Math.sin(a) * 45 * t;
        }
      }
    }

    // Carry the ink along its velocity, then soften and fade it.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        scratch[i] = sample(
          ink,
          cols,
          rows,
          col - (vx[i]! * t) / INK_FIELD,
          row - (vy[i]! * t) / INK_FIELD,
        );
      }
    }
    const fade = Math.exp(-t * 1.6);
    const calm = Math.exp(-t * 1.8);
    let peak = 0;
    for (let row = 0; row < rows; row++) {
      const up = Math.max(row - 1, 0) * cols;
      const down = Math.min(row + 1, rows - 1) * cols;
      const here = row * cols;
      for (let col = 0; col < cols; col++) {
        const i = here + col;
        const near =
          scratch[here + Math.max(col - 1, 0)]! +
          scratch[here + Math.min(col + 1, cols - 1)]! +
          scratch[up + col]! +
          scratch[down + col]!;
        const v = Math.min(
          Math.max((scratch[i]! * 0.84 + near * 0.04) * fade - 0.002, 0),
          1,
        );
        ink[i] = v;
        if (v > peak) peak = v;
        vx[i]! *= calm;
        vy[i]! *= calm;
      }
    }
    this.peak = peak;
  }

  /** The halftone grid that `paint` fills: one pixel per 3px cell. */
  cells(): { cols: number; rows: number } {
    return {
      cols: Math.max(Math.floor(this.width / INK_CELL), 0),
      rows: Math.max(Math.floor(this.height / INK_CELL), 0),
    };
  }

  /**
   * Fills `pixels` (`cols × rows` from `cells()`, RGBA as `Uint32`) with the
   * halftone. Returns how many cells it inked.
   */
  paint(pixels: Uint32Array, palette: InkPalette): number {
    pixels.fill(0);
    if (this.quiet()) return 0;
    const { cols: gridCols, rows: gridRows } = this.cells();
    const { ink: field, cols, rows } = this;
    const rings: [number, number, number, number, number][] = [];
    for (const ripple of this.ripples) {
      const front = rippleFront(ripple);
      if (front)
        rings.push([
          ripple.x,
          ripple.y,
          front[0],
          rippleBand(ripple),
          front[1],
        ]);
    }
    const press = this.press;
    const orb = press
      ? (() => {
          const charge = pressCharge(press);
          const breath = Math.sin(this.time * 9) * 1.5;
          return [
            press.x,
            press.y,
            4 + 14 * charge + breath,
            0.4 + 0.5 * charge,
          ] as const;
        })()
      : null;
    let count = 0;
    for (let row = 0; row < gridRows; row++) {
      const y = (row + 0.5) * INK_CELL;
      for (let col = 0; col < gridCols; col++) {
        const x = (col + 0.5) * INK_CELL;
        const tone = sample(
          field,
          cols,
          rows,
          x / INK_FIELD - 0.5,
          y / INK_FIELD - 0.5,
        );
        let lit = 0;
        for (const [rx, ry, radius, band, amp] of rings) {
          const off = Math.hypot(x - rx, y - ry) - radius;
          if (Math.abs(off) < band * 2.5)
            lit = Math.max(lit, Math.exp(-((off / band) ** 2)) * amp);
        }
        if (orb) {
          const d = Math.hypot(x - orb[0], y - orb[1]);
          if (d < orb[2])
            lit = Math.max(lit, Math.sqrt(1 - d / orb[2]) * orb[3]);
        }
        // Coverage stays sparse, so the halftone never fills in solid.
        let colour = 0;
        if (lit > tone && inked(col, row, lit * LIT_COVERAGE))
          colour = palette.lit[level(lit)];
        else if (inked(col, row, tone * INK_COVERAGE))
          colour = palette.ink[level(tone)];
        if (colour) {
          pixels[row * gridCols + col] = colour;
          count++;
        }
      }
    }
    return count;
  }
}
