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

/**
 * Signs an idea comes from outside the project: a web address, a domain, an
 * issue or pull request number, or words naming one.
 */
const OUTSIDE =
  /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|dev|app|co|ai)\b|github|gitlab|stack ?overflow|\b(?:issue|pull request|PR|ticket|bug report)s?\b|#\d+|\b[A-Z]{2,}-\d+\b/i;

/** Whether an idea's words point outside the project. */
export function looksFromOutside(...texts: readonly string[]): boolean {
  return texts.some((text) => OUTSIDE.test(text));
}

const SIZES = new Set<CrewIdeaSize>(["small", "medium", "large"]);

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
