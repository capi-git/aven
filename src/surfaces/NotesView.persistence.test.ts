// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotesView } from "./NotesView";

const notesMock = vi.hoisted(() => ({
  loadNotes: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  upsertNote: vi.fn(),
}));

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));
vi.mock("../lib/notes", async (original) => ({
  ...(await original<typeof import("../lib/notes")>()),
  ...notesMock,
}));

const note = {
  id: "persistence-note",
  slug: "persistence-note",
  title: "Original",
  body: "Content",
  createdAt: 1,
  updatedAt: 1,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notesMock.loadNotes.mockResolvedValue([note]);
  notesMock.upsertNote.mockImplementation(async (next) => ({
    ...note,
    ...next,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(NotesView, { onClose: vi.fn() })),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function deleteButton() {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete",
  )!;
}

async function editTitle(value: string) {
  const title = container.querySelector<HTMLInputElement>(
    'input[aria-label="Note title"]',
  )!;
  await act(async () => {
    title.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(title, value);
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => title.blur());
}

it("continues saving edits after a note deletion fails", async () => {
  notesMock.deleteNote.mockRejectedValue(new Error("Storage unavailable"));
  await act(async () => deleteButton().click());
  expect(notesMock.deleteNote).toHaveBeenCalledWith(note.id);
  expect(container.textContent).toContain("Storage unavailable");

  await editTitle("Keep this edit");
  expect(notesMock.upsertNote).toHaveBeenCalledWith(
    expect.objectContaining({ id: note.id, title: "Keep this edit" }),
  );
});

it("runs only one deletion while its first request is pending", async () => {
  let finish!: () => void;
  notesMock.deleteNote.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    deleteButton().click();
    deleteButton().click();
  });
  expect(notesMock.deleteNote).toHaveBeenCalledTimes(1);
  notesMock.loadNotes.mockResolvedValue([]);
  await act(async () => finish());
});

it("keeps a successful deletion complete without requiring another list read", async () => {
  notesMock.deleteNote.mockResolvedValue(undefined);
  notesMock.loadNotes.mockRejectedValue(new Error("List unavailable"));
  await act(async () => deleteButton().click());
  expect(container.querySelector('input[aria-label="Note title"]')).toBeNull();
  expect(notesMock.loadNotes).toHaveBeenCalledTimes(1);
  expect(notesMock.upsertNote).not.toHaveBeenCalled();
});

it("opens a successfully created note without requiring another list read", async () => {
  const created = {
    ...note,
    id: "new-note",
    title: "Created",
    slug: "created",
  };
  notesMock.createNote.mockResolvedValue(created);
  notesMock.loadNotes.mockRejectedValue(new Error("List unavailable"));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="New note"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
      ?.value,
  ).toBe("Created");
  expect(notesMock.loadNotes).toHaveBeenCalledTimes(1);
});

it("shows a list failure and lets the user retry", async () => {
  notesMock.loadNotes.mockRejectedValueOnce(new Error("List unavailable"));
  await act(async () =>
    root.render(createElement(NotesView, { key: "retry", onClose: vi.fn() })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "List unavailable",
  );
  expect(container.textContent).not.toContain("No notes yet");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[role="alert"] button')!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
      ?.value,
  ).toBe(note.title);
});
