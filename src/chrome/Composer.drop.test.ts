// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { attachmentsFromFiles } from "../lib/attachments";
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
vi.mock("../lib/attachments", async (original) => ({
  ...(await original<typeof import("../lib/attachments")>()),
  attachmentsFromFiles: vi.fn(),
}));

const image: Attachment = {
  id: "dropped-image",
  name: "screenshot.png",
  mimeType: "image/png",
  kind: "image",
  size: 3,
  data: "YWJj",
};

function transfer(files: File[], itemsOnly = false) {
  return {
    types: itemsOnly ? [] : ["Files"],
    files: itemsOnly ? [] : files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    dropEffect: "none",
  } as unknown as DataTransfer;
}

function dropEvent(type: string, data: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  return event;
}

describe("composer image drops", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof Composer>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      enabled: true,
      focused: false,
      hotkeys: false,
      harness: "codex",
      model: "gpt-5",
      runtimeMode: "full-access",
      executionCwd: "~",
      hideTopBar: true,
      initialDraft: "Keep this unsent",
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
      onDraftChange: vi.fn(),
      onAttachmentsChange: vi.fn(),
    };
    vi.mocked(attachmentsFromFiles).mockReset().mockResolvedValue([image]);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(extra: ComponentProps<typeof Composer> | null = null) {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(
            "section",
            { "data-session-drop": "left" },
            createElement(Composer, props),
          ),
          extra &&
            createElement(
              "section",
              { "data-session-drop": "right" },
              createElement(Composer, extra),
            ),
        ),
      ),
    );
    return container.querySelector<HTMLElement>("[data-session-drop]")!;
  }

  it("accepts an items-only screenshot in just the targeted pane without sending", async () => {
    const other = { ...props, onAttachmentsChange: vi.fn() };
    const pane = await render(other);
    const file = new File(["abc"], "screenshot.png", { type: "image/png" });
    const data = transfer([file], true);
    const over = dropEvent("dragover", data);
    await act(async () => pane.querySelector("textarea")!.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("copy");
    expect(pane.querySelector("[data-file-drag]")).not.toBeNull();
    await act(async () =>
      pane.querySelector("textarea")!.dispatchEvent(dropEvent("drop", data)),
    );
    expect(attachmentsFromFiles).toHaveBeenCalledExactlyOnceWith([file]);
    expect(props.onAttachmentsChange).toHaveBeenLastCalledWith([image]);
    expect(other.onAttachmentsChange).not.toHaveBeenCalled();
    expect(pane.querySelector("textarea")!.value).toBe("Keep this unsent");
    expect(pane.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,YWJj",
    );
    expect(pane.querySelector("[data-file-drag]")).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("does not steal a drop from a neighboring or hidden session", async () => {
    props.enabled = false;
    const pane = await render();
    const data = transfer([
      new File(["abc"], "image.png", { type: "image/png" }),
    ]);
    await act(async () => {
      pane.dispatchEvent(dropEvent("drop", data));
      container.dispatchEvent(dropEvent("drop", data));
    });
    expect(attachmentsFromFiles).not.toHaveBeenCalled();
  });

  it("allows ordinary text dragging and reports failed file reads", async () => {
    const pane = await render();
    const text = dropEvent("drop", {
      types: ["text/plain"],
      files: [],
      items: [],
    } as unknown as DataTransfer);
    await act(async () => pane.dispatchEvent(text));
    expect(text.defaultPrevented).toBe(false);
    expect(attachmentsFromFiles).not.toHaveBeenCalled();
    vi.mocked(attachmentsFromFiles).mockRejectedValueOnce(
      new Error("read failed"),
    );
    await act(async () =>
      pane.dispatchEvent(
        dropEvent("drop", transfer([new File(["x"], "image.png")])),
      ),
    );
    expect(pane.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't attach",
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("does not publish a late attachment after the target has closed", async () => {
    let resolve!: (files: Attachment[]) => void;
    vi.mocked(attachmentsFromFiles).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pane = await render();
    await act(async () =>
      pane.dispatchEvent(
        dropEvent("drop", transfer([new File(["x"], "image.png")])),
      ),
    );
    await act(async () => root.render(null));
    await act(async () => resolve([image]));
    expect(props.onAttachmentsChange).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
