// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettingsProject } from "../lib/settingsProject";
import { ProjectScripts, SCRIPT_PROMPTS } from "./ProjectScripts";

vi.mock("../lib/fs", () => ({
  listDir: () => Promise.resolve([]),
  readTextFile: () => Promise.reject(new Error("none")),
  subscribeGitChanged: () => () => undefined,
}));
vi.mock("./DotSpinner", () => ({ DotSpinner: () => null }));

let root: Root;
let container: HTMLDivElement;
let stored: Map<string, string>;
const handlers = {
  onOpenTerminal: vi.fn(),
  onToggleTerminal: vi.fn(),
  onStartChat: vi.fn(),
  onOpenSettings: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(ProjectScripts, {
        project: "/p",
        cwd: "/p",
        active: true,
        ...handlers,
      }),
    ),
  );
}

function text(label: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent?.trim() === label);
}
function labelled(label: string) {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
}

describe("ProjectScripts strip", () => {
  it("has Setup, Run, a terminal glyph, then New terminal and the fold", async () => {
    await render();
    const bar = container.querySelector(".project-scripts-bar")!;
    expect(
      Array.from(
        bar.querySelectorAll("button"),
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual(["Setup", "Run", "Terminal", "New terminal", "Hide scripts"]);
    expect(labelled("Terminal")!.textContent).toBe("");
    expect(bar.querySelector(".project-scripts-rule")).not.toBeNull();
    await act(async () => labelled("New terminal")!.click());
    expect(handlers.onOpenTerminal).toHaveBeenCalledWith("/p");
    await act(async () => labelled("Terminal")!.click());
    expect(handlers.onToggleTerminal).toHaveBeenCalledOnce();
    await act(async () => labelled("Hide scripts")!.click());
    expect(container.querySelector(".project-scripts-body")).toBeNull();
    expect(stored.get("aven.scriptsOpen")).toBe("false");
  });

  it("explains a missing run script and offers an agent, the form and settings", async () => {
    await render();
    await act(async () => text("Run")!.click());
    expect(container.textContent).toContain("Add a run script");
    expect(container.textContent).toContain(
      "It starts your dev server or app. Each script opens in its own tab.",
    );
    await act(async () => text("Ask an agent to write it")!.click());
    expect(handlers.onStartChat).toHaveBeenCalledWith("/p", SCRIPT_PROMPTS.run);
    await act(async () => text("Open project settings")!.click());
    expect(handlers.onOpenSettings).toHaveBeenCalledWith("project");
    expect(loadSettingsProject()).toBe("/p");
    await act(async () => text("Add one yourself")!.click());
    expect(container.querySelector('[aria-label="Command"]')).not.toBeNull();
    await act(async () => text("Cancel")!.click());
    expect(container.textContent).toContain("Add a run script");
  });

  it("explains a missing setup script the same way", async () => {
    await render();
    await act(async () => text("Setup")!.click());
    expect(container.textContent).toContain("Add a setup script");
    expect(container.textContent).toContain(
      "It runs in each new copy to install dependencies and copy env files.",
    );
    await act(async () => text("Ask an agent to write it")!.click());
    expect(handlers.onStartChat).toHaveBeenCalledWith(
      "/p",
      SCRIPT_PROMPTS.setup,
    );
  });
});
