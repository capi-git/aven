import { crewMembers, type Crew } from "./crews";

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

/** A memory's first line worth showing: past its headings, no bullet. */
function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) continue;
    const line = trimmed.replace(/^([-*•]|\d+[.)])\s*/, "").trim();
    if (line) return line;
  }
  return "";
}

/**
 * What Avos remembers, for its profile: what you asked it to remember for
 * every card first, then the first line of each memory (Avos's, then its
 * helpers'), at most `limit` of them; `total` counts every note and memory,
 * so the profile can offer the rest.
 */
export function avosRemembers(
  crew: Pick<Crew, "members" | "notes">,
  limit = 3,
): { lines: string[]; total: number } {
  const memories = crewMembers(crew)
    .filter((member) => member.role !== "fixer" && member.memory)
    .sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead"))
    .map((member) => firstLine(member.memory!))
    .filter(Boolean);
  const all = [...crew.notes.map((note) => note.text.trim()), ...memories];
  return { lines: all.slice(0, limit), total: all.length };
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
 * into one line that opens the activity.
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
