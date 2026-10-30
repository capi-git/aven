import { finalFencedBlock, reviewUrl } from "./automationReview";
import {
  readFinding,
  readRan,
  type CrewFinding,
  type CrewHandoff,
  type CrewIdeaSize,
  type CrewVerdict,
} from "./crews";
import { cleanUntrusted } from "./memoryKeeperSafety";

/**
 * Reading what a crew's bots hand back. Each ends its turn with one fenced
 * block, the way an automation leaves a review card: the Builder an
 * `aven-handoff`, the Checker an `aven-verdict`, the Scout `aven-ideas`.
 * Aven reads only the fields it knows, clips them, and keeps them as data:
 * what one bot wrote reaches the next only as quoted material, never as
 * instructions, and buttons never use a bot's words.
 */

export const HANDOFF_FENCE = "aven-handoff";
export const VERDICT_FENCE = "aven-verdict";
export const IDEAS_FENCE = "aven-ideas";
/** A goal turn's answer: is the goal met, and the next card towards it. */
export const GOAL_FENCE = "aven-goal";
/** Work a member queues from its own chat, through Aven: cards, or a goal. */
export const TASKS_FENCE = "aven-tasks";
/** Every fence a crew's bot ends a reply with. */
export const CREW_FENCES = [
  HANDOFF_FENCE,
  VERDICT_FENCE,
  IDEAS_FENCE,
  GOAL_FENCE,
  TASKS_FENCE,
] as const;

/** At most this many must-fix items count; more read as notes for later. */
export const MUST_FIX_MAX = 5;
const LATER_MAX = 8;
const HOW_TO_CHECK_MAX = 6;
/** Ideas the Scout may hand back in one turn. */
export const IDEAS_PER_TURN = 3;

function json(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One plain line of a bot's words: secrets out, lines to an AI dropped, clipped. */
export function botLine(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  return cleanUntrusted(value, max).replace(/\s+/g, " ").trim();
}

function botLines(value: unknown, keep: number, max = 300): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => botLine(item, max))
    .filter(Boolean)
    .slice(0, keep);
}

/** The reply without its closing block, for a one-line summary. */
export function replyBefore(text: string, fence: string): string {
  return finalFencedBlock(text, fence)?.before ?? text.trim();
}

/** The Builder's handoff note, or null when its reply ends without one. */
export function parseHandoff(text: string): CrewHandoff | null {
  const block = finalFencedBlock(text, HANDOFF_FENCE);
  const fields = block ? json(block.body) : null;
  if (!fields) return null;
  const question = botLine(fields.question, 400);
  return {
    summary: botLine(fields.summary, 600),
    howToCheck: botLines(fields.howToCheck, HOW_TO_CHECK_MAX),
    ran: readRan(fields.ran).map((ran) => ({
      ...ran,
      command: botLine(ran.command, 200),
      ...(ran.note ? { note: botLine(ran.note, 200) } : {}),
    })),
    ...(question ? { question } : {}),
  };
}

function cleanFinding(finding: CrewFinding): CrewFinding | null {
  const text = botLine(finding.text, 300);
  if (!text) return null;
  const where = finding.where ? botLine(finding.where, 120) : "";
  const how = finding.how ? botLine(finding.how, 300) : "";
  return {
    text,
    ...(where ? { where } : {}),
    ...(how ? { how } : {}),
    ...(finding.about ? { about: finding.about } : {}),
    ...(finding.regression ? { regression: true } : {}),
  };
}

/**
 * The Checker's verdict, or null when its reply ends without one.
 *
 * Only must-fix items send a card back; its own pass or fail word is not
 * trusted over them. At most `MUST_FIX_MAX` count, the rest become notes for
 * later. From round 2 the check is about the earlier findings and what
 * changed: a must-fix item must name the earlier finding it is `about`, or
 * be a `regression` the latest changes caused. Anything else new is a note
 * for later, so a card is never sent back for something that was there all
 * along.
 */
export function parseVerdict(
  text: string,
  scope: { round: number; earlier: readonly CrewFinding[] },
): CrewVerdict | null {
  const block = finalFencedBlock(text, VERDICT_FENCE);
  const fields = block ? json(block.body) : null;
  if (!fields) return null;
  const findings = (Array.isArray(fields.mustFix) ? fields.mustFix : [])
    .map(readFinding)
    .filter((item): item is CrewFinding => !!item)
    .map(cleanFinding)
    .filter((item): item is CrewFinding => !!item);
  const later = botLines(fields.later, LATER_MAX);
  const mustFix: CrewFinding[] = [];
  for (const finding of findings) {
    const inScope =
      scope.round <= 1 ||
      finding.regression === true ||
      (finding.about !== undefined &&
        finding.about >= 1 &&
        finding.about <= scope.earlier.length);
    if (inScope && mustFix.length < MUST_FIX_MAX) {
      // Round 1 has nothing earlier to point at.
      const kept =
        scope.round <= 1 ? { ...finding, about: undefined } : finding;
      if (kept.about === undefined) delete kept.about;
      mustFix.push(kept);
    } else later.push(finding.text);
  }
  return {
    pass: mustFix.length === 0,
    summary: botLine(fields.summary, 600),
    mustFix,
    later: [...new Set(later)].slice(0, LATER_MAX),
    ran: readRan(fields.ran).map((ran) => ({
      ...ran,
      command: botLine(ran.command, 200),
      ...(ran.note ? { note: botLine(ran.note, 200) } : {}),
    })),
  };
}

export type ScoutIdea = {
  title: string;
  why: string;
  size: CrewIdeaSize;
  /** Outside material it is based on: such an idea never starts by itself. */
  sourceUrl?: string;
  /**
   * Its words point outside the project (a link, an issue or pull request):
   * Aven's own check, whatever the Scout said. It never starts by itself.
   */
  outside?: boolean;
};

const SIZES = new Set<CrewIdeaSize>(["small", "medium", "large"]);

/** Letters from other scripts that read as Latin ones (`еvil.соm`). */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  ё: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ї: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
  ɡ: "g",
  ο: "o",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ʏ: "y",
  ɪ: "i",
  ᴏ: "o",
};

/**
 * Text as a reader sees it: compatibility forms folded (full-width `．`,
 * `＃`), invisible characters dropped, look-alike letters made Latin, every
 * kind of hyphen made `-`, and dots written with spaces closed up.
 */
export function foldedText(text: string): string {
  return (
    text
      .normalize("NFKC")
      .replace(/[­᠎​-‏‪-‮⁠-⁤﻿]/g, "")
      .toLowerCase()
      .replace(/[^\x00-\x7f]/g, (char) => CONFUSABLES[char] ?? char)
      .replace(/[‐-―−﹘﹣－]/g, "-")
      .replace(/(\w)\s+\.\s*(?=[a-z0-9])/g, "$1.")
      // `evil. com/x` or a closing `evil. com`, but not a sentence's end.
      .replace(/(\w)\.\s+(?=[a-z]{2,}(?:\/|\s*$))/g, "$1.")
  );
}

/** File endings a project's own files have: such a name is the project's. */
const FILE_ENDINGS = new Set(
  (
    "ts tsx js jsx mjs cjs json jsonc css scss sass less html htm vue svelte astro " +
    "md mdx txt yml yaml toml ini env lock rs go py rb java kt kts swift m mm c h cc " +
    "cpp hpp cs php sql graphql gql proto sh bash zsh ps1 bat gradle xml plist svg " +
    "png jpg jpeg gif webp ico wasm map snap test spec"
  ).split(" "),
);

/** The middle of a three-part file name (`vite.config.ts`, `app.test.tsx`). */
const FILE_MIDDLES = new Set(
  (
    "config test tests spec setup stories story module d min e2e local dev prod " +
    "server client worker types type mock mocks service controller component " +
    "page layout route routes store schema util utils helper helpers style styles " +
    "entry index main api hooks hook model view"
  ).split(" "),
);

/** A dotted word that names something on the web rather than a project file. */
function looksLikeHost(token: string): boolean {
  const parts = token.split(".").filter(Boolean);
  if (parts.length < 2) return false;
  // An IP address.
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part)))
    return true;
  const ending = parts[parts.length - 1]!;
  if (!/^[a-z]{2,}$/.test(ending)) return false;
  if (!FILE_ENDINGS.has(ending)) return true;
  if (parts.length === 2) return false;
  // `get.evil.sh` is a host; `vite.config.ts` is a file.
  return !parts.slice(1, -1).every((part) => FILE_MIDDLES.has(part));
}

/**
 * Signs an idea comes from outside the project. Kept on the cautious side:
 * when in doubt, the idea waits in Ideas for Give to crew.
 */
const OUTSIDE_PATTERNS: readonly RegExp[] = [
  // Any scheme, defanged ones too (`hxxps://`).
  /\b(?:h[tx]{2}ps?|s?ftp|ssh|git|file)\s*:\s*\/\//,
  /\bh[tx]{2}ps?\b/,
  /\bwww\s*\./,
  /:\/\//,
  // Defanged dots: `evil[.]com`, `evil(.)com`, `evil (dot) com`.
  /[[(]\s*(?:\.|dot)\s*[\])]/,
  /\b(?:dot)\s+[a-z]{2,}\b/,
  // Issue, pull request and tracker numbers: `#42`, `# 42`, `PROJ-42`, `LIN 42`.
  /#\s*\d+/,
  /\b[a-z]{2,10}\s*-\s*\d+\b/,
  // Places and people outside the project.
  /\b(?:issues?|pull requests?|prs?|tickets?|bug reports?|github|gitlab|bitbucket|jira|stack ?overflow|forums?|blogs?|reddit|discord|slack|twitter|tweets?|gists?|pastebin|websites?|articles?|tutorials?|upstream|online|internet|web ?pages?|links?|urls?)\b/,
  // Documentation and packages: what another project's authors wrote.
  /\b(?:readme|docs?|documentation|changelogs?|release notes|node_modules|vendor|registry|npm|npmjs|pypi|crates|rubygems|packagist|maven|cocoapods|homebrew)\b/,
  /\bpackage(?:'s)?\s+(?:docs?|readme|page|instructions)\b/,
];

/** Whether an idea's words point outside the project (see `OUTSIDE_PATTERNS`). */
export function looksFromOutside(...texts: readonly string[]): boolean {
  return texts.some((raw) => {
    const text = foldedText(raw);
    if (OUTSIDE_PATTERNS.some((pattern) => pattern.test(text))) return true;
    // An upper-case key with a number, read before folding: `LIN 42`.
    if (/\b[A-Z]{2,10}\s+\d+\b/.test(raw.normalize("NFKC"))) return true;
    return (text.match(/[a-z0-9_-]+(?:\.[a-z0-9_-]+)+/g) ?? []).some(
      looksLikeHost,
    );
  });
}

/**
 * The Scout's ideas, at most `IDEAS_PER_TURN`. Each needs a title and its
 * size; one without a size it stated is left out, since only ideas the
 * Scout says are small may start by themselves.
 */
export function parseIdeas(text: string): ScoutIdea[] {
  const block = finalFencedBlock(text, IDEAS_FENCE);
  const fields = block ? json(block.body) : null;
  if (!fields || !Array.isArray(fields.ideas)) return [];
  const ideas: ScoutIdea[] = [];
  for (const item of fields.ideas) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const title = botLine(raw.title, 120);
    const size =
      typeof raw.size === "string" ? raw.size.trim().toLowerCase() : "";
    if (!title || !SIZES.has(size as CrewIdeaSize)) continue;
    if (ideas.some((idea) => idea.title.toLowerCase() === title.toLowerCase()))
      continue;
    const sourceUrl = reviewUrl(raw.source ?? raw.sourceUrl);
    const why = botLine(raw.why, 300);
    // Read before cleaning: a link in the raw words counts too.
    const rawWords = [raw.title, raw.why, raw.source, raw.sourceUrl]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    const outside = !!sourceUrl || looksFromOutside(title, why, rawWords);
    ideas.push({
      title,
      why,
      size: size as CrewIdeaSize,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(outside ? { outside: true } : {}),
    });
    if (ideas.length >= IDEAS_PER_TURN) break;
  }
  return ideas;
}

/** A card a bot proposes: its title and why, in the bot's words (data). */
export type CrewTask = { title: string; why?: string };

function tasksFrom(value: unknown, keep: number): CrewTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: CrewTask[] = [];
  for (const item of value) {
    const raw =
      typeof item === "string"
        ? { title: item }
        : item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
    if (!raw) continue;
    const title = botLine(raw.title, 120);
    if (!title) continue;
    if (tasks.some((task) => task.title.toLowerCase() === title.toLowerCase()))
      continue;
    const why = botLine(raw.why, 300);
    tasks.push({ title, ...(why ? { why } : {}) });
    if (tasks.length >= keep) break;
  }
  return tasks;
}

/** At most this many cards a goal turn plans at once: the next one. */
export const GOAL_CARDS_PER_TURN = 1;

/**
 * A goal turn's answer: whether the goal is met (with why), and the next
 * card towards it. Null when the reply ends without its block.
 */
export function parseGoal(
  text: string,
): { met: boolean; summary: string; next: CrewTask[] } | null {
  const block = finalFencedBlock(text, GOAL_FENCE);
  const fields = block ? json(block.body) : null;
  if (!fields) return null;
  const met = fields.met === true;
  return {
    met,
    summary: botLine(fields.summary, 300),
    next: met ? [] : tasksFrom(fields.next, GOAL_CARDS_PER_TURN),
  };
}

/** At most this many cards a member queues from its chat at once. */
export const TASKS_PER_REPLY = 5;

/**
 * Work a member queues from its own chat when you ask it for some: cards
 * for the crew, and a goal to keep going towards. Null without its block.
 */
export function parseTasks(
  text: string,
): { tasks: CrewTask[]; goal?: string } | null {
  const block = finalFencedBlock(text, TASKS_FENCE);
  const fields = block ? json(block.body) : null;
  if (!fields) return null;
  const goal = botLine(fields.goal, 300);
  const tasks = tasksFrom(fields.tasks, TASKS_PER_REPLY);
  if (!goal && !tasks.length) return null;
  return { tasks, ...(goal ? { goal } : {}) };
}
