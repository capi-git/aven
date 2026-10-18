/**
 * Small wording helpers shared by every surface that builds a sentence:
 * counts and lists read the same in a card, a bar, a panel and Activity.
 */

/** "1 file", "3 files"; `many` for irregular plurals. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C": no comma before "and", as the app writes. */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Claude's", "Codex's": a name that owns something. */
export function possessive(name: string): string {
  return `${name}'s`;
}
