// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_FENCE,
  armChatAutomation,
  asksForAutomation,
  chatAutomationId,
  parseAutomationFields,
  parseChatAutomationBody,
  settleChatAutomation,
} from "./chatAutomation";
import { getScheduledAgent, listScheduledAgents } from "./scheduledAgents";

const chat = {
  id: "chat-1",
  cwd: "/tmp/site",
  harness: "claude",
  model: "opus",
  runtimeMode: "full-access",
} as const;
const body = JSON.stringify({
  name: "Morning review",
  prompt: "List yesterday's changes.",
  days: [1, 2, 3, 4, 5],
  time: "09:00",
});
const reply = `Done.\n\n\`\`\`${AUTOMATION_FENCE}\n${body}\n\`\`\``;

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  // Clears an arm left by an earlier test.
  settleChatAutomation(chat, "", false, 0);
});

describe("asking in a chat", () => {
  it("hears a request for something recurring", () => {
    for (const text of [
      "create an automation for this",
      "upload articles everyday",
      "do this every morning",
      "run it every 6 hours",
      "a weekly report please",
      "schedule this",
    ])
      expect(asksForAutomation(text), text).toBe(true);
    for (const text of ["fix the bug", "every test passes", "what is daylight"])
      expect(asksForAutomation(text), text).toBe(false);
  });

  it("hears a request to keep watching something", () => {
    for (const text of [
      "watch this Notion page; if it updates, add it to the articles on the website",
      "keep an eye on the changelog",
      "Whenever a new post appears, share it",
      "if the page changes, tell me",
      "keep the docs up to date with Notion",
      "monitor the feed for new releases",
    ])
      expect(asksForAutomation(text), text).toBe(true);
    for (const text of [
      "run npm in watch mode",
      "the watch task fails",
      "does the file watcher work",
      "what changed in this file",
      "if this changes the API we need a note",
      "I watched the demo",
    ])
      expect(asksForAutomation(text), text).toBe(false);
  });

  it("only offers it on a turn you typed", () => {
    expect(armChatAutomation("a", "do this daily", false)).toBe("");
    expect(armChatAutomation("a", "fix the bug", true)).toBe("");
    expect(armChatAutomation("a", "do this daily", true)).toContain(
      AUTOMATION_FENCE,
    );
  });
});

describe("the block", () => {
  it("reads a daily time and a repeat", () => {
    expect(parseChatAutomationBody(body)?.schedule).toEqual({
      kind: "weekly",
      days: [1, 2, 3, 4, 5],
      time: "09:00",
    });
    expect(
      parseChatAutomationBody(
        JSON.stringify({ name: "N", prompt: "P", everyHours: 6 }),
      )?.schedule,
    ).toEqual({ kind: "interval", hours: 6 });
  });

  it("refuses anything incomplete", () => {
    for (const bad of [
      "not json",
      "[]",
      JSON.stringify({ prompt: "P", days: [1], time: "09:00" }),
      JSON.stringify({ name: "N", days: [1], time: "09:00" }),
      JSON.stringify({ name: "N", prompt: "P" }),
      JSON.stringify({ name: "N", prompt: "P", days: [], time: "09:00" }),
      JSON.stringify({ name: "N", prompt: "P", days: [1], time: "soon" }),
      JSON.stringify({ name: "N", template: "nope", days: [1], time: "09:00" }),
    ])
      expect(parseChatAutomationBody(bad), bad).toBeNull();
  });

  it("writes the Notion steps from the template, drafts and all", () => {
    const draft = parseChatAutomationBody(
      JSON.stringify({
        name: "Articles",
        template: "notion-articles",
        answers: {
          source: "https://www.notion.so/abc",
          destination: "/insights pages",
          readyStatus: "Ready",
        },
        days: [0, 1, 2, 3, 4, 5, 6],
        time: "08:00",
      }),
    );
    expect(draft?.prompt).toContain("https://www.notion.so/abc");
    expect(draft?.prompt).toContain("Nothing goes live until I press Publish");
    expect(
      parseChatAutomationBody(
        JSON.stringify({
          name: "Articles",
          template: "notion-articles",
          answers: { destination: "/insights" },
          days: [1],
          time: "08:00",
        }),
      ),
    ).toBeNull();
  });
});

describe("an automation as an object", () => {
  it("reads a team's job by the same rules as a block", () => {
    expect(parseAutomationFields(JSON.parse(body))).toEqual(
      parseChatAutomationBody(body),
    );
    for (const bad of [null, "text", [], { name: "N", prompt: "P" }])
      expect(parseAutomationFields(bad)).toBeNull();
  });
});

describe("the connections a block names", () => {
  const block = (fields: Record<string, unknown>) =>
    JSON.stringify({
      name: "Slack digest",
      days: [1],
      time: "09:00",
      prompt: "Summarise my Slack.",
      ...fields,
    });

  it("asks only for what a run can't work without", () => {
    expect(armChatAutomation(chat.id, "every morning", true)).toContain(
      '"connections": ["Slack"]',
    );
    settleChatAutomation(chat, "", false, 0);
  });

  it("keeps them on the automation it creates", () => {
    armChatAutomation(chat.id, "every morning", true);
    const created = settleChatAutomation(
      chat,
      `\`\`\`${AUTOMATION_FENCE}\n${block({ connections: ["Slack", "slack", 3, " "] })}\n\`\`\``,
      true,
      1_000,
    );
    expect(created?.connections).toEqual(["Slack"]);
    expect(getScheduledAgent(created!.id)?.connections).toEqual(["Slack"]);
  });

  it("leaves them off when there are none, or they aren't a list", () => {
    expect(parseChatAutomationBody(block({}))).not.toHaveProperty(
      "connections",
    );
    expect(
      parseChatAutomationBody(block({ connections: "Slack" })),
    ).not.toHaveProperty("connections");
  });

  it("ignores them on the built-in steps, which have a way round", () => {
    const draft = parseChatAutomationBody(
      block({
        prompt: undefined,
        template: "notion-articles",
        answers: {
          source: "https://www.notion.so/team/Articles-0123456789abcdef",
          destination: "the blog",
        },
        connections: ["Notion"],
      }),
    );
    expect(draft?.prompt).toContain("Notion");
    expect(draft).not.toHaveProperty("connections");
  });
});

describe("when the turn settles", () => {
  it("creates it for an armed turn, once, and never with Full access", () => {
    armChatAutomation(chat.id, "do this every morning", true);
    const agent = settleChatAutomation(chat, reply, true, 1000);
    expect(agent?.name).toBe("Morning review");
    expect(agent?.project).toBe("/tmp/site");
    expect(agent?.runtimeMode).toBe("auto");
    expect(agent?.enabled).toBe(true);
    expect(agent?.nextRunAt).toBeGreaterThan(1000);
    armChatAutomation(chat.id, "do this every morning", true);
    settleChatAutomation(chat, reply, true, 2000);
    expect(listScheduledAgents()).toHaveLength(1);
    expect(getScheduledAgent(agent!.id)?.createdAt).toBe(1000);
  });

  it("ignores a block from a turn you didn't ask in", () => {
    expect(settleChatAutomation(chat, reply, true, 1000)).toBeNull();
    armChatAutomation(chat.id, "fix the bug", true);
    expect(settleChatAutomation(chat, reply, true, 1000)).toBeNull();
    expect(listScheduledAgents()).toHaveLength(0);
  });

  it("creates nothing for a stopped turn, and the arm doesn't carry over", () => {
    armChatAutomation(chat.id, "do this daily", true);
    expect(settleChatAutomation(chat, reply, false, 1000)).toBeNull();
    expect(settleChatAutomation(chat, reply, true, 1000)).toBeNull();
    expect(listScheduledAgents()).toHaveLength(0);
  });

  it("gives each block its own id", () => {
    const one = { name: "A", prompt: "P" };
    expect(chatAutomationId("x", one)).toBe(chatAutomationId("x", one));
    expect(chatAutomationId("x", one)).not.toBe(chatAutomationId("y", one));
  });
});
