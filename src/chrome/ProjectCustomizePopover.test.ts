// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGIL_CRITTERS } from "../lib/dotSigils";
import { MARK_TONES } from "../lib/markTones";
import { projectKey } from "../lib/paths";
import { projectSigilAt } from "../lib/projectAppearance";
import {
  TAB_GROUP_COLORS,
  loadTabGroupColors,
  loadTabGroupMascots,
  saveTabGroupColor,
  tabGroupColor,
} from "../lib/tabGroups";
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

const preview = () =>
  document.body.querySelector<HTMLElement>(
    '[role="dialog"] .project-mark .stack-mark',
  );

describe("mark", () => {
  it("shows the project's Stack beside its name, with no sigil to pick", async () => {
    await open();
    expect(preview()).not.toBeNull();
    expect(
      document.body.querySelector('[role="radiogroup"][aria-label="Mark"]'),
    ).toBeNull();
    expect(document.body.querySelector("[data-mark-choice]")).toBeNull();
    // Colour and logo stay.
    expect(
      document.body.querySelector('[role="radiogroup"][aria-label="Colour"]'),
    ).not.toBeNull();
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.textContent === "Choose image…",
      ),
    ).toBe(true);
  });
});

describe("colour", () => {
  const colours = () => [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[role="radiogroup"][aria-label="Colour"] [role="radio"]',
    ),
  ];
  const checked = () =>
    colours()
      .filter((button) => button.getAttribute("aria-checked") === "true")
      .map((button) => button.title);

  it("offers Grey and the eight mark colours", async () => {
    await open();
    expect(colours().map((button) => button.title)).toEqual(
      MARK_TONES.map((item) => item.label),
    );
    // Unpicked: the colour worked out from its name is the one marked.
    const automatic = (TAB_GROUP_COLORS as readonly string[]).indexOf(
      tabGroupColor("app"),
    );
    expect(checked()).toEqual([MARK_TONES[automatic].label]);
    // The Stack is drawn in it (Grey has no tone of its own).
    const tone = MARK_TONES[automatic].tone;
    expect(preview()!.dataset.tone).toBe(tone === "grey" ? undefined : tone);
  });

  it("shows a colour saved before marks", async () => {
    saveTabGroupColor(projectKey(PATH), 7);
    await open();
    expect(checked()).toEqual(["Teal"]);
    expect(preview()!.dataset.tone).toBe("teal");
  });

  it("saves a picked colour where colours are kept, keeping the sigil its agents wear", async () => {
    await open();
    const before = projectSigilAt(PATH).key;
    const pink = colours().find((button) => button.title === "Pink")!;
    await act(async () => pink.click());
    expect(checked()).toEqual(["Pink"]);
    expect(loadTabGroupColors()).toEqual({ [projectKey(PATH)]: 5 });
    expect(preview()!.dataset.tone).toBe("pink");
    expect(projectSigilAt(PATH).key).toBe(before);
    expect(Object.values(loadTabGroupMascots())).toEqual([
      SIGIL_CRITTERS[before],
    ]);
    const grey = colours().find((button) => button.title === "Grey")!;
    await act(async () => grey.click());
    expect(checked()).toEqual(["Grey"]);
    expect(loadTabGroupColors()).toEqual({ [projectKey(PATH)]: 0 });
    expect(preview()!.hasAttribute("data-tone")).toBe(false);
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
