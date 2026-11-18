// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClaudeCost } from "../lib/chatCost";
import type { ScriptRun } from "../lib/projectScripts";
import {
  contextButtonLabel,
  FooterContext,
  FooterCost,
  MachineCardBody,
} from "./FooterHoverButtons";
import { RunCardBody } from "./ProjectScripts";

const GB = 1024 ** 3;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const render = (element: ReactElement) => act(async () => root.render(element));
const buttonNamed = (name: RegExp) =>
  [...container.querySelectorAll("button")].find((button) =>
    name.test(button.getAttribute("aria-label") ?? ""),
  );
/** Click pins the card; it is a portal in the document body. */
const pin = (button: HTMLButtonElement) => act(async () => button.click());
const card = () => document.body.querySelector(".hover-card");

describe("context button", () => {
  it("says this chat's share of its context, or its tokens", () => {
    expect(contextButtonLabel({ used: 62_000, window: 200_000 })).toBe("31%");
    expect(contextButtonLabel({ used: 62_000 })).toBe("62K");
    expect(contextButtonLabel(null)).toBeNull();
  });

  it("hides without a chat's context", async () => {
    await render(createElement(FooterContext, { context: null }));
    expect(container.textContent).toBe("");
  });

  it("pins a card with the model, the level and Compact", async () => {
    const compact = vi.fn();
    await render(
      createElement(FooterContext, {
        context: { used: 62_000, window: 200_000 },
        model: "Claude Sonnet 5",
        onCompact: compact,
      }),
    );
    const button = buttonNamed(/Context used: 31%/)!;
    expect(button.textContent).toBe("31%");
    await pin(button);
    expect(card()?.textContent).toContain("This chatClaude Sonnet 5");
    expect(card()?.textContent).toContain("31% used62K of 200K");
    const compactButton = [...card()!.querySelectorAll("button")].find(
      (item) => item.textContent === "Compact",
    )!;
    await act(async () => compactButton.click());
    expect(compact).toHaveBeenCalledOnce();
    expect(card()).toBeNull();
  });

  it("offers no Compact when the chat can't compact", async () => {
    await render(
      createElement(FooterContext, {
        context: { used: 1_000, window: 200_000 },
      }),
    );
    await pin(buttonNamed(/Context used/)!);
    expect(card()?.textContent).not.toContain("Compact");
  });
});

describe("cost button", () => {
  it("hides until a chat has cost something today", async () => {
    await render(createElement(FooterCost, { chatTitle: () => undefined }));
    expect(container.textContent).toBe("");
  });

  it("shows today's spend and lists it by chat", async () => {
    recordClaudeCost("a", 0.84, undefined);
    recordClaudeCost("b", 0.61, undefined);
    const titles: Record<string, string> = {
      a: "Notion music clipping campaign",
      b: "Rate card for new clients",
    };
    await render(
      createElement(FooterCost, { chatTitle: (id: string) => titles[id] }),
    );
    const button = buttonNamed(/Spent today/)!;
    expect(button.textContent).toBe("$1.45");
    await pin(button);
    const text = card()?.textContent ?? "";
    expect(text).toContain("$1.45spent today");
    expect(text).toContain("Notion music clipping campaign$0.84");
    expect(text).toContain("Rate card for new clients$0.61");
    expect(text).toContain("This week$1.45");
    // No saved Claude plan: nothing claims it is covered.
    expect(text).not.toContain("Covered");
  });
});

describe("This Mac card", () => {
  it("shows CPU, memory and who uses them", async () => {
    await render(
      createElement(MachineCardBody, {
        stats: {
          cpuPercent: 18.2,
          memoryUsed: 11.2 * GB,
          memoryTotal: 32 * GB,
          aven: { cpuPercent: 6, memory: 2.1 * GB },
          scripts: { cpuPercent: 9, memory: 1.4 * GB },
        },
      }),
    );
    const text = container.textContent;
    expect(text).toContain("CPU18%");
    expect(text).toContain("Memory11.2 of 32 GB");
    expect(text).toContain("Aven and its agents6% · 2.1 GB");
    expect(text).toContain("Dev servers and tests9% · 1.4 GB");
  });

  it("leaves out scripts when none run", async () => {
    await render(
      createElement(MachineCardBody, {
        stats: {
          cpuPercent: 5,
          memoryUsed: GB,
          memoryTotal: 8 * GB,
          aven: { cpuPercent: 1, memory: GB },
          scripts: null,
        },
      }),
    );
    expect(container.textContent).not.toContain("Dev servers");
  });
});

describe("Run card", () => {
  const NOW = 1_800_000_000_000;
  const run = (change: Partial<ScriptRun>): ScriptRun => ({
    key: "run:/p/clippedin:Dev",
    kind: "run",
    name: "Dev",
    command: "npm run dev",
    cwd: "/p/clippedin",
    state: "running",
    code: null,
    output: "  Local:   http://localhost:5173/\n",
    startedAt: NOW - 41 * 60_000,
    ...change,
  });

  it("lists what runs with Stop, then the last result", async () => {
    await render(
      createElement(RunCardBody, {
        project: "/p/clippedin",
        running: [run({})],
        last: run({ state: "done", endedAt: NOW - 3 * 60_000 }),
        now: NOW,
      }),
    );
    const text = container.textContent;
    expect(text).toContain("Running in clippedin");
    expect(text).toContain("npm run dev:5173 · 41mStop");
    expect(text).toContain("Last run passed3m ago");
    expect(buttonNamed(/Stop Dev/)).toBeDefined();
  });

  it("says nothing about a stopped run", async () => {
    await render(
      createElement(RunCardBody, {
        project: "/p/clippedin",
        running: [],
        last: run({ state: "stopped", endedAt: NOW }),
        now: NOW,
      }),
    );
    expect(container.textContent).toBe("");
  });
});
