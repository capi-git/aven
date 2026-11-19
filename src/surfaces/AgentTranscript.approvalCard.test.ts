// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const asking = (always?: string): Block[] => [
  { id: "u1", role: "user", text: "Run the tests" },
  {
    id: "t1",
    role: "tool",
    text: "pnpm test --run",
    tool: { callId: "c1", kind: "execute", title: "pnpm test --run" },
    approval: { requestId: 7, ...(always ? { always } : {}) },
  },
];

async function show(blocks: Block[], onApproval = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(AgentTranscript, { blocks, busy: true, onApproval }),
    ),
  );
  return onApproval;
}

const card = () =>
  container.querySelector<HTMLElement>("[data-approval-pending]")!;
const answers = () =>
  [...card().querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => !button.hasAttribute("data-approval-note"),
  );
const press = (
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });

describe("approval card", () => {
  it("shows Allow and Deny, and no Always the provider did not offer", async () => {
    await show(asking());
    expect(answers().map((button) => button.textContent)).toEqual([
      "Allow",
      "Deny",
    ]);
  });

  it("offers Always allow with what it covers, at most three answers", async () => {
    const onApproval = await show(asking("pnpm test *"));
    expect(answers().map((button) => button.textContent)).toEqual([
      "Allow",
      "Always allowpnpm test *",
      "Deny",
    ]);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-approval-always]")!
        .click(),
    );
    expect(onApproval).toHaveBeenCalledWith(7, "allowAlways");
  });

  it("answers from the keyboard only while the card has focus", async () => {
    const onApproval = await show(asking("pnpm test *"));
    // Typing elsewhere (the message box) is left alone.
    await press(document.body, "a");
    await press(document.body, "Enter");
    expect(onApproval).not.toHaveBeenCalled();

    card().focus();
    await press(card(), "Enter");
    expect(onApproval).toHaveBeenLastCalledWith(7, "allow");
    await press(card(), "Enter", { altKey: true });
    expect(onApproval).toHaveBeenLastCalledWith(7, "allowAlways");
    await press(card(), "a");
    expect(onApproval).toHaveBeenLastCalledWith(7, "allowAlways");
    await press(card(), "d");
    expect(onApproval).toHaveBeenLastCalledWith(7, "deny");
  });

  it("claims Escape so the chat's own Escape does not stop the turn", async () => {
    const onApproval = await show(asking());
    const outer = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    window.addEventListener("keydown", outer);
    card().focus();
    await press(card(), "Escape");
    window.removeEventListener("keydown", outer);
    expect(onApproval).toHaveBeenLastCalledWith(7, "deny");
    expect(outer).not.toHaveBeenCalled();
  });

  it("ignores A when Always is not offered", async () => {
    const onApproval = await show(asking());
    card().focus();
    await press(card(), "a");
    expect(onApproval).not.toHaveBeenCalled();
  });

  it("denies with a note typed in the card", async () => {
    const onApproval = await show(asking());
    await act(async () =>
      card().querySelector<HTMLButtonElement>("[data-approval-note]")!.click(),
    );
    const field = card().querySelector<HTMLInputElement>("input")!;
    expect(field.placeholder).toBe("Tell the agent why…");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      set.call(field, "Use the staging database");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(field, "Enter");
    expect(onApproval).toHaveBeenCalledWith(
      7,
      "deny",
      "Use the staging database",
    );
  });

  it("goes back from the note with Escape, and an empty note is a plain deny", async () => {
    const onApproval = await show(asking());
    card().focus();
    await press(card(), "n");
    const field = card().querySelector<HTMLInputElement>("input")!;
    await press(field, "Escape");
    expect(card().querySelector("input")).toBeNull();
    expect(onApproval).not.toHaveBeenCalled();
    await press(card(), "n");
    await act(async () =>
      [...card().querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Deny")!
        .click(),
    );
    expect(onApproval).toHaveBeenCalledWith(7, "deny");
  });
});
