/**
 * The real-app check's agent pages step: the stand-in opens the check's page
 * six times through its browser command and lists what each open returned
 * and how long it took. These read that list and say what went wrong.
 */

/** What the stand-in reported for one of its opens. */
export type AgentOpenReport = {
  id?: string;
  reused?: string | null;
  /** How long the browser command took. */
  ms?: number;
  note?: string;
};

const WORD = "AVEN_PAGES";
/** What the opens must have done: one page, reloaded then navigated, then a second. */
const EXPECTED = "-,reloaded,navigated,navigated,-,navigated";

const stillLoading = (open: AgentOpenReport) =>
  !!open.note?.includes("still loading");

/** Each open's outcome and time: "1. - 120 ms, 2. reloaded 2410 ms (still loading), …". */
export function agentOpensTimings(opens: readonly AgentOpenReport[]): string {
  return opens
    .map((open, index) => {
      const outcome = open.id ? (open.reused ?? "-") : "no answer";
      const took = typeof open.ms === "number" ? `${open.ms} ms` : "?";
      const note = stillLoading(open)
        ? " (still loading)"
        : open.note
          ? ` (note: ${open.note.slice(0, 60).trimEnd()})`
          : "";
      return `${index + 1}. ${outcome} ${took}${note}`;
    })
    .join(", ");
}

/**
 * The opens the stand-in's reply lists, or why the step fails: it said
 * nothing, or an open failed or got no answer (with the timings so far).
 */
export function readAgentOpens(text: string): {
  opens: AgentOpenReport[];
  failure?: string;
} {
  const at = text.indexOf(WORD);
  if (at < 0)
    return {
      opens: [],
      failure: `The stand-in reported: ${text || "nothing"}`,
    };
  const listed = text.slice(at + WORD.length).trim();
  const start = listed.indexOf("[");
  let opens: AgentOpenReport[] = [];
  try {
    const parsed: unknown = start < 0 ? [] : JSON.parse(listed.slice(start));
    if (Array.isArray(parsed)) opens = parsed as AgentOpenReport[];
  } catch {
    return { opens, failure: `The stand-in reported: ${text}` };
  }
  if (!listed.startsWith("FAILED")) return { opens };
  const why = listed.slice("FAILED".length, start < 0 ? undefined : start);
  return {
    opens,
    failure: `The stand-in's opens failed: ${why.trim()} (${agentOpensTimings(opens) || "none answered"})`,
  };
}

/** Why the opens did not build on one page, or null. */
export function agentOpensProblem(
  opens: readonly AgentOpenReport[],
): string | null {
  const ids = opens.map((open) => open.id);
  const reused = opens.map((open) => open.reused ?? "-");
  if (
    opens.length === 6 &&
    new Set(ids.slice(0, 4)).size === 1 &&
    ids[4] !== ids[0] &&
    ids[5] === ids[4] &&
    reused.join(",") === EXPECTED
  )
    return null;
  return `The opens returned ${JSON.stringify(opens.map(({ id, reused }) => ({ id, reused })))} (${agentOpensTimings(opens)})`;
}

/** The step's line for opens that built on one page. */
export function agentOpensSummary(opens: readonly AgentOpenReport[]): string {
  const reused = opens.map((open) => open.reused ?? "-").join(", ");
  const times = opens.map((open) => open.ms ?? "?").join(", ");
  const loading = opens.filter(stillLoading).length;
  return `one page reloaded and navigated, a second only for another path (${reused}) in ${times} ms${loading ? `; ${loading} still loading when handed back` : ""}`;
}
