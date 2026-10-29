// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { claudeAdapter } from "../lib/harness/claudeAdapter";
import type { Session } from "../lib/session";
import type { DiscussionHost } from "../lib/discussions";

const bot = vi.hoisted(() => ({ project: undefined as string | undefined }));
vi.mock("../lib/projectBots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/projectBots")>()),
  useBotChatProject: () => bot.project,
}));
vi.mock("../hooks/useProjectBotName", () => ({
  useProjectBotName: (path?: string) => (path ? "Jelly" : undefined),
}));
vi.mock("./BotChat", () => ({
  BotChatHeader: () => null,
  BotIntro: () => null,
}));
vi.mock("./EmptySession", () => ({
  EmptySession: ({ composer }: { composer?: ReactNode }) => composer ?? null,
}));
vi.mock("../chrome/SessionReview", () => ({ SessionReview: () => null }));
vi.mock("./AgentTranscript", () => ({ AgentTranscript: () => null }));
vi.mock("../chrome/PromptOutline", () => ({ PromptOutline: () => null }));
vi.mock("../chrome/useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("../chrome/ComposerRunner", () => ({ ComposerRunner: () => null }));
vi.mock("../chrome/MemoryKeeper", () => ({ MemoryKeeperOffer: () => null }));
vi.mock("../chrome/DevPreviewChip", () => ({ DevPreviewChip: () => null }));
vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));

const { SessionPane } = await import("./SessionPane");

const PROJECT = "/Users/me/Developer/site";

describe("a chat's message box and its helm", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof SessionPane>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>([["aven.helmHint.v1", "seen"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    registerHarness(claudeAdapter);
    bot.project = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      session: {
        id: "chat-1",
        harness: "claude",
        model: "claude:opus",
        modelSettings: {},
        runtimeMode: "full-access",
        cwd: PROJECT,
        title: "Chat",
        blocks: [{ id: "u0", role: "user", text: "Earlier" }],
      } as Session,
      visible: true,
      focused: true,
      inSplit: false,
      composerFocused: false,
      recents: [],
      onFocus: vi.fn(),
      onClose: vi.fn(),
      onCwdChange: vi.fn(),
      onBranchChange: vi.fn(),
      onModelChange: vi.fn(),
      onModelSettingsChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
      onStop: vi.fn(),
      onCompactContext: vi.fn(),
      onDeleteQueuedMessage: vi.fn(),
      onEditQueuedMessage: vi.fn(),
      onQueuedMessageEditingChange: vi.fn(),
      onSteerQueuedMessage: vi.fn(),
      onResumeQueue: vi.fn(),
      onApproval: vi.fn(),
      onQuestionReply: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenDiff: vi.fn(),
      onOpenPlan: vi.fn(),
      onBuildPlan: vi.fn(),
      onNewTerminal: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render(
    session: Partial<Session> = {},
    more: Partial<typeof props> = {},
  ) {
    props = { ...props, ...more, session: { ...props.session, ...session } };
    await act(async () => root.render(createElement(SessionPane, props)));
  }
  const stops = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) =>
        /^Stop/.test(button.getAttribute("aria-label") ?? "") ||
        button.classList.contains("session-run-stop"),
    );
  const openHelm = () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-helm-critter]")!
        .click(),
    );
  const rows = () =>
    [...container.querySelectorAll<HTMLElement>("[data-helm-row]")].map(
      (row) => row.dataset.helmRow,
    );

  it("says what the agent is doing in the critter's bubble, with the chat's one Stop", async () => {
    await render({
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "Look", startedAt: Date.now() - 5_000 },
        {
          id: "t1",
          role: "tool",
          text: "",
          streaming: true,
          tool: {
            callId: "c1",
            kind: "read",
            title: "Read Composer.tsx",
            status: "in_progress",
            preview: {
              kind: "read",
              path: `${PROJECT}/Composer.tsx`,
              fileName: "Composer.tsx",
            },
          },
        },
      ] as Session["blocks"],
    });
    // The Working row above the box is gone; the bubble carries it.
    expect(container.querySelector(".session-run-status")).toBeNull();
    const bubble = container.querySelector<HTMLElement>(
      '[data-helm-say="running"]',
    )!;
    expect(bubble.textContent).toContain("Composer.tsx");
    expect(bubble.querySelector('[role="timer"]')).not.toBeNull();
    expect(stops()).toHaveLength(1);
    await act(async () => stops()[0].click());
    expect(props.onStop).toHaveBeenCalledWith("chat-1");
  });

  it("keeps queued messages and their count while the agent works", async () => {
    await render({
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "Go", startedAt: Date.now() },
      ] as Session["blocks"],
      queuedMessages: [{ id: "q1", text: "Then the docs", attachments: [] }],
    });
    expect(
      container.querySelector("[data-message-queue]")?.textContent,
    ).toContain("Then the docs");
    expect(
      container.querySelector('[data-helm-say="running"]')!.textContent,
    ).toContain("1 queued");
    expect(stops()).toHaveLength(1);
  });

  it("stands the project's own critter at the helm", async () => {
    await render();
    const critter = container.querySelector(
      "[data-helm-critter] .helm-critter",
    )!;
    expect(critter.getAttribute("data-critter")).toBeTruthy();
    expect(
      container.querySelector("[data-composer][data-helm]"),
    ).not.toBeNull();
  });

  it("leaves the agent's choices out of a bot's chat, whose critter is its project's", async () => {
    bot.project = PROJECT;
    await render({
      cwd: "/Users/me/Library/Application Support/Aven/bots/site",
    });
    await openHelm();
    expect(rows()).not.toContain("model");
    expect(rows()).not.toContain("access");
    expect(rows()).toContain("files");
    expect(rows()).toContain("critter");
    expect(
      container
        .querySelector("[data-helm-critter]")!
        .getAttribute("aria-label"),
    ).not.toContain("Claude");
  });

  it("offers Discuss in the dialog's modes where the chat can start one", async () => {
    const discussion = {
      start: vi.fn(() => null),
      open: vi.fn(),
      candidates: () => [],
    } as unknown as DiscussionHost;
    await render({}, { discussion });
    await openHelm();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-helm-row="modes"]')!
        .click(),
    );
    expect(
      container.querySelector("[data-composer-discuss]")?.textContent,
    ).toContain("Discuss");
  });
});
