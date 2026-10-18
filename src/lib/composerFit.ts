/**
 * How much the message box's controls row says for its width: `full`, every
 * word; `compact`, short mode chips ("Race · 2 agents", "Discuss · Codex ·
 * 3") and the agent pill without its effort; `narrow`, the shortest chips
 * ("Race · 2"), Plan and Orchestrator as their icons and the agent pill as
 * its mark. Whatever is left out stays in the tooltip, so no word is ever
 * cut off.
 */
export type ComposerFit = "full" | "compact" | "narrow";

/** A mode chip on (Race, Discuss, Plan, Orchestrator) needs more room. */
export function composerFit(width: number, modeChip: boolean): ComposerFit {
  // Not laid out yet: as wide as it gets.
  if (width <= 0) return "full";
  if (width < (modeChip ? 400 : 300)) return "narrow";
  if (width < (modeChip ? 540 : 380)) return "compact";
  return "full";
}
