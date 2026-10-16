/**
 * The memory keeper's part of a project memory. It lives in one delimited
 * block of plain Markdown sections, so the memory stays one readable text:
 *
 *   <!-- aven:auto — kept up to date by Aven. Edit a line here and it becomes yours. -->
 *   ## Stack
 *   - …
 *   <!-- /aven:auto -->
 *
 * Everything outside the block belongs to the user and is never changed.
 * Inside it, a line the keeper did not write (the user edited or added it)
 * is moved out of the block on the keeper's next pass, so it becomes the
 * user's, and a line the user deleted is not written again.
 */

export const KEEPER_SECTIONS = [
  "Stack",
  "How to run",
  "Conventions",
  "In progress",
  "Decisions",
  "Gotchas",
] as const;
export type KeeperSection = (typeof KEEPER_SECTIONS)[number];
export type KeeperSections = Partial<Record<KeeperSection, string[]>>;

/** What a first fill (and Refresh now) writes. */
export const FILL_SECTIONS: readonly KeeperSection[] = KEEPER_SECTIONS;
/** What a routine update may change; Stack and Conventions wait for a refresh. */
export const UPDATE_SECTIONS: readonly KeeperSection[] = [
  "How to run",
  "In progress",
  "Decisions",
  "Gotchas",
];

export const AUTO_START =
  "<!-- aven:auto — kept up to date by Aven. Edit a line here and it becomes yours. -->";
export const AUTO_END = "<!-- /aven:auto -->";
const START = /^\s*<!--\s*aven:auto\b.*-->\s*$/;
const END = /^\s*<!--\s*\/aven:auto\s*-->\s*$/;

/** The keeper's block never takes more than this, so the user keeps room. */
export const KEEPER_MAX_CHARS = 4_000;
/** Room left for the user's own lines (Remember this) after the block. */
export const KEEPER_HEADROOM_CHARS = 800;
/** Below this the block would be too thin to be useful; the keeper waits. */
const KEEPER_MIN_CHARS = 300;
export const KEEPER_ITEMS_PER_SECTION = 8;
export const KEEPER_ITEM_MAX_CHARS = 240;

export function isKeeperMarker(line: string): boolean {
  return START.test(line) || END.test(line);
}

/** The memory as agents should read it: the keeper's markers removed. */
export function withoutKeeperMarkers(body: string): string {
  if (!body.includes("aven:auto")) return body;
  return body
    .split("\n")
    .filter((line) => !isKeeperMarker(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export type MemoryParts = {
  /** The user's text before the keeper's block. */
  before: string;
  /** The block's inner text; null when the memory has no block. */
  auto: string | null;
  /** The user's text after the block. */
  after: string;
};

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

const SECTION_ALIASES: Record<string, KeeperSection> = {
  stack: "Stack",
  "tech stack": "Stack",
  "how to run": "How to run",
  "how to run it": "How to run",
  running: "How to run",
  commands: "How to run",
  conventions: "Conventions",
  "in progress": "In progress",
  "work in progress": "In progress",
  decisions: "Decisions",
  gotchas: "Gotchas",
  pitfalls: "Gotchas",
};

export function keeperSectionNamed(name: string): KeeperSection | null {
  const key = name
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SECTION_ALIASES[key] ?? null;
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function joinParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Where the block ends when its end marker was deleted: after the last line
 * that still belongs to one of the keeper's sections.
 */
function implicitEnd(all: readonly string[], start: number): number {
  let inSection = false;
  for (let index = start + 1; index < all.length; index += 1) {
    const line = all[index];
    if (!line.trim()) continue;
    const heading = line.match(HEADING);
    if (heading) {
      if (!keeperSectionNamed(heading[1])) return index;
      inSection = true;
      continue;
    }
    if (inSection && (LIST_ITEM.test(line) || /^\s{2,}\S/.test(line))) continue;
    return index;
  }
  return all.length;
}

export function splitMemory(body: string): MemoryParts {
  const all = lines(body);
  const strip = (part: readonly string[]) =>
    part
      .filter((line) => !isKeeperMarker(line))
      .join("\n")
      .trim();
  const start = all.findIndex((line) => START.test(line));
  if (start < 0) return { before: strip(all), auto: null, after: "" };
  const end = all.findIndex((line, index) => index > start && END.test(line));
  const stop = end >= 0 ? end : implicitEnd(all, start);
  return {
    before: strip(all.slice(0, start)),
    auto: strip(all.slice(start + 1, stop)),
    after: strip(all.slice(end >= 0 ? end + 1 : stop)),
  };
}

/**
 * The keeper's sections in a block's text. Lines under no known section (a
 * heading the user added, text above the first heading) are `loose`.
 */
export function parseSections(text: string): {
  sections: KeeperSections;
  loose: string[];
} {
  const sections: KeeperSections = {};
  const loose: string[] = [];
  let current: KeeperSection | null = null;
  for (const line of lines(text)) {
    if (!line.trim()) continue;
    const heading = line.match(HEADING);
    if (heading) {
      current = keeperSectionNamed(heading[1]);
      if (current) sections[current] ??= [];
      else loose.push(line.trimEnd());
      continue;
    }
    if (current) sections[current]!.push(line.trimEnd());
    else loose.push(line.trimEnd());
  }
  return { sections, loose };
}

export function renderSections(sections: KeeperSections): string {
  return KEEPER_SECTIONS.flatMap((name) => {
    const items = sections[name] ?? [];
    return items.length ? [`## ${name}\n${items.join("\n")}`] : [];
  }).join("\n\n");
}

function renderBlock(inner: string): string {
  return inner.trim() ? `${AUTO_START}\n${inner.trim()}\n${AUTO_END}` : "";
}

/** A line's identity for comparisons: no bullet, case or spacing. */
export function lineKey(line: string): string {
  return line.trim().replace(LIST_ITEM, "").replace(/\s+/g, " ").toLowerCase();
}

function countKeys(items: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = lineKey(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function allItems(sections: KeeperSections): string[] {
  return KEEPER_SECTIONS.flatMap((name) => sections[name] ?? []);
}

/** The memory read for a keeper pass: whose each line is, and what was removed. */
export type MemoryAnalysis = {
  parts: MemoryParts;
  /** Lines in the block that the keeper wrote and that are unchanged. */
  kept: KeeperSections;
  /** Lines in the block the keeper did not write: the user's now. */
  claimed: string[];
  /** Lines the keeper wrote that the user has since deleted. */
  removed: string[];
  /** Everything that belongs to the user, as it will read after the pass. */
  userText: string;
};

/**
 * Compare the block with `baseline`, the block the keeper last wrote. With
 * no baseline (first pass, or Aven's own record was lost), every line in the
 * block counts as the keeper's.
 */
export function analyzeMemory(
  body: string,
  baseline: string | null,
): MemoryAnalysis {
  const parts = splitMemory(body);
  const current = parseSections(parts.auto ?? "");
  const kept: KeeperSections = {};
  const claimed = [...current.loose];
  let removed: string[] = [];
  if (baseline == null || parts.auto == null) {
    Object.assign(kept, current.sections);
  } else {
    const remaining = countKeys(allItems(parseSections(baseline).sections));
    for (const name of KEEPER_SECTIONS) {
      for (const line of current.sections[name] ?? []) {
        const key = lineKey(line);
        const left = remaining.get(key) ?? 0;
        if (left > 0) {
          remaining.set(key, left - 1);
          (kept[name] ??= []).push(line);
        } else if (key) {
          claimed.push(line);
        }
      }
    }
    removed = allItems(parseSections(baseline).sections).filter((line) => {
      const key = lineKey(line);
      const left = remaining.get(key) ?? 0;
      if (left <= 0) return false;
      remaining.set(key, left - 1);
      return true;
    });
  }
  return {
    parts,
    kept,
    claimed,
    removed,
    userText: joinParts([parts.before, claimed.join("\n"), parts.after]),
  };
}

/** How many characters the keeper's block may use beside the user's text. */
export function keeperBudget(userText: string, maxChars: number): number {
  const frame = AUTO_START.length + AUTO_END.length + 6;
  return Math.min(
    KEEPER_MAX_CHARS,
    maxChars - userText.length - KEEPER_HEADROOM_CHARS - frame,
  );
}

/** Drop items, longest section first, until the sections fit `budget`. */
export function fitSections(
  sections: KeeperSections,
  budget: number,
): KeeperSections {
  const next: KeeperSections = {};
  for (const name of KEEPER_SECTIONS)
    if (sections[name]?.length) next[name] = [...sections[name]!];
  while (renderSections(next).length > budget) {
    let longest: KeeperSection | null = null;
    for (const name of KEEPER_SECTIONS) {
      const count = next[name]?.length ?? 0;
      if (count && (!longest || count >= (next[longest]?.length ?? 0)))
        longest = name;
    }
    if (!longest) break;
    next[longest]!.pop();
    if (!next[longest]!.length) delete next[longest];
  }
  return next;
}

export type KeeperMerge = {
  body: string;
  /** The block's inner text as written: the next pass's baseline. */
  baseline: string;
  /** Lines moved out of the block because the user wrote them. */
  claimed: number;
};

/**
 * Apply the model's sections to the memory. Only `replace` sections take the
 * reply; the others keep the keeper's current lines. Lines the user deleted
 * or already has are left out. Null when the block cannot fit beside the
 * user's text.
 */
export function mergeKeeperReply(input: {
  analysis: MemoryAnalysis;
  reply: KeeperSections;
  replace: readonly KeeperSection[];
  maxChars: number;
}): KeeperMerge | null {
  const { analysis, reply, replace, maxChars } = input;
  const budget = keeperBudget(analysis.userText, maxChars);
  if (budget < KEEPER_MIN_CHARS) return null;
  const skip = countKeys([
    ...analysis.removed,
    ...lines(analysis.userText).filter((line) => !HEADING.test(line)),
  ]);
  const next: KeeperSections = {};
  for (const name of KEEPER_SECTIONS) {
    const source = replace.includes(name)
      ? (reply[name] ?? [])
      : (analysis.kept[name] ?? []);
    const seen = new Set<string>();
    const items = source.filter((line) => {
      const key = lineKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      // The user's own lines and deletions win over the reply, never over
      // what the keeper already keeps in a section it is not replacing.
      return !replace.includes(name) || !skip.has(key);
    });
    if (items.length) next[name] = items;
  }
  const fitted = fitSections(next, budget);
  const inner = renderSections(fitted);
  const { parts, claimed } = analysis;
  const block = renderBlock(inner);
  const body =
    parts.auto == null
      ? joinParts([block, parts.before])
      : joinParts([parts.before, block, claimed.join("\n"), parts.after]);
  return { body, baseline: inner, claimed: claimed.length };
}

/**
 * Put back the keeper's block from `previous`, keeping everything the user
 * has written since. Used for Undo when the memory changed after the update.
 */
export function restoreKeeperBlock(current: string, previous: string): string {
  const now = splitMemory(current);
  const then = splitMemory(previous);
  const block = renderBlock(then.auto ?? "");
  if (now.auto == null) return joinParts([block, now.before]);
  return joinParts([now.before, block, now.after]);
}

/** Lines added and removed between two versions, ignoring the markers. */
export function lineDiff(
  before: string,
  after: string,
): { added: number; removed: number } {
  const meaningful = (text: string) =>
    lines(text).filter((line) => line.trim() && !isKeeperMarker(line));
  const old = countKeys(meaningful(before));
  let added = 0;
  for (const line of meaningful(after)) {
    const key = lineKey(line);
    const left = old.get(key) ?? 0;
    if (left > 0) old.set(key, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of old.values()) removed += left;
  return { added, removed };
}

/** "+2 −1 lines" */
export function formatLineDiff(diff: { added: number; removed: number }) {
  const total = diff.added + diff.removed;
  if (!total) return "No changes";
  return `+${diff.added} −${diff.removed} ${total === 1 ? "line" : "lines"}`;
}
