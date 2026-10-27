// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";

vi.mock("../lib/fs", () => ({
  basename: (path: string) => path.split("/").pop() ?? path,
  revealPath: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
  isTauri: () => false,
}));

const { PersonalProjectRow } = await import("./PersonalProjectRow");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (onOpenBoard?: () => void) =>
  act(async () =>
    root.render(
      createElement(PersonalProjectRow, {
        path: "/work/site",
        active: false,
        expanded: false,
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onOpenBoard,
      }),
    ),
  );

it("opens the project's board from its menu, with no icon of its own on the row", async () => {
  const onOpenBoard = vi.fn();
  await render(onOpenBoard);
  // The row's hover actions are fold, New chat and ···; the board is in ···
  // (and on the toolbar's strip), so its name keeps the room.
  expect(host.querySelector(".personal-project-board")).toBeNull();
  expect(host.querySelector('[aria-label="Open site board"]')).toBeNull();

  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((entry) => entry.textContent?.includes("Open board"))!;
  expect(item).toBeTruthy();
  await act(async () => item.click());
  expect(onOpenBoard).toHaveBeenCalledTimes(1);
});

it("offers no board where the sidebar cannot open one", async () => {
  await render();
  expect(host.querySelector(".personal-project-board")).toBeNull();
});
