import {
  CREW_FENCES,
  GOAL_FENCE,
  HANDOFF_FENCE,
  IDEAS_FENCE,
  TASKS_FENCE,
  VERDICT_FENCE,
  parseGoal,
  parseHandoff,
  parseIdeas,
  parseTasks,
  parseVerdict,
} from "./crewHandoff";
import { plural } from "./words";

/**
 * A crew's fenced block in a chat (`aven-ideas`, `aven-handoff`,
 * `aven-verdict`, `aven-goal`, `aven-tasks`) is Aven's to read, never raw
 * JSON for you: it shows as a compact card with a label, a line and a few
 * items, in Aven's words around the bot's (clipped, as data).
 */

export type CrewFenceView = {
  kind: "ideas" | "handoff" | "verdict" | "goal" | "tasks";
  /** "3 ideas", "Handed over", "2 must-fix", "Passed", "Goal met". */
  label: string;
  /** One line under it: the bot's summary, or what Aven did with it. */
  line?: string;
  /** Titles or findings, each with a short detail. */
  items: { title: string; detail?: string }[];
};

/** Whether a fence's language is one of the crew's. */
export function isCrewFence(language: string): boolean {
  return (CREW_FENCES as readonly string[]).includes(language.toLowerCase());
}

/** What a crew fence says, or null when its body can't be read (it shows a quiet line). */
export function crewFenceView(
  language: string,
  body: string,
): CrewFenceView | null {
  const fence = language.toLowerCase();
  const text = `\`\`\`${fence}\n${body}\n\`\`\``;
  if (fence === IDEAS_FENCE) {
    const ideas = parseIdeas(text);
    if (!ideas.length) return null;
    return {
      kind: "ideas",
      label: plural(ideas.length, "idea"),
      items: ideas.map((idea) => ({
        title: idea.title,
        detail: [idea.size, idea.why].filter(Boolean).join(" · "),
      })),
    };
  }
  if (fence === HANDOFF_FENCE) {
    const handoff = parseHandoff(text);
    if (!handoff) return null;
    const ran = handoff.ran.length
      ? `ran ${handoff.ran.map((item) => `${item.command}${item.ok ? "" : " (failed)"}`).join(", ")}`
      : "";
    return {
      kind: "handoff",
      label: handoff.question ? "Asks you" : "Handed over",
      line: handoff.question ?? handoff.summary,
      items: handoff.question
        ? []
        : [
            ...(ran ? [{ title: ran }] : []),
            ...handoff.howToCheck.slice(0, 3).map((step) => ({
              title: step,
            })),
          ],
    };
  }
  if (fence === VERDICT_FENCE) {
    const verdict = parseVerdict(text, { round: 1, earlier: [] });
    if (!verdict) return null;
    const mustFix = verdict.mustFix.length;
    return {
      kind: "verdict",
      label: mustFix ? plural(mustFix, "must-fix", "must-fix") : "Passed",
      ...(verdict.summary ? { line: verdict.summary } : {}),
      items: verdict.mustFix.map((finding) => ({
        title: finding.text,
        ...(finding.where ? { detail: finding.where } : {}),
      })),
    };
  }
  if (fence === GOAL_FENCE) {
    const goal = parseGoal(text);
    if (!goal) return null;
    return {
      kind: "goal",
      label: goal.met
        ? "Goal met"
        : goal.next.length
          ? "Next for the goal"
          : "Nothing left to plan",
      ...(goal.summary ? { line: goal.summary } : {}),
      items: goal.next.map((task) => ({
        title: task.title,
        ...(task.why ? { detail: task.why } : {}),
      })),
    };
  }
  if (fence === TASKS_FENCE) {
    const asked = parseTasks(text);
    if (!asked) return null;
    return {
      kind: "tasks",
      label: asked.tasks.length
        ? `${plural(asked.tasks.length, "card")} for the crew`
        : "A goal for the crew",
      ...(asked.goal ? { line: `Goal: ${asked.goal}` } : {}),
      items: asked.tasks.map((task) => ({
        title: task.title,
        ...(task.why ? { detail: task.why } : {}),
      })),
    };
  }
  return null;
}
