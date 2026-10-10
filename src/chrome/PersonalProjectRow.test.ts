// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";

vi.mock("../lib/fs", () => ({
  basename: (path: string) => path.split("/").pop() ?? path,
  revealPath: vi.fn(),
}));

const { PersonalProjectRow } = await import("./PersonalProjectRow");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
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

const render = () =>
  act(async () =>
    root.render(
      createElement(PersonalProjectRow, {
        path: "/tmp/aven-project",
        active: false,
        expanded: false,
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
