import type { Attachment } from "./session";

export const ADD_TO_CHAT_EVENT = "monocode:add-to-chat";

/** `mention` adds `@label` to the end of the message, on its line. */
export type AddToChatMode = "quote" | "plain" | "mention";

export type AddToChatRequest = {
  text: string;
  mode: AddToChatMode;
  attachments?: Attachment[];
  /** A file to mention; the message box writes its `@` label. */
  path?: string;
  /** The chat to add to; absent means the current add-to-chat target. */
  sessionId?: string;
};

export type QuoteRequest = {
  id: number;
  text: string;
  mode?: AddToChatMode;
  attachments?: Attachment[];
  /** A file to mention: the composer turns it into its `@` label. */
  mention?: string;
};

export function requestAddToChat(
  text: string,
  mode: AddToChatMode = "quote",
  attachments?: Attachment[],
  sessionId?: string,
) {
  if (typeof window === "undefined") return;
  const value = text.replace(/\r\n?/g, "\n").trim();
  if (!value && !attachments?.length) return;
  window.dispatchEvent(
    new CustomEvent<AddToChatRequest>(ADD_TO_CHAT_EVENT, {
      detail: {
        text: value,
        mode,
        ...(attachments?.length ? { attachments } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
    }),
  );
}

/** Mention the file at `path` in a chat's message box (see `QuoteRequest.mention`). */
export function requestAddFileToChat(path: string, sessionId?: string) {
  if (typeof window === "undefined" || !path.trim()) return;
  window.dispatchEvent(
    new CustomEvent<AddToChatRequest>(ADD_TO_CHAT_EVENT, {
      detail: {
        text: "",
        mode: "mention",
        path,
        ...(sessionId ? { sessionId } : {}),
      },
    }),
  );
}

export type QuoteConsumption = {
  draft: string;
  consumedId: number | null;
  changed: boolean;
};

export function isMarkdownBlockquotePosition(
  text: string,
  position: number,
): boolean {
  const index = Math.max(0, Math.min(position, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return /^ {0,3}>/.test(text.slice(lineStart, index));
}

export function appendSelectionQuote(draft: string, text: string): string {
  const selected = text.replace(/\r\n?/g, "\n").trim();
  if (!selected) return draft;

  const quote = selected
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return joinComposerInsert(draft, quote);
}

export function appendComposerInsert(draft: string, text: string): string {
  const selected = text.replace(/\r\n?/g, "\n").trim();
  if (!selected) return draft;
  return joinComposerInsert(draft, selected);
}

/** `@label` after the message, a space apart, ready to type on. */
export function appendMention(draft: string, label: string): string {
  const value = label.trim();
  if (!value) return draft;
  const separator = draft.length === 0 || /\s$/.test(draft) ? "" : " ";
  return `${draft}${separator}@${value} `;
}

export function consumeQuoteRequest(
  draft: string,
  consumedId: number | null,
  request: QuoteRequest | undefined,
): QuoteConsumption {
  if (!request || (consumedId !== null && request.id <= consumedId)) {
    return { draft, consumedId, changed: false };
  }

  const next =
    request.mode === "plain"
      ? appendComposerInsert(draft, request.text)
      : request.mode === "mention"
        ? appendMention(draft, request.text)
        : appendSelectionQuote(draft, request.text);
  return {
    draft: next,
    consumedId: request.id,
    changed: next !== draft,
  };
}

export function acknowledgeQuoteRequest(
  current: QuoteRequest | undefined,
  handledId: number,
): QuoteRequest | undefined {
  return current?.id === handledId ? undefined : current;
}

function joinComposerInsert(draft: string, block: string): string {
  const separator =
    draft.length === 0
      ? ""
      : draft.endsWith("\n\n")
        ? ""
        : draft.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${draft}${separator}${block}\n\n`;
}
