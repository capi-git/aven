/** Normalize caught values without losing a provider's useful message. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A caught failure's own message, or `fallback` when it has none. Native
 * commands reject with plain strings, so checking only for `Error` hides the
 * reason a provider failed behind the fallback.
 */
export function failureText(error: unknown, fallback: string): string {
  if (error == null) return fallback;
  return errorText(error).trim() || fallback;
}

/** Shared sink for actionable failures. Intentional best-effort cleanup may stay quiet. */
export function logError(context: string, error: unknown): void {
  console.error(`[aven] ${context}: ${errorText(error)}`);
}
