import type { Attachment } from "./session";

export type ComposerDraft = {
  text: string;
  attachments: Attachment[];
  updatedAt: number;
};

type DraftPatch = { text?: string; attachments?: Attachment[] };
type DraftStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_PREFIX = "monocode.composerDraft.v1:";
const SAVE_DELAY_MS = 250;

function sameAttachments(left: Attachment[], right: Attachment[]): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const other = right[index];
      return (
        file.id === other.id &&
        file.name === other.name &&
        file.mimeType === other.mimeType &&
        file.kind === other.kind &&
        file.size === other.size &&
        file.path === other.path &&
        file.data === other.data
      );
    })
  );
}

/** Object URLs belong to a mounted composer and cannot survive a webview restart. */
export function sanitizeComposerDraft(raw: unknown): ComposerDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.text !== "string") return undefined;
  const attachments: Attachment[] = [];
  if (Array.isArray(value.attachments)) {
    for (const rawAttachment of value.attachments.slice(0, 20)) {
      if (!rawAttachment || typeof rawAttachment !== "object") continue;
      const file = rawAttachment as Record<string, unknown>;
      if (
        typeof file.id !== "string" ||
        !file.id ||
        typeof file.name !== "string" ||
        typeof file.mimeType !== "string" ||
        !["image", "audio", "file"].includes(file.kind as string) ||
        typeof file.size !== "number" ||
        !Number.isFinite(file.size) ||
        file.size < 0
      )
        continue;
      const path =
        typeof file.path === "string" && file.path ? file.path : undefined;
      const data =
        typeof file.data === "string" && file.data ? file.data : undefined;
      // A name alone cannot be sent; preserve either its file path or pasted bytes.
      if (!path && !data) continue;
      attachments.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        kind: file.kind as Attachment["kind"],
        size: file.size,
        ...(path ? { path } : {}),
        ...(data ? { data } : {}),
      });
    }
  }
  return {
    text: value.text,
    attachments,
    updatedAt:
      typeof value.updatedAt === "number" &&
      Number.isFinite(value.updatedAt) &&
      value.updatedAt >= 0
        ? value.updatedAt
        : 0,
  };
}

/**
 * Drafts are local UI state, separate from sent conversation history. The native
 * workspace snapshot is a second durable copy, including large pasted images
 * that may exceed WebKit's localStorage quota. No IPC runs on a keystroke.
 */
export function createComposerDraftStore(
  storage: () => DraftStorage | undefined,
  lifecycle?: EventTarget,
) {
  const drafts = new Map<string, ComposerDraft>();
  const dirty = new Set<string>();
  const owners = new Map<string, number>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const readStored = (id: string): ComposerDraft | undefined => {
    try {
      const raw = storage()?.getItem(STORAGE_PREFIX + encodeURIComponent(id));
      return raw ? sanitizeComposerDraft(JSON.parse(raw)) : undefined;
    } catch {
      return undefined;
    }
  };
  const read = (id: string): ComposerDraft | undefined => {
    if (!id) return undefined;
    const cached = drafts.get(id);
    if (cached) return cached;
    const stored = readStored(id);
    if (stored) drafts.set(id, stored);
    return stored;
  };
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const id of dirty) {
      const draft = drafts.get(id);
      if (!draft) continue;
      try {
        const target = storage();
        if (!target) continue;
        target.setItem(
          STORAGE_PREFIX + encodeURIComponent(id),
          JSON.stringify(draft),
        );
        dirty.delete(id);
      } catch {
        // Retain the complete draft for the native snapshot and a later retry.
        // Do not schedule idle retries or discard pasted bytes to fit a quota.
      }
    }
  };
  const update = (id: string, patch: DraftPatch) => {
    if (!id) return;
    const previous = read(id);
    const draft = sanitizeComposerDraft({
      text: patch.text ?? previous?.text ?? "",
      attachments: patch.attachments ?? previous?.attachments ?? [],
      updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
    })!;
    if (
      previous &&
      previous.text === draft.text &&
      sameAttachments(previous.attachments, draft.attachments)
    )
      return;
    drafts.set(id, draft);
    dirty.add(id);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
    for (const listener of listeners) listener();
  };
  const restore = (id: string, raw: unknown): ComposerDraft | undefined => {
    const saved = sanitizeComposerDraft(raw);
    const current = read(id);
    // A later local edit or explicit clear wins over an older workspace save.
    if (!id || !saved || (current && current.updatedAt > saved.updatedAt))
      return current;
    drafts.set(id, saved);
    return saved;
  };
  /** Accept a peer webview's draft without changing its ordering timestamp. */
  const importDraft = (id: string, raw: unknown): ComposerDraft | undefined => {
    const previous = read(id);
    const accepted = restore(id, raw);
    if (!accepted || accepted === previous) return accepted;
    dirty.add(id);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
    for (const listener of listeners) listener();
    return accepted;
  };
  const retain = (id: string) => {
    owners.set(id, (owners.get(id) ?? 0) + 1);
    return () => {
      const count = Math.max(0, (owners.get(id) ?? 1) - 1);
      if (count) { owners.set(id, count); return; }
      owners.delete(id);
      flush();
      const cached = drafts.get(id), stored = readStored(id);
      // Only release memory after verifying the durable copy. Quota failures,
      // imported newer drafts and clear-ordering timestamps must survive.
      if (!dirty.has(id) && cached && stored && stored.updatedAt === cached.updatedAt &&
          stored.text === cached.text && sameAttachments(stored.attachments, cached.attachments)) drafts.delete(id);
    };
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  lifecycle?.addEventListener("beforeunload", flush);
  lifecycle?.addEventListener("pagehide", flush);
  return {
    read,
    update,
    restore,
    importDraft,
    subscribe,
    retain,
    flush,
    dispose() {
      flush();
      lifecycle?.removeEventListener("beforeunload", flush);
      lifecycle?.removeEventListener("pagehide", flush);
      listeners.clear();
    },
  };
}

let store: ReturnType<typeof createComposerDraftStore> | undefined;
function currentStore() {
  return (store ??= createComposerDraftStore(
    () => (typeof localStorage === "undefined" ? undefined : localStorage),
    typeof window === "undefined" ? undefined : window,
  ));
}
export const readComposerDraft = (id: string) => currentStore().read(id);
export const updateComposerDraft = (id: string, patch: DraftPatch) =>
  currentStore().update(id, patch);
export const restoreComposerDraft = (id: string, raw: unknown) =>
  currentStore().restore(id, raw);
export const importComposerDraft = (id: string, raw: unknown) =>
  currentStore().importDraft(id, raw);
export const subscribeComposerDrafts = (listener: () => void) =>
  currentStore().subscribe(listener);
export const flushComposerDrafts = () => currentStore().flush();

export const retainComposerDraft = (id: string) => currentStore().retain(id);
