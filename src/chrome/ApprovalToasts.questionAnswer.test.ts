// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalToasts } from "./ApprovalToasts";
import { pendingApprovalForSession } from "../lib/approvalToast";
import { newSession, type Session } from "../lib/session";

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

function askingSession(options: Array<{ id: string; label: string }>): Session {
  const session = { ...newSession("claude", "/repo"), id: "s1" };
  session.pendingQuestion = {
    requestId: 5,
    title: "Deploy",
    questions: [
      {
        id: "Deploy now?",
        header: "Deploy",
        prompt: "Deploy now?",
        multiSelect: false,
        allowCustom: true,
        options,
      },
    ],
  };
  return session;
}

function render(session: Session, onAnswer = vi.fn(), onFocus = vi.fn()) {
  const pending = pendingApprovalForSession(session)!;
  act(() =>
    root.render(
      createElement(ApprovalToasts, {
        notices: [{ ...pending, session }],
        onFocusSession: onFocus,
        onApproval: vi.fn(),
        onAnswer,
      }),
    ),
  );
  return { onAnswer, onFocus };
}

const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Answers"] button',
  ),
];

describe("ApprovalToasts question answers", () => {
  it("answers a simple question from the notice, suggestion first", () => {
    const { onAnswer, onFocus } = render(
      askingSession([
        { id: "Wait", label: "Wait" },
        { id: "Ship (Recommended)", label: "Ship (Recommended)" },
      ]),
    );
    expect(document.body.textContent).toContain("Deploy now?");
    expect(buttons().map((button) => button.textContent)).toEqual([
      "Ship",
      "Wait",
    ]);
    act(() => buttons()[0].click());
    expect(onAnswer).toHaveBeenCalledWith("s1", 5, {
      kind: "answered",
      answers: { "Deploy now?": ["Ship (Recommended)"] },
    });
    expect(onFocus).not.toHaveBeenCalled();
    expect(buttons()[0].textContent).toBe("Sending…");
    expect(buttons().every((button) => button.disabled)).toBe(true);
    act(() => buttons()[1].click());
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it("only opens the chat when the question has too many options", () => {
    render(
      askingSession(["a", "b", "c", "d", "e"].map((id) => ({ id, label: id }))),
    );
    expect(buttons()).toEqual([]);
  });
});
