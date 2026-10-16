// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKeeperProject,
  resetMemoryKeeperCache,
  updateKeeperProject,
} from "../lib/memoryKeeper";
import { ProjectMemoryDialog } from "./ProjectMemoryDialog";

const native = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isHarnessAvailable: (id: string) => id === "claude",
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const BODY =
  "<!-- aven:auto — kept up to date by Aven. Edit a line here and it becomes yours. -->\n## Stack\n- Go\n<!-- /aven:auto -->\n\n- Use pnpm";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetMemoryKeeperCache();
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command) =>
    command === "project_memory_get"
      ? { key: "/work/app", path: "/work/app", body: BODY, updatedAt: 5 }
      : null,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetMemoryKeeperCache();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(ProjectMemoryDialog, {
        path: "/work/app",
        onClose: vi.fn(),
      }),
    ),
  );
  await act(async () => undefined);
}

function field() {
  return document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Project memory"]',
  )!;
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  )!;
}

describe("project memory editor with the memory keeper", () => {
  it("shows the keeper's block as readable text, its switch, model and last run", async () => {
    updateKeeperProject("/work/app", () => ({
      consent: "on",
      model: "Claude · Haiku 4.5",
      lastRunAt: Date.now() - 3 * 60 * 60_000,
    }));
    await render();
    expect(field().value).toBe(BODY);
    const toggle = document.querySelector('[role="switch"]')!;
    expect(toggle.textContent).toContain("Kept up to date by Aven");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain(
      "Claude · Haiku 4.5 · last ran 3 h ago",
    );
    expect(button("Refresh now")).toBeDefined();
  });

  it("shows Aven's last update with Undo in the header, and marks it seen", async () => {
    updateKeeperProject("/work/app", () => ({
      consent: "on",
      change: {
        at: Date.now() - 2 * 60 * 60_000,
        kind: "update",
        added: 2,
        removed: 1,
        before: "- Use pnpm",
        baselineBefore: null,
        updatedAt: 5,
        seen: false,
      },
    }));
    await render();
    const header = document.querySelector('[role="dialog"] header')!;
    expect(header.textContent).toContain(
      "Updated by Aven 2 h ago · +2 −1 lines",
    );
    expect(getKeeperProject("/work/app").change?.seen).toBe(true);
    expect(button("Undo").disabled).toBe(false);
    // An unsaved edit holds Undo back, so it never discards typing.
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field(), `${BODY}\n- More`);
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Undo").disabled).toBe(true);
  });

  it("offers to turn keeping on when it is off", async () => {
    await render();
    const toggle =
      document.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(getKeeperProject("/work/app")).toMatchObject({
      consent: "on",
      requested: { manual: false },
    });
  });
});
