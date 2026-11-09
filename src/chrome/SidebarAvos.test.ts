// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvosGlance } from "../lib/avos";
import { installCrewWorkspace } from "../lib/crewActions";
import { getCrew, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { SidebarAvosRow } from "./SidebarAvos";

vi.mock("./AgentMark", () => ({ AgentMark: () => null }));

const PATH = "/Users/me/holo";
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
  updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  resetCrewsCache();
});

const glance = (patch: Partial<AvosGlance> = {}): AvosGlance => ({
  path: PATH,
  note: null,
  state: "resting",
  line: "Quiet",
  ...patch,
});

async function draw(avos: AvosGlance, onOpen = vi.fn()) {
  await act(async () =>
    root.render(createElement(SidebarAvosRow, { avos, onOpen })),
  );
  return onOpen;
}

const row = () =>
  container.querySelector<HTMLButtonElement>(`[data-avos-row="${PATH}"]`)!;
const items = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );
const pick = async (label: string) =>
  act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === label)!
      .click(),
  );
const rightClick = async () =>
  act(async () => {
    row().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 30,
      }),
    );
  });

describe("Avos's sidebar row", () => {
  it("right-clicked, offers Open, what it remembers, Pause and Settings", async () => {
    const openSettings = vi.fn();
    const uninstall = installCrewWorkspace({
      openChat: vi.fn(),
      openCrew: vi.fn(),
      openSettings,
      stop: vi.fn(),
    });
    try {
      const onOpen = await draw(glance());
      await rightClick();
      expect(items()).toEqual([
        "Open Avos",
        "What Avos remembers",
        "Pause Avos",
        "Settings…",
      ]);
      await pick("Pause Avos");
      expect(getCrew(PATH)?.paused).toBe(true);
      await rightClick();
      expect(items()).toContain("Resume Avos");
      await pick("Settings…");
      expect(openSettings).toHaveBeenCalledWith(PATH);
      await rightClick();
      await pick("Open Avos");
      expect(onOpen).toHaveBeenCalledWith(PATH);
    } finally {
      uninstall();
    }
  });

  it("offers Stop now while Avos works", async () => {
    await draw(glance({ note: "working", state: "working" }));
    await rightClick();
    expect(items()).toContain("Stop now");
  });
});
