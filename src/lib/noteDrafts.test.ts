import { afterEach, expect, it, vi } from "vitest";
import { getNoteDraft } from "./noteDrafts";
import { upsertNote, type Note, type NoteUpsert } from "./notes";
import { flushWorkspaceDrafts } from "./workspaceDraftFlush";

vi.mock("./notes", async (original) => ({
  ...(await original<typeof import("./notes")>()),
  upsertNote: vi.fn(),
}));

const note: Note = {
  id: "draft-note",
  slug: "draft-note",
  title: "Original",
  body: "Original body",
  createdAt: 1,
  updatedAt: 1,
};

afterEach(async () => {
  await getNoteDraft(note).remove(() => {});
  vi.resetAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("flushes the last keystroke for quit without waiting for the debounce", async () => {
  const draft = getNoteDraft(note);
  const write = deferred<Note>();
  vi.mocked(upsertNote).mockReturnValue(write.promise);
  draft.edit({ body: "Last keystroke" });
  let finished = false;
  const quitting = flushWorkspaceDrafts().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(upsertNote).toHaveBeenCalledWith({
    id: note.id,
    title: note.title,
    body: "Last keystroke",
  });
  expect(finished).toBe(false);
  write.resolve({ ...note, body: "Last keystroke" });
  await quitting;
  expect(finished).toBe(true);
});

it("retains failed edits after the editor closes and rejects quit until retry succeeds", async () => {
  const draft = getNoteDraft(note);
  const release = draft.subscribe(() => {});
  vi.mocked(upsertNote).mockRejectedValue(new Error("Disk unavailable"));
  draft.edit({ body: "Keep this edit" });
  release();
  await expect(flushWorkspaceDrafts()).rejects.toThrow("Disk unavailable");
  const reopened = getNoteDraft(note);
  expect(reopened).toBe(draft);
  expect(reopened.getSnapshot()).toMatchObject({
    body: "Keep this edit",
    error: "Disk unavailable",
  });
  vi.mocked(upsertNote).mockImplementation(async (value) => ({
    ...note,
    ...value,
  }));
  await flushWorkspaceDrafts();
  expect(reopened.getSnapshot().saved.body).toBe("Keep this edit");
});

it("shares pending drafts across stale remounts and serializes later edits", async () => {
  const draft = getNoteDraft(note);
  const first = deferred<Note>();
  const second = deferred<Note>();
  vi.mocked(upsertNote)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  draft.edit({ body: "New body" });
  const saving = draft.flush();
  await Promise.resolve();
  // The parent may still hold the original note while the first save is pending.
  const reopened = getNoteDraft(note);
  expect(reopened.getSnapshot().body).toBe("New body");
  reopened.edit({ title: "New title" });
  const flushing = flushWorkspaceDrafts();
  expect(upsertNote).toHaveBeenCalledTimes(1);
  first.resolve({ ...note, body: "New body" });
  await Promise.resolve();
  expect(upsertNote).toHaveBeenCalledTimes(2);
  expect(upsertNote).toHaveBeenLastCalledWith({
    id: note.id,
    title: "New title",
    body: "New body",
  });
  second.resolve({ ...note, title: "New title", body: "New body" });
  await Promise.all([saving, flushing]);
  expect(reopened.getSnapshot().saved.body).toBe("New body");
});

it("waits for a pending save before deleting and ignores late edits after deletion", async () => {
  const draft = getNoteDraft(note);
  const write = deferred<Note>();
  vi.mocked(upsertNote).mockReturnValue(write.promise);
  draft.edit({ body: "Updated" });
  const saving = draft.flush();
  await Promise.resolve();
  const remove = vi.fn();
  const deletion = draft.remove(remove);
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
  write.resolve({ ...note, body: "Updated" });
  await Promise.all([saving, deletion]);
  expect(remove).toHaveBeenCalledOnce();
  draft.edit({ body: "Late image callback" });
  await draft.flush();
  expect(upsertNote).toHaveBeenCalledOnce();
});

it("accepts normalized saved text without continuously resaving it", async () => {
  const draft = getNoteDraft(note);
  vi.mocked(upsertNote).mockImplementation(async (value) => ({
    ...note,
    ...value,
    body: value.body.replaceAll("\r\n", "\n"),
  }));
  draft.edit({ body: "Line one\r\nLine two" });
  await draft.flush();
  expect(upsertNote).toHaveBeenCalledOnce();
  expect(draft.getSnapshot().body).toBe("Line one\nLine two");
});

it("keeps edits made during a failed deletion available to the next flush", async () => {
  const draft = getNoteDraft(note);
  const deletion = deferred<void>();
  const removing = draft.remove(() => deletion.promise);
  draft.edit({ body: "Typed while deletion was pending" });
  const refused = expect(removing).rejects.toThrow("Delete failed");
  deletion.reject(new Error("Delete failed"));
  await refused;
  vi.mocked(upsertNote).mockImplementation(async (value: NoteUpsert) => ({
    ...note,
    ...value,
  }));
  await flushWorkspaceDrafts();
  expect(draft.getSnapshot().saved.body).toBe(
    "Typed while deletion was pending",
  );
});
