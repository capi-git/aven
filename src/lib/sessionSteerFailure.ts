import type { Session } from "./session";

/** A rejected follow-up does not finish or restart the provider's original turn. */
export function appendSteerFailure(session: Session, error: unknown): Session {
  const detail =
    error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : "";
  return {
    ...session,
    blocks: [
      ...session.blocks,
      {
        id: crypto.randomUUID(),
        role: "system",
        text: `Could not send the steering message.${detail ? ` ${detail}` : ""}`,
      },
    ],
  };
}
