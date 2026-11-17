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

const render = (onOpenBoard?: () => void, onNewInCopy?: () => void) =>
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
        onNewInCopy,
      }),
    ),
  );

const menuItems = async () => {
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
};

it("starts a chat in a new copy from the project's menu", async () => {
  const onNewInCopy = vi.fn();
  await render(undefined, onNewInCopy);
  const item = (await menuItems()).find(
    (entry) => entry.textContent === "New chat in a copy",
  );
  expect(item).toBeTruthy();
  await act(async () => item!.click());
  expect(onNewInCopy).toHaveBeenCalledTimes(1);
});

it("offers no copy where the sidebar cannot make one", async () => {
  await render();
  const items = await menuItems();
  expect(items.length).toBeGreaterThan(0);
  expect(
    items.some((entry) => entry.textContent === "New chat in a copy"),
  ).toBe(false);
});
