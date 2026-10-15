// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { claudeAdapter } from "../lib/harness/claudeAdapter";
import {
  resetDiscussionStore,
  type DiscussionHost,
  type DiscussionStartRequest,
} from "../lib/discussions";
import { Composer } from "./Composer";

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./AgentPill", () => ({ AgentPill: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));
vi.mock("./SecondOpinionButton", () => ({ SecondOpinionButton: () => null }));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;
let host: DiscussionHost & {
  start: ReturnType<
    typeof vi.fn<(request: DiscussionStartRequest) => string | null>
  >;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  registerHarness(codexAdapter);
  registerHarness(claudeAdapter);
  host = {
    options: () => ({
      candidates: [
        {
          sessionId: "b",
          title: "Review",
          harness: "codex",
          model: "GPT-5",
          cwd: "/work/site",
        },
      ],
    }),
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
const picker = () => container.querySelector("[data-discussion-picker]");
const topic = () =>
  container.querySelector<HTMLTextAreaElement>('[aria-label="Topic"]')!.value;

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
async function openPlus() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Add files or choose a mode"]',
      )!
      .click(),
  );
}
const discussItem = () =>
  document.body.querySelector<HTMLButtonElement>("[data-composer-discuss]");

describe("Discuss with… in the composer", () => {
  it("opens the picker from the + menu with the draft as the topic", async () => {
    await render();
    await type("Compare our caching options");
    await openPlus();
    expect(discussItem()?.textContent).toContain("Discuss with…");
    await act(async () => discussItem()!.click());
    expect(picker()).not.toBeNull();
    expect(topic()).toBe("Compare our caching options");
    expect(document.body.querySelector("[data-composer-plus]")).toBeNull();
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

  it("opens the picker when /discuss is picked from the slash menu", async () => {
    await render();
    await type("/disc");
    const command = [...document.body.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("/discuss"),
    )!;
    expect(command).toBeTruthy();
    await act(async () => command.click());
    expect(picker()).not.toBeNull();
    expect(field().value).toBe("");
  });

  it("opens the picker for a typed /discuss and sends nothing", async () => {
    await render();
    await type("/discuss Should we cache lookups?");
    await press("Enter");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(topic()).toBe("Should we cache lookups?");
  });

  it("clears the draft once the discussion starts", async () => {
    await render();
    await type("Compare caching");
    await openPlus();
    await act(async () => discussItem()!.click());
    const start = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Start discussion",
    )!;
    await act(async () => start.click());
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Compare caching",
      }),
    );
    expect(picker()).toBeNull();
    expect(field().value).toBe("");
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
