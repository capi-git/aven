// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type {
  UserQuestion,
  UserQuestionPrompt,
  UserQuestionReply,
} from "../lib/userQuestion";

let container: HTMLDivElement;
let composer: HTMLDivElement;
let textarea: HTMLTextAreaElement;
let mount: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Like Composer: the card sits above the message box in [data-composer].
  container = document.createElement("div");
  composer = document.createElement("div");
  composer.dataset.composer = "";
  mount = document.createElement("div");
  textarea = document.createElement("textarea");
  composer.append(mount, textarea);
  container.append(composer);
  document.body.append(container);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const layout: UserQuestion = {
  id: "layout",
  prompt: "Which layout?",
  multiSelect: false,
  allowCustom: false,
  options: [
    { id: "grid", label: "Grid", preview: "[ ][ ]" },
    { id: "list", label: "List (Recommended)", preview: "[    ]" },
    { id: "cards", label: "Cards" },
  ],
};
const parts: UserQuestion = {
  id: "parts",
  prompt: "Which parts?",
  multiSelect: true,
  allowCustom: false,
  options: [
    { id: "header", label: "Header" },
    { id: "footer", label: "Footer" },
  ],
};

function render(
  questions: UserQuestion[],
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  patch: Partial<UserQuestionPrompt> = {},
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: { requestId: 3, questions, ...patch },
        onReply,
      }),
    ),
  );
}

const options = () =>
  Array.from(mount.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
const button = (label: string) =>
  [...mount.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label,
  )!;

function key(target: Element, value: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function typeInComposer(value: string) {
  textarea.value = value;
  act(() => textarea.focus());
}

describe("QuestionForm keyboard without clicking first", () => {
  it("takes the keyboard on the suggestion, so Enter accepts it", () => {
    const onReply = vi.fn();
    render([layout], onReply);
    const [, list] = options();
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(list.textContent).toContain("List");
    expect(list.textContent).toContain("Recommended");
    expect(list.textContent).not.toContain("(Recommended)");

    key(list, "Enter");
    expect(onReply).toHaveBeenCalledWith(3, {
      kind: "answered",
      answers: { layout: ["list"] },
    });
  });

  it("takes the keyboard from an empty message box", () => {
    typeInComposer("");
    render([layout]);
    expect(document.activeElement).toBe(options()[1]);
  });

  it("never takes the keyboard while you are typing, and offers ⌥↑", () => {
    typeInComposer("half a thought");
    render([layout]);
    expect(document.activeElement).toBe(textarea);
    expect(mount.textContent).toContain("⌥↑ to answer with keys");

    // A number typed in the message box stays there.
    key(textarea, "1");
    expect(options()[0].getAttribute("aria-pressed")).toBe("false");

    key(textarea, "ArrowUp", { altKey: true });
    expect(document.activeElement).toBe(options()[1]);
    expect(textarea.value).toBe("half a thought");
  });

  it("does not take the keyboard from another chat's message box", () => {
    const other = document.createElement("textarea");
    document.body.append(other);
    act(() => other.focus());
    render([layout]);
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("picks with number keys and moves the preview with the highlight", () => {
    render([layout]);
    const preview = () =>
      mount.querySelector("[data-question-preview]")?.textContent;
    expect(preview()).toBe("[    ]");
    key(document.activeElement!, "1");
    expect(options()[0].getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(options()[0]);
    expect(preview()).toBe("[ ][ ]");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    expect(preview()).toBe("No preview");
  });

  it("returns to the message box on Esc without skipping", () => {
    const onReply = vi.fn();
    render([layout], onReply);
    key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(textarea);
    expect(onReply).not.toHaveBeenCalled();
    expect(mount.querySelector("[data-question-form]")).not.toBeNull();
  });

  it("goes back a step and keeps the earlier answers", () => {
    const onReply = vi.fn();
    render([layout, parts], onReply);
    expect(button("Back")).toBeUndefined();
    key(document.activeElement!, "3");
    key(document.activeElement!, "Enter");
    expect(mount.textContent).toContain("2 of 2");
    expect(document.activeElement).toBe(options()[0]);

    key(document.activeElement!, "2");
    act(() => button("Back").click());
    expect(mount.textContent).toContain("1 of 2");
    expect(options()[2].getAttribute("aria-pressed")).toBe("true");

    act(() => button("Continue").click());
    expect(options()[1].getAttribute("aria-pressed")).toBe("true");
    key(options()[1], "Enter");
    expect(onReply).toHaveBeenCalledWith(3, {
      kind: "answered",
      answers: { layout: ["cards"], parts: ["footer"] },
    });
  });

  it("tags a multi-select suggestion without choosing it", () => {
    render([
      {
        ...parts,
        options: [
          { id: "header", label: "Header (Recommended)" },
          parts.options[1],
        ],
      },
    ]);
    const [header] = options();
    expect(header.textContent).toContain("Recommended");
    expect(header.getAttribute("aria-pressed")).toBe("false");
  });

  it("sends a letter typed on the card to the message box", () => {
    render([layout]);
    key(document.activeElement!, "h");
    expect(document.activeElement).toBe(textarea);
  });
});

describe("QuestionForm key numbers", () => {
  it("shows them only while the card has the keyboard", () => {
    const keys = () => mount.querySelectorAll("[data-question-key]").length;
    typeInComposer("busy typing");
    render([layout]);
    expect(keys()).toBe(0);
    key(textarea, "ArrowUp", { altKey: true });
    expect(keys()).toBe(3);
    key(document.activeElement!, "Escape");
    expect(keys()).toBe(0);
  });
});
