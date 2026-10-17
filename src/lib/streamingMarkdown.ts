import remend from "remend";
import { detectTextDirection, parseMarkdownIntoBlocks } from "streamdown";

/**
 * Streamdown repairs the whole message with `remend` and splits all of it into
 * blocks on every update. For a long streamed reply that is most of the work:
 * `remend`'s link check rescans the text from the start for every `[`, so its
 * cost grows with the square of the reply's length, and its bold check scans
 * the text twice copying a substring at every character. This module produces
 * the same repaired text and the same blocks with work that grows with the
 * length of the reply (repair) or of its last few blocks (splitting).
 */

const INCOMPLETE_LINK = "](streamdown:incomplete-link)";

/** remend's handlers that run before its link handler (priorities 0–15). */
const BEFORE_LINKS = {
  links: false,
  images: false,
  boldItalic: false,
  bold: false,
  italic: false,
  inlineCode: false,
  strikethrough: false,
  katex: false,
} as const;

/**
 * remend's handlers that run after its link handler (priorities 30–70), with
 * its bold handler (35) replaced by the single-pass one below.
 */
const AFTER_LINKS = {
  singleTilde: false,
  comparisonOperators: false,
  htmlTags: false,
  setextHeadings: false,
  links: false,
  images: false,
  bold: false,
  handlers: [{ name: "bold", handle: completeStreamingBold, priority: 35 }],
};

const BACKSLASH = 92;
const BACKTICK = 96;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const BANG = 33;
const ASTERISK = 42;
const NEWLINE = 10;

/**
 * remend's "inside code" answer for every offset at once: `inside[i]` is what
 * its scanner reports for position `i` (an open inline span or fence before
 * it). Escaped backticks and ``` runs are read exactly as remend reads them.
 */
function codeBefore(text: string): Uint8Array {
  const length = text.length;
  const inside = new Uint8Array(length + 1);
  let inline = false;
  let fence = false;
  let filled = 0;
  for (let index = 0; index < length; index += 1) {
    if (inline || fence) inside.fill(1, filled, index + 1);
    filled = index + 1;
    const code = text.charCodeAt(index);
    if (
      code === BACKSLASH &&
      index + 1 < length &&
      text.charCodeAt(index + 1) === BACKTICK
    ) {
      index += 1;
      continue;
    }
    if (
      code === BACKTICK &&
      text.charCodeAt(index + 1) === BACKTICK &&
      text.charCodeAt(index + 2) === BACKTICK
    ) {
      fence = !fence;
      index += 2;
      continue;
    }
    if (!fence && code === BACKTICK) inline = !inline;
  }
  if (inline || fence) inside.fill(1, filled, length + 1);
  return inside;
}

/** remend's handling of `[text](url` with no closing parenthesis yet. */
function completeLinkUrl(
  text: string,
  closeAt: number,
  inCode: Uint8Array,
): string | null {
  if (text.indexOf(")", closeAt + 2) !== -1) return null;
  let depth = 1;
  let openAt = -1;
  for (let index = closeAt - 1; index >= 0; index -= 1) {
    const code = text.charCodeAt(index);
    if (code === CLOSE_BRACKET) depth += 1;
    else if (code === OPEN_BRACKET && --depth === 0) {
      openAt = index;
      break;
    }
  }
  if (openAt === -1 || inCode[openAt]) return null;
  const image = openAt > 0 && text.charCodeAt(openAt - 1) === BANG;
  const before = text.substring(0, image ? openAt - 1 : openAt);
  if (image) return before;
  return `${before}[${text.substring(openAt + 1, closeAt)}${INCOMPLETE_LINK}`;
}

/**
 * Exactly remend's link and image handler in its default "protocol" mode,
 * in one pass instead of one pass per `[`. An unfinished link gets a
 * placeholder URL; an unfinished image is cut off until it is complete.
 */
export function completeStreamingLinks(text: string): string {
  if (!text.includes("[")) return text;
  const inCode = codeBefore(text);
  const closeAt = text.lastIndexOf("](");
  if (closeAt !== -1 && !inCode[closeAt]) {
    const completed = completeLinkUrl(text, closeAt, inCode);
    if (completed !== null) return completed;
  }
  // A `[` is unfinished when no `]` after it closes it, counting nesting.
  const open: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === OPEN_BRACKET) open.push(index);
    else if (code === CLOSE_BRACKET && open.length > 0) open.pop();
  }
  for (let item = open.length - 1; item >= 0; item -= 1) {
    const at = open[item];
    if (inCode[at]) continue;
    if (at > 0 && text.charCodeAt(at - 1) === BANG)
      return text.substring(0, at - 1);
    return `${text}${INCOMPLETE_LINK}`;
  }
  return text;
}

/** True when remend's scanner is inside inline code or a fence before `at`. */
function insideCode(text: string, at: number): boolean {
  let inline = false;
  let fence = false;
  for (let index = 0; index < at; index += 1) {
    const code = text.charCodeAt(index);
    if (
      code === BACKSLASH &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) === BACKTICK
    ) {
      index += 1;
      continue;
    }
    if (
      code === BACKTICK &&
      text.charCodeAt(index + 1) === BACKTICK &&
      text.charCodeAt(index + 2) === BACKTICK
    ) {
      fence = !fence;
      index += 2;
      continue;
    }
    if (!fence && code === BACKTICK) inline = !inline;
  }
  return inline || fence;
}

/** True when `at` falls strictly inside a closed inline code span. */
function insideInlineCode(text: string, at: number): boolean {
  let open = false;
  let fence = false;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      code === BACKSLASH &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) === BACKTICK
    ) {
      index += 1;
      continue;
    }
    if (
      code === BACKTICK &&
      text.charCodeAt(index + 1) === BACKTICK &&
      text.charCodeAt(index + 2) === BACKTICK
    ) {
      fence = !fence;
      index += 2;
      continue;
    }
    if (fence || code !== BACKTICK) continue;
    if (open) {
      if (start < at && at < index) return true;
      open = false;
      start = -1;
    } else {
      open = true;
      start = index;
    }
  }
  return false;
}

/** remend's count of `**` pairs outside fences. */
function boldMarkers(text: string): number {
  let count = 0;
  let fence = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      code === BACKTICK &&
      index + 2 < text.length &&
      text.charCodeAt(index + 1) === BACKTICK &&
      text.charCodeAt(index + 2) === BACKTICK
    ) {
      fence = !fence;
      index += 2;
      continue;
    }
    if (
      !fence &&
      code === ASTERISK &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) === ASTERISK
    ) {
      count += 1;
      index += 1;
    }
  }
  return count;
}

/** True when the line holding `at` is a thematic break of `mark`s. */
function thematicBreakAt(text: string, at: number, mark: string): boolean {
  let start = 0;
  for (let index = at - 1; index >= 0; index -= 1)
    if (text.charCodeAt(index) === NEWLINE) {
      start = index + 1;
      break;
    }
  let end = text.length;
  for (let index = at; index < text.length; index += 1)
    if (text.charCodeAt(index) === NEWLINE) {
      end = index;
      break;
    }
  let marks = 0;
  for (const character of text.substring(start, end)) {
    if (character === mark) marks += 1;
    else if (character !== " " && character !== "\t") return false;
  }
  return marks >= 3;
}

const BOLD_AT_END = /(\*\*)([^*]*\*?)$/;
const ONLY_MARKERS = /^[\s_~*`]*$/;
const LIST_MARKER = /^[\s]*[-*+][\s]+$/;

/**
 * Exactly remend's bold handler: close a `**` the end of the text left open.
 * remend asks whether the marker is in code by scanning from the start twice,
 * copying a three-character substring at every position; these scans read
 * character codes instead.
 */
export function completeStreamingBold(text: string): string {
  const match = BOLD_AT_END.exec(text);
  if (!match) return text;
  const after = match[2];
  const at = text.lastIndexOf("**");
  if (insideCode(text, at) || insideInlineCode(text, at)) return text;
  if (!after || ONLY_MARKERS.test(after)) return text;
  const lineStart = at > 0 ? text.lastIndexOf("\n", at - 1) + 1 : 0;
  if (LIST_MARKER.test(text.substring(lineStart, at)) && after.includes("\n"))
    return text;
  if (thematicBreakAt(text, at, "*")) return text;
  if (boldMarkers(text) % 2 !== 1) return text;
  return after.endsWith("*") ? `${text}*` : `${text}**`;
}

/**
 * The text Streamdown renders for `markdown`: identical to `remend(markdown)`
 * with its default options. remend runs in three steps so its link handler,
 * the part whose cost grew with the square of the length, can be replaced by
 * the single pass above.
 */
export function completeStreamingMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  const linked = completeStreamingLinks(remend(markdown, BEFORE_LINKS));
  // remend stops after its link handler once it has added a placeholder.
  if (linked.endsWith(INCOMPLETE_LINK)) return linked;
  // remend drops one trailing space before its first handler. Each step does
  // that again, so a cut-off image that leaves one space behind takes the
  // original path to keep that space.
  if (linked.endsWith(" ") && !linked.endsWith("  ")) return remend(markdown);
  return remend(linked, AFTER_LINKS);
}

/** Streamdown's own check for a code fence still open in a block. */
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;

export function hasIncompleteCodeFence(block: string): boolean {
  let marker: string | null = null;
  let length = 0;
  for (const line of block.split("\n")) {
    const match = FENCE_LINE.exec(line);
    if (!match) continue;
    const fence = match[1];
    if (marker === null) {
      marker = fence[0];
      length = fence.length;
    } else if (fence[0] === marker && fence.length >= length) {
      marker = null;
      length = 0;
    }
  }
  return marker !== null;
}

const COMPARISON_IMAGE_BLOCK =
  /^!\[\s*(before|after)\b[^\]\n]*\]\((?:<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)$/i;

function comparisonImage(block: string): "before" | "after" | undefined {
  if (!block.includes("![")) return undefined;
  const kind = COMPARISON_IMAGE_BLOCK.exec(block.trim())?.[1]?.toLowerCase();
  return kind === "before" || kind === "after" ? kind : undefined;
}

/** Streamdown renders blocks separately; keep a Before/After image pair in one. */
export function mergeComparisonImages(blocks: readonly string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    let next = index + 1;
    while (next < blocks.length && !blocks[next].trim()) next++;
    if (
      comparisonImage(block) === "before" &&
      next < blocks.length &&
      comparisonImage(blocks[next]) === "after"
    ) {
      merged.push(`${block.trim()}\n${blocks[next].trim()}`);
      index = next;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

/**
 * Streamdown's splitter treats the whole message as one block when it holds
 * a footnote. A reference definition is registered for the whole message
 * (a repeated one is dropped), so splitting only the end could keep one the
 * whole message would not. Either way, split everything.
 */
const FOOTNOTE = /\[\^[\w-]{1,200}\]/;
const REFERENCE_DEFINITION =
  /(?:^|\n)[ \t>]*(?:(?:[*+-]|\d{1,9}[.)])[ \t]+)*\[[^\]]*\]:/;

/** Blocks re-split on each update: the open block and two before it. */
const LIVE_BLOCKS = 3;

type SplitState = {
  markdown: string;
  blocks: string[];
  /** Offset just after each block; blocks tile the text exactly. */
  ends: number[];
};

function commonPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a.charCodeAt(index) === b.charCodeAt(index))
    index += 1;
  return index;
}

function blockEnds(blocks: readonly string[]): number[] {
  let offset = 0;
  return blocks.map((block) => (offset += block.length));
}

/**
 * Re-split only the end of `markdown`, reusing blocks from the previous text.
 * A finished block is kept when the text through the block after it is
 * unchanged, so whatever decided where it ends is still there. Returns
 * undefined when everything has to be split again.
 */
function splitEnd(
  previous: SplitState,
  markdown: string,
  split: (markdown: string) => string[],
): string[] | undefined {
  const count = previous.blocks.length;
  if (count <= LIVE_BLOCKS) return undefined;
  if (FOOTNOTE.test(markdown) || REFERENCE_DEFINITION.test(markdown))
    return undefined;
  let keep = count - LIVE_BLOCKS;
  const unchangedThrough = previous.ends[count - 2];
  if (
    markdown.length < unchangedThrough ||
    !markdown.startsWith(previous.markdown.slice(0, unchangedThrough))
  ) {
    // Earlier text changed: keep only blocks followed by two unchanged ones.
    const common = commonPrefixLength(markdown, previous.markdown);
    let unchanged = 0;
    while (unchanged < count && previous.ends[unchanged] <= common)
      unchanged += 1;
    keep = Math.min(keep, unchanged - 2);
  }
  if (keep <= 0) return undefined;
  const offset = previous.ends[keep - 1];
  const tail = split(markdown.slice(offset));
  // A lone newline would have joined the block before it.
  if (tail[0] === "\n") return undefined;
  let length = 0;
  for (const block of tail) length += block.length;
  if (length !== markdown.length - offset) return undefined;
  return previous.blocks.slice(0, keep).concat(tail);
}

export type TextDirection = "ltr" | "rtl";

export type StreamingBlocks = {
  blocks: string[];
  directions: TextDirection[];
};

export type StreamingBlockOptions = {
  /** Reuse finished blocks from the previous text. Off for a final render. */
  streaming: boolean;
  /** Keep Before/After image pairs in one block (not for Inbox content). */
  comparisons: boolean;
};

/**
 * Splits successive versions of one message into Streamdown's blocks. While
 * streaming, finished blocks are reused and only the end is split again; a
 * final render splits everything. Each block's direction is worked out once.
 */
export function createStreamingBlockSplitter(
  split: (markdown: string) => string[] = parseMarkdownIntoBlocks,
) {
  let previous: SplitState | null = null;
  let lastBlocks: readonly string[] = [];
  let lastDirections: readonly TextDirection[] = [];
  return (
    markdown: string,
    options: StreamingBlockOptions,
  ): StreamingBlocks => {
    const reused =
      options.streaming && previous
        ? splitEnd(previous, markdown, split)
        : undefined;
    const base = reused ?? split(markdown);
    // Only text that the blocks tile exactly can be split again from a block.
    // A finished message keeps nothing for a next update.
    const ends = options.streaming ? blockEnds(base) : [];
    previous =
      options.streaming && (ends.at(-1) ?? 0) === markdown.length
        ? { markdown, blocks: base, ends }
        : null;
    const blocks = options.comparisons ? mergeComparisonImages(base) : base;
    const directions = blocks.map((block, index) =>
      lastBlocks[index] === block
        ? lastDirections[index]
        : (detectTextDirection(block) as TextDirection),
    );
    lastBlocks = blocks;
    lastDirections = directions;
    return { blocks, directions };
  };
}
