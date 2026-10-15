// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_MEMORY_CHANGED } from "../lib/projectMemory";
import { ProjectMemoryDialog } from "./ProjectMemoryDialog";

const native = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
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

const STORED = {
  key: "/work/app",
  path: "/work/app",
  body: "- Use pnpm",
  updatedAt: 5,
};

let root: Root;
let container: HTMLDivElement;
const close = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  native.invoke.mockReset();
  close.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function respond(handlers: Record<string, (args: unknown) => unknown>) {
  native.invoke.mockImplementation(async (command, args) => {
    const handler = handlers[command];
    if (!handler) return null;
    return handler(args);
  });
}

async function render() {
  await act(async () =>
    root.render(
      createElement(ProjectMemoryDialog, {
        path: "/work/app",
        onClose: close,
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

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("project memory editor", () => {
  it("shows the memory, its size, when it was edited and who receives it", async () => {
    respond({ project_memory_get: () => STORED });
    await render();
    expect(field().value).toBe("- Use pnpm");
    const text = document.body.textContent ?? "";
    expect(text).toContain("10 of 8k characters");
    expect(text).toMatch(/Edited/);
    expect(text).toContain("System prompt");
    expect(text).toContain("Claude Code");
    expect(text).toContain("Developer instructions");
    expect(text).toContain("Codex");
    expect(text).toContain("First message");
    expect(text).toContain("Cursor");
    expect(text).toContain(
      "Changes reach new chats right away, and chats already open with their next message.",
    );
    expect(button("Save").disabled).toBe(true);
  });

  it("saves an edit based on the version it opened", async () => {
    respond({
      project_memory_get: () => STORED,
      project_memory_set: () => ({ ...STORED, updatedAt: 6 }),
    });
    await render();
    await type("- Use pnpm\n- Ship small");
    expect(button("Save").disabled).toBe(false);
    await act(async () => button("Save").click());
    expect(native.invoke).toHaveBeenCalledWith("project_memory_set", {
      key: "/work/app",
      path: "/work/app",
      body: "- Use pnpm\n- Ship small",
      baseUpdatedAt: 5,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses text over the cap", async () => {
    respond({ project_memory_get: () => null });
    await render();
    await type("x".repeat(8001));
    expect(button("Save").disabled).toBe(true);
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("offers the latest copy or keeping this one when the memory changed meanwhile", async () => {
    const newer = { ...STORED, body: "- Use pnpm\n- Remembered", updatedAt: 9 };
    let stored = STORED;
    const saves: unknown[] = [];
    respond({
      project_memory_get: () => stored,
      project_memory_set: (args) => {
        saves.push(args);
        if (saves.length === 1) return Promise.reject(PROJECT_MEMORY_CHANGED);
        return { ...newer, updatedAt: 10 };
      },
    });
    await render();
    await type("- Mine");
    stored = newer;
    await act(async () => button("Save").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "The memory changed while you were editing",
    );
    expect(close).not.toHaveBeenCalled();
    await act(async () => button("Keep mine").click());
    expect(saves[1]).toEqual({
      key: "/work/app",
      path: "/work/app",
      body: "- Mine",
      baseUpdatedAt: 9,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows the latest copy instead when asked", async () => {
    const newer = { ...STORED, body: "- Remembered", updatedAt: 9 };
    let stored = STORED;
    respond({
      project_memory_get: () => stored,
      project_memory_set: () => Promise.reject(PROJECT_MEMORY_CHANGED),
    });
    await render();
    await type("- Mine");
    stored = newer;
    await act(async () => button("Save").click());
    await act(async () => button("Show latest").click());
    await act(async () => undefined);
    expect(field().value).toBe("- Remembered");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes on Escape without saving", async () => {
    respond({ project_memory_get: () => STORED });
    await render();
    await type("- Unsaved");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(close).toHaveBeenCalledOnce();
    expect(native.invoke).not.toHaveBeenCalledWith(
      "project_memory_set",
      expect.anything(),
    );
  });
});
