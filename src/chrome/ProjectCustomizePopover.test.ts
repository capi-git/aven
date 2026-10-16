// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_MASCOTS } from "../lib/projectMascots";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import { ProjectCustomizePopover } from "./ProjectCustomizePopover";

const PATH = "/Users/me/Developer/app";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function open() {
  await act(async () =>
    root.render(
      createElement(ProjectCustomizePopover, {
        path: PATH,
        anchor: { x: 40, y: 40 },
        onClose: vi.fn(),
      }),
    ),
  );
}

const mascots = () => [
  ...document.body.querySelectorAll<HTMLButtonElement>(
    '[role="radiogroup"][aria-label="Mascot"] [role="radio"]',
  ),
];

describe("mascot picker", () => {
  it("lays every mascot out in wrapping cells, five to a row", async () => {
    await open();
    const group = document.body.querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Mascot"]',
    )!;
    // One row of fixed cells overflowed the popover and cut the last mascot
    // in half; equal grid cells wrap instead.
    expect(group.classList.contains("grid")).toBe(true);
    expect(group.classList.contains("grid-cols-5")).toBe(true);
    expect(group.classList.contains("flex")).toBe(false);
    expect(PROJECT_MASCOTS.length).toBeGreaterThan(5);
    expect(mascots().map((button) => button.title)).toEqual(
      PROJECT_MASCOTS.map((mascot) => mascot.name),
    );
    for (const button of mascots()) {
      // A cell takes its column's width rather than a size of its own.
      expect(button.classList.contains("shrink-0")).toBe(false);
      expect(button.className).not.toMatch(/\bsize-\d/);
    }
  });

  it("marks the chosen mascot and moves the mark when another is picked", async () => {
    await open();
    const checked = () =>
      mascots()
        .filter((button) => button.getAttribute("aria-checked") === "true")
        .map((button) => button.title);
    expect(checked()).toHaveLength(1);
    const other = mascots().find(
      (button) => button.getAttribute("aria-checked") !== "true",
    )!;
    await act(async () => other.click());
    expect(checked()).toEqual([other.title]);
  });

  it("keeps every mascot reachable from the keyboard", async () => {
    await open();
    for (const button of mascots()) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
      expect(button.disabled).toBe(false);
    }
  });
});

describe("colour row", () => {
  it("offers every colour and the custom colour", async () => {
    await open();
    const labels = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Color "], button[aria-label="Custom color"]',
      ),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      ...TAB_GROUP_COLORS.map((_, index) => `Color ${index + 1}`),
      "Custom color",
    ]);
  });
});

describe("memory section", () => {
  it("turns the memory keeper on and off beside the memory's own row", async () => {
    const { getKeeperProject, resetMemoryKeeperCache } =
      await import("../lib/memoryKeeper");
    const availability = await import("../lib/harness/availability");
    resetMemoryKeeperCache();
    availability.recordHarnessAvailability("claude", true);
    await open();
    const toggle = document.body.querySelector<HTMLButtonElement>(
      '[role="switch"][data-memory-keeper-switch]',
    )!;
    expect(toggle.textContent).toContain("Kept up to date by Aven");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(getKeeperProject(PATH).consent).toBe("on");
    await act(async () => toggle.click());
    expect(getKeeperProject(PATH).consent).toBe("off");
    availability.recordHarnessAvailability("claude", false);
    resetMemoryKeeperCache();
  });
});
