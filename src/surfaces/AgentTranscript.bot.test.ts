// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import {
  resetProjectBotsCache,
  updateProjectBot,
  withReadyFix,
} from "../lib/projectBots";
import { sanitizeSessionForPersist } from "../lib/sessionStore";
import { newSession, type Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

const PATH = "/work/orbit";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  resetProjectBotsCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetProjectBotsCache();
  vi.unstubAllGlobals();
});

const wake = (id: string, label: string): Block => ({
  id,
  role: "user",
  text: label,
  startedAt: 1,
  durationMs: 2000,
  botWake: { label },
});

it("shows a wake-up as a tag, folds a check with nothing to report, and puts a fix's card under its turn", async () => {
  updateProjectBot(PATH, (bot) =>
    withReadyFix(
      { ...bot, on: true, base: "b".repeat(40) },
      {
        base: "b".repeat(40),
        turnId: "w2",
        files: 2,
        additions: 14,
        deletions: 6,
        paths: ["a.ts", "b.ts"],
        at: 1,
      },
    ),
  );
  const blocks: Block[] = [
    wake("w1", "Chat finished · Tidy styles"),
    { id: "r1", role: "assistant", text: "Nothing to report." },
    wake("w2", "Chat finished · Add sign-up flow"),
    { id: "r2", role: "assistant", text: "Two tests broke; I fixed them." },
    { id: "u3", role: "user", text: "Thanks!", startedAt: 3, durationMs: 1 },
    { id: "r3", role: "assistant", text: "Any time." },
  ];
  await act(async () =>
    root.render(createElement(AgentTranscript, { blocks, botProject: PATH })),
  );
  // The quiet check is one line, its reply folded away.
  const checked = container.querySelectorAll("[data-bot-checked]");
  expect(checked).toHaveLength(1);
  expect(checked[0].textContent).toContain("Chat finished · Tidy styles");
  expect(checked[0].textContent).toContain("Checked · nothing to report");
  expect(container.textContent).not.toContain("Nothing to report.");
  // A wake-up that found something is a tag, never your message bubble.
  const tags = container.querySelectorAll("[data-bot-wake]");
  expect([...tags].map((tag) => tag.textContent)).toEqual([
    expect.stringContaining("Chat finished · Add sign-up flow"),
  ]);
  expect(container.textContent).toContain("Two tests broke; I fixed them.");
  // The fix's card follows the turn that made it, and only that one.
  const cards = container.querySelectorAll("[data-bot-fix]");
  expect(cards).toHaveLength(1);
  expect(cards[0].getAttribute("data-bot-fix")).toBe("ready");
  expect(cards[0].textContent).toContain("Fix ready · 2 files");
  // One plain line: no line counts to explain.
  expect(cards[0].textContent).not.toContain("+14");
  expect(
    [...cards[0].querySelectorAll("button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Review", "Apply"]);
  // Throw away waits with the changes, once you look at them.
  const review = [...cards[0].querySelectorAll("button")].find(
    (button) => button.textContent === "Review",
  )!;
  await act(async () => review.click());
  expect(
    [...cards[0].querySelectorAll("button")]
      .map((button) => button.textContent)
      .filter((label) => label === "Throw away" || label === "Hide"),
  ).toEqual(["Hide", "Throw away"]);
  // Your own message is an ordinary one.
  expect(
    container.querySelector(".personal-user-message")?.textContent,
  ).toContain("Thanks!");
});

it("keeps a wake-up's tag when it is saved", () => {
  const session = {
    ...newSession("claude", PATH),
    blocks: [wake("w1", "Dev server crashed")],
  };
  expect(sanitizeSessionForPersist(session).blocks[0].botWake).toEqual({
    label: "Dev server crashed",
  });
});

it("while a bot works, shows one line of what it is doing, and asks to be allowed once", async () => {
  updateProjectBot(PATH, (bot) => ({ ...bot, on: true }));
  const step = (id: string, title: string, status: string): Block => ({
    id,
    role: "tool",
    text: title,
    tool: { kind: "execute", title, status },
  });
  const blocks: Block[] = [
    {
      ...wake("w1", "Chat finished · Add sign-up flow"),
      durationMs: undefined,
    },
    step("t1", "git status --short", "completed"),
    step("t2", "npm test -- auth", "in_progress"),
  ];
  await act(async () =>
    root.render(
      createElement(AgentTranscript, { blocks, busy: true, botProject: PATH }),
    ),
  );
  expect(container.textContent).toContain("Running the tests…");
  // Its steps wait behind that line.
  expect(container.textContent).not.toContain("git status --short");
  expect(container.textContent).not.toContain("npm test -- auth");

  const onApproval = vi.fn();
  const asking: Block[] = [
    ...blocks.slice(0, 2),
    {
      ...step("t2", "git push origin main", "pending"),
      approval: { requestId: 7 },
    },
  ];
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: asking,
        busy: true,
        botProject: PATH,
        onApproval,
      }),
    ),
  );
  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-approval-pending] button",
    ),
  ];
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Allow once",
    "Don't allow",
  ]);
  await act(async () => buttons[1]!.click());
  expect(onApproval).toHaveBeenCalledWith(7, "deny");
});
