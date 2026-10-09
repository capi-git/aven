/** Normalize caught values without losing a provider's useful message. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shared sink for actionable failures. Intentional best-effort cleanup may stay quiet. */
export function logError(context: string, error: unknown): void {
  console.error(`[aven] ${context}: ${errorText(error)}`);
}
