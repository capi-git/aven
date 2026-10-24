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

async function menuItem(botOn: boolean, onBotSettings: () => void) {
  await act(async () =>
    root.render(
      createElement(PersonalProjectRow, {
        path: "/work/site",
        active: false,
        expanded: false,
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        botOn,
        onBotSettings,
      }),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => /bot/i.test(entry.textContent ?? ""),
  );
}

it("offers Add a bot for a project without one, and its settings once it has one", async () => {
  const onBotSettings = vi.fn();
  const add = await menuItem(false, onBotSettings);
  expect(add?.textContent).toContain("Add a bot");
  await act(async () => add!.click());
  expect(onBotSettings).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(host);
  const settings = await menuItem(true, onBotSettings);
  expect(settings?.textContent).toContain("Bot settings…");
});
