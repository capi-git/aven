import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harnessDescriptor } from "./harness/descriptors";
import { applyHarnessEvent } from "./harness/apply";
import { registerHarness, type HarnessAdapter } from "./harness/registry";
import type {
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "./harness/types";
import {
  EXPIRED_QUESTION_SENT,
  EXPIRED_QUESTION_UNSENT,
  answerQuestion,
  deliverApproval,
  deliverQuestionReply,
} from "./questionReply";
import { newSession, type HarnessId, type Session } from "./session";
import {
  questionReplyText,
  type UserQuestion,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "./userQuestion";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => undefined,
}));

const questions: UserQuestion[] = [
  {
    id: "Which part should I start with?",
    header: "Scope",
    prompt: "Which part should I start with?",
    multiSelect: false,
    allowCustom: true,
    options: [
      { id: "Parser", label: "Parser" },
      { id: "Renderer", label: "Renderer" },
    ],
  },
  {
    id: "What should I fix?",
    header: "Fixes",
    prompt: "What should I fix?",
    multiSelect: true,
    allowCustom: true,
    options: [
      { id: "Significant bugs", label: "Significant bugs" },
      { id: "Style nits", label: "Style nits" },
    ],
  },
];

const prompt: UserQuestionPrompt = { requestId: 3, title: "Scope", questions };

/** Replies each fake agent took, and which question ids it still waits on. */
const taken = new Map<HarnessId, Array<[string, number]>>();
const waiting = new Map<HarnessId, Set<number>>();
const approvals = new Map<HarnessId, Array<[string, number, string]>>();

function fakeAgent(id: "claude" | "codex" | "cursor"): HarnessAdapter {
  return {
    id,
    descriptor: harnessDescriptor(id),
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval(sessionId, requestId, decision) {
      approvals.get(id)!.push([sessionId, requestId, decision]);
    },
    respondQuestion(sessionId, requestId) {
      if (!waiting.get(id)!.delete(requestId)) return false;
      taken.get(id)!.push([sessionId, requestId]);
      return true;
    },
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
  };
}

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

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/repo"),
    id: "chat",
    busy: true,
    pendingQuestion: prompt,
    ...patch,
  };
}

const answered: UserQuestionReply = {
  kind: "answered",
  answers: {
    "Which part should I start with?": ["Parser"],
    "What should I fix?": ["Significant bugs"],
  },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  for (const id of ["claude", "codex", "cursor"] as const) {
    taken.set(id, []);
    waiting.set(id, new Set());
    approvals.set(id, []);
    registerHarness(fakeAgent(id));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("questionReplyText", () => {
  it("writes one plain line per answered question", () => {
    expect(questionReplyText(questions, answered)).toBe(
      "Scope: Parser\nFixes: Significant bugs",
    );
    expect(
      questionReplyText(questions, {
        kind: "answered",
        answers: { "What should I fix?": ["Significant bugs", "__custom__"] },
        custom: { "What should I fix?": "The slow startup" },
      }),
    ).toBe("Fixes: Significant bugs, The slow startup");
  });

  it("has nothing to say for a skipped card", () => {
    expect(questionReplyText(questions, { kind: "skipped" })).toBe("");
  });
});

describe("deliverQuestionReply", () => {
  it("reaches the agent that asked after the chat switched to another", () => {
    // Switched from Claude to Codex mid-turn: Claude still runs the turn.
    waiting.get("claude")!.add(3);
    const switched = chat({
      harness: "codex",
      pendingSwitch: {
        from: "claude",
        fromModel: "claude:opus",
        fromSettings: {},
      },
    });
    expect(deliverQuestionReply(switched, 3, answered)).toBe(true);
    expect(taken.get("claude")).toEqual([["chat", 3]]);
    expect(taken.get("codex")).toEqual([]);
  });

  it("reports false when no agent waits on the question", () => {
    expect(deliverQuestionReply(chat(), 3, answered)).toBe(false);
  });

  it("sends an approval to the agent that asked after a switch", () => {
    deliverApproval(
      chat({
        harness: "codex",
        pendingSwitch: {
          from: "claude",
          fromModel: "claude:opus",
          fromSettings: {},
        },
      }),
      5,
      "allow",
    );
    expect(approvals.get("claude")).toEqual([["chat", 5, "allow"]]);
  });
});

describe("answerQuestion", () => {
  function effects(sent = true) {
    const events: HarnessEvent[] = [];
    const messages: string[] = [];
    return {
      events,
      messages,
      effects: {
        close: (requestId: number) =>
          events.push({
            type: "question.resolved",
            requestId,
            decision: "cancelled",
          }),
        send: (text: string) => {
          messages.push(text);
          return sent;
        },
        note: (text: string) => events.push({ type: "status", text }),
      },
    };
  }

  it("only delivers when the agent still waits", () => {
    waiting.get("claude")!.add(3);
    const run = effects();
    expect(answerQuestion(chat(), 3, answered, run.effects)).toBe("delivered");
    expect(run.events).toEqual([]);
    expect(run.messages).toEqual([]);
  });

  it("closes a stale card and sends its answers as a message", () => {
    const run = effects();
    const session = chat();
    expect(answerQuestion(session, 3, answered, run.effects)).toBe("sent");
    expect(run.messages).toEqual(["Scope: Parser\nFixes: Significant bugs"]);
    const after = run.events.reduce(applyHarnessEvent, session);
    expect(after.pendingQuestion).toBeUndefined();
    expect(after.blocks.at(-1)).toMatchObject({
      role: "system",
      text: EXPIRED_QUESTION_SENT,
    });
  });

  it("says so when the chat refuses the message", () => {
    const run = effects(false);
    expect(answerQuestion(chat(), 3, answered, run.effects)).toBe("expired");
    expect(run.events.at(-1)).toEqual({
      type: "status",
      text: EXPIRED_QUESTION_UNSENT,
    });
  });

  it("closes a stale skipped card without sending anything", () => {
    const run = effects();
    const session = chat();
    expect(answerQuestion(session, 3, { kind: "skipped" }, run.effects)).toBe(
      "expired",
    );
    expect(run.messages).toEqual([]);
    expect(
      run.events.reduce(applyHarnessEvent, session).pendingQuestion,
    ).toBeUndefined();
  });

  it("sends nothing for a card that is no longer shown", () => {
    const run = effects();
    expect(
      answerQuestion(
        chat({ pendingQuestion: undefined }),
        3,
        answered,
        run.effects,
      ),
    ).toBe("expired");
    expect(run.messages).toEqual([]);
  });
});
