// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => undefined,
}));

vi.mock("../lib/harness/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
    // Like --replay-user-messages: Claude echoes each prompt as it starts on it.
    const rec = JSON.parse(line) as Record<string, unknown>;
    if (rec.type === "user" && typeof rec.uuid === "string")
      queueMicrotask(() =>
        onLine?.(JSON.stringify({ ...rec, isReplay: true })),
      );
  },
}));

const { QuestionForm } = await import("./QuestionForm");
const { sendClaudeTurn, stopClaudeSession, __claudeTestReset } =
  await import("../lib/harness/claude");
const { claudeAdapter } = await import("../lib/harness/claudeAdapter");
const { registerHarness } = await import("../lib/harness/registry");
const { applyHarnessEvent } = await import("../lib/harness/apply");
const { answerQuestion, EXPIRED_QUESTION_SENT } =
  await import("../lib/questionReply");
const { newSession } = await import("../lib/session");
import type { Session } from "../lib/session";
import type { UserQuestionReply } from "../lib/userQuestion";

let container: HTMLDivElement;
let root: Root;
let session: Session;
/** Like a chat that no longer hears this turn: its events are dropped. */
let deaf = false;
let messages: string[] = [];

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const parse = () =>
  sent.map((line) => JSON.parse(line) as Record<string, unknown>);
const emit = (rec: Record<string, unknown>) => onLine!(JSON.stringify(rec));
const responseFor = (id: string) =>
  parse().find(
    (m) =>
      (m.response as Record<string, unknown> | undefined)?.request_id === id,
  );
const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse())}`,
  );
};

/** What the composer does: the card shows while the chat has a question. */
function onReply(requestId: number, reply: UserQuestionReply) {
  answerQuestion(session, requestId, reply, {
    close: (id) => {
      session = applyHarnessEvent(session, {
        type: "question.resolved",
        requestId: id,
        decision: "cancelled",
      });
    },
    send: (text) => {
      messages.push(text);
      return true;
    },
    note: (text) => {
      session = applyHarnessEvent(session, { type: "status", text });
    },
  });
}

function render() {
  act(() =>
    root.render(
      session.pendingQuestion
        ? createElement(QuestionForm, {
            prompt: session.pendingQuestion,
            onReply,
          })
        : null,
    ),
  );
}

const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
    entry.textContent?.includes(label),
  )!;

async function askTwoQuestions() {
  const turn = sendClaudeTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "review the parser",
    attachments: [],
    onEvent: (event) => {
      if (!deaf) session = applyHarnessEvent(session, event);
    },
  });
  await waitFor(
    () =>
      parse().some(
        (m) =>
          (m.request as Record<string, unknown> | undefined)?.subtype ===
          "initialize",
      ),
    "initialize",
  );
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  await waitFor(() => parse().some((m) => m.type === "user"), "prompt");
  emit({
    type: "control_request",
    request_id: "ask_1",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      tool_use_id: "tool_ask_1",
      input: {
        questions: [
          {
            question: "Which part should I start with?",
            header: "Scope",
            multiSelect: false,
            options: [{ label: "Parser" }, { label: "Renderer" }],
          },
          {
            question: "What should I fix?",
            header: "Fixes",
            multiSelect: true,
            options: [{ label: "Significant bugs" }, { label: "Style nits" }],
          },
        ],
      },
    },
  });
  await waitFor(() => !!session.pendingQuestion, "question card");
  render();
  // Wrapped: an async function returning the promise would wait for the turn.
  return { turn };
}

/** Answer "Parser", Continue, tick "Significant bugs", Continue. */
function answerBoth() {
  expect(container.textContent).toContain("1 of 2");
  act(() => button("Parser").click());
  act(() => button("Continue").click());
  expect(container.textContent).toContain("2 of 2");
  expect(container.textContent).toContain("Select all that apply");
  act(() => button("Significant bugs").click());
  act(() => button("Continue").click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  sent.length = 0;
  onLine = undefined;
  deaf = false;
  messages = [];
  __claudeTestReset();
  registerHarness(claudeAdapter);
  session = { ...newSession("claude", "/repo"), id: "s1", busy: true };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await stopClaudeSession("s1");
  __claudeTestReset();
  vi.unstubAllGlobals();
});

describe("Answering Claude Code's two-question card", () => {
  it("Continue on the second question answers Claude and closes the card", async () => {
    const { turn } = await askTwoQuestions();
    answerBoth();
    await waitFor(() => !!responseFor("ask_1"), "Claude's answer");
    expect(responseFor("ask_1")).toMatchObject({
      response: {
        response: {
          behavior: "allow",
          updatedInput: {
            answers: {
              "Which part should I start with?": "Parser",
              "What should I fix?": "Significant bugs",
            },
          },
        },
      },
    });
    await waitFor(() => !session.pendingQuestion, "card to close");
    render();
    expect(container.querySelector("[data-question-form]")).toBeNull();
    expect(messages).toEqual([]);
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });

  it("sends the answers as a message when Claude no longer waits on the card", async () => {
    const { turn } = await askTwoQuestions();
    // The chat stopped hearing this turn, then the process went away: the
    // card is still on screen but nothing can answer it.
    deaf = true;
    await stopClaudeSession("s1");
    await turn;
    expect(session.pendingQuestion).toBeDefined();

    answerBoth();
    expect(responseFor("ask_1")).toBeUndefined();
    expect(messages).toEqual(["Scope: Parser\nFixes: Significant bugs"]);
    expect(session.pendingQuestion).toBeUndefined();
    expect(session.blocks.at(-1)).toMatchObject({
      role: "system",
      text: EXPIRED_QUESTION_SENT,
    });
    render();
    expect(container.querySelector("[data-question-form]")).toBeNull();
  });
});
