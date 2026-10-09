// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";

let root: Root;
let container: HTMLDivElement;
let opener: HTMLButtonElement;
const remove = vi.fn();
function Harness() {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(DeleteWorkspaceDialog, {
        profile: { id: "research", name: "Research", icon: "folder" },
        onCancel: () => setOpen(false),
        onDelete: remove,
      })
    : null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  remove.mockReset();
  container = document.createElement("div");
  opener = document.createElement("button");
  document.body.append(container, opener);
  opener.focus();
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  opener.remove();
  vi.unstubAllGlobals();
});
function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
}
it("explains preserved data and requires explicit confirmation", async () => {
  expect(document.body.textContent).toContain(
    "projects and chats will stay available in Personal",
  );
  expect(document.body.textContent).toContain("running agents are kept");
  expect(document.activeElement).not.toBe(button("Delete workspace"));
  await act(async () => button("Cancel").click());
  expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
it("cancels with Escape", async () => {
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("confirms once and closes", async () => {
  await act(async () => button("Delete workspace").click());
  expect(remove).toHaveBeenCalledExactlyOnceWith("research");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps the dialog open on persistence failure and retries", async () => {
  remove.mockImplementationOnce(() => {
    throw new Error("Could not save workspace changes. Try again.");
  });
  await act(async () => button("Delete workspace").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Try again",
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button("Delete workspace").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
