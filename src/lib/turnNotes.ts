import { useCallback, useSyncExternalStore } from "react";
import {
  createChatRecordStore,
  finiteTime,
  shortText,
  type ChatRecord,
} from "./chatRecords";

/**
 * One-time notes for a chat's next turn: something Aven did for that chat
 * that its agent would not otherwise know, such as committing its changes
 * with Ship it or keeping its version of a race. A note rides ahead of the
 * next message sent to the chat, hidden from the transcript like the
 * shared-work note, and is then dropped. A newer note of the same kind
 * replaces an older one. Notes are saved, so a restart keeps them.
 */

export const TURN_NOTE_TAG = "aven-note";

/** "ship", "race": one note of each kind waits at a time. */
export type TurnNoteKind = "ship" | "race";

export type TurnNote = {
  kind: TurnNoteKind;
  text: string;
  at: number;
  /** A few words the chat's message box shows while the note waits. */
  hint?: string;
};

type TurnNotesRecord = ChatRecord & { notes: TurnNote[] };

const KINDS: readonly TurnNoteKind[] = ["ship", "race"];
/** Longest note kept, in characters. */
export const TURN_NOTE_LIMIT = 4_000;
/** Chats whose notes are kept. */
const CHATS_KEPT = 100;

function readNote(value: unknown): TurnNote | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = KINDS.find((entry) => entry === row.kind);
  const text = shortText(row.text, TURN_NOTE_LIMIT);
  if (!kind || !text || !finiteTime(row.at)) return null;
  const hint = shortText(row.hint, 120);
  return { kind, text, at: row.at, ...(hint ? { hint } : {}) };
}

const store = createChatRecordStore<TurnNotesRecord>({
  key: "aven.turnNotes.v1",
  limit: CHATS_KEPT,
  parse(value) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.sessionId !== "string" || !row.sessionId) return null;
    if (!finiteTime(row.at) || !Array.isArray(row.notes)) return null;
    const notes = row.notes.flatMap((note) => readNote(note) ?? []);
    if (!notes.length) return null;
    return { sessionId: row.sessionId.slice(0, 256), at: row.at, notes };
  },
});

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > TURN_NOTE_LIMIT
    ? `${trimmed.slice(0, TURN_NOTE_LIMIT - 1).trimEnd()}…`
    : trimmed;
}

function put(sessionId: string, notes: readonly TurnNote[]) {
  store.update((current) => {
    const next = { ...current };
    if (notes.length)
      next[sessionId] = {
        sessionId,
        at: Math.max(...notes.map((note) => note.at)),
        notes: [...notes],
      };
    else if (current[sessionId]) delete next[sessionId];
    else return current;
    return next;
  });
}

/** Leave `text` for this chat's next turn, in place of any of its kind. */
export function queueTurnNote(
  sessionId: string,
  note: Omit<TurnNote, "at"> & { at?: number },
): void {
  const text = clip(note.text);
  if (!sessionId || !text) return;
  const entry: TurnNote = {
    kind: note.kind,
    text,
    at: note.at ?? Date.now(),
    ...(note.hint ? { hint: note.hint } : {}),
  };
  const others = (store.snapshot()[sessionId]?.notes ?? []).filter(
    (item) => item.kind !== note.kind,
  );
  put(sessionId, [...others, entry]);
}

/** The notes waiting for this chat's next turn, oldest first. */
export function pendingTurnNotes(sessionId: string): readonly TurnNote[] {
  return store.snapshot()[sessionId]?.notes ?? [];
}

/** Drop a chat's notes, as when it is deleted. */
export function forgetTurnNotes(sessionId: string): void {
  put(sessionId, []);
}

/** The hidden block ahead of a message, or "" without notes. */
export function turnNotesBlock(notes: readonly TurnNote[]): string {
  if (!notes.length) return "";
  const lines = notes.map((note) =>
    notes.length > 1 ? `- ${note.text}` : note.text,
  );
  return `<${TURN_NOTE_TAG}>\nFrom Aven, about this chat. The user's message follows.\n${lines.join("\n")}\n</${TURN_NOTE_TAG}>`;
}

/**
 * The text a turn sends: this chat's waiting notes ahead of `text`, which
 * are taken from the queue. `restore` puts them back when the turn never
 * reached the agent, unless a newer note of the same kind came meanwhile.
 * A provider command (`/compact`) goes untouched, and the notes wait.
 */
export function takeTurnNotes(
  sessionId: string,
  text: string,
): { text: string; restore: () => void } {
  const unchanged = { text, restore: () => {} };
  if (text.trimStart().startsWith("/")) return unchanged;
  const notes = pendingTurnNotes(sessionId);
  if (!notes.length) return unchanged;
  put(sessionId, []);
  return {
    text: `${turnNotesBlock(notes)}\n\n${text}`,
    restore: () => {
      const now = pendingTurnNotes(sessionId);
      const back = notes.filter(
        (note) =>
          !now.some((item) => item.kind === note.kind && item.at >= note.at),
      );
      if (back.length)
        put(
          sessionId,
          [
            ...now.filter(
              (item) => !back.some((note) => note.kind === item.kind),
            ),
            ...back,
          ].sort((a, b) => a.at - b.at),
        );
    },
  };
}

/** The hint of the newest waiting note that has one, kept current. */
export function useTurnNoteHint(sessionId: string | undefined): string | null {
  const read = useCallback(() => {
    if (!sessionId) return null;
    const notes = store.snapshot()[sessionId]?.notes ?? [];
    for (let index = notes.length - 1; index >= 0; index--)
      if (notes[index].hint) return notes[index].hint ?? null;
    return null;
  }, [sessionId]);
  return useSyncExternalStore(store.subscribe, read, read);
}
