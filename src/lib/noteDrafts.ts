import { noteTitle, upsertNote, type Note } from "./notes";
import { registerWorkspaceDraftFlusher } from "./workspaceDraftFlush";

type NoteDraftSnapshot = {
  title: string;
  body: string;
  saved: Note;
  error: string | null;
  deleting: boolean;
};

/** One draft and writer per note, including while its editor is closed. */
const drafts = new Map<string, NoteDraft>();
const savedListeners = new Set<(note: Note) => void>();

export function subscribeSavedNoteDrafts(listener: (note: Note) => void) {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

export function getNoteDraft(note: Note): NoteDraft {
  let draft = drafts.get(note.id);
  if (!draft) {
    draft = new NoteDraft(note);
    drafts.set(note.id, draft);
  }
  return draft;
}

class NoteDraft {
  private snapshot: NoteDraftSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private deletion: Promise<void> | null = null;
  private unregister: (() => void) | null = null;
  private revision = 0;
  private deleted = false;

  constructor(note: Note) {
    this.snapshot = {
      title: note.title,
      body: note.body,
      saved: note,
      error: null,
      deleting: false,
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) void this.flush().catch(() => undefined);
    };
  };

  private publish(patch: Partial<NoteDraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private dirty() {
    const { title, body, saved } = this.snapshot;
    return (
      (title.trim() || noteTitle(body)) !== saved.title || body !== saved.body
    );
  }

  private cancelTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private register() {
    this.unregister ??= registerWorkspaceDraftFlusher(this.flush);
  }

  private releaseIfClean() {
    if (this.writing || this.deletion || this.dirty()) return;
    this.unregister?.();
    this.unregister = null;
    // React may immediately resubscribe after an effect cleanup. Only retire a
    // settled, unobserved draft; a pending/failed save must outlive its editor.
    queueMicrotask(() => {
      if (
        !this.listeners.size &&
        !this.writing &&
        !this.deletion &&
        !this.dirty()
      ) {
        if (drafts.get(this.snapshot.saved.id) === this) {
          drafts.delete(this.snapshot.saved.id);
        }
      }
    });
  }

  edit = (patch: Partial<Pick<NoteDraftSnapshot, "title" | "body">>) => {
    if (this.deleted) return;
    this.revision += 1;
    this.publish({ ...patch, error: null });
    this.register();
    this.cancelTimer();
    if (!this.deletion) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => undefined);
      }, 400);
    }
  };

  flush = (): Promise<void> => {
    this.cancelTimer();
    if (this.deletion) return this.deletion;
    if (this.writing) return this.writing;
    if (this.deleted || !this.dirty()) {
      this.releaseIfClean();
      return Promise.resolve();
    }
    this.register();
    // Schedule the writer after assigning its promise, even when an injected
    // transport throws synchronously. Later edits are drained by the same loop.
    this.writing = Promise.resolve()
      .then(async () => {
        while (!this.deleted && !this.deletion && this.dirty()) {
          const { title, body, saved: previous } = this.snapshot;
          const revision = this.revision;
          const saved = await upsertNote({
            id: previous.id,
            title: title.trim() || noteTitle(body),
            body,
          });
          this.publish({
            saved,
            error: null,
            ...(revision === this.revision || this.snapshot.title === title
              ? { title: saved.title }
              : {}),
            ...(revision === this.revision || this.snapshot.body === body
              ? { body: saved.body }
              : {}),
          });
          for (const listener of savedListeners) listener(saved);
        }
      })
      .catch((error: unknown) => {
        this.publish({
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        this.writing = null;
        this.releaseIfClean();
      });
    return this.writing;
  };

  remove = (deleteNote: () => void | Promise<void>): Promise<void> => {
    if (this.deletion) return this.deletion;
    if (this.deleted) return Promise.resolve();
    this.cancelTimer();
    this.publish({ deleting: true });
    this.register();
    const writing = this.writing;
    this.deletion = Promise.resolve()
      .then(async () => {
        // Explicit deletion can proceed even if the last edit could not save.
        await writing?.catch(() => undefined);
        await deleteNote();
        this.deleted = true;
        this.unregister?.();
        this.unregister = null;
        drafts.delete(this.snapshot.saved.id);
      })
      .catch((error: unknown) => {
        this.publish({
          deleting: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        this.deletion = null;
        this.releaseIfClean();
      });
    return this.deletion;
  };
}
