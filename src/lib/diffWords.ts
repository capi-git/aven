import type { UnifiedLine } from "./unifiedDiff";

// Word changes inside a changed line, after Rune's diff view
// (github.com/anomalyco/rune, crates/rune-kit/src/diff/myers.rs, MIT,
// © 2026 Anomaly): a removed line and the added line that replaces it are
// split into words, runs of spaces and single other characters, and the words
// that differ are marked. Lines that share too little get no marks, since
// marking nearly everything says less than the line's own colour.

/** A `[start, end)` range of a line's text, in string indices. */
export type TextRange = readonly [start: number, end: number];

export type WordChanges = { old: TextRange[]; new: TextRange[] };

/** Past this length a line is drawn without word marks. */
const MAX_LINE = 1000;
/** Pairs past this many in one run of replaced lines get no word marks. */
const MAX_PAIRS = 128;
/** A pair whose word edit needs more steps than this gets no marks. */
const MAX_EDITS = 256;

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^]/gu;

/**
 * The ranges of `oldText` and `newText` that differ by words, or `null` when
 * the lines are the same, too long, or share less than a quarter of their
 * words (then the whole line is the change).
 */
export function wordChanges(
  oldText: string,
  newText: string,
): WordChanges | null {
  if (oldText === newText) return null;
  if (oldText.length > MAX_LINE || newText.length > MAX_LINE) return null;
  const a = tokens(oldText);
  const b = tokens(newText);
  const flags = changedFlags(
    a.map((token) => token.text),
    b.map((token) => token.text),
  );
  if (!flags) return null;
  let shared = 0;
  for (let index = 0; index < a.length; index += 1) {
    const token = a[index];
    if (!flags[0][index] && token.text.trim()) shared += token.text.length;
  }
  if (shared * 4 < Math.max(content(oldText), content(newText))) return null;
  const old = join(oldText, runs(a, flags[0]));
  const next = join(newText, runs(b, flags[1]));
  if (old.length === 0 && next.length === 0) return null;
  return { old, new: next };
}

/**
 * Each removed line paired with the added line that replaces it: within a run
 * of removed lines followed by added ones, the first with the first, and so on.
 */
export function wordPartners(
  lines: readonly UnifiedLine[],
  partners = new Map<UnifiedLine, UnifiedLine>(),
): Map<UnifiedLine, UnifiedLine> {
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind !== "del") {
      index += 1;
      continue;
    }
    const del = index;
    while (index < lines.length && lines[index].kind === "del") index += 1;
    const add = index;
    while (index < lines.length && lines[index].kind === "add") index += 1;
    const pairs = Math.min(add - del, index - add);
    if (pairs === 0 || pairs > MAX_PAIRS) continue;
    for (let offset = 0; offset < pairs; offset += 1) {
      const removed = lines[del + offset];
      const added = lines[add + offset];
      partners.set(removed, added);
      partners.set(added, removed);
    }
  }
  return partners;
}

const cache = new WeakMap<UnifiedLine, TextRange[] | null>();

/**
 * The word changes to mark on `line`, given its partner from `wordPartners`.
 * Worked out the first time either line is drawn and kept with the lines, so
 * only the lines on screen pay for it.
 */
export function lineWordChanges(
  line: UnifiedLine,
  partner: UnifiedLine | undefined,
): TextRange[] | null {
  if (!partner || (line.kind !== "add" && line.kind !== "del")) return null;
  const known = cache.get(line);
  if (known !== undefined) return known;
  const removed = line.kind === "del" ? line : partner;
  const added = line.kind === "del" ? partner : line;
  const changes = wordChanges(removed.text, added.text);
  cache.set(removed, changes?.old ?? null);
  cache.set(added, changes?.new ?? null);
  return cache.get(line) ?? null;
}

export type MarkedPiece = { text: string; color?: string; changed: boolean };

/** Syntax pieces of a line cut where word changes start and end. */
export function markPieces(
  pieces: readonly { text: string; color?: string }[],
  ranges: readonly TextRange[],
): MarkedPiece[] {
  if (ranges.length === 0) {
    return pieces.map((piece) => ({ ...piece, changed: false }));
  }
  const out: MarkedPiece[] = [];
  let at = 0;
  let range = 0;
  for (const piece of pieces) {
    const end = at + piece.text.length;
    let cursor = at;
    while (cursor < end) {
      while (range < ranges.length && ranges[range][1] <= cursor) range += 1;
      const next = ranges[range];
      let stop = end;
      let changed = false;
      if (next && next[0] <= cursor) {
        changed = true;
        stop = Math.min(end, next[1]);
      } else if (next && next[0] < end) {
        stop = next[0];
      }
      push(out, piece.text.slice(cursor - at, stop - at), piece.color, changed);
      cursor = stop;
    }
    at = end;
  }
  return out;
}

function push(
  out: MarkedPiece[],
  text: string,
  color: string | undefined,
  changed: boolean,
) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.color === color && last.changed === changed) {
    last.text += text;
    return;
  }
  out.push(color ? { text, color, changed } : { text, changed });
}

type Token = { text: string; start: number; end: number };

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    out.push({ text: match[0], start, end: start + match[0].length });
  }
  return out;
}

function content(text: string): number {
  let count = 0;
  for (const char of text) if (!/\s/u.test(char)) count += 1;
  return Math.max(1, count);
}

function runs(list: readonly Token[], changed: readonly boolean[]) {
  const out: [number, number][] = [];
  for (let index = 0; index < list.length; index += 1) {
    if (!changed[index]) continue;
    const token = list[index];
    const last = out[out.length - 1];
    if (last && last[1] === token.start) last[1] = token.end;
    else out.push([token.start, token.end]);
  }
  return out;
}

/** Changes split only by spaces read as one. */
function join(text: string, ranges: [number, number][]): TextRange[] {
  const out: [number, number][] = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    if (last && !text.slice(last[1], range[0]).trim()) last[1] = range[1];
    else out.push([range[0], range[1]]);
  }
  return out;
}

/**
 * Which items of `a` were removed and which of `b` were added, by Myers'
 * O(ND) difference algorithm, or `null` past `MAX_EDITS` steps.
 */
export function changedFlags<T>(
  a: readonly T[],
  b: readonly T[],
  maxEdits = MAX_EDITS,
): [boolean[], boolean[]] | null {
  const removed = new Array<boolean>(a.length).fill(false);
  const added = new Array<boolean>(b.length).fill(false);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) {
    for (let index = start; index < endA; index += 1) removed[index] = true;
    for (let index = start; index < endB; index += 1) added[index] = true;
    return [removed, added];
  }
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] keeps diagonals -d..d of the furthest x reached after d - 1 steps.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxEdits); d += 1) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const before = trace[d];
    const at = (k: number) => before[k + d];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    if (down) added[start + previousY] = true;
    else removed[start + previousX] = true;
    x = previousX;
    y = previousY;
  }
  return [removed, added];
}
