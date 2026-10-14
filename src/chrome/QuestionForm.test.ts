// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import {
  CUSTOM_OPTION_ID,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../lib/userQuestion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

function renderQuestion(
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  multiSelect = false,
  patch: Partial<UserQuestionPrompt> = {},
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: { ...prompt(multiSelect), ...patch },
        onReply,
      }),
    ),
  );
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  );
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("QuestionForm keyboard navigation", () => {
  it("moves the highlighted option with arrow keys and selects it with Enter", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);

    expect(options[0].tabIndex).toBe(0);
    expect(options[1].tabIndex).toBe(-1);
    act(() => options[0].focus());

    keyDown(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].dataset.highlighted).toBe("true");
    expect(options[1].tabIndex).toBe(0);

    keyDown(options[1], "Enter");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"] },
    });
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "ArrowUp");
    expect(document.activeElement).toBe(options[2]);

    keyDown(options[2], "Home");
    expect(document.activeElement).toBe(options[0]);

    keyDown(options[0], "End");
    expect(document.activeElement).toBe(options[2]);
  });

  it("uses number keys to focus and select the matching option", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "3");

    expect(document.activeElement).toBe(options[2]);
    expect(options[2].getAttribute("aria-pressed")).toBe("true");
    expect(options[2].getAttribute("aria-keyshortcuts")).toBe("3");
  });

  it("toggles highlighted options for multi-select questions", () => {
    const options = renderQuestion(vi.fn(), true);
    act(() => options[0].focus());

    keyDown(options[0], "Enter");
    keyDown(options[0], "ArrowDown");
    keyDown(options[1], " ");

    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    keyDown(options[1], " ");
    expect(options[1].getAttribute("aria-pressed")).toBe("false");
  });
});

describe("QuestionForm answer delivery", () => {
  const next = () =>
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const skip = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Skip",
    )!;
  const customPrompt = () => {
    const value = prompt();
    value.questions[0].allowCustom = true;
    return value;
  };
  const typeCustom = (value: string) => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  };
  const submit = () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  it("disables answers and Skip while sending and guards manual duplicate submissions", () => {
    const onReply = vi.fn();
    const question = customPrompt();
    const options = renderQuestion(onReply, false, question);
    act(() => options.at(-1)!.click());
    typeCustom("Purple");
    act(() => next().click());
    expect(onReply).toHaveBeenCalledOnce();
    renderQuestion(onReply, false, { ...question, submitting: true });
    expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(next().textContent).toBe("Sending…");
    for (const control of container.querySelectorAll<
      HTMLButtonElement | HTMLInputElement
    >("button, input"))
      expect(control.disabled).toBe(true);
    act(() => {
      submit();
      skip().click();
    });
    keyDown(options[0], "1");
    expect(options.at(-1)!.getAttribute("aria-pressed")).toBe("true");
    expect(onReply).toHaveBeenCalledOnce();
  });

  it("retains a custom answer after delivery fails and retries the same request once", () => {
    const onReply = vi.fn();
    const question = customPrompt();
    const options = renderQuestion(onReply, false, question);
    act(() => options.at(-1)!.click());
    const input = typeCustom("Purple");
    act(() => {
      submit();
      submit();
      skip().click();
    });
    expect(onReply).toHaveBeenCalledOnce();
    renderQuestion(onReply, false, { ...question, submitting: true });
    renderQuestion(onReply, false, {
      ...question,
      submitting: false,
      error: "Could not send your answer. Try again.",
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not send your answer. Try again.",
    );
    expect(input.value).toBe("Purple");
    expect(input.disabled).toBe(false);
    expect(options.at(-1)!.getAttribute("aria-pressed")).toBe("true");
    expect(next().disabled).toBe(false);
    act(() => {
      submit();
      submit();
    });
    expect(onReply).toHaveBeenCalledTimes(2);
    expect(onReply).toHaveBeenLastCalledWith(7, {
      kind: "answered",
      answers: { colour: [CUSTOM_OPTION_ID] },
      custom: { colour: "Purple" },
    });
  });
});
