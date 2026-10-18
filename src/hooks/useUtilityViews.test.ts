// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveNotesEnabled } from "../lib/settings";
import { useUtilityViews } from "./useUtilityViews";

type Views = ReturnType<typeof useUtilityViews>;
let views: Views;
let root: Root;
let host: HTMLElement;

function Harness() {
  views = useUtilityViews();
  return null;
}

function openViews(): string[] {
  return (
    [
      ["home", views.homeViewOpen],
      ["settings", views.settingsOpen],
      ["search", views.searchViewOpen],
      ["inbox", views.inboxViewOpen],
      ["automations", views.automationsViewOpen],
      ["notes", views.notesViewOpen],
      ["filePicker", views.filePickerOpen],
    ] as const
  )
    .filter(([, open]) => open)
    .map(([name]) => name);
}

beforeEach(async () => {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps at most one utility open", async () => {
  const opens = [
    () => views.onOpenSearch(),
    () => views.onOpenInbox(),
    () => views.onOpenAutomations(),
    () => views.onOpenNotes(),
    () => views.onOpenSettings(),
  ];
  for (const order of [
    [0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0],
    [2, 4, 0, 3, 1],
  ]) {
    for (const index of order) {
      await act(async () => opens[index]());
      expect(openViews()).toHaveLength(1);
    }
  }
});

it("returns from Settings to the utility it replaced", async () => {
  await act(async () => views.onOpenSearch());
  await act(async () => views.openSettings("providers"));
  expect(openViews()).toEqual(["settings"]);
  expect(views.settingsSection).toBe("providers");
  await act(async () => views.onCloseSettings());
  expect(openViews()).toEqual(["search"]);
});

it("closes Notes when Notes is turned off", async () => {
  await act(async () => views.onOpenNotes());
  expect(openViews()).toEqual(["notes"]);
  await act(async () => saveNotesEnabled(false));
  expect(views.notesEnabled).toBe(false);
  expect(openViews()).toEqual([]);
  // And it does not reopen while off.
  await act(async () => views.onOpenNotes());
  expect(openViews()).toEqual([]);
});

it("opens Home over every utility and the file picker", async () => {
  await act(async () => {
    views.onOpenInbox();
    views.setFilePickerOpen(true);
  });
  await act(async () => views.onOpenHome());
  expect(openViews()).toEqual(["home"]);
});

it("closes the five utilities but leaves Home and the file picker", async () => {
  await act(async () => {
    views.setHomeViewOpen(true);
    views.setFilePickerOpen(true);
    views.onOpenAutomations();
  });
  // Opening a utility closes the file picker, so reopen it.
  await act(async () => views.setFilePickerOpen(true));
  await act(async () => views.closeUtilityViews());
  expect(openViews()).toEqual(["home", "filePicker"]);
});

it("shows the workspace over Home and every utility for a new chat", async () => {
  // The sidebar's New chat pressed over Home.
  await act(async () => views.setHomeViewOpen(true));
  await act(async () => views.showWorkspace());
  expect(openViews()).toEqual([]);
  // Starting an Inbox item or adding a note to a chat from a utility opened
  // over Home must not leave Home in front of the new chat.
  for (const open of [
    () => views.onOpenInbox(),
    () => views.onOpenNotes(),
    () => views.onOpenSearch(),
    () => views.onOpenAutomations(),
    () => views.onOpenSettings(),
  ]) {
    await act(async () => views.onOpenHome());
    await act(async () => open());
    await act(async () => views.showWorkspace());
    expect(openViews()).toEqual([]);
  }
});

it("returns focus to the control that opened a utility", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  await act(async () => views.onOpenSearch());
  // The utility takes focus while it is open.
  opener.blur();
  await act(async () => views.onOpenInbox());
  await act(async () => views.onLeaveInbox());
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
