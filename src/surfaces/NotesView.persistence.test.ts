// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotesView } from "./NotesView";
import { getNoteDraft } from "../lib/noteDrafts";
import { flushWorkspaceDrafts } from "../lib/workspaceDraftFlush";

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
  await getNoteDraft(note).remove(() => {});
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function deleteButton() {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete",
  )!;
}

async function editTitle(value: string, blur = true) {
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
  if (blur) await act(async () => title.blur());
}

it("awaits an active note's last edit during the workspace shutdown flush", async () => {
  let finish!: (value: typeof note) => void;
  notesMock.upsertNote.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await editTitle("Last edit before quitting", false);
  let finished = false;
  let flushing!: Promise<void>;
  await act(async () => {
    flushing = flushWorkspaceDrafts().then(() => {
      finished = true;
    });
  });
  expect(notesMock.upsertNote).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Last edit before quitting" }),
  );
  expect(finished).toBe(false);
  await act(async () => {
    finish({ ...note, title: "Last edit before quitting" });
    await flushing;
  });
  expect(finished).toBe(true);
});

it("shows save errors and rejects the shutdown flush until the note saves", async () => {
  notesMock.upsertNote.mockRejectedValue(new Error("Disk unavailable"));
  await editTitle("Keep this edit", false);
  await act(async () => {
    await expect(flushWorkspaceDrafts()).rejects.toThrow("Disk unavailable");
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Disk unavailable",
  );
  notesMock.upsertNote.mockImplementation(async (value) => ({
    ...note,
    ...value,
  }));
  await act(async () => {
    await flushWorkspaceDrafts();
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("reopens a pending draft instead of the old parent value", async () => {
  let finish!: (value: typeof note) => void;
  notesMock.upsertNote.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await editTitle("Newer title");
  // Remount before the save completes; loadNotes still returns the old record.
  await act(async () =>
    root.render(
      createElement(NotesView, { key: "reopened", onClose: vi.fn() }),
    ),
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
      ?.value,
  ).toBe("Newer title");
  await act(async () => {
    finish({ ...note, title: "Newer title" });
  });
  await act(async () => {
    await flushWorkspaceDrafts();
  });
  expect(notesMock.upsertNote).toHaveBeenCalledTimes(1);
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
      ?.value,
  ).toBe("Newer title");
});

it("updates the note list when a save finishes while another note is selected", async () => {
  const second = { ...note, id: "second-note", title: "Second" };
  notesMock.loadNotes.mockResolvedValue([note, second]);
  await act(async () =>
    root.render(
      createElement(NotesView, { key: "two-notes", onClose: vi.fn() }),
    ),
  );
  let finish!: (value: typeof note) => void;
  notesMock.upsertNote.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await editTitle("Saved in background");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[title="Second"]')!
      .click(),
  );
  await act(async () => {
    finish({ ...note, title: "Saved in background" });
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[title="Saved in background"]')!
      .click(),
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
      ?.value,
  ).toBe("Saved in background");
  expect(notesMock.upsertNote).toHaveBeenCalledTimes(1);
});

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
