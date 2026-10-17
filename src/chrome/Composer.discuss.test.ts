// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { claudeAdapter } from "../lib/harness/claudeAdapter";
import {
  DISCUSSION_ROUNDS_KEY,
  discussionStore,
  resetDiscussionStore,
  type DiscussionCandidate,
  type DiscussionHost,
  type DiscussionStartRequest,
} from "../lib/discussions";
import type { HarnessId } from "../lib/session";
import { Composer } from "./Composer";

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./AgentPill", () => ({ AgentPill: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));
// The new-chat model menu, reduced to one choice.
vi.mock("./SecondOpinionButton", async () => {
  const { createElement } = await import("react");
  return {
    SecondOpinionButton: ({
      onPick,
    }: {
      onPick: (harness: HarnessId, model: string) => void;
    }) =>
      createElement(
        "button",
        {
          type: "button",
          "data-new-chat": "",
          onClick: () => onPick("claude", "claude:sonnet-5"),
        },
        "New chat with…",
      ),
  };
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;
let values: Map<string, string>;
let candidates: DiscussionCandidate[];
let blocked: string | undefined;
let host: DiscussionHost & {
  start: ReturnType<
    typeof vi.fn<(request: DiscussionStartRequest) => string | null>
  >;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  registerHarness(codexAdapter);
  registerHarness(claudeAdapter);
  blocked = undefined;
  candidates = [
    {
      sessionId: "b",
      title: "Review",
      harness: "codex",
      model: "GPT-5",
      cwd: "/work/site",
    },
    {
      sessionId: "c",
      title: "Busy one",
      harness: "claude",
      model: "Opus",
      cwd: "/work/site",
      blocked: "working",
    },
    {
      sessionId: "d",
      title: "Notes",
      harness: "claude",
      model: "Sonnet",
      cwd: "/work/site",
    },
  ];
  host = {
    options: () => ({ ...(blocked ? { blocked } : {}), candidates }),
    start: vi.fn<(request: DiscussionStartRequest) => string | null>(
      () => null,
    ),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    executionCwd: "/work/site",
    cwd: "/work/site",
    sessionId: "a",
    hideTopBar: false,
    discussion: host,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Composer, props)));
}
const field = () =>
  container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message"]',
  )!;
const chip = () =>
  container.querySelector<HTMLElement>("[data-discussion-chip]");
const chipLabel = () =>
  chip()?.querySelector("[data-discussion-chip-label]")?.textContent;
const menu = () =>
  document.body.querySelector<HTMLElement>("[data-discussion-menu]");
const reason = () =>
  menu()?.querySelector("[data-discussion-reason]")?.textContent;

async function type(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
}
async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("Nothing to click");
  await act(async () => (element as HTMLElement).click());
}
async function openPlus() {
  await click(
    container.querySelector('[aria-label="Add files or choose a mode"]'),
  );
}
const discussItem = () =>
  document.body.querySelector<HTMLButtonElement>("[data-composer-discuss]");
async function turnOn() {
  await openPlus();
  await click(discussItem());
}
const openMenu = () => click(chip()?.querySelector("[aria-haspopup]"));

describe("Discuss mode in the composer", () => {
  it("sits in the + menu with Plan mode and Orchestrator and toggles a chip", async () => {
    await render();
    await openPlus();
    const item = discussItem()!;
    expect(item.textContent).toContain("Discuss");
    expect(item.getAttribute("aria-pressed")).toBe("false");
    const modes = [
      ...document.body.querySelectorAll("[data-composer-plus] button"),
    ].map((button) => button.textContent ?? "");
    expect(modes.findIndex((text) => text.includes("Orchestrator"))).toBe(
      modes.findIndex((text) => text.startsWith("Discuss")) - 1,
    );
    await click(item);
    expect(document.body.querySelector("[data-composer-plus]")).toBeNull();
    // The first open chat that can join, with three rounds.
    expect(chipLabel()).toBe("Discuss with Codex · 3 rounds");
    expect(
      chip()?.querySelector("[aria-haspopup]")?.getAttribute("title"),
    ).toBe("GPT-5 in “Review”");
    expect(menu()).toBeNull();
    expect(field().placeholder).toBe("What should they discuss?");
    await openPlus();
    expect(discussItem()?.getAttribute("aria-pressed")).toBe("true");
    await click(discussItem());
    expect(chip()).toBeNull();
  });

  it("starts the discussion when the message is sent, with it as the topic", async () => {
    await render();
    await turnOn();
    await type("Compare our caching options");
    await press("Enter");
    expect(host.start).toHaveBeenCalledExactlyOnceWith({
      sessionId: "a",
      partner: { kind: "chat", sessionId: "b" },
      topic: "Compare our caching options",
      rounds: 3,
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(field().value).toBe("");
    expect(chip()).toBeNull();
  });

  it("chooses the partner and rounds from the chip's dropdown", async () => {
    await render();
    await turnOn();
    await openMenu();
    const rows = [
      ...menu()!.querySelectorAll<HTMLButtonElement>(
        "[data-discussion-candidate]",
      ),
    ];
    expect(rows.map((row) => row.dataset.discussionCandidate)).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    // A chat that can't join says why and can't be chosen.
    expect(rows[1].disabled).toBe(true);
    expect(rows[1].textContent).toContain("Working");
    await click(rows[2]);
    expect(chipLabel()).toBe("Discuss with Claude · 3 rounds");
    await click(menu()!.querySelector("[data-discussion-rounds='5']"));
    expect(chipLabel()).toBe("Discuss with Claude · 5 rounds");
    expect(values.get(DISCUSSION_ROUNDS_KEY)).toBe("5");
    expect(reason()).toContain("Type the topic in the message box");

    await type("Is the index worth it?");
    await press("Enter");
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({
        partner: { kind: "chat", sessionId: "d" },
        topic: "Is the index worth it?",
        rounds: 5,
      }),
    );
  });

  it("can start a new chat with a chosen model instead", async () => {
    await render();
    await turnOn();
    await openMenu();
    await click(menu()!.querySelector("[data-new-chat]"));
    expect(chipLabel()).toBe("Discuss with new Claude chat · 3 rounds");
    await type("Plan the migration");
    await press("Enter");
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({
        partner: { kind: "new", harness: "claude", model: "claude:sonnet-5" },
      }),
    );
  });

  it("remembers the last rounds for the next discussion", async () => {
    values.set(DISCUSSION_ROUNDS_KEY, "2");
    await render();
    await turnOn();
    expect(chipLabel()).toBe("Discuss with Codex · 2 rounds");
  });

  it("opens the dropdown with a reason instead of starting when it can't", async () => {
    candidates = [];
    await render();
    await turnOn();
    // Nobody to talk to: the dropdown opens at once.
    expect(chipLabel()).toBe("Discuss with … · 3 rounds");
    expect(reason()).toBe("Choose a chat to discuss with.");
    await click(chip()?.querySelector("[aria-haspopup]"));
    expect(menu()).toBeNull();
    await type("Topic");
    await press("Enter");
    expect(host.start).not.toHaveBeenCalled();
    expect(field().value).toBe("Topic");
    expect(reason()).toBe("Choose a chat to discuss with.");
  });

  it("shows why this chat can't start one, and the host's refusal", async () => {
    blocked = "This chat is busy with another turn.";
    await render();
    await turnOn();
    await openMenu();
    expect(reason()).toBe("This chat is busy with another turn.");
    await openMenu();
    blocked = undefined;
    host.start.mockReturnValueOnce("“Review” has a question for you.");
    await type("Topic");
    await press("Enter");
    expect(host.start).toHaveBeenCalledOnce();
    expect(field().value).toBe("Topic");
    expect(chip()).not.toBeNull();
    expect(reason()).toBe("“Review” has a question for you.");
  });

  it("turns on when /discuss is picked from the slash menu", async () => {
    await render();
    await type("/disc");
    const command = [...document.body.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("/discuss"),
    )!;
    expect(command).toBeTruthy();
    await click(command);
    expect(chipLabel()).toBe("Discuss with Codex · 3 rounds");
    expect(field().value).toBe("");
    expect(host.start).not.toHaveBeenCalled();
  });

  it("turns on for a typed /discuss and keeps the rest as the topic", async () => {
    await render();
    await type("/discuss Should we cache lookups?");
    await press("Enter");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    expect(chip()).not.toBeNull();
    expect(field().value).toBe("Should we cache lookups?");
    await press("Enter");
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Should we cache lookups?" }),
    );
  });

  it("gives way to Plan mode", async () => {
    await render();
    await turnOn();
    await openPlus();
    const plan = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        "[data-composer-plus] button",
      ),
    ].find((button) => button.textContent?.includes("Plan mode"))!;
    await click(plan);
    expect(chip()).toBeNull();
    await type("Do it");
    await press("Enter");
    expect(host.start).not.toHaveBeenCalled();
    expect(props.onSubmit).toHaveBeenCalledWith(
      "Do it",
      [],
      expect.objectContaining({ intent: "plan" }),
    );
  });

  it("offers a send-nothing preview in development builds", async () => {
    host.preview = true;
    await render();
    await turnOn();
    await type("Look at this");
    await openMenu();
    const preview = [...menu()!.querySelectorAll("button")].find(
      (button) => button.textContent === "Preview",
    );
    await click(preview);
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Look at this", preview: true }),
    );
    expect(field().value).toBe("Look at this");
  });

  it("is not offered without a host or in an Inbox chat", async () => {
    props.discussion = undefined;
    await render();
    await openPlus();
    expect(discussItem()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    props.discussion = host;
    props.hideTopBar = true;
    await render();
    await openPlus();
    expect(discussItem()).toBeNull();
  });

  it("sends /discuss as text where discussions are unavailable", async () => {
    props.discussion = undefined;
    await render();
    await type("/discuss hello");
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledWith(
      "/discuss hello",
      [],
      expect.anything(),
    );
  });
});

describe("the message box while this chat's discussion runs", () => {
  const party = (sessionId: string, title: string) => ({
    sessionId,
    harness: "codex" as const,
    model: "GPT-5",
    title,
    cwd: "/work/site",
  });
  function startHere() {
    discussionStore().start({
      id: "d1",
      a: party("a", "Caching"),
      b: party("b", "Review"),
      topic: "Cache the lookups?",
      rounds: 2,
    });
  }
  const added = () =>
    (discussionStore().get("d1")?.interjections ?? []).map(
      (entry) => entry.text,
    );

  it("sends what you write to both chats instead of this agent", async () => {
    startHere();
    await render();
    expect(field().placeholder).toBe("Add something for both of them…");
    expect(
      container.querySelector('[aria-label="Send to both"]'),
    ).not.toBeNull();
    await type("Keep it under 50 lines.");
    await press("Enter");
    expect(added()).toEqual(["Keep it under 50 lines."]);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(field().value).toBe("");
  });

  it("resumes a paused discussion with your message", async () => {
    startHere();
    discussionStore().pause("d1", "“Review” needs your approval.");
    await render();
    expect(field().placeholder).toBe("Add something for both of them…");
    await type("Go ahead.");
    await press("Enter");
    expect(added()).toEqual(["Go ahead."]);
    expect(discussionStore().get("d1")?.status).toBe("active");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("goes back to messaging this agent once it has ended", async () => {
    startHere();
    await render();
    await act(async () => discussionStore().stop("d1"));
    expect(field().placeholder).not.toBe("Add something for both of them…");
    await type("Now build it.");
    await press("Enter");
    expect(added()).toEqual([]);
    expect(props.onSubmit).toHaveBeenCalledWith(
      "Now build it.",
      [],
      expect.anything(),
    );
  });

  it("leaves the other chat's message box as it is", async () => {
    startHere();
    props.sessionId = "b";
    await render();
    expect(field().placeholder).not.toBe("Add something for both of them…");
    await type("Hello");
    await press("Enter");
    expect(added()).toEqual([]);
    expect(props.onSubmit).toHaveBeenCalled();
  });
});
