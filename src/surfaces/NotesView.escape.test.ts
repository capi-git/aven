// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NotesView } from "./NotesView";

const notesMock = vi.hoisted(() => ({
  loadNotes: vi.fn(async () => [] as Array<Record<string, unknown>>),
  upsertNote: vi.fn(),
}));

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));
vi.mock("../lib/notes", () => ({
  loadNotes: notesMock.loadNotes,
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  notePreview: vi.fn(),
  noteSourceProject: vi.fn(),
  noteTitle: vi.fn(),
  upsertNote: notesMock.upsertNote,
  requestAddNoteToChat: vi.fn(),
}));

it("lets a visible child dialog handle Escape before closing Notes", async () => {
  notesMock.loadNotes.mockResolvedValue([]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.getClientRects = () =>
    [new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList;
  try {
    await act(async () => root.render(createElement(NotesView, { onClose })));
    container.append(dialog);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(onClose).not.toHaveBeenCalled();

    dialog.remove();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("serializes title blur saves so an older write cannot finish last", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = {
    id: "note-1",
    slug: "note-1",
    title: "Original",
    body: "Content",
    createdAt: 1,
    updatedAt: 1,
  };
  notesMock.loadNotes.mockResolvedValue([original]);
  const pending: Array<(value: typeof original) => void> = [];
  notesMock.upsertNote.mockImplementation(
    (next: typeof original) =>
      new Promise((resolve) => {
        pending.push((value) => resolve({ ...next, ...value }));
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(NotesView, { onClose: vi.fn() })),
    );
    const title = container.querySelector(
      'input[aria-label="Note title"]',
    )! as HTMLInputElement;
    const editAndBlur = async (value: string) => {
      await act(async () => {
        title.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(title, value);
        title.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => title.blur());
    };
    await editAndBlur("First");
    expect(notesMock.upsertNote).toHaveBeenCalledTimes(1);
    await editAndBlur("Second");
    expect(notesMock.upsertNote).toHaveBeenCalledTimes(1);
    await act(async () => pending.shift()!({ ...original, title: "First" }));
    expect(notesMock.upsertNote).toHaveBeenCalledTimes(2);
    expect(notesMock.upsertNote.mock.calls[1][0]).toMatchObject({
      title: "Second",
    });
    await act(async () => pending.shift()!({ ...original, title: "Second" }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    notesMock.upsertNote.mockReset();
    vi.unstubAllGlobals();
  }
});
