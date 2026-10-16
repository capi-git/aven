// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DiscussionCandidate,
  DiscussionHost,
  DiscussionStartRequest,
} from "../lib/discussions";
import { DiscussionPicker } from "./DiscussionPicker";

// The new-chat model menu is SecondOpinionButton's own; here it picks one.
vi.mock("./SecondOpinionButton", () => ({
  SecondOpinionButton: (props: {
    onPick: (harness: string, model: string) => void;
    label: ReactNode;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-new-chat": true,
        onClick: () => props.onPick("codex", "gpt-5"),
      },
      props.label,
    ),
}));
vi.mock("./ProjectMark", () => ({
  ProjectMark: ({ path }: { path?: string }) =>
    createElement("span", { "data-project-mark": path }),
}));

let root: Root;
let container: HTMLDivElement;
let host: DiscussionHost & {
  start: ReturnType<
    typeof vi.fn<(request: DiscussionStartRequest) => string | null>
  >;
};
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onStarted: ReturnType<typeof vi.fn<() => void>>;
let candidates: DiscussionCandidate[];
let blocked: string | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  candidates = [
    {
      sessionId: "busy",
      title: "Busy chat",
      harness: "claude",
      model: "Opus",
      cwd: "/work/api",
      blocked: "working",
    },
    {
      sessionId: "b",
      title: "Review",
      harness: "codex",
      model: "GPT-5",
      cwd: "/work/site",
    },
  ];
  blocked = undefined;
  host = {
    options: () => ({ candidates, ...(blocked ? { blocked } : {}) }),
    start: vi.fn<(request: DiscussionStartRequest) => string | null>(
      () => null,
    ),
  };
  onClose = vi.fn<() => void>();
  onStarted = vi.fn<() => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(topic = "Cache the lookups?") {
  await act(async () =>
    root.render(
      createElement(DiscussionPicker, {
        host,
        sessionId: "a",
        harness: "claude",
        model: "opus",
        initialTopic: topic,
        onClose,
        onStarted,
      }),
    ),
  );
}

const startButton = () =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Start discussion",
  )!;
const candidate = (id: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-discussion-candidate="${id}"]`,
  )!;

describe("DiscussionPicker", () => {
  it("lists other chats with their marks and preselects one that can join", async () => {
    await render();
    expect(candidate("b").textContent).toContain("Review");
    expect(candidate("b").textContent).toContain("GPT-5");
    expect(
      candidate("b").querySelector('[data-project-mark="/work/site"]'),
    ).not.toBeNull();
    expect(candidate("b").getAttribute("aria-checked")).toBe("true");
    expect(candidate("busy").disabled).toBe(true);
    expect(candidate("busy").textContent).toContain("Working");
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Topic"]')!
        .value,
    ).toBe("Cache the lookups?");
  });

  it("starts with the chosen chat, topic and rounds", async () => {
    await render();
    const five = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not([data-discussion-candidate])',
      ),
    ].find((button) => button.textContent === "5")!;
    await act(async () => five.click());
    await act(async () => startButton().click());
    expect(host.start).toHaveBeenCalledExactlyOnceWith({
      sessionId: "a",
      partner: { kind: "chat", sessionId: "b" },
      topic: "Cache the lookups?",
      rounds: 5,
    });
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("defaults to three rounds and can start a new chat instead", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-new-chat]")!.click(),
    );
    expect(candidate("b").getAttribute("aria-checked")).toBe("false");
    await act(async () => startButton().click());
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({
        partner: { kind: "new", harness: "codex", model: "gpt-5" },
        rounds: 3,
      }),
    );
  });

  it("explains why it cannot start yet", async () => {
    await render("");
    expect(startButton().disabled).toBe(true);
    expect(container.textContent).toContain("Add a topic to discuss.");
    await act(async () => root.unmount());
    root = createRoot(container);
    blocked = "This chat is busy with another turn.";
    await render();
    expect(startButton().disabled).toBe(true);
    expect(container.textContent).toContain(
      "This chat is busy with another turn.",
    );
  });

  it("shows why the host refused, and stays open", async () => {
    host.start.mockReturnValue("“Review” is busy with another turn.");
    await render();
    await act(async () => startButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "“Review” is busy with another turn.",
    );
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a press outside, but not in the model menu", async () => {
    await render();
    const menu = document.createElement("div");
    menu.setAttribute("data-provider-target", "");
    document.body.append(menu);
    await act(async () => {
      menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => {
      container
        .querySelector('[aria-label="Topic"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    menu.remove();
  });

  it("offers a send-nothing preview in development builds", async () => {
    host.preview = true;
    await render("");
    const preview = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Preview",
    )!;
    await act(async () => preview.click());
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({ preview: true, topic: "Preview" }),
    );
  });
});
