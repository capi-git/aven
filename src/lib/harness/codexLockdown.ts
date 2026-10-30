/**
 * Codex refusing to run a closed chat (a crew's Checker) because a tool it
 * couldn't switch off stayed on. Kept apart from the harness so the crew's
 * runner can recognise it without loading Codex's client.
 */

/** The start of the refusal. */
export const CODEX_TOOLS_OPEN = "Codex couldn't be locked down here";

/** The same refusal in the words an earlier build used. */
const EARLIER = "Codex couldn't start with its tools switched off";

/** Whether an error (or a turn's error text) is that refusal. */
export function isCodexToolsOpen(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : (error ?? ""));
  return text.includes(CODEX_TOOLS_OPEN) || text.includes(EARLIER);
}

/** "plugin a, plugin b, plugin c and 12 more": short enough for a card. */
export function shortList(items: readonly string[], shown = 3): string {
  if (items.length <= shown) return items.join(", ");
  return `${items.slice(0, shown).join(", ")} and ${items.length - shown} more`;
}
