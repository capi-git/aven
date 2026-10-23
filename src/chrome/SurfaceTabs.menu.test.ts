// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newChangesTab,
  newFileTab,
  newPlanTab,
  newTerminalFile,
} from "../lib/layout";
import { REVEAL_LABEL } from "../lib/platform";
import { SurfaceTabs, fileTabMenuItems } from "./SurfaceTabs";

const mocks = vi.hoisted(() => ({
  reveal: vi.fn(async (_path: string) => {}),
  copy: vi.fn(async (_text: string) => {}),
}));
vi.mock("../hooks/useSortable", () => ({
  useSortable: () => ({
    draggingId: null,
    toIndex: null,
    fromIndex: null,
    setContainerRef: () => {},
    setItemRef: () => {},
    onItemPointerDown: () => {},
    consumeClick: () => false,
  }),
}));
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  revealPath: mocks.reveal,
}));
vi.mock("../lib/clipboard", () => ({ copyText: mocks.copy }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

type Props = ComponentProps<typeof SurfaceTabs>;
let root: Root;
let host: HTMLElement;
let props: Props;
const notes = newFileTab(
  "/Users/me/Documents/Stanislaus impressions.md",
  "/repo",
);
const app = newFileTab("/repo/src/App.tsx", "/repo");

const tab = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (node) => node.textContent?.trim() === label,
  )!;
const menu = () => document.querySelector('[role="menu"]');
const menuLabels = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    (item) => item.textContent?.trim(),
  );
const pick = async (label: string) => {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((node) => node.textContent?.trim() === label);
  if (!item) throw new Error(`No menu item ${label}`);
  await act(async () => item.click());
};
const render = async (patch: Partial<Props> = {}) => {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(SurfaceTabs, props)));
};
const rightClick = async (node: HTMLElement) => {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 12,
  });
  await act(async () => node.dispatchEvent(event));
  return event;
};
const keydown = async (node: HTMLElement, init: KeyboardEventInit) => {
  await act(async () =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    ),
  );
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  mocks.reveal.mockClear();
  mocks.copy.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    files: [notes, app],
    activeFileId: app.id,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onReorder: vi.fn(),
    onAddToChat: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("file tab menu", () => {
  it("lists add to chat, reveal, copy path and close", () => {
    expect(
      fileTabMenuItems(true).flatMap((item) =>
        item.kind === "item" ? [item.label] : [],
      ),
    ).toEqual(["Add to chat", REVEAL_LABEL, "Copy path", "Close"]);
    expect(
      fileTabMenuItems(false).flatMap((item) =>
        item.kind === "item" ? [item.id] : [],
      ),
    ).toEqual(["reveal", "copy-path", "close"]);
  });

  it("opens on right-click of a file tab without selecting it", async () => {
    await render();
    const event = await rightClick(tab("Stanislaus impressions.md"));
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("aria-label")).toBe(
      "Actions for Stanislaus impressions.md",
    );
    expect(menuLabels()).toEqual([
      "Add to chat",
      REVEAL_LABEL,
      "Copy path",
      "Close",
    ]);
    expect(props.onSelectFile).not.toHaveBeenCalled();
  });

  it("adds the right-clicked file to a chat", async () => {
    await render();
    await rightClick(tab("Stanislaus impressions.md"));
    await pick("Add to chat");
    expect(props.onAddToChat).toHaveBeenCalledExactlyOnceWith(notes.id);
    expect(menu()).toBeNull();
  });

  it("reveals the file in the file manager", async () => {
    await render();
    await rightClick(tab("Stanislaus impressions.md"));
    await pick(REVEAL_LABEL);
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(notes.path);
  });

  it("copies the file's full path", async () => {
    await render();
    await rightClick(tab("App.tsx"));
    await pick("Copy path");
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("/repo/src/App.tsx");
  });

  it("closes the tab like its close button", async () => {
    await render();
    await rightClick(tab("App.tsx"));
    await pick("Close");
    expect(props.onCloseFile).toHaveBeenCalledExactlyOnceWith(app.id);
  });

  it("opens from the keyboard with Shift+F10 or the menu key", async () => {
    await render();
    await keydown(tab("App.tsx"), { key: "F10", shiftKey: true });
    expect(menu()?.getAttribute("aria-label")).toBe("Actions for App.tsx");
    await keydown(document.querySelector('[role="menu"]')!, {
      key: "Escape",
    });
    await render();
    await keydown(tab("Stanislaus impressions.md"), { key: "ContextMenu" });
    expect(menu()?.getAttribute("aria-label")).toBe(
      "Actions for Stanislaus impressions.md",
    );
    expect(props.onSelectFile).not.toHaveBeenCalled();
  });

  it("leaves out add to chat where nothing can take the file", async () => {
    await render({ onAddToChat: undefined });
    await rightClick(tab("App.tsx"));
    expect(menuLabels()).toEqual([REVEAL_LABEL, "Copy path", "Close"]);
  });

  it("gives terminals, plans and the changes view no file menu", async () => {
    const plan = newPlanTab("session", "block", "Plan", "/repo");
    const changes = newChangesTab("/repo");
    const terminal = newTerminalFile("/repo");
    await render({ files: [plan, changes, terminal] });
    for (const label of ["Plan", "Changes", "repo"]) {
      const event = await rightClick(tab(label));
      expect(event.defaultPrevented).toBe(false);
      expect(menu()).toBeNull();
    }
  });
});
