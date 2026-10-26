// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  turnOffProjectBot: vi.fn(async () => null as string | null),
  saveBotSettings: vi.fn(),
}));
vi.mock("../lib/projectBotActions", () => actions);

import { resetProjectBotsCache, updateProjectBot } from "../lib/projectBots";
import { BotSettingsSheet } from "./BotSettingsSheet";

const PATH = "/work/orbit";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  resetProjectBotsCache();
  for (const fn of Object.values(actions)) fn.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetProjectBotsCache();
  vi.unstubAllGlobals();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const switches = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>('[role="switch"]')].map(
    (item) => item.getAttribute("aria-label"),
  );
const button = (label: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );

it("shows three plain switches that apply as you flip them, and nothing else to set", async () => {
  updateProjectBot(PATH, (bot) => ({ ...bot, on: true }));
  const onClose = vi.fn();
  await act(async () =>
    root.render(createElement(BotSettingsSheet, { path: PATH, onClose })),
  );
  expect(switches()).toEqual([
    "Look when a chat finishes",
    "Look when the dev server crashes",
    "Start fixes on its own",
  ]);
  const text = dialog().textContent ?? "";
  expect(text).toContain("orbit's teammate");
  expect(text).toContain(
    "Never pushes or publishes: you ship its fixes. Asks before merging, sending or deleting.",
  );
  expect(text).toContain("Up to 15 runs a day, quiet 11 pm–8 am");
  // No On switch, model pickers, limits section, browser or desktop switches.
  expect(dialog().querySelectorAll("select, [role='combobox']")).toHaveLength(
    0,
  );
  expect(text).not.toMatch(/Sonnet|Opus|browser|other apps|Coming soon/i);
  const fix = dialog().querySelector<HTMLButtonElement>(
    '[aria-label="Start fixes on its own"]',
  )!;
  await act(async () => fix.click());
  expect(actions.saveBotSettings).toHaveBeenCalledWith(PATH, {
    can: { fix: false },
  });
  await act(async () => button("Done")!.click());
  expect(onClose).toHaveBeenCalled();
  expect(actions.turnOffProjectBot).not.toHaveBeenCalled();
});

it("asks before turning a bot off, saying its copy goes, then turns it off", async () => {
  updateProjectBot(PATH, (bot) => ({ ...bot, on: true, name: "Jelly" }));
  const onClose = vi.fn();
  await act(async () =>
    root.render(createElement(BotSettingsSheet, { path: PATH, onClose })),
  );
  await act(async () => button("Turn off")!.click());
  expect(dialog().textContent).toContain("Turn off Jelly?");
  expect(dialog().textContent).toContain("its copy of orbit is removed");
  expect(actions.turnOffProjectBot).not.toHaveBeenCalled();
  await act(async () => button("Turn off")!.click());
  expect(actions.turnOffProjectBot).toHaveBeenCalledWith(PATH);
  expect(onClose).toHaveBeenCalled();
});
