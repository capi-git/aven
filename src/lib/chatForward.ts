import type { NoteComposerCard } from "./notes";
import type { HarnessId } from "./session";

/**
 * Forward: a reply from one chat goes to another chat (or a new one) as a
 * card above its message box, named by the chat it came from. Nothing is
 * sent until the user sends it, with anything they add.
 */
export const FORWARD_TO_CHAT_EVENT = "aven:forward-to-chat";

export type ForwardRequest = {
  card: NoteComposerCard;
  /** The chat to fill; absent starts a new chat in `cwd`. */
  toSessionId?: string;
  cwd: string;
};

/** The card that carries `text` from the chat `from` to another. */
export function forwardCard(
  from: { id: string; title: string; harness: HarnessId; cwd: string },
  text: string,
): NoteComposerCard | null {
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) return null;
  return {
    id: from.id,
    slug: "",
    title: from.title,
    body,
    kind: "forward",
    harness: from.harness,
    sourceCwd: from.cwd,
  };
}

export function requestForwardToChat(request: ForwardRequest) {
  if (typeof window === "undefined" || !request.card.body.trim()) return;
  window.dispatchEvent(
    new CustomEvent<ForwardRequest>(FORWARD_TO_CHAT_EVENT, {
      detail: request,
    }),
  );
}
