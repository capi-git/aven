import { sanitizeComposerDraft } from "./composerDrafts";
import { persistableAttachment } from "./attachments";
import { HARNESSES, type HarnessId, type QueuedMessage } from "./session";

/** Keep accepted work and its attachment bytes, excluding transient UI fields. */
export function persistedMessageQueue(raw: unknown): QueuedMessage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((value): QueuedMessage[] => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      !value.id ||
      seen.has(value.id) ||
      typeof value.text !== "string"
    )
      return [];
    const draft = sanitizeComposerDraft(value);
    if (!draft) return [];
    seen.add(value.id);
    const result: QueuedMessage = {
      id: value.id,
      text: draft.text,
      attachments: draft.attachments.map((file) =>
        file.path ? persistableAttachment(file) : file,
      ),
    };
    if (
      value.intent === "plan" ||
      value.intent === "default" ||
      value.intent === "build" ||
      value.intent === "orchestrate"
    )
      result.intent = value.intent;
    const note = value.noteCard;
    if (
      note &&
      [note.id, note.slug, note.title, note.body].every(
        (item) => typeof item === "string",
      )
    ) {
      result.noteCard = {
        id: note.id,
        slug: note.slug,
        title: note.title,
        body: note.body,
        ...(typeof note.sourceCwd === "string"
          ? { sourceCwd: note.sourceCwd }
          : {}),
      };
    }
    const card = value.handoffCard;
    if (
      card &&
      HARNESSES.includes(card.from as HarnessId) &&
      HARNESSES.includes(card.to as HarnessId) &&
      typeof card.brief === "string"
    ) {
      result.handoffCard = {
        from: card.from,
        to: card.to,
        brief: card.brief,
        ...(typeof card.request === "string" ? { request: card.request } : {}),
        ...(Number.isFinite(card.files) && card.files >= 0
          ? { files: card.files }
          : {}),
      };
    }
    return [result];
  });
}

/** Reopening a saved queue must never start a provider request by itself. */
export function restoredMessageQueue(raw: unknown) {
  const queuedMessages = persistedMessageQueue(raw);
  return {
    queuedMessages: queuedMessages.length ? queuedMessages : undefined,
    queueStatus: queuedMessages.length ? ("paused" as const) : undefined,
  };
}
