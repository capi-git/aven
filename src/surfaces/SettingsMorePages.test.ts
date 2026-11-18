// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(async () => "/data/copies"),
  isTauri: () => false,
}));
vi.mock("../chrome/ProjectCustomizePopover", () => ({
  ProjectCustomizePopover: () => null,
}));
vi.mock("../chrome/ProjectMemoryDialog", () => ({
  ProjectMemoryDialog: () => null,
}));

const { ProjectPage } = await import("./SettingsMorePages");
const { loadRunScripts } = await import("../lib/workspaceActions");
const { loadSetupScript } = await import("../lib/projectScripts");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const data = new Map<string, string>();
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

const type = async (label: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
};

it("saves a project's Setup and Run commands for its Run strip", async () => {
  await act(async () =>
    root.render(createElement(ProjectPage, { path: "/work/dock" })),
  );
  const setup = await type("Setup command", "swift package resolve");
  await act(async () => setup.blur());
  expect(loadSetupScript("/work/dock")).toBe("swift package resolve");

  await type("Run command name", "Build and open");
  await type("Run command", "./build.sh && open build/App.app");
  const add = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Add",
  )!;
  await act(async () => add.click());
  expect(loadRunScripts("/work/dock")).toEqual([
    expect.objectContaining({
      name: "Build and open",
      command: "./build.sh && open build/App.app",
    }),
  ]);
  expect(host.textContent).toContain("Run · Build and open");

  const remove = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove Build and open"]',
  )!;
  await act(async () => remove.click());
  expect(loadRunScripts("/work/dock")).toEqual([]);
});

it("asks for a project when none is chosen", async () => {
  await act(async () =>
    root.render(createElement(ProjectPage, { path: null })),
  );
  expect(host.textContent).toContain("Choose a project");
});

it("doesn't carry an unfinished Run command to another project's page", async () => {
  await act(async () =>
    root.render(createElement(ProjectPage, { path: "/work/a" })),
  );
  await type("Run command name", "Build A");
  await type("Run command", "./build-a.sh");
  // Another project's settings, in the same section.
  await act(async () =>
    root.render(createElement(ProjectPage, { path: "/work/b" })),
  );
  const field = (label: string) =>
    host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(field("Run command name").value).toBe("");
  expect(field("Run command").value).toBe("");
  const add = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Add",
  )!;
  await act(async () => add.click());
  expect(loadRunScripts("/work/b")).toEqual([]);
  expect(loadRunScripts("/work/a")).toEqual([]);
});
