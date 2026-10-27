// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectKey } from "../lib/paths";
import type { ProjectStatus } from "../lib/projectStatus";
import {
  TAB_GROUP_COLORS,
  loadTabGroupColors,
  loadTabGroupMascots,
  saveTabGroupColor,
  saveTabGroupLogo,
} from "../lib/tabGroups";
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

let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
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

const PATH = "/tmp/aven-project";

const render = (status?: ProjectStatus) =>
  act(async () =>
    root.render(
      createElement(PersonalProjectRow, {
        path: PATH,
        active: false,
        expanded: false,
        status,
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelect: vi.fn(),
        onToggle: vi.fn(),
      }),
    ),
  );

const menu = () =>
  document.querySelector('[role="menu"][aria-label^="Actions for"]');

it("closes the project actions menu when its button is pressed again", async () => {
  await render();
  const button = host.querySelector<HTMLButtonElement>(
    ".personal-project-more",
  )!;
  // A real press: the pointer goes down on the trigger before it clicks.
  const press = async () => {
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await act(async () => button.click());
  };
  await press();
  expect(menu()).not.toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await press();
  expect(menu()).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

it("still opens the context menu at the pointer", async () => {
  await render();
  const open = host.querySelector<HTMLButtonElement>(".personal-project-open")!;
  await act(async () => {
    open.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 50,
      }),
    );
  });
  const frame = menu()?.closest<HTMLElement>(".aven-popover-frame");
  expect(frame?.style.left).toBe("40px");
  expect(frame?.style.top).toBe("50px");
});

it("shows the project's mascot in its colour, stepping only while an agent runs", async () => {
  await render();
  const mascot = () => host.querySelector<SVGElement>(".project-mark svg")!;
  expect(host.querySelector(".project-mark")?.getAttribute("data-kind")).toBe(
    "mascot",
  );
  expect(mascot().classList.contains("mascot-active")).toBe(false);
  await act(async () => saveTabGroupColor(projectKey(PATH), 4));
  expect(mascot().style.color).toBe(TAB_GROUP_COLORS[4]);
  await render({ running: 1, waiting: 0, unread: 0 });
  expect(mascot().classList.contains("mascot-active")).toBe(true);
  // The working dot is gone: the mascot carries the state.
  expect(host.querySelector(".personal-task-working-dot")).toBeNull();
});

it("shows a logo instead of the mascot when one is set", async () => {
  saveTabGroupLogo(projectKey(PATH), "/logos/aven.png");
  await render({ running: 1, waiting: 0, unread: 0 });
  const mark = host.querySelector(".project-mark")!;
  expect(mark.getAttribute("data-kind")).toBe("logo");
  expect(mark.querySelector("img")?.getAttribute("src")).toMatch(
    /^asset:\/\/localhost\/logos\/aven\.png/,
  );
  // A still logo gets the accent dot instead (shown by the stylesheet).
  expect(host.querySelector(".personal-project-running")).not.toBeNull();
});

it("spells out what is happening in the tooltip and keeps the marks quiet", async () => {
  await render({ running: 2, waiting: 1, unread: 3, files: 12 });
  const open = host.querySelector<HTMLButtonElement>(".personal-project-open")!;
  expect(open.title).toBe(
    `2 agents running · 1 needs you · 3 unread · 12 files changed\n${PATH}`,
  );
  expect(open.getAttribute("aria-label")).toContain("1 needs you");
  const status = host.querySelector(".personal-project-status")!;
  expect(status.querySelector(".personal-project-waiting")).not.toBeNull();
  expect(status.querySelector(".personal-project-unread")?.textContent).toBe(
    "3",
  );
  expect(status.querySelector(".personal-project-files")?.textContent).toBe(
    "+12",
  );

  await render(undefined);
  expect(host.querySelector(".personal-project-status")).toBeNull();
  expect(open.title).toBe(PATH);
  // The fold and ··· actions stay in place (New chat when the row has one).
  expect(host.querySelectorAll(".personal-project-row-action")).toHaveLength(2);
});

it("customizes the name, colour and mascot from the actions menu, and resets", async () => {
  await render();
  const button = host.querySelector<HTMLButtonElement>(
    ".personal-project-more",
  )!;
  await act(async () => button.click());
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((node) => node.textContent?.includes("Customize project"));
  expect(item).toBeDefined();
  await act(async () => item!.click());
  const dialog = () =>
    document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label^="Customize"]',
    );
  expect(dialog()).not.toBeNull();

  const name = dialog()!.querySelector<HTMLInputElement>(
    'input[aria-label="Project name"]',
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(name, "Aven app");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    dialog()!
      .querySelector<HTMLButtonElement>('button[aria-label="Color 3"]')!
      .click(),
  );
  await act(async () =>
    dialog()!
      .querySelector<HTMLButtonElement>('button[aria-label="Jellyfish"]')!
      .click(),
  );
  expect(loadTabGroupColors()[projectKey(PATH)]).toBe(2);
  expect(loadTabGroupMascots()[projectKey(PATH)]).toBe("jelly");

  await act(async () =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent === "Done")!
      .click(),
  );
  expect(dialog()).toBeNull();
  expect(host.querySelector(".personal-project-label")?.textContent).toBe(
    "Aven app",
  );

  await act(async () => button.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((node) => node.textContent?.includes("Customize project"))!
      .click(),
  );
  await act(async () =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent === "Reset")!
      .click(),
  );
  expect(loadTabGroupColors()[projectKey(PATH)]).toBeUndefined();
  expect(loadTabGroupMascots()[projectKey(PATH)]).toBeUndefined();
  expect(host.querySelector(".personal-project-label")?.textContent).toBe(
    "aven-project",
  );
});

it("leaves the name unchanged when the customize panel is dismissed with Escape", async () => {
  await render();
  const button = host.querySelector<HTMLButtonElement>(
    ".personal-project-more",
  )!;
  await act(async () => button.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((node) => node.textContent?.includes("Customize project"))!
      .click(),
  );
  const name = document.querySelector<HTMLInputElement>(
    'input[aria-label="Project name"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Half typed");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".personal-project-label")?.textContent).toBe(
    "aven-project",
  );
});

it("opens the project's memory from the actions menu", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((node) => node.textContent?.includes("Project memory"));
  expect(item).toBeDefined();
  await act(async () => item!.click());
  expect(
    document.querySelector(
      '[role="dialog"][aria-label="Project memory for aven-project"]',
    ),
  ).not.toBeNull();
  expect(menu()).toBeNull();
});

it("reaches the memory from the customize panel, keeping a typed name", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((node) => node.textContent?.includes("Customize project"))!
      .click(),
  );
  const name = document.querySelector<HTMLInputElement>(
    'input[aria-label="Project name"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Aven app");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.includes("Project memory…"),
  );
  expect(row?.textContent).toContain("Empty");
  await act(async () => row!.click());
  expect(
    document.querySelector('[role="dialog"][aria-label^="Customize"]'),
  ).toBeNull();
  expect(
    document.querySelector(
      '[role="dialog"][aria-label="Project memory for Aven app"]',
    ),
  ).not.toBeNull();
  expect(host.querySelector(".personal-project-label")?.textContent).toBe(
    "Aven app",
  );
});

it("notes Aven's memory update in the tooltip, marked until the memory is opened", async () => {
  const { resetMemoryKeeperCache, updateKeeperProject } =
    await import("../lib/memoryKeeper");
  resetMemoryKeeperCache();
  updateKeeperProject(PATH, () => ({
    consent: "on",
    change: {
      at: Date.now() - 2 * 60 * 60_000,
      kind: "update",
      added: 2,
      removed: 1,
      before: "",
      baselineBefore: null,
      updatedAt: 5,
      seen: false,
    },
  }));
  await render();
  const open = host.querySelector<HTMLButtonElement>(".personal-project-open")!;
  expect(open.title).toBe(
    `Memory updated by Aven 2 h ago (+2 −1 lines)\n${PATH}`,
  );
  expect(open.getAttribute("aria-label")).toContain("memory updated");
  expect(host.querySelector("[data-memory-updated]")).not.toBeNull();

  await act(async () =>
    host.querySelector<HTMLButtonElement>(".personal-project-more")!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((node) => node.textContent?.includes("Project memory"))!
      .click(),
  );
  // Seen: the mark goes, the tooltip keeps the note for the day.
  expect(host.querySelector("[data-memory-updated]")).toBeNull();
  expect(open.title).toContain("Memory updated by Aven");
  resetMemoryKeeperCache();
});

it("keeps changed files out of the row at rest: in the tooltip, and counted on hover or focus", async () => {
  await render({ running: 0, waiting: 0, unread: 0, files: 128 });
  const files = host.querySelector<HTMLElement>(".personal-project-files")!;
  expect(files.dataset.count).toBe("128");
  expect(
    files.querySelector(".personal-project-files-count")?.textContent,
  ).toBe("+128");
  // The number is still spoken and named in the tooltip.
  const open = host.querySelector<HTMLButtonElement>(".personal-project-open")!;
  expect(open.getAttribute("aria-label")).toContain("128 files changed");
  expect(open.title).toContain("128 files changed");
  const css = readFileSync("src/chrome/PersonalNavigation.css", "utf8");
  expect(css).toMatch(/\.personal-project-files \{\s*display: none;/);
  expect(css).toMatch(
    /\.personal-project-row:is\(:hover, :focus-within\)\s+\.personal-project-files-count \{\s*display: inline;/,
  );
});

it("puts its actions in the Tab order right after the name: fold, New chat, then ···", async () => {
  const onNew = vi.fn();
  const onToggle = vi.fn();
  await act(async () =>
    root.render(
      createElement(PersonalProjectRow, {
        path: PATH,
        active: false,
        expanded: false,
        status: { running: 0, waiting: 1, unread: 2 },
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelect: vi.fn(),
        onToggle,
        onNew,
        onOpenBoard: vi.fn(),
      }),
    ),
  );
  const row = host.querySelector<HTMLElement>(".personal-project-row")!;
  const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Open aven-project project, 1 needs you · 2 unread",
    "Expand aven-project chats",
    "New chat in aven-project",
    "Actions for aven-project",
  ]);
  for (const button of buttons) {
    // Hidden only by the stylesheet's width and opacity, never removed from
    // the Tab order; focus inside the row shows them all.
    expect(button.tabIndex).toBe(0);
    expect(button.hidden).toBe(false);
    expect(button.getAttribute("aria-hidden")).toBeNull();
    await act(async () => button.focus());
    expect(document.activeElement).toBe(button);
    expect(row.contains(document.activeElement)).toBe(true);
  }
  // Keyboard presses reach them as clicks.
  await act(async () => buttons[1].click());
  await act(async () => buttons[2].click());
  expect(onToggle).toHaveBeenCalledOnce();
  expect(onNew).toHaveBeenCalledOnce();
  // What needs the person stays in the name's button at rest.
  const status = buttons[0].querySelector(".personal-project-status")!;
  expect(status.querySelector(".personal-project-waiting")).not.toBeNull();
  expect(status.querySelector(".personal-project-unread")?.textContent).toBe(
    "2",
  );
  // The board is in the ··· menu, not a row icon.
  expect(row.querySelector(".personal-project-board")).toBeNull();
});

it("names a cut-off project in its tooltip", async () => {
  await render(undefined);
  const open = host.querySelector<HTMLButtonElement>(".personal-project-open")!;
  const label = host.querySelector<HTMLElement>(".personal-project-label")!;
  expect(open.title).toBe(PATH);
  Object.defineProperty(label, "scrollWidth", {
    value: 300,
    configurable: true,
  });
  Object.defineProperty(label, "clientWidth", {
    value: 120,
    configurable: true,
  });
  await act(async () =>
    // React derives pointer enter from an over event arriving from outside.
    open.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }),
    ),
  );
  expect(open.title).toBe(`aven-project\n${PATH}`);
});
