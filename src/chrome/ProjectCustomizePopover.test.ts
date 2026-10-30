// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_SIGILS, SIGIL_CRITTERS } from "../lib/dotSigils";
import { loadTabGroupMascots } from "../lib/tabGroups";
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

const marks = () => [
  ...document.body.querySelectorAll<HTMLButtonElement>(
    '[role="radiogroup"][aria-label="Mark"] [role="radio"]',
  ),
];

describe("mark picker", () => {
  it("lays every project mark out in wrapping cells, six to a row", async () => {
    await open();
    const group = document.body.querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Mark"]',
    )!;
    // Equal grid cells that wrap, so none is cut at the popover's edge.
    expect(group.classList.contains("grid")).toBe(true);
    expect(group.classList.contains("grid-cols-6")).toBe(true);
    expect(group.classList.contains("flex")).toBe(false);
    // All twelve, by their names, each drawn in dots.
    expect(PROJECT_SIGILS).toHaveLength(12);
    expect(marks().map((button) => button.title)).toEqual(
      PROJECT_SIGILS.map((sigil) => sigil.label),
    );
    expect(marks().map((button) => button.getAttribute("aria-label"))).toEqual(
      PROJECT_SIGILS.map((sigil) => sigil.label),
    );
    for (const button of marks()) {
      expect(button.querySelector(".dot-mark")).not.toBeNull();
      // A cell takes its column's width rather than a size of its own.
      expect(button.classList.contains("shrink-0")).toBe(false);
      expect(button.className).not.toMatch(/\bsize-\d/);
    }
  });

  it("marks the chosen mark and saves another under its critter name", async () => {
    await open();
    const checked = () =>
      marks()
        .filter((button) => button.getAttribute("aria-checked") === "true")
        .map((button) => button.title);
    expect(checked()).toHaveLength(1);
    const other = marks().find(
      (button) => button.getAttribute("aria-checked") !== "true",
    )!;
    await act(async () => other.click());
    expect(checked()).toEqual([other.title]);
    const key = other.dataset.markChoice!;
    expect(Object.values(loadTabGroupMascots())).toEqual([SIGIL_CRITTERS[key]]);
  });

  it("keeps every mark reachable from the keyboard", async () => {
    await open();
    for (const button of marks()) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
      expect(button.disabled).toBe(false);
    }
  });
});

describe("colour", () => {
  it("offers no colour: marks have none", async () => {
    await open();
    expect(
      document.body.querySelectorAll(
        'button[aria-label^="Color "], button[aria-label="Custom color"]',
      ),
    ).toHaveLength(0);
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
