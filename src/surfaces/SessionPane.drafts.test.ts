// @vitest-environment happy-dom
import {
  act,
  createElement,
  Fragment,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Composer } from "../chrome/Composer";
import { SessionPane } from "./SessionPane";
import type { Attachment, Session } from "../lib/session";
import { resetHarnessModelOverlays, setHarnessModels } from "../lib/models";
import { requestAddToChat } from "../lib/quoteDraft";

const mock = vi.hoisted(() => ({
  composer: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  release: vi.fn(),
  retain: vi.fn(),
}));
vi.mock("../chrome/Composer", () => ({ Composer: mock.composer }));
vi.mock("../lib/composerDrafts", () => ({
  readComposerDraft: mock.read,
  updateComposerDraft: mock.update,
  retainComposerDraft: mock.retain,
}));
vi.mock("./EmptySession", () => ({
  EmptySession: ({ composer }: { composer?: ReactNode }) => composer ?? null,
}));
vi.mock("../chrome/SessionReview", () => ({ SessionReview: () => null }));
vi.mock("./AgentTranscript", () => ({ AgentTranscript: () => null }));
vi.mock("../chrome/PromptOutline", () => ({ PromptOutline: () => null }));

const attachment: Attachment = {
  id: "image-1",
  name: "draft.png",
  mimeType: "image/png",
  kind: "image",
  size: 3,
  data: "YWJj",
};

describe("session pane draft and header ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof SessionPane>;
  const composerProps = () =>
    mock.composer.mock.calls.at(-1)![0] as ComponentProps<typeof Composer>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    mock.composer.mockReturnValue(null);
    mock.retain.mockReturnValue(mock.release);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      session: {
        id: "one",
        harness: "codex",
        model: "gpt-5",
        runtimeMode: "full-access",
        cwd: "~",
        title: "New session",
        blocks: [],
        composerSeed: "Original seed",
      },
      visible: false,
      focused: false,
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
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  });

  async function render(
    session: Partial<Session> = {},
    inSplit = props.inSplit,
  ) {
    props = { ...props, inSplit, session: { ...props.session, ...session } };
    await act(async () => root.render(createElement(SessionPane, props)));
  }

  it("shows the model for a fresh split pane, then preserves a generated title with model context", async () => {
    await render({ model: "codex:qa-model", title: "codex" }, true);
    expect(
      container.querySelector("[data-session-pane-label]")?.textContent,
    ).toBe("qa-model");
    await act(async () =>
      setHarnessModels("codex", [
        { id: "codex:qa-model", harness: "codex", name: "QA Model" },
      ]),
    );
    expect(
      container.querySelector("[data-session-pane-label]")?.textContent,
    ).toBe("QA Model");
    expect(container.querySelector("[data-session-pane-model]")).toBeNull();
    await render({ title: "codex · Repair preview" });
    expect(
      container.querySelector("[data-session-pane-label]")?.textContent,
    ).toBe("Repair preview");
    expect(
      container.querySelector("[data-session-pane-model]")?.textContent,
    ).toBe("QA Model");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close pane"]')!
        .click(),
    );
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("one");
  });

  it("labels the still-running provider while the next provider is selected, then updates when idle", async () => {
    await render(
      {
        harness: "claude",
        title: "New session",
        model: "claude:next-model",
        busy: true,
        blocks: [
          {
            id: "turn",
            role: "user",
            text: "Run",
            startedAt: 1,
            turnModel: { harness: "codex", model: "codex:running-model" },
          },
        ],
        pendingSwitch: {
          from: "codex",
          fromModel: "codex:running-model",
          fromSettings: {},
        },
      },
      true,
    );
    expect(
      container.querySelector("[data-session-pane-label]")?.textContent,
    ).toBe("running-model");
    await render({ busy: false });
    expect(
      container.querySelector("[data-session-pane-label]")?.textContent,
    ).toBe("next-model");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("restores explicit empty text before the seed and retains attachment data through composer relocation", async () => {
    mock.read.mockReturnValue({
      text: "",
      attachments: [attachment],
      updatedAt: 1,
    });
    await render();
    expect(composerProps().initialDraft).toBe("");
    expect(composerProps().initialAttachments).toEqual([attachment]);
    const withPreview = { ...attachment, previewUrl: "blob:mounted-only" };
    composerProps().onAttachmentsChange?.([withPreview]);
    expect(mock.update).toHaveBeenCalledWith("one", {
      text: "",
      attachments: [withPreview],
    });
    await render({}, true);
    expect(composerProps().initialAttachments).toEqual([attachment]);
    expect(mock.read).toHaveBeenCalledOnce();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("changes draft ownership with the session and ignores an old session callback", async () => {
    mock.read.mockImplementation((id: string) => ({
      text: `${id} unsent`,
      attachments: [],
      updatedAt: 1,
    }));
    await render();
    const oldChange = composerProps().onDraftChange!;
    await render({ id: "two" });
    expect(composerProps().initialDraft).toBe("two unsent");
    oldChange("Late edit from one");
    expect(mock.update).not.toHaveBeenCalled();
    composerProps().onDraftChange?.("New edit in two");
    expect(mock.update).toHaveBeenCalledExactlyOnceWith("two", {
      text: "New edit in two",
    });
  });

  it("keeps inbox exploration drafts ephemeral while retaining them locally", async () => {
    await render({
      inboxAsk: {
        key: "item",
        title: "Issue",
        url: "https://example.com/issue",
        provider: "github",
      },
    });
    composerProps().onDraftChange?.("Temporary thought");
    composerProps().onAttachmentsChange?.([attachment]);
    await render({}, true);
    expect(composerProps().initialDraft).toBe("Temporary thought");
    expect(composerProps().initialAttachments).toEqual([attachment]);
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("forwards screenshot-only requests to just the current add-to-chat target", async () => {
    mock.read.mockReturnValue(undefined);
    const latestFor = (id: string) =>
      mock.composer.mock.calls
        .map(([value]) => value as ComponentProps<typeof Composer>)
        .findLast((value) => value.sessionId === id)!;
    const renderTarget = async (target: string) => {
      await act(async () =>
        root.render(
          createElement(
            Fragment,
            null,
            ...["one", "two"].map((id) =>
              createElement(SessionPane, {
                ...props,
                key: id,
                session: { ...props.session, id },
                inSplit: true,
                addToChatTarget: target === id,
              }),
            ),
          ),
        ),
      );
    };

    await renderTarget("one");
    await act(async () => requestAddToChat("", "plain", [attachment]));
    expect(latestFor("one").quoteRequest).toMatchObject({
      text: "",
      mode: "plain",
      attachments: [attachment],
    });
    expect(latestFor("two").quoteRequest).toBeUndefined();
    await act(async () =>
      latestFor("one").onQuoteRequestConsumed?.(
        latestFor("one").quoteRequest!.id,
      ),
    );

    await renderTarget("two");
    await act(async () => requestAddToChat("", "plain", [attachment]));
    expect(latestFor("one").quoteRequest).toBeUndefined();
    expect(latestFor("two").quoteRequest?.attachments).toEqual([attachment]);
    expect(mock.update).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
