import { clamp } from "./math";
import {
  createPath,
  homeDir,
  listSkills,
  readTextFile,
  writeTextFile,
  type DiscoveredSkill,
} from "./fs";
import { invalidateProjectFiles } from "./fileIndex";
import { fuzzyMatch, type FuzzyHit } from "./fuzzy";
import { joinPath } from "./paths";
import { looksLikeProject, normalizeProjectPath } from "./recents";
import { isMarkdownBlockquotePosition } from "./quoteDraft";
import type { HarnessId } from "./session";
import { getHarness } from "./harness/registry";
import type { NativeCommand } from "./harness/nativeCommands";
import {
  CREATE_SKILL_BODY,
  CREATE_SKILL_DESCRIPTION,
  CREATE_SKILL_NAME,
} from "./createSkill";
import {
  COMPUTER_USE_SKILL_BODY,
  COMPUTER_USE_SKILL_DESCRIPTION,
  COMPUTER_USE_SKILL_NAME,
} from "./computerUseSkill";

export type SkillScope = "project" | "user" | "builtin";
export type SkillSource =
  | "agents"
  | "claude"
  | "cursor"
  | "codex"
  | "opencode"
  | "pi"
  | "omp"
  | "fx"
  | "grok"
  | "monocode";

type SkillCommon = {
  name: string;
  description: string;
  invocation: string;
};

export type FileSkill = SkillCommon & {
  kind: "file";
  path: string;
  scope: Exclude<SkillScope, "builtin">;
  source: SkillSource;
};

export type BuiltinSkill = SkillCommon & {
  kind: "builtin";
  scope: "builtin";
  source: "monocode";
};

export type NativeSkill = NativeCommand & {
  kind: "native";
};

export type Skill = FileSkill | BuiltinSkill | NativeSkill;

export type SlashToken = {
  start: number;
  end: number;
  query: string;
};

export const BUILTIN_CREATE_SKILL: BuiltinSkill = {
  kind: "builtin",
  name: CREATE_SKILL_NAME,
  description: CREATE_SKILL_DESCRIPTION,
  invocation: CREATE_SKILL_NAME,
  scope: "builtin",
  source: "monocode",
};

export const BUILTIN_COMPUTER_USE_SKILL: BuiltinSkill = {
  kind: "builtin",
  name: COMPUTER_USE_SKILL_NAME,
  description: COMPUTER_USE_SKILL_DESCRIPTION,
  invocation: COMPUTER_USE_SKILL_NAME,
  scope: "builtin",
  source: "monocode",
};

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_TOKEN_RE =
  /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?)(?=\s|$)/g;
const MAX_PICKER = 50;
/** Description-only matches are a fallback; a few are enough to find one. */
const MAX_DESCRIPTION_HITS = 10;
/**
 * Per place in the recently used list: enough to win a near tie between
 * matches, not to lift a scattered match above a name that starts the query.
 */
const RECENT_BONUS = 3;
const NATIVE_SKILL_TTL_MS = 30_000;
const NATIVE_SKILL_RETRY_MS = 5_000;

export type SkillCatalogContext = {
  harness: HarnessId;
  cwd: string;
  sessionId?: string;
};

type CatalogRequest = {
  generation: number;
  promise: Promise<Skill[]>;
};

type CatalogEntry = {
  cwd: string;
  skills: Skill[] | null;
  loadedAt: number;
  retryAt: number;
  generation: number;
  inFlight: CatalogRequest | null;
};

const catalogEntries = new Map<string, CatalogEntry>();

export function skillCatalogKey(context: SkillCatalogContext): string {
  const sessionScoped = !!getHarness(context.harness)?.commands?.subscribe;
  return `${context.harness}\0${normalizeProjectPath(context.cwd)}${sessionScoped && context.sessionId ? `\0${context.sessionId}` : ""}`;
}

export function hasNativeCommands(harness: HarnessId): boolean {
  return !!getHarness(harness)?.commands;
}

export function isNativeCommandPrompt(
  text: string,
  harness: HarnessId,
): boolean {
  return (
    getHarness(harness)?.commands?.rawSlashCommands === true &&
    /^\s*\/[^\s/\\]+(?=\s|$)/.test(text)
  );
}

/** A live update supersedes any cold probe already in flight. */
export function subscribeSkills(
  context: SkillCatalogContext,
  onSkills: (skills: Skill[]) => void,
): () => void {
  return (
    getHarness(context.harness)?.commands?.subscribe?.(context, (commands) => {
      const key = skillCatalogKey(context);
      const previous = catalogEntries.get(key);
      const skills = keepSameSkills(
        previous?.skills,
        commands.map((command): Skill => ({ ...command, kind: "native" })),
      );
      catalogEntries.set(key, {
        cwd: normalizeProjectPath(context.cwd),
        skills,
        loadedAt: Date.now(),
        retryAt: 0,
        generation: (previous?.generation ?? 0) + 1,
        inFlight: null,
      });
      onSkills(skills);
    }) ?? (() => undefined)
  );
}

export function peekSkills(context: SkillCatalogContext): Skill[] | null {
  return catalogEntries.get(skillCatalogKey(context))?.skills ?? null;
}

export function invalidateSkills(context?: { cwd: string }) {
  if (!context) {
    catalogEntries.clear();
    return;
  }
  const cwd = normalizeProjectPath(context.cwd);
  for (const entry of catalogEntries.values()) {
    if (entry.cwd !== cwd) continue;
    entry.generation += 1;
    entry.loadedAt = 0;
    entry.retryAt = 0;
    entry.inFlight = null;
  }
}

export function loadSkills(
  context: SkillCatalogContext,
  options?: { refresh?: boolean },
): Promise<Skill[]> {
  const normalized = {
    harness: context.harness,
    cwd: normalizeProjectPath(context.cwd),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  } satisfies SkillCatalogContext;
  const key = skillCatalogKey(normalized);
  let entry = catalogEntries.get(key);
  if (!entry) {
    entry = {
      cwd: normalized.cwd,
      skills: null,
      loadedAt: 0,
      retryAt: 0,
      generation: 0,
      inFlight: null,
    };
    catalogEntries.set(key, entry);
  }

  const now = Date.now();
  if (options?.refresh) {
    if (entry.inFlight?.generation === entry.generation) {
      return entry.inFlight.promise;
    }
    entry.generation += 1;
    entry.retryAt = 0;
    return startCatalogLoad(key, entry, normalized);
  }

  if (entry.inFlight?.generation === entry.generation) {
    return entry.inFlight.promise;
  }
  if (!hasNativeCommands(normalized.harness) && entry.skills) {
    return Promise.resolve(entry.skills);
  }
  if (
    hasNativeCommands(normalized.harness) &&
    entry.skills &&
    now - entry.loadedAt < NATIVE_SKILL_TTL_MS
  ) {
    return Promise.resolve(entry.skills);
  }
  if (hasNativeCommands(normalized.harness) && now < entry.retryAt) {
    return Promise.resolve(entry.skills ?? []);
  }
  return startCatalogLoad(key, entry, normalized);
}

function startCatalogLoad(
  key: string,
  entry: CatalogEntry,
  context: SkillCatalogContext,
): Promise<Skill[]> {
  const generation = entry.generation;
  const promise = loadCatalog(context)
    .then((loaded) => {
      if (
        catalogEntries.get(key) !== entry ||
        entry.generation !== generation
      ) {
        return catalogEntries.get(key)?.skills ?? [];
      }
      // An unchanged rescan keeps the same list, so an open picker is not
      // re-ranked (or reordered under the highlighted row) for nothing.
      const skills = keepSameSkills(entry.skills, loaded);
      entry.skills = skills;
      entry.loadedAt = Date.now();
      entry.retryAt = 0;
      return skills;
    })
    .catch(() => {
      if (
        catalogEntries.get(key) !== entry ||
        entry.generation !== generation
      ) {
        return catalogEntries.get(key)?.skills ?? [];
      }
      if (hasNativeCommands(context.harness)) {
        entry.retryAt = Date.now() + NATIVE_SKILL_RETRY_MS;
        return entry.skills ?? [];
      }
      const fallback = keepSameSkills(entry.skills, mergeCatalog([]));
      entry.skills = fallback;
      entry.loadedAt = Date.now();
      return fallback;
    })
    .finally(() => {
      if (
        catalogEntries.get(key) === entry &&
        entry.generation === generation &&
        entry.inFlight?.promise === promise
      ) {
        entry.inFlight = null;
      }
    });
  entry.inFlight = { generation, promise };
  return promise;
}

async function loadCatalog(context: SkillCatalogContext): Promise<Skill[]> {
  const provider = getHarness(context.harness)?.commands;
  if (provider) {
    const commands = await provider.discover(context);
    return commands.map((command): NativeSkill => ({
      kind: "native",
      ...command,
    }));
  }
  return mergeCatalog(await listSkills(context.cwd));
}

export function mergeCatalog(discovered: DiscoveredSkill[]): Skill[] {
  const out = new Map<string, Skill>();
  const add = (skill: Skill) => {
    if (!skill.name || out.has(skill.name)) return;
    out.set(skill.name, skill);
  };
  for (const skill of discovered) {
    if (skill.source === "agents") add(asSkill(skill));
  }
  add(BUILTIN_CREATE_SKILL);
  add(BUILTIN_COMPUTER_USE_SKILL);
  for (const skill of discovered) {
    if (skill.source !== "agents") add(asSkill(skill));
  }
  return [...out.values()];
}

function asSkill(skill: DiscoveredSkill): FileSkill {
  return {
    kind: "file",
    name: skill.name,
    description: skill.description,
    invocation: skill.name,
    path: skill.path,
    scope: skill.scope === "user" ? "user" : "project",
    source: skill.source === "monocode" ? "monocode" : skill.source,
  };
}

/** A `/` picker row: the skill and which of its characters the query matched. */
export type SkillMatch = {
  skill: Skill;
  /** Matched characters of `skill.invocation`, the text the picker shows. */
  positions: number[];
  /** Matched characters of `skill.description`, for a description-only hit. */
  descriptionPositions: number[];
};

export type RankSkillOptions = {
  limit?: number;
  /** Invocations used recently in this project, most recent first. */
  recent?: readonly string[];
};

export function rankSkills(
  skills: Skill[],
  query: string,
  limit = MAX_PICKER,
): Skill[] {
  return rankSkillMatches(skills, query, { limit }).map((row) => row.skill);
}

/**
 * Rank the `/` picker. Names and invocations are fuzzy-matched; descriptions
 * only by word start or substring, after every name hit and a few at most,
 * because a short query is a subsequence of almost any sentence. Recently
 * used skills come first; Aven's own commands follow the user's skills unless
 * the query starts their name.
 */
export function rankSkillMatches(
  skills: readonly Skill[],
  query: string,
  { limit = MAX_PICKER, recent = [] }: RankSkillOptions = {},
): SkillMatch[] {
  const recentRank = new Map<string, number>();
  recent.forEach((invocation, index) => {
    if (!recentRank.has(invocation)) recentRank.set(invocation, index);
  });
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...skills]
      .sort((a, b) => {
        const ra = recentRank.get(a.invocation);
        const rb = recentRank.get(b.invocation);
        if (ra !== undefined || rb !== undefined) {
          return (
            (ra ?? Number.POSITIVE_INFINITY) - (rb ?? Number.POSITIVE_INFINITY)
          );
        }
        const rank = scopeRank(a) - scopeRank(b);
        if (rank !== 0) return rank;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit)
      .map((skill) => ({ skill, positions: [], descriptionPositions: [] }));
  }

  type Scored = SkillMatch & { tier: number; score: number };
  const named: Scored[] = [];
  const described: Scored[] = [];
  for (const skill of skills) {
    const hit = matchSkillName(needle, skill);
    if (hit) {
      const recency = recentRank.get(skill.invocation);
      named.push({
        skill,
        positions: hit.positions,
        descriptionPositions: [],
        tier:
          skill.kind === "builtin" && !startsSkillName(needle, skill) ? 1 : 0,
        score:
          hit.score +
          (recency === undefined
            ? 0
            : Math.max(0, recent.length - recency) * RECENT_BONUS),
      });
      continue;
    }
    const desc = matchSkillDescription(needle, skill.description);
    if (desc) {
      described.push({
        skill,
        positions: [],
        descriptionPositions: desc.positions,
        tier: 2,
        score: desc.score,
      });
    }
  }
  const order = (a: Scored, b: Scored) =>
    a.tier - b.tier ||
    b.score - a.score ||
    a.skill.name.localeCompare(b.skill.name);
  named.sort(order);
  described.sort(order);
  return [...named, ...described.slice(0, MAX_DESCRIPTION_HITS)]
    .slice(0, limit)
    .map(({ skill, positions, descriptionPositions }) => ({
      skill,
      positions,
      descriptionPositions,
    }));
}

/** Fuzzy name or invocation hit, with positions in the shown invocation. */
function matchSkillName(needle: string, skill: Skill): FuzzyHit | null {
  const { invocation, name } = skill;
  const nameHit = fuzzyMatch(needle, name);
  if (nameHit) {
    // `/skill:architect` shows the name at the end of its invocation.
    const offset = invocation.toLowerCase().endsWith(name.toLowerCase())
      ? invocation.length - name.length
      : -1;
    return {
      score: nameHit.score,
      positions:
        offset >= 0
          ? nameHit.positions.map((index) => index + offset)
          : (fuzzyMatch(needle, invocation)?.positions ?? []),
    };
  }
  const invocationHit = fuzzyMatch(needle, invocation);
  if (invocationHit) return invocationHit;
  if (skill.kind !== "native") return null;
  for (const alias of skill.aliases ?? []) {
    const aliasHit = fuzzyMatch(needle, alias);
    // The alias is not shown, so there is nothing to highlight.
    if (aliasHit) return { score: aliasHit.score, positions: [] };
  }
  return null;
}

/**
 * A word in the description starting with the query, or for three or more
 * characters the query anywhere; an earlier word start ranks higher.
 */
function matchSkillDescription(
  needle: string,
  description: string,
): FuzzyHit | null {
  if (needle.length < 2 || !description) return null;
  const hay = description.toLowerCase();
  let inside = -1;
  for (
    let at = hay.indexOf(needle);
    at !== -1;
    at = hay.indexOf(needle, at + 1)
  ) {
    if (at === 0 || !isWordChar(hay[at - 1]!)) {
      return { score: 100_000 - at, positions: span(at, needle.length) };
    }
    if (inside === -1) inside = at;
  }
  if (inside === -1 || needle.length < 3) return null;
  return { score: -inside, positions: span(inside, needle.length) };
}

function startsSkillName(needle: string, skill: Skill): boolean {
  return (
    skill.name.toLowerCase().startsWith(needle) ||
    skill.invocation.toLowerCase().startsWith(needle)
  );
}

function span(start: number, length: number): number[] {
  return Array.from({ length }, (_, index) => start + index);
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Aven's own commands follow the project's and the user's skills. */
function scopeRank(skill: Skill): number {
  if (skill.kind === "native" || skill.scope === "project") return 0;
  if (skill.kind === "builtin") return 2;
  return 1;
}

/** The same rows in the same order, compared by value. */
export function sameSkillList(
  a: readonly Skill[],
  b: readonly Skill[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const x = a[index]!;
    const y = b[index]!;
    if (x === y) continue;
    if (
      x.kind !== y.kind ||
      x.name !== y.name ||
      x.invocation !== y.invocation ||
      x.description !== y.description ||
      x.source !== y.source ||
      JSON.stringify(x) !== JSON.stringify(y)
    )
      return false;
  }
  return true;
}

function keepSameSkills(
  previous: Skill[] | null | undefined,
  next: Skill[],
): Skill[] {
  return previous && sameSkillList(previous, next) ? previous : next;
}

/** Slash token that contains `cursor`, if the user is typing `/skill`. */
export function slashTokenAt(
  text: string,
  cursor: number,
  native = false,
): SlashToken | null {
  const i = clamp(cursor, 0, text.length);
  let start = i;
  while (start > 0 && !isSpace(text[start - 1]!)) start -= 1;
  if (text[start] !== "/") return null;
  if (start > 0 && text[start - 1] === ":") return null;
  if (isMarkdownBlockquotePosition(text, start)) return null;

  let end = start + 1;
  while (end < text.length && !isSpace(text[end]!)) end += 1;

  const typed = text.slice(start + 1, i);
  if (typed.includes("/") || typed.includes("\\")) return null;
  if (native) {
    if (!/^[a-zA-Z0-9_.:-]*$/.test(typed)) return null;
  } else {
    if (/[A-Z]/.test(typed)) return null;
    if (!/^(?:[a-z0-9-]+(?::[a-z0-9-]*)?)?$/.test(typed)) return null;
  }

  return { start, end, query: typed };
}

export function replaceSlashToken(
  text: string,
  token: SlashToken,
  name: string,
): string {
  const rest = text.slice(token.end);
  const spacer = rest.startsWith(" ") ? "" : " ";
  return `${text.slice(0, token.start)}/${name}${spacer}${rest}`;
}

export function skillNamesInText(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  SKILL_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_RE.exec(text))) {
    const name = match[2];
    const start = match.index + (match[1]?.length ?? 0);
    if (!name || seen.has(name) || isMarkdownBlockquotePosition(text, start)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type SkillTextPart = {
  text: string;
  skill: boolean;
};

/** Split composer text so known `/skill` tokens can be highlighted. */
export function skillTextParts(
  text: string,
  names: ReadonlySet<string>,
): SkillTextPart[] {
  if (!text) return [];
  if (names.size === 0) return [{ text, skill: false }];

  const parts: SkillTextPart[] = [];
  const push = (value: string, skill: boolean) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.skill === skill) {
      last.text += value;
      return;
    }
    parts.push({ text: value, skill });
  };

  SKILL_TOKEN_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_RE.exec(text))) {
    const name = match[2];
    const lead = match[1] ?? "";
    const start = match.index + lead.length;
    if (
      !name ||
      !names.has(name) ||
      isMarkdownBlockquotePosition(text, start)
    ) {
      continue;
    }
    const end = start + 1 + name.length;
    push(text.slice(cursor, start), false);
    push(text.slice(start, end), true);
    cursor = end;
  }
  push(text.slice(cursor), false);
  return parts;
}

export function injectSkillPrompt(
  text: string,
  skills: Skill[],
  bodies: Record<string, string>,
): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    const body = bodies[skill.name]?.trim();
    if (!body) continue;
    const origin =
      skill.kind === "file"
        ? `Skill file: ${skill.path}\nResolve relative resources from this file's directory.\n\n`
        : "";
    blocks.push(`## /${skill.name}\n\n${origin}${body}`);
  }
  if (blocks.length === 0) return text;
  return [
    "The user invoked skill(s) with /name. Use each skill as task guidance, subject to the user's request and the host's higher-priority instructions.",
    "",
    blocks.join("\n\n"),
    "",
    "---",
    "",
    text,
  ].join("\n");
}

export async function applySkillsToTurn(
  text: string,
  context: SkillCatalogContext,
): Promise<string> {
  if (hasNativeCommands(context.harness)) return text;
  const names = skillNamesInText(text);
  if (names.length === 0) return text;
  const catalog = await loadSkills(context);
  const picked: Array<FileSkill | BuiltinSkill> = [];
  for (const name of names) {
    const skill = catalog.find((item) => item.name === name);
    if (skill?.kind === "file" || skill?.kind === "builtin") {
      picked.push(skill);
    }
  }
  if (picked.length === 0) return text;
  const bodies: Record<string, string> = {};
  await Promise.all(
    picked.map(async (skill) => {
      bodies[skill.name] = await readSkillBody(skill);
    }),
  );
  return injectSkillPrompt(text, picked, bodies);
}

type SkillLoader = typeof loadSkills;

export function warmNativeSkills(
  context: SkillCatalogContext,
  load: SkillLoader = loadSkills,
): void {
  if (!hasNativeCommands(context.harness)) return;
  void load(context).catch(() => undefined);
}

export async function readSkillBody(
  skill: FileSkill | BuiltinSkill,
): Promise<string> {
  if (skill.kind === "builtin") {
    return skill.name === COMPUTER_USE_SKILL_NAME
      ? COMPUTER_USE_SKILL_BODY
      : CREATE_SKILL_BODY;
  }
  try {
    return await readTextFile(skill.path);
  } catch {
    return `Skill "${skill.name}" could not be read from ${skill.path}.`;
  }
}

export function slugSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && name.length <= 64;
}

export function titleFromSkillName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function blankSkillMarkdown(name: string): string {
  const title = titleFromSkillName(name);
  const words = name.replace(/-/g, " ");
  return `---
name: ${name}
description: ${title}. Use when the user asks to ${words}.
---

# ${title}

## Instructions

`;
}

export async function createBlankSkill(input: {
  cwd: string;
  name: string;
  scope: "project" | "user";
}): Promise<string> {
  const name = slugSkillName(input.name);
  if (!isValidSkillName(name)) {
    throw new Error("Use a lowercase name with letters, numbers, and hyphens.");
  }
  const root =
    input.scope === "user" || !looksLikeProject(input.cwd)
      ? await homeDir()
      : input.cwd;
  const relative = `.agents/skills/${name}`;
  await createPath(root, relative, true);
  const path = joinPath(root, `${relative}/SKILL.md`);
  await writeTextFile(path, blankSkillMarkdown(name));
  invalidateSkills({ cwd: input.cwd });
  invalidateProjectFiles(input.cwd);
  return path;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}
