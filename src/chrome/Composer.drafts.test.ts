// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { fxAdapter } from "../lib/harness/fxAdapter";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { saveFollowUpBehavior } from "../lib/settings";
import { Composer } from "./Composer";
import type { Attachment } from "../lib/session";

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ModelSettings", () => ({ ModelSettings: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const attachment: Attachment = {
  id: "image-1",
  name: "draft.png",
  mimeType: "image/png",
  kind: "image",
  size: 3,
  data: "YWJj",
};

describe("composer draft mutation boundaries", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof Composer>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    registerHarness(codexAdapter);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      enabled: false,
      focused: false,
      harness: "codex",
      model: "gpt-5",
      runtimeMode: "full-access",
      executionCwd: "~",
      hideTopBar: true,
      initialDraft: "Unsent draft",
      initialAttachments: [attachment],
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
      onDraftChange: vi.fn(),
      onAttachmentsChange: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(createElement(Composer, props)));
    return container.querySelector<HTMLTextAreaElement>("textarea")!;
  }

  it("queues a busy follow-up with its attachments and clears only after acceptance", async () => {
    props.busy = true;
    const textarea = await render();
    const queue = container.querySelector<HTMLButtonElement>(
      '[aria-label="Queue message"]',
    );
    expect(queue).not.toBeNull();
    await act(async () => queue!.click());
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(
      "Unsent draft",
      [attachment],
      {
        intent: "default",
        followUpBehavior: "queue",
      },
    );
    expect(textarea.value).toBe("");
    expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps the busy action and submitted behavior in sync with explicit Steer", async () => {
    props.busy = true;
    const textarea = await render();
    await act(async () => saveFollowUpBehavior("steer"));
    expect(
      container.querySelector('[aria-label="Steer active turn"]'),
    ).not.toBeNull();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(props.onSubmit).toHaveBeenLastCalledWith(
      "Unsent draft",
      [attachment],
      {
        intent: "default",
        followUpBehavior: "steer",
      },
    );
  });

  it("offers Queue while an idle paused queue already has work", async () => {
    props.queuedMessages = [
      { id: "first", text: "Existing queued message", attachments: [] },
    ];
    props.queueStatus = "paused";
    await render();
    const queue = container.querySelector<HTMLButtonElement>(
      '[aria-label="Queue message"]',
    );
    expect(queue).not.toBeNull();
    await act(async () => queue!.click());
    expect(props.onSubmit).toHaveBeenLastCalledWith(
      "Unsent draft",
      [attachment],
      {
        intent: "default",
        followUpBehavior: "queue",
      },
    );
  });

  it("restores text and image bytes without sending, then publishes typing synchronously", async () => {
    const textarea = await render();
    expect(textarea.value).toBe("Unsent draft");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,YWJj",
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      textarea.value = "Save before immediately quitting";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      expect(props.onDraftChange).toHaveBeenLastCalledWith(
        "Save before immediately quitting",
      );
      root.render(null);
    });
    expect(props.onAttachmentsChange).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("publishes attachment removal before an immediate unmount", async () => {
    await render();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Remove draft.png"]')!
        .click();
      expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([]);
      root.render(null);
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("clears persisted text and attachments synchronously after an explicit send", async () => {
    const textarea = await render();
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith(
        "Unsent draft",
        [attachment],
        { intent: "default" },
      );
      expect(props.onDraftChange).toHaveBeenLastCalledWith("");
      expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([]);
    });
    expect(textarea.value).toBe("");
    expect(container.querySelector("img")).toBeNull();
  });

  it("retains text and attachments when the submit callback rejects the send", async () => {
    props.onSubmit = vi.fn(() => false);
    const textarea = await render();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("Unsent draft");
    expect(container.querySelector("img")).not.toBeNull();
    expect(props.onDraftChange).not.toHaveBeenCalled();
    expect(props.onAttachmentsChange).not.toHaveBeenCalled();
  });

  it("keeps an fx follow-up visible while disabling unavailable mid-turn steering", async () => {
    registerHarness(fxAdapter);
    props = {
      ...props,
      harness: "fx",
      busy: true,
      initialAttachments: [],
      queuedMessages: [{ id: "queued", text: "Next task", attachments: [] }],
      onSteerQueuedMessage: vi.fn(),
    };
    await render();
    const steer = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Steer",
    )!;
    expect(steer.disabled).toBe(true);
    await act(async () => steer.click());
    expect(props.onSteerQueuedMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Next task");
  });

  it("reports an attachment overflow without changing the accepted draft", async () => {
    const full = Array.from({ length: 20 }, (_, i) => ({
      ...attachment,
      id: `image-${i}`,
      name: `${i}.png`,
    }));
    props.initialAttachments = full;
    await render();
    props = {
      ...props,
      quoteRequest: {
        id: 22,
        text: "",
        attachments: [{ ...attachment, id: "overflow", name: "overflow.png" }],
      },
    };
    const textarea = await render();
    expect(props.onAttachmentsChange).toHaveBeenLastCalledWith(full);
    expect(container.textContent).toContain("You can attach up to 20 files");
    expect(
      container.querySelector('[aria-label="Remove overflow.png"]'),
    ).toBeNull();
    expect(textarea.value).toBe("Unsent draft");
  });

  it("merges screenshot requests once, preserving the draft and attachment removal across rerenders", async () => {
    const screenshot: Attachment = {
      ...attachment,
      id: "browser-selection",
      name: "selection.png",
    };
    const textarea = await render();
    textarea.setSelectionRange(3, 3);
    const acknowledge = vi.fn();
    props = {
      ...props,
      quoteRequest: {
        id: 2,
        text: "",
        mode: "plain",
        attachments: [attachment, screenshot, screenshot],
      },
      onQuoteRequestConsumed: acknowledge,
    };
    await render();
    expect(textarea.value).toBe("Unsent draft");
    expect(textarea.selectionStart).toBe(3);
    expect(props.onDraftChange).not.toHaveBeenCalled();
    expect(props.onAttachmentsChange).toHaveBeenCalledExactlyOnceWith([
      attachment,
      screenshot,
    ]);
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(2);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove selection.png"]',
        )!
        .click(),
    );
    expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([attachment]);
    const changedAcknowledge = vi.fn();
    props = {
      ...props,
      quoteRequest: { ...props.quoteRequest! },
      onQuoteRequestConsumed: changedAcknowledge,
    };
    await render();
    expect(props.onAttachmentsChange).toHaveBeenCalledTimes(2);
    expect(changedAcknowledge).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Remove selection.png"]'),
    ).toBeNull();

    props = { ...props, quoteRequest: { ...props.quoteRequest!, id: 3 } };
    await render();
    expect(props.onAttachmentsChange).toHaveBeenCalledTimes(3);
    expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([
      attachment,
      screenshot,
    ]);
    props = {
      ...props,
      quoteRequest: {
        id: 2,
        text: "stale text",
        attachments: [{ ...screenshot, id: "stale-image" }],
      },
    };
    await render();
    expect(textarea.value).toBe("Unsent draft");
    expect(props.onAttachmentsChange).toHaveBeenCalledTimes(3);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("keeps an image-only request empty and compact until the user sends it", async () => {
    props = {
      ...props,
      enabled: true,
      initialDraft: "",
      initialAttachments: [],
      quoteRequest: { id: 1, text: "", attachments: [attachment] },
      onQuoteRequestConsumed: vi.fn(),
    };
    const textarea = await render();
    expect(textarea.value).toBe("");
    expect(props.onDraftChange).not.toHaveBeenCalled();
    expect(props.onAttachmentsChange).toHaveBeenCalledExactlyOnceWith([
      attachment,
    ]);
    expect(container.querySelector("[data-attachments-only]")).not.toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("", [attachment], {
      intent: "default",
    });
  });
});
