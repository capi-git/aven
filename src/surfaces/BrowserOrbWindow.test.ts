// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  browserOrbWindow,
  type BrowserOrbSnapshot,
  type BrowserOrbState,
} from "../lib/browserOrb";
import { BrowserOrbWindow } from "./BrowserOrbWindow";

vi.mock("../lib/browserOrb", async (original) => ({
  ...(await original<typeof import("../lib/browserOrb")>()),
  browserOrbWindow: {
    listen: vi.fn(),
    getState: vi.fn(),
    ready: vi.fn().mockResolvedValue(undefined),
    layout: vi.fn().mockResolvedValue(undefined),
    act: vi.fn().mockResolvedValue(undefined),
  },
}));

const IDLE: BrowserOrbSnapshot = {
  chat: { title: "Fix hero layout", agent: "Claude Code" },
  busy: false,
  answer: null,
  tint: null,
};

let root: Root;
let container: HTMLDivElement;
let receive: (state: BrowserOrbState) => void = () => {};

async function mount(snapshot: BrowserOrbSnapshot = IDLE) {
  vi.mocked(browserOrbWindow.listen).mockImplementation(
    async (_e, callback) => {
      receive = callback as typeof receive;
      return () => {};
    },
  );
  vi.mocked(browserOrbWindow.getState).mockResolvedValue({
    snapshot,
    revision: 1,
  });
  await act(async () => root.render(createElement(BrowserOrbWindow)));
  await act(async () => {});
}

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

function type(value: string) {
  const input = container.querySelector<HTMLInputElement>(".orb-input")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows the bubble, sizes the window and then asks to be shown", async () => {
  await mount();
  expect(button("Ask Aven about this page")).not.toBeNull();
  expect(browserOrbWindow.layout).toHaveBeenCalledWith(
    60,
    expect.any(Number),
    false,
  );
  expect(browserOrbWindow.ready).toHaveBeenCalledTimes(1);
});

it("opens into the pill, sends to the chat and folds back", async () => {
  await mount();
  await act(async () => button("Ask Aven about this page")!.click());
  expect(browserOrbWindow.layout).toHaveBeenLastCalledWith(
    600,
    expect.any(Number),
    true,
  );
  expect(
    container.querySelector(".orb-input")?.getAttribute("placeholder"),
  ).toBe("Ask Claude Code about this page…");
  expect(button("Send")!.disabled).toBe(true);
  await act(async () => type("  Why is the hero cramped?  "));
  expect(button("Send")!.disabled).toBe(false);
  await act(async () => button("Send")!.click());
  expect(browserOrbWindow.act).toHaveBeenCalledWith({
    action: "submit",
    text: "Why is the hero cramped?",
  });
  expect(container.querySelector(".orb-pill")).toBeNull();
  expect(browserOrbWindow.layout).toHaveBeenLastCalledWith(
    60,
    expect.any(Number),
    false,
  );
});

it("closes with the close button and with Escape", async () => {
  await mount();
  await act(async () => button("Ask Aven about this page")!.click());
  await act(async () => button("Close")!.click());
  expect(container.querySelector(".orb-pill")).toBeNull();
  await act(async () => button("Ask Aven about this page")!.click());
  await act(async () =>
    container
      .querySelector(".orb-stack")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(container.querySelector(".orb-pill")).toBeNull();
});

it("offers Stop while the chat is working", async () => {
  await mount({ ...IDLE, busy: true });
  expect(container.querySelector(".orb-stack.is-busy")).not.toBeNull();
  await act(async () => button("Aven is working. Open")!.click());
  await act(async () => button("Stop")!.click());
  expect(browserOrbWindow.act).toHaveBeenCalledWith({ action: "stop" });
});

it("shows an answer card until it is dismissed, with reply and open actions", async () => {
  await mount();
  await act(async () =>
    receive({
      snapshot: {
        ...IDLE,
        answer: { id: "a1", text: "The heading is fixed at 44px." },
      },
      revision: 2,
    }),
  );
  expect(container.querySelector(".orb-card-text")?.textContent).toBe(
    "The heading is fixed at 44px.",
  );
  expect(browserOrbWindow.layout).toHaveBeenLastCalledWith(
    500,
    expect.any(Number),
    false,
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Open chat")!
      .click(),
  );
  expect(browserOrbWindow.act).toHaveBeenCalledWith({ action: "openChat" });
  expect(container.querySelector(".orb-card")).toBeNull();

  await act(async () =>
    receive({
      snapshot: { ...IDLE, answer: { id: "a2", text: "Second answer." } },
      revision: 3,
    }),
  );
  await act(async () => button("Dismiss")!.click());
  expect(container.querySelector(".orb-card")).toBeNull();
  // An older state arriving late does not bring a dismissed answer back.
  await act(async () =>
    receive({
      snapshot: { ...IDLE, answer: { id: "a1", text: "old" } },
      revision: 1,
    }),
  );
  expect(container.querySelector(".orb-card")).toBeNull();
});

it("explains when there is no chat to ask", async () => {
  await mount({ ...IDLE, chat: null });
  await act(async () => button("Ask Aven about this page")!.click());
  const input = container.querySelector<HTMLInputElement>(".orb-input")!;
  expect(input.disabled).toBe(true);
  expect(input.placeholder).toBe("Open a chat in this workspace to ask");
});

it("tints the glass with the chosen colour", async () => {
  await mount({ ...IDLE, tint: "#9b5cff" });
  const stack = container.querySelector<HTMLElement>(".orb-stack")!;
  expect(stack.hasAttribute("data-tint")).toBe(true);
  expect(stack.style.getPropertyValue("--orb-tint")).toBe("#9b5cff");
});
