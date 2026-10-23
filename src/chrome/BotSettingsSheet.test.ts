// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  turnOnProjectBot: vi.fn(async () => null as string | null),
  turnOffProjectBot: vi.fn(async () => null as string | null),
  saveBotSettings: vi.fn(),
}));
vi.mock("../lib/projectBotActions", () => actions);
vi.mock("../lib/harness/availability", () => ({
  isHarnessAvailable: () => true,
  probeHarnessAvailability: async () => undefined,
}));

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

it("turns a bot on with three plain switches and nothing else to set", async () => {
  const onClose = vi.fn();
  const onTurnedOn = vi.fn();
  await act(async () =>
    root.render(
      createElement(BotSettingsSheet, { path: PATH, onClose, onTurnedOn }),
    ),
  );
  expect(switches()).toEqual([
    expect.stringMatching(/ is on$/),
    "Look when a chat finishes",
    "Look when the dev server crashes",
    "Start fixes on its own",
  ]);
  const text = dialog().textContent ?? "";
  expect(text).toContain("orbit's bot");
  expect(text).toContain(
    "Always asks before pushing, publishing, merging, sending or deleting.",
  );
  expect(text).toContain("Up to 15 runs a day, quiet 11 pm–8 am");
  // No model pickers, limits section, browser or desktop switches.
  expect(dialog().querySelectorAll("select, [role='combobox']")).toHaveLength(
    0,
  );
  expect(text).not.toMatch(/Sonnet|Opus|browser|other apps|Coming soon/i);
  // A bot that was never on has nothing to turn off.
  expect(button("Turn off")).toBeUndefined();

  const fix = dialog().querySelector<HTMLButtonElement>(
    '[aria-label="Start fixes on its own"]',
  )!;
  await act(async () => fix.click());
  expect(text).not.toContain("It only tells you what it found.");
  expect(dialog().textContent).toContain("It only tells you what it found.");
  await act(async () => button("Done")!.click());
  expect(actions.turnOnProjectBot).toHaveBeenCalledWith(
    PATH,
    {
      name: undefined,
      wakes: { chatFinished: true, devServer: true },
      can: { fix: false },
    },
    expect.any(String),
  );
  expect(onClose).toHaveBeenCalled();
  expect(onTurnedOn).toHaveBeenCalledWith(PATH);
});

it("says plainly why a bot can't be turned on", async () => {
  actions.turnOnProjectBot.mockResolvedValueOnce(
    "Bots need a Git project. This folder isn't a Git repository yet.",
  );
  const onClose = vi.fn();
  await act(async () =>
    root.render(createElement(BotSettingsSheet, { path: PATH, onClose })),
  );
  await act(async () => button("Done")!.click());
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
    "Bots need a Git project. This folder isn't a Git repository yet.",
  );
  expect(onClose).not.toHaveBeenCalled();
});

it("asks before turning a bot off, then removes its copy", async () => {
  updateProjectBot(PATH, (bot) => ({ ...bot, on: true, name: "Jelly" }));
  const onClose = vi.fn();
  await act(async () =>
    root.render(createElement(BotSettingsSheet, { path: PATH, onClose })),
  );
  await act(async () => button("Turn off")!.click());
  expect(dialog().textContent).toContain("Turn off Jelly?");
  expect(actions.turnOffProjectBot).not.toHaveBeenCalled();
  await act(async () => button("Turn off")!.click());
  expect(actions.turnOffProjectBot).toHaveBeenCalledWith(PATH);
  expect(onClose).toHaveBeenCalled();
});
