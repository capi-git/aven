import type { Crew } from "./crews";

/**
 * Avos's profile beside its chat, and its message when something needs
 * you: the words for both.
 */

/** What a row in Avos's "for you" message asks of you. */
export type AvosAskKind = "ready" | "answer" | "idea";

/**
 * Avos's line above what waits for you in its chat: what it is, in a few
 * words, as a person would say it.
 */
export function avosForYouLine(kinds: readonly AvosAskKind[]): string {
  if (!kinds.length) return "";
  const one = kinds.length === 1;
  const only = (kind: AvosAskKind) => kinds.every((item) => item === kind);
  if (only("ready"))
    return one
      ? "This is ready for you to look at."
      : "These are ready for you to look at.";
  if (only("answer"))
    return one
      ? "I need your answer on this."
      : "I need your answers on these.";
  if (only("idea"))
    return one
      ? "An idea, if you want it built."
      : "Some ideas, if you want them built.";
  return `${kinds.length} things need you.`;
}

/** The start of `now`'s day, on this computer's clock. */
function dayStart(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * What Avos's helpers finished today: each helper's answer, and each job
 * that came back ready, with findings or a mock-up. The profile folds them
 * into one line that opens the activity in a sheet.
 */
export function avosFinishedToday(
  crew: Pick<Crew, "feed">,
  now: number,
): number {
  const from = dayStart(now);
  return crew.feed.filter(
    (entry) =>
      entry.at >= from &&
      entry.at <= now &&
      ((entry.kind === "say" && entry.who === "helper") ||
        entry.kind === "ready" ||
        entry.kind === "findings" ||
        entry.kind === "mockup"),
  ).length;
}

/** One of Avos's notes: its words, and which line of its notes it is. */
export type MemoryFact = { line: number; text: string };

/**
 * What Avos has learned, one fact a row: each line of its notes that says
 * something, past headings and blank lines, its bullet taken off.
 */
export function memoryFacts(memory: string | undefined): MemoryFact[] {
  if (!memory) return [];
  const facts: MemoryFact[] = [];
  memory.split("\n").forEach((raw, line) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const text = trimmed.replace(/^([-*•]|\d+[.)])\s*/, "").trim();
    if (text) facts.push({ line, text });
  });
  return facts;
}

/** Its notes without one fact's line (by `memoryFacts`' line), or null if empty. */
export function withoutMemoryFact(memory: string, line: number): string | null {
  const lines = memory.split("\n");
  lines.splice(line, 1);
  const next = lines.join("\n").trim();
  return memoryFacts(next).length ? next : null;
}
