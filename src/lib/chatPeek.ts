import type { Session } from "./session";

/**
 * The open chats, for hover cards that peek into one: its copy, its step
 * and its last reply. The workspace provides it; cards ask only once open,
 * so rows never read transcripts while they render. Another window (the
 * floating sidebar, a detached workspace) has none and shows less.
 */
let lookup: ((id: string) => Session | undefined) | null = null;

export function provideChatPeek(
  next: (id: string) => Session | undefined,
): () => void {
  lookup = next;
  return () => {
    if (lookup === next) lookup = null;
  };
}

export function peekChat(id: string | undefined): Session | undefined {
  return id && lookup ? lookup(id) : undefined;
}
