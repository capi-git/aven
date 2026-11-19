// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterSidePanelOpens,
  resetSidePanelForTest,
  setSidePanelOpen,
  sidePanelOpening,
} from "../lib/sidePanel";
import { PersonalInspectorDock } from "./PersonalInspectorDock";

const shown = vi.hoisted(() => vi.fn());
vi.mock("./WorkspaceInspector", () => ({
  WorkspaceInspector: (props: { active: boolean }) => {
    shown(props.active);
    return null;
  },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>([
    ["monocode.personal.inspector", JSON.stringify({ open: false })],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  resetSidePanelForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetSidePanelForTest();
  vi.unstubAllGlobals();
});

async function render(workspaceVisible = true) {
  await act(async () =>
    root.render(
      createElement(PersonalInspectorDock, {
        workspaceVisible,
        width: 280,
        onWidthChange: vi.fn(),
        cwd: "/p",
        onOpenFile: vi.fn(),
        onOpenDiff: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
        filesSearchOpen: false,
        onFilesSearchOpenChange: vi.fn(),
      }),
    ),
  );
}

describe("PersonalInspectorDock", () => {
  it("shows while the workspace is on screen and the panel is open", async () => {
    await render();
    expect(shown).toHaveBeenLastCalledWith(false);
    await act(async () => setSidePanelOpen(true));
    expect(shown).toHaveBeenLastCalledWith(true);
    await render(false);
    expect(shown).toHaveBeenLastCalledWith(false);
    expect(
      container
        .querySelector(".personal-inspector-slot")
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("holds the panel's reads until its slide in ends", async () => {
    await render();
    const read = vi.fn();
    await act(async () => setSidePanelOpen(true));
    expect(sidePanelOpening()).toBe(true);
    afterSidePanelOpens(read);
    expect(read).not.toHaveBeenCalled();
    const dock = container.querySelector(".personal-inspector-dock")!;
    // A transition inside the panel is not its slide.
    await act(async () => {
      dock.firstElementChild!.dispatchEvent(
        new Event("transitionend", { bubbles: true }),
      );
    });
    expect(read).not.toHaveBeenCalled();
    await act(async () => {
      dock.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    expect(read).toHaveBeenCalledOnce();
    expect(sidePanelOpening()).toBe(false);
  });
});
