// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RememberButton } from "./RememberButton";

const native = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => false,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  native.invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function open(text: string) {
  await act(async () =>
    root.render(createElement(RememberButton, { project: "/work/app/", text })),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Remember this"]')!
      .click(),
  );
}

function field() {
  return document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Item to remember"]',
  );
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
    field()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Remember this", () => {
  it("starts from a short item the user edits, then adds it to the project memory", async () => {
    native.invoke.mockResolvedValue({
      key: "/work/app",
      path: "/work/app",
      body: "- Run tests with make test.",
      updatedAt: 1,
    });
    await open("Run tests with `make test`.\n\n```sh\nmake test\n```");
    expect(field()?.value).toBe("- Run tests with `make test`.");
    await type("- Run tests with make test; it needs Docker.");
    await act(async () => button("Remember").click());
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
      "project_memory_append",
      {
        key: "/work/app",
        path: "/work/app",
        item: "- Run tests with make test; it needs Docker.",
      },
    );
    expect(field()).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Remembered for this project"]',
      ),
    ).not.toBeNull();
  });

  it("keeps the item open with the reason when it cannot be added", async () => {
    native.invoke.mockRejectedValue(
      "Project memory is full. Remove something from it before adding more.",
    );
    await open("Use pnpm.");
    await act(async () => button("Remember").click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Project memory is full. Remove something from it before adding more.",
    );
    expect(field()?.value).toBe("- Use pnpm.");
  });

  it("does not add an empty item", async () => {
    await open("```\nonly code\n```");
    expect(field()?.value).toBe("");
    expect(button("Remember").disabled).toBe(true);
  });
});
