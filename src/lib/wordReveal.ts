import type { Element, ElementContent, Root, Text } from "hast";

// Streamed words fade in one after another, after Rune's streaming reveal
// (github.com/anomalyco/rune, crates/rune/README.md "Stream edges", MIT,
// © 2026 Anomaly): 180 ms each, 20 ms apart, the gap shrinking to 5.5 ms as
// words pile up so a fast stream never falls behind. Only words still
// fading in are elements of their own; the rest are plain text.

/** How long one word takes to fade in (ms). */
export const WORD_FADE_MS = 180;
export const WORD_STAGGER_MAX_MS = 20;
export const WORD_STAGGER_MIN_MS = 5.5;
/** A backlog is spread over about this long, within the limits above (ms). */
const BACKLOG_SPREAD_MS = 220;
/**
 * No word waits longer than this to start (ms): a stream faster than the
 * stagger brings words in together rather than queueing them up.
 */
export const WORD_MAX_LAG_MS = 120;

/** Elements whose text is not split into words. */
const WHOLE = new Set(["code", "svg", "math", "annotation", "img"]);
/** Elements left alone, text and all. */
const SKIP = new Set(["pre", "script", "style"]);

/** The gap between words when `backlog` words are waiting to fade in. */
export function wordStagger(backlog: number): number {
  if (backlog <= 0) return WORD_STAGGER_MAX_MS;
  return Math.min(
    WORD_STAGGER_MAX_MS,
    Math.max(WORD_STAGGER_MIN_MS, BACKLOG_SPREAD_MS / backlog),
  );
}

type BlockWords = {
  /** When each word of the block starts fading in (ms, `performance.now`). */
  starts: number[];
  /** The delay each word was first drawn with, kept so a redraw matches. */
  delays: string[];
};

/**
 * One streamed message's reveal schedule: when each word of each block
 * fades in. Words already there when it starts showing (a chat opened while
 * its agent writes) appear at once.
 */
export class WordReveal {
  private blocks = new Map<number, BlockWords>();
  private lastStart = Number.NEGATIVE_INFINITY;
  private lastStagger = WORD_STAGGER_MAX_MS;
  private primed: boolean;

  /** `fromStart`: animate the first words too, as a new reply does. */
  constructor(fromStart: boolean) {
    this.primed = fromStart;
  }

  /** Whether block `index` has been drawn with this schedule. */
  knows(index: number): boolean {
    return this.blocks.has(index);
  }

  /**
   * Before the first draw of a message that was already on screen: its
   * blocks other than the last are there already and stay plain text.
   */
  adopt(blockCount: number) {
    if (this.primed || this.blocks.size > 0) return;
    for (let index = 0; index < blockCount - 1; index += 1)
      this.blocks.set(index, { starts: [], delays: [] });
  }

  /** Whether block `index` still has a word fading in at `now`. */
  pending(index: number, now: number): boolean {
    const words = this.blocks.get(index);
    const last = words?.starts.at(-1);
    return last != null && now < last + WORD_FADE_MS;
  }

  /** When the last scheduled word has finished fading in. */
  get settlesAt(): number {
    return this.lastStart + WORD_FADE_MS;
  }

  /**
   * Splits block `index`'s text into word spans. New words get a start in
   * the schedule; words seen before keep theirs, and once a word has faded
   * in its span carries no animation, so redrawing it never replays one.
   */
  revealBlock(tree: Root, index: number, now: number) {
    let words = this.blocks.get(index);
    if (!words) {
      words = { starts: [], delays: [] };
      this.blocks.set(index, words);
    }
    const found = countWords(tree);
    // Shown at once: the words already there before this message showed.
    if (!this.primed) {
      while (words.starts.length < found) {
        words.starts.push(Number.NEGATIVE_INFINITY);
        words.delays.push("");
      }
    } else if (found > words.starts.length) {
      const waiting = Math.max(
        0,
        Math.round((this.lastStart - now) / this.lastStagger),
      );
      const stagger = wordStagger(waiting + found - words.starts.length);
      this.lastStagger = stagger;
      let start = Math.max(now, this.lastStart + stagger);
      while (words.starts.length < found) {
        start = Math.min(start, now + WORD_MAX_LAG_MS);
        words.starts.push(start);
        words.delays.push(`${Math.round(start - now)}ms`);
        this.lastStart = start;
        start += stagger;
      }
    }
    this.primed = true;
    let word = 0;
    // Words starting in the same frame fade as one element: the screen can't
    // tell them apart, and fewer fading elements cost less to draw. A group
    // is named after its first word: the markdown renderer keys elements by
    // tag, so each keeps its element (and its running fade) while the words
    // before it settle back into plain text.
    const place = (): Placement => {
      const at = word;
      word += 1;
      const start = words.starts[at] ?? Number.NEGATIVE_INFINITY;
      if (!Number.isFinite(start)) return null;
      const frame = Math.floor(start / FRAME_MS);
      if (now >= (frame + 1) * FRAME_MS + WORD_FADE_MS) return null;
      return {
        frame,
        tag: `${WORD_TAG}${at}`,
        delay: words.delays[at] || "0ms",
      };
    };
    splitWords(tree, place);
  }
}

/** Where a word fades in, or null for one already in. */
type Placement = { frame: number; tag: string; delay: string } | null;

/** Words whose fades start within one frame of this share an element. */
const FRAME_MS = 1000 / 60;

/** Fading words are `<aven-w0>`, `<aven-w1>`…: inline, with no style. */
export const WORD_TAG = "aven-w";

/** The words `revealBlock` would find in `tree`. */
export function countWords(tree: Root): number {
  let count = 0;
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type === "text") count += wordsIn(child.value).words;
      else if (child.type === "element") {
        if (SKIP.has(child.tagName)) continue;
        if (WHOLE.has(child.tagName)) count += 1;
        else visit(child);
      }
    }
  };
  visit(tree);
  return count;
}

function splitWords(node: Root | Element, place: () => Placement) {
  const out: ElementContent[] = [];
  let changed = false;
  let plain = "";
  let open: { frame: number; text: Text } | null = null;
  let gap = "";
  const close = () => {
    plain += gap;
    gap = "";
    open = null;
  };
  const flush = () => {
    close();
    if (plain) out.push({ type: "text", value: plain });
    plain = "";
  };
  const element = (at: NonNullable<Placement>, children: ElementContent[]) =>
    ({
      type: "element",
      tagName: at.tag,
      properties: { dataReveal: "", style: `--reveal-delay:${at.delay}` },
      children,
    }) satisfies Element;
  for (const child of node.children as ElementContent[]) {
    if (child.type === "text") {
      for (const part of wordsIn(child.value).parts) {
        if (!part.word) {
          if (open) gap += part.text;
          else plain += part.text;
          continue;
        }
        const at = place();
        if (!at) {
          close();
          plain += part.text;
          continue;
        }
        if (open && open.frame === at.frame) {
          open.text.value += gap + part.text;
          gap = "";
          continue;
        }
        close();
        if (plain) out.push({ type: "text", value: plain });
        plain = "";
        const text: Text = { type: "text", value: part.text };
        out.push(element(at, [text]));
        open = { frame: at.frame, text };
        changed = true;
      }
      continue;
    }
    flush();
    if (child.type === "element") {
      if (SKIP.has(child.tagName)) {
        out.push(child);
        continue;
      }
      if (WHOLE.has(child.tagName)) {
        const at = place();
        if (at) changed = true;
        out.push(at ? element(at, [child]) : child);
        continue;
      }
      splitWords(child, place);
    }
    out.push(child);
  }
  flush();
  if (changed) node.children = out as typeof node.children;
}

function wordsIn(value: string): {
  words: number;
  parts: { text: string; word: boolean }[];
} {
  const parts: { text: string; word: boolean }[] = [];
  let words = 0;
  for (const match of value.matchAll(/\s+|[^\s]+/g)) {
    const word = !/^\s/.test(match[0]);
    if (word) words += 1;
    parts.push({ text: match[0], word });
  }
  return { words, parts };
}

type BlockReveal = { reveal: WordReveal; index: number };

/**
 * Which schedule a block's text belongs to, by the text: the plugin below
 * reads it. Streamdown keeps one processor per plugin list and options, so
 * every block shares one and finds its own schedule here.
 */
const blockReveals = new Map<string, BlockReveal>();

/** Marks `content` as block `index` of `reveal` until the returned call. */
export function revealContent(
  content: string,
  reveal: WordReveal,
  index: number,
): () => void {
  const entry = { reveal, index };
  blockReveals.set(content, entry);
  return () => {
    if (blockReveals.get(content) === entry) blockReveals.delete(content);
  };
}

/** One options object for every block, so they share one processor. */
export const REVEAL_OPTIONS = { toJSON: () => "reveal" };

/**
 * A rehype plugin that splits a block's words into spans that fade in on its
 * message's schedule, for blocks marked with `revealContent`.
 */
export function rehypeRevealWords() {
  return (tree: Root, file: { value?: unknown }) => {
    const entry = blockReveals.get(String(file.value ?? ""));
    if (entry) entry.reveal.revealBlock(tree, entry.index, performance.now());
  };
}
