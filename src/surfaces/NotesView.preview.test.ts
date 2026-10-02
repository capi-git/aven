// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getNoteDraft } from "../lib/noteDrafts";
import { invalidateNotes, loadNotes, type Note } from "../lib/notes";
import { NotesView } from "./NotesView";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));

const stored: Note = {
  id: "preview-note",
  slug: "preview-note",
  title: "Plan",
  body: "Keep this text.",
  createdAt: 1,
  updatedAt: 1,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invalidateNotes();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockImplementation(async (command: string) =>
    command === "notes_list" ? [stored] : null,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await getNoteDraft(stored).remove(() => {});
  container.remove();
  invalidateNotes();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(createElement(NotesView, { onClose: vi.fn() })),
  );
}

const title = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')
    ?.value;

it("shows preloaded notes immediately while refreshing in the background", async () => {
  await loadNotes();
  let finish!: (notes: Note[]) => void;
  invoke.mockReturnValue(
    new Promise<Note[]>((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  expect(title()).toBe("Plan");
  expect(container.textContent).toContain("Keep this text.");
  expect(container.querySelector(".animate-spin")).toBeNull();

  await act(async () => finish([{ ...stored, title: "Updated plan", updatedAt: 2 }]));
  expect(title()).toBe("Updated plan");
});

it("still shows a spinner when no notes have been loaded yet", async () => {
  invoke.mockReturnValue(new Promise<Note[]>(() => {}));
  await render();
  expect(container.querySelector(".animate-spin")).not.toBeNull();
  expect(title()).toBeUndefined();
});

it("keeps a note's consecutive lines on their own lines", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "notes_list"
      ? [{ ...stored, body: "> first line\n> second line\n> third line" }]
      : null,
  );
  await render();
  const quote = container.querySelector<HTMLElement>(
    '[data-streamdown="blockquote"]',
  )!;
  expect(quote.querySelector("p")?.innerHTML).toBe(
    "first line<br>second line<br>third line",
  );
});
