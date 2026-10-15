// @vitest-environment happy-dom
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
    `2 agents running · 1 waiting for you · 3 unread · 12 files changed\n${PATH}`,
  );
  expect(open.getAttribute("aria-label")).toContain("1 waiting for you");
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
  // Disclosure, new-task and more actions stay in place.
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
      .querySelector<HTMLButtonElement>('button[aria-label="Mascot ghost"]')!
      .click(),
  );
  expect(loadTabGroupColors()[projectKey(PATH)]).toBe(2);
  expect(loadTabGroupMascots()[projectKey(PATH)]).toBe("ghost");

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
