import { clamp } from "./math";
import {
  loadProjectFiles,
  rankProjectFiles,
  type RankedFile,
} from "./fileIndex";
import { basename, type ProjectFile } from "./fs";
import { openFilesSnapshot, type OpenFilesSnapshot } from "./openFiles";
import { displayPath, isEqualOrInside, pathKey, prettyCwd } from "./paths";
import { isMarkdownBlockquotePosition } from "./quoteDraft";
import { looksLikeProject } from "./recents";

export type MentionToken = {
  start: number;
  end: number;
  query: string;
};

/**
 * A file `@` knows from an open tab or an earlier mention. One in the project
 * listing keeps its project entry; one outside it (another folder, or an
 * ignored or brand-new file) is `unlisted` and reaches the agent by its full
 * path.
 */
export type MentionFile = ProjectFile & {
  unlisted?: boolean;
  /** Open in a tab now: the picker offers it first. */
  open?: boolean;
};

/** What reading `@label`s needs: a map, or an index with open files on top. */
export type MentionLookup<V> = {
  get(key: string): V | undefined;
  readonly size: number;
};

/** `@label` → the file it points at, plus the label to write. */
export type MentionIndex = {
  /** Every writable label (basename when unique, always the relative path). */
  labels: MentionLookup<MentionFile>;
  /** Preferred label per file path — the shortest unambiguous one. */
  labelOf: MentionLookup<string>;
};

export type MentionHit = {
  start: number;
  end: number;
  label: string;
  file: MentionFile;
};

export type MentionTextPart = {
  text: string;
  file?: MentionFile;
};

const MENTION_TOKEN_RE = /(^|\s)@(\S+)/g;
const TRAILING_PUNCTUATION = new Set([
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  "]",
  "}",
  '"',
  "'",
  "/",
]);
const MAX_QUERY = 120;
const MAX_PICKER = 30;

/** Mention token that contains `cursor`, if the user is typing `@file`. */
export function mentionTokenAt(
  text: string,
  cursor: number,
): MentionToken | null {
  const i = clamp(cursor, 0, text.length);
  let start = i;
  while (start > 0 && !isSpace(text[start - 1]!)) start -= 1;
  if (text[start] !== "@") return null;
  if (isMarkdownBlockquotePosition(text, start)) return null;

  let end = start + 1;
  while (end < text.length && !isSpace(text[end]!)) end += 1;

  const typed = text.slice(start + 1, i);
  if (typed.includes("@") || typed.length > MAX_QUERY) return null;

  return { start, end, query: typed };
}

export function replaceMentionToken(
  text: string,
  token: MentionToken,
  label: string,
): string {
  const rest = text.slice(token.end);
  const spacer = rest.startsWith(" ") ? "" : " ";
  return `${text.slice(0, token.start)}@${label}${spacer}${rest}`;
}

/**
 * What `@` can offer for one file list, computed once per list: typing after
 * `@` re-ranks on every key, and a large project has tens of thousands.
 */
type Mentionable = {
  usable: ProjectFile[];
  ordered?: ProjectFile[];
  byPath?: Map<string, ProjectFile>;
};
const mentionables = new WeakMap<ProjectFile[], Mentionable>();

function mentionable(files: ProjectFile[]): Mentionable {
  let entry = mentionables.get(files);
  if (!entry) {
    entry = {
      usable: withMentionDirectories(files).filter((file) =>
        isMentionableRelative(file.relative),
      ),
    };
    mentionables.set(files, entry);
  }
  return entry;
}

export function buildMentionIndex(files: ProjectFile[]): {
  labels: Map<string, ProjectFile>;
  labelOf: Map<string, string>;
} {
  const entries = mentionable(files).usable;
  const counts = new Map<string, number>();
  for (const file of entries) {
    counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
  }

  const labels = new Map<string, ProjectFile>();
  const labelOf = new Map<string, string>();
  const used = new Set<string>();

  const claim = (label: string, file: ProjectFile, preferred = false) => {
    if (!isTokenSafe(label) || used.has(label)) return false;
    used.add(label);
    labels.set(label, file);
    if (preferred || !labelOf.has(file.path)) labelOf.set(file.path, label);
    return true;
  };

  for (const file of entries) {
    const unique =
      !file.isDir && counts.get(file.name) === 1 && isTokenSafe(file.name);
    if (unique) claim(file.name, file, true);
    if (isTokenSafe(file.relative)) claim(file.relative, file);
  }

  for (const file of entries) {
    if (labelOf.has(file.path)) continue;
    const encoded = encodeMentionToken(file.relative);
    if (!encoded) continue;
    let label = encoded;
    for (let n = 2; used.has(label) && n < 1000; n++) {
      label = `${encoded}~${n}`;
    }
    claim(label, file, true);
  }

  return { labels, labelOf };
}

export function mentionLabel(file: ProjectFile, index: MentionIndex): string {
  return index.labelOf.get(file.path) ?? file.relative;
}

/** Files the picker offers: recents first without a query, fuzzy after. */
export function rankMentionFiles(
  files: ProjectFile[],
  query: string,
  recents: string[],
  limit = MAX_PICKER,
): RankedFile[] {
  const entry = mentionable(files);
  const usable = entry.usable;
  const needle = query.replace(/\/+$/, "").trim();
  if (needle) return rankProjectFiles(usable, needle, recents, limit);

  const out: RankedFile[] = [];
  const seen = new Set<string>();
  if (recents.length > 0) {
    const byPath = (entry.byPath ??= new Map(
      usable.map((file) => [file.path, file]),
    ));
    for (const path of recents) {
      const file = byPath.get(path);
      if (!file || seen.has(path)) continue;
      seen.add(path);
      out.push({ ...file, score: 0, positions: [] });
      if (out.length >= limit) return out;
    }
  }

  const rest = (entry.ordered ??= shallowestFirst(usable));
  for (const file of rest) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push({ ...file, score: 0, positions: [] });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A stable `@` label per path for this run, for files `@` knows from tabs:
 * the name, with spaces as dashes, and `~2`… when another file has it. It
 * never changes while the app runs, so a draft means the same file when sent.
 */
const stableLabels = new Map<string, string>();
const stableOwners = new Set<string>();

export function stableMentionLabel(path: string): string | null {
  const key = pathKey(path);
  const known = stableLabels.get(key);
  if (known) return known;
  const name = basename(path);
  const base = isTokenSafe(name) ? name : encodeMentionToken(name);
  if (!base) return null;
  let label = base;
  for (let n = 2; stableOwners.has(label); n++) {
    if (n >= 1000) return null;
    label = `${base}~${n}`;
  }
  stableLabels.set(key, label);
  stableOwners.add(label);
  return label;
}

export function resetStableMentionLabels() {
  stableLabels.clear();
  stableOwners.clear();
}

const listedByKey = new WeakMap<ProjectFile[], Map<string, ProjectFile>>();

function listedFile(
  files: ProjectFile[],
  path: string,
): ProjectFile | undefined {
  let byKey = listedByKey.get(files);
  if (!byKey) {
    byKey = new Map();
    for (const file of files) {
      if (!file.isDir) byKey.set(pathKey(file.path), file);
    }
    listedByKey.set(files, byKey);
  }
  return byKey.get(pathKey(path));
}

/**
 * The files `@` knows from tabs, as mention entries for one project: its own
 * listing entry when listed, else an `unlisted` entry shown by its folder.
 */
export function mentionFilesFor(
  known: OpenFilesSnapshot,
  files: ProjectFile[],
  cwd: string,
): MentionFile[] {
  if (known.known.length === 0) return [];
  const open = new Set(known.open.map(pathKey));
  const project = looksLikeProject(cwd);
  const out: MentionFile[] = [];
  for (const path of known.known) {
    const isOpen = open.has(pathKey(path));
    const listed = listedFile(files, path);
    if (listed) {
      out.push(isOpen ? { ...listed, open: true } : listed);
      continue;
    }
    if (!stableMentionLabel(path)) continue;
    out.push({
      name: basename(path),
      path,
      // Shown and matched only; the agent is given `path`.
      relative:
        project && isEqualOrInside(path, cwd)
          ? displayPath(path, cwd)
          : prettyCwd(path),
      unlisted: true,
      ...(isOpen ? { open: true } : {}),
    });
  }
  return out;
}

/**
 * `index` with the files `@` knows from tabs on top. Each takes its stable
 * label where nothing in the project has it, so a label written before the
 * listing loaded still resolves; a project file keeps its own label first.
 */
export function withMentionExtras(
  index: MentionIndex,
  extras: MentionFile[],
): MentionIndex {
  if (extras.length === 0) return index;
  const labels = new Map<string, MentionFile>();
  const labelOf = new Map<string, string>();
  const taken = (label: string) =>
    labels.has(label) || index.labels.get(label) !== undefined;
  for (const file of extras) {
    const label = stableMentionLabel(file.path);
    if (!label) continue;
    const labelled = () =>
      index.labelOf.get(file.path) !== undefined || labelOf.has(file.path);
    if (!taken(label)) {
      labels.set(label, file);
      if (!labelled()) labelOf.set(file.path, label);
      continue;
    }
    if (labelled()) continue;
    for (let n = 2; n < 1000; n++) {
      const next = `${label}~${n}`;
      if (taken(next)) continue;
      labels.set(next, file);
      labelOf.set(file.path, next);
      break;
    }
  }
  return {
    labels: {
      get: (label) => index.labels.get(label) ?? labels.get(label),
      size: index.labels.size + labels.size,
    },
    labelOf: {
      get: (path) => index.labelOf.get(path) ?? labelOf.get(path),
      size: index.labelOf.size + labelOf.size,
    },
  };
}

/** Open files the picker offers before the project's: all, or the matches. */
export function rankOpenMentionFiles(
  files: MentionFile[],
  query: string,
  limit = MAX_PICKER,
): RankedFile[] {
  const open = files.filter((file) => file.open);
  const needle = query.replace(/\/+$/, "").trim();
  if (!needle)
    return open
      .slice(0, limit)
      .map((file) => ({ ...file, score: 0, positions: [] }));
  return rankProjectFiles(open, needle, [], limit);
}

/** Split composer text so known `@file` tokens can be highlighted. */
export function fileMentionParts(
  text: string,
  labels: MentionLookup<MentionFile>,
): MentionTextPart[] {
  if (!text) return [];
  const hits = scanMentions(text, labels);
  if (hits.length === 0) return [{ text }];

  const parts: MentionTextPart[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start) });
    parts.push({ text: text.slice(hit.start, hit.end), file: hit.file });
    cursor = hit.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export function fileMentionsInText(
  text: string,
  labels: MentionLookup<MentionFile>,
): MentionHit[] {
  const seen = new Set<string>();
  return scanMentions(text, labels).filter((hit) => {
    if (seen.has(hit.file.path)) return false;
    seen.add(hit.file.path);
    return true;
  });
}

/**
 * Spell out where each `@name` lives, so the harness does not have to guess
 * which `App.tsx` the user meant. Tokens already written as a project-relative
 * path need no help. A file outside the project listing, mentioned from its
 * tab, is given by its full path.
 */
export async function applyFileMentionsToTurn(
  text: string,
  cwd: string,
  known: OpenFilesSnapshot = openFilesSnapshot(),
): Promise<string> {
  if (!looksMentioned(text)) return text;
  const files = await loadProjectFiles(cwd).catch(() => []);
  const extras = mentionFilesFor(known, files, cwd);
  if (files.length === 0 && extras.length === 0) return text;

  const index = withMentionExtras(buildMentionIndex(files), extras);
  const lines = fileMentionsInText(text, index.labels)
    .filter((hit) => hit.file.unlisted || hit.label !== hit.file.relative)
    .map(
      (hit) =>
        `- @${hit.label} → ${hit.file.unlisted ? hit.file.path : hit.file.relative}`,
    );
  if (lines.length === 0) return text;

  return [text, "", "---", "Referenced with @ above:", ...lines].join("\n");
}

/** Parent folders of indexed files, so `@` can point at a directory. */
export function withMentionDirectories(files: ProjectFile[]): ProjectFile[] {
  const dirs = new Map<string, ProjectFile>();
  for (const file of files) {
    if (file.isDir) {
      if (isSafeProjectRelative(file.relative)) dirs.set(file.relative, file);
      continue;
    }
    if (!isSafeProjectRelative(file.relative)) continue;
    const parts = file.relative.split("/");
    let rel = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!;
      rel = rel ? `${rel}/${segment}` : segment;
      if (dirs.has(rel) || !isSafeProjectRelative(rel)) continue;
      dirs.set(rel, {
        name: segment,
        path: mentionDirPath(file, rel),
        relative: rel,
        isDir: true,
      });
    }
  }
  if (dirs.size === 0) return files;

  const seen = new Set(files.map((file) => file.path));
  const extra = [...dirs.values()].filter((dir) => !seen.has(dir.path));
  return extra.length === 0 ? files : [...files, ...extra];
}

function scanMentions(
  text: string,
  labels: MentionLookup<MentionFile>,
): MentionHit[] {
  if (labels.size === 0) return [];
  const hits: MentionHit[] = [];
  MENTION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_TOKEN_RE.exec(text))) {
    const raw = match[2];
    if (!raw) continue;
    const start = match.index + (match[1] ?? "").length;
    if (isMarkdownBlockquotePosition(text, start)) continue;
    const resolved = resolveLabel(raw, labels);
    if (!resolved) continue;
    hits.push({
      start,
      end: start + 1 + resolved.label.length,
      label: resolved.label,
      file: resolved.file,
    });
  }
  return hits;
}

/** `@App.tsx,` still points at `App.tsx` — peel trailing punctuation. */
function resolveLabel(
  raw: string,
  labels: MentionLookup<MentionFile>,
): { label: string; file: MentionFile } | null {
  let value = raw;
  while (value) {
    const file = labels.get(value);
    if (file) return { label: value, file };
    if (!TRAILING_PUNCTUATION.has(value[value.length - 1]!)) return null;
    value = value.slice(0, -1);
  }
  return null;
}

function looksMentioned(text: string): boolean {
  return /(^|\s)@\S/.test(text);
}

function mentionDirPath(file: ProjectFile, relativeDir: string): string {
  const trail = file.relative.slice(relativeDir.length);
  if (!trail) return file.path;
  if (file.path.endsWith(trail)) {
    return file.path.slice(0, file.path.length - trail.length);
  }
  const winTrail = trail.replace(/\//g, "\\");
  if (file.path.endsWith(winTrail)) {
    return file.path.slice(0, file.path.length - winTrail.length);
  }
  return file.path.slice(0, file.path.length - trail.length);
}

/** Same order as `localeCompare`, without its per-call setup. */
let pathCollator: Intl.Collator | undefined;

/**
 * Shallow paths first, folders before files at each depth, then by path.
 * Depth is measured once per file: a large project sorts tens of thousands.
 */
function shallowestFirst(files: ProjectFile[]): ProjectFile[] {
  const collator = (pathCollator ??= new Intl.Collator());
  return files
    .map((file) => ({ file, depth: pathDepth(file.relative) }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        Number(Boolean(b.file.isDir)) - Number(Boolean(a.file.isDir)) ||
        collator.compare(a.file.relative, b.file.relative),
    )
    .map((row) => row.file);
}

function pathDepth(relative: string): number {
  let depth = 0;
  for (const ch of relative) if (ch === "/") depth += 1;
  return depth;
}

/** Workspace-relative only: no absolute paths, `..`, or control / format characters. */
function isSafeProjectRelative(relative: string): boolean {
  if (!relative || relative.length > MAX_QUERY * 4) return false;
  if (hasUnsafeChars(relative)) return false;
  if (relative.startsWith("/") || relative.startsWith("\\")) return false;
  if (relative.includes("://")) return false;
  for (const part of relative.split("/")) {
    if (!part || part === "." || part === "..") return false;
  }
  return true;
}

/**
 * `@` tokens are one whitespace-delimited word. Collapse whitespace so a
 * spaced path still inserts as a normal `@label`; the real relative path is
 * recovered from the mention index on send.
 */
function encodeMentionToken(relative: string): string | null {
  const encoded = relative.replace(/\s+/g, "-");
  return isTokenSafe(encoded) ? encoded : null;
}

function isTokenSafe(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_QUERY &&
    !/[\s@\\]/.test(value) &&
    !hasUnsafeChars(value)
  );
}

/** ASCII/C1 controls, bidi/format marks, and Unicode line/paragraph separators. */
function hasUnsafeChars(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function isMentionableRelative(relative: string): boolean {
  if (!isSafeProjectRelative(relative)) return false;
  return isTokenSafe(relative) || encodeMentionToken(relative) != null;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}
