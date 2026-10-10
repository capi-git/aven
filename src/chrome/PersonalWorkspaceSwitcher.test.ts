// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { PersonalWorkspaceSwitcher } from "./PersonalWorkspaceSwitcher";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";
it("keeps button selection, arrow wrapping/focus and settings/add-project actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn(),
    settings = vi.fn(),
    add = vi.fn();
  await act(async () =>
    root.render(
      createElement(PersonalWorkspaceSwitcher, {
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelectProfile: select,
        onOpenSettings: settings,
        onAddProject: add,
      }),
    ),
  );
  const personal = host.querySelector<HTMLButtonElement>(
      '[data-profile-index="0"]',
    )!,
    work = host.querySelector<HTMLButtonElement>('[data-profile-index="1"]')!;
  await act(async () => work.click());
  expect(select).toHaveBeenLastCalledWith("work");
  await act(async () =>
    personal.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(select).toHaveBeenLastCalledWith("work");
  expect(document.activeElement).toBe(work);
  await act(async () =>
    personal.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(select).toHaveBeenLastCalledWith("work");
  host.querySelector<HTMLButtonElement>('[aria-label^="Settings"]')!.click();
  host.querySelector<HTMLButtonElement>('[aria-label="Add project"]')!.click();
  expect(settings).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledTimes(1);
  expect(
    host.querySelector('[aria-label="More workspace actions"]'),
  ).toBeNull();
  expect(host.querySelector('[aria-label="Working agents"]')).toBeNull();
  await act(async () =>
    personal.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  await act(async () =>
    personal.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps working agents reachable without mixing in workspace appearance or utility navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  await act(async () =>
    root.render(
      createElement(PersonalWorkspaceSwitcher, {
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelectAgent: select,
        liveAgents: [
          {
            id: "task-one",
            cwd: "/tmp/project",
            title: "Review changes",
            harness: "codex",
            activity: "Working",
            needsApproval: false,
            done: false,
          },
        ],
      }),
    ),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Working agents"]')!
      .click(),
  );
  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Working agents"]',
  )!;
  expect(menu).not.toBeNull();
  expect(
    [...menu.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    ),
  ).toEqual(["Review changes · Working"]);
  await act(async () =>
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(),
  );
  expect(select).toHaveBeenCalledWith("task-one");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("closes the working agents menu when its button is pressed again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(PersonalWorkspaceSwitcher, {
        profiles: DEFAULT_WORKSPACE_PROFILES,
        activeProfileId: "personal",
        onSelectAgent: vi.fn(),
        liveAgents: [
          {
            id: "task-one",
            cwd: "/tmp/project",
            title: "Review changes",
            harness: "codex",
            activity: "Working",
            needsApproval: false,
            done: false,
          },
        ],
      }),
    ),
  );
  const button = host.querySelector<HTMLButtonElement>(
    '[aria-label="Working agents"]',
  )!;
  // A real press: the pointer goes down on the trigger before it clicks.
  const press = async () => {
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await act(async () => button.click());
  };
  const menu = () =>
    document.querySelector('[role="menu"][aria-label="Working agents"]');
  await press();
  expect(menu()).not.toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await press();
  expect(menu()).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  await press();
  expect(menu()).not.toBeNull();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
