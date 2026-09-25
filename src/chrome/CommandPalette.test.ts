// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PALETTE_COMMANDS, type PaletteChat } from "../lib/commandPalette";
import { CommandPalette } from "./CommandPalette";

let root: Root;
let props: Parameters<typeof CommandPalette>[0];
const chats: PaletteChat[] = [
  {
    id: "c1",
    cwd: "/work/site",
    harness: "codex",
    title: "Fix login redirect on Safari",
    updatedAt: 2,
  },
  {
    id: "c2",
    cwd: "/work/app",
    harness: "claude",
    title: "Pricing page",
    updatedAt: 3,
    busy: true,
  },
];

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  props = {
    open: true,
    onClose: vi.fn(),
    project: { path: "~", name: "Home" },
    projects: [
      { path: "/work/site", name: "Site" },
      { path: "/work/app", name: "App" },
    ],
    chats,
    agents: [
      { harness: "claude", model: "opus", label: "Claude Code · Opus 5.5" },
      { harness: "codex", model: "gpt", label: "Codex · GPT-5.4" },
    ],
    commands: PALETTE_COMMANDS,
    searchChats: vi.fn().mockResolvedValue([]),
    searchSettings: () => [],
    onRunCommand: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenSetting: vi.fn(),
    onStartChat: vi.fn(),
    onStartRace: vi.fn(),
  };
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(CommandPalette, props)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = () =>
  document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Command palette"]',
  )!;
const text = () =>
  document.body.querySelector("[data-command-palette]")!.textContent ?? "";
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

it("opens with Start actions, running chats first, and projects", () => {
  expect(document.activeElement).toBe(input());
  const content = text();
  expect(content).toContain("New chat");
  expect(content).toContain("Search everything");
  expect(content.indexOf("Pricing page")).toBeLessThan(
    content.indexOf("Fix login redirect"),
  );
  expect(content).toContain("Site");
});

it("turns a typed sentence into a new chat with the chosen agent and project", async () => {
  await type("fix the redirect loop");
  expect(text()).toContain("Start a chat: “fix the redirect loop”");
  expect(text()).toContain("Claude Code · Opus 5.5");
  await key("Tab");
  expect(text()).toContain("Codex · GPT-5.4");
  await key("Tab", { shiftKey: true });
  expect(text()).toContain("Site");
  await key("Enter");
  expect(props.onStartChat).toHaveBeenCalledWith({
    text: "fix the redirect loop",
    agent: props.agents[1],
    project: "/work/site",
    background: false,
  });
  expect(props.onClose).toHaveBeenCalled();
});

it("starts in the background with Command-Enter", async () => {
  await type("write release notes");
  await key("Enter", { metaKey: true });
  expect(props.onStartChat).toHaveBeenCalledWith(
    expect.objectContaining({
      background: true,
      project: "~",
      text: "write release notes",
    }),
  );
});

it("lists matching chats under the new chat and opens one with the arrow keys", async () => {
  await type("login");
  await vi.advanceTimersByTimeAsync(200);
  expect(props.searchChats).toHaveBeenCalledWith("login");
  expect(text()).toContain("Fix login redirect on Safari");
  // Below "Start a chat" comes "Race it", then the matching chats.
  await key("ArrowDown");
  await key("ArrowDown");
  await key("Enter");
  expect(props.onOpenChat).toHaveBeenCalledWith("c1");
  expect(props.onStartChat).not.toHaveBeenCalled();
});

it("narrows to commands with > and runs them", async () => {
  await type("> sidebar");
  expect(text()).not.toContain("Start a chat");
  await key("Enter");
  expect(props.onRunCommand).toHaveBeenCalledWith("toggle_sidebar");
});

it("narrows to chats with # and closes on Escape", async () => {
  await type("# pricing");
  expect(text()).toContain("Pricing page");
  expect(text()).not.toContain("Fix login redirect");
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(props.onClose).toHaveBeenCalled();
});

it("offers a race of the chosen agent against another, started with Option-Enter", async () => {
  await type("fix the redirect loop");
  expect(text()).toContain("Race it: Claude Code vs Codex");
  await key("Enter", { altKey: true });
  expect(props.onStartRace).toHaveBeenCalledWith({
    text: "fix the redirect loop",
    agents: props.agents,
    project: "~",
  });
  expect(props.onStartChat).not.toHaveBeenCalled();
});
