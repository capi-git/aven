// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, leafIds, type LayoutNode } from "../lib/layout";
import { RetainedBrowserPane } from "./RetainedBrowserPane";
import { WorkspaceStage } from "./WorkspaceStage";
import { getRegisteredAgentBrowserPage } from "../lib/agentBrowser";

const native = vi.hoisted(() => ({
  attach: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  listen: vi.fn(),
  listenToolbar: vi.fn().mockResolvedValue(() => {}),
  unlisten: vi.fn(),
  setFloating: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: () => ({ x: 0, y: 40, width: 600, height: 500, scale: 2 }),
  nativeBrowser: native,
}));

describe("retained browser pages in the workspace stage", () => {
  let root: Root;
  let container: HTMLDivElement;
  const urls = {
    "project-a-preview": "http://localhost:3000/preview",
    "project-a-docs": "https://example.com/docs",
    "project-b-preview": "http://localhost:4000/preview",
  };
  type PageId = keyof typeof urls;
  let pageIds: PageId[];
  const pipResult = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    native.listenToolbar.mockResolvedValue(() => {});
    native.attach.mockResolvedValue({
      id: "returning-native",
      url: "https://example.com/docs",
      title: "Docs",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    for (const fn of [
      native.create,
      native.close,
      native.layout,
      native.navigate,
    ])
      fn.mockResolvedValue(undefined);
    native.listen.mockResolvedValue(native.unlisten);
    native.setFloating.mockResolvedValue("preview-float-requested");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    pageIds = Object.keys(urls) as PageId[];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(
    layout: LayoutNode,
    visible = true,
    requests: Partial<Record<PageId, number>> = {},
  ) {
    const shown = leafIds(layout);
    await act(async () =>
      root.render(
        createElement(WorkspaceStage, {
          layout,
          focusedId: shown[0],
          visible,
          dragging: false,
          dragTarget: null,
          onFocus: vi.fn(),
          onLayoutChange: vi.fn(),
          surfaces: pageIds.map((id) => ({
            id,
            content: createElement(RetainedBrowserPane, {
              id,
              initialUrl: urls[id],
              visible: visible && shown.includes(id),
              expanded: shown.length === 1,
              pictureInPictureRequest: requests[id],
              onPictureInPictureResult: pipResult,
            }),
          })),
        }),
      ),
    );
    await act(async () => vi.advanceTimersByTime(120));
  }
  function address(id: PageId) {
    return container.querySelector<HTMLInputElement>(
      `[data-workspace-surface="${id}"] [aria-label="Preview address"]`,
    );
  }
  const columns = (): LayoutNode => ({
    type: "split",
    id: "a-columns",
    dir: "right",
    sizes: [0.6, 0.4],
    children: [leaf("project-a-preview"), leaf("project-a-docs")],
  });

  it("does not create native pages for unvisited saved tabs", async () => {
    await render(leaf("project-a-preview"), false);
    expect(native.create).not.toHaveBeenCalled();
    expect(native.listen).not.toHaveBeenCalled();
    await render(leaf("project-a-preview"));
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.create.mock.calls[0][1]).toBe(urls["project-a-preview"]);
    expect(address("project-a-docs")).toBeNull();
    expect(address("project-b-preview")).toBeNull();
  });

  it("creates an explicitly requested background agent page and retains its registration across workspace switches", async () => {
    const props = {
      id: "background-agent-preview",
      initialUrl: "https://example.com/agent-preview",
      visible: false,
    };
    await act(async () =>
      root.render(createElement(RetainedBrowserPane, props)),
    );
    expect(native.create).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(RetainedBrowserPane, { ...props, agentRequested: true }),
      ),
    );
    expect(native.create).toHaveBeenCalledOnce();
    const nativeId = native.create.mock.calls[0][0];
    expect(getRegisteredAgentBrowserPage(props.id)).toBe(nativeId);
    await act(async () =>
      root.render(createElement(RetainedBrowserPane, props)),
    );
    await act(async () =>
      root.render(createElement(RetainedBrowserPane, { ...props, visible: true })),
    );
    await act(async () =>
      root.render(createElement(RetainedBrowserPane, props)),
    );
    expect(getRegisteredAgentBrowserPage(props.id)).toBe(nativeId);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.navigate).not.toHaveBeenCalled();
    expect(native.close).not.toHaveBeenCalled();
  });

  it("acknowledges a returned native page even when its grouped tab is not selected", async () => {
    const props = {
      id: "project-a-docs",
      initialUrl: urls["project-a-docs"],
      visible: false,
    };
    await act(async () =>
      root.render(createElement(RetainedBrowserPane, props)),
    );
    expect(native.attach).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(RetainedBrowserPane, {
          ...props,
          attachedNativeId: "returning-native",
        }),
      ),
    );
    expect(native.attach).toHaveBeenCalledExactlyOnceWith("returning-native");
    expect(native.layout).toHaveBeenCalledWith(
      "returning-native",
      expect.any(Object),
      false,
    );
    expect(native.layout.mock.calls.some((call) => call[2] === true)).toBe(
      false,
    );
    expect(native.create).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();
    expect(native.close).not.toHaveBeenCalled();
  });

  it("mounts only the explicitly requested unvisited page for group Picture in Picture", async () => {
    await render(leaf("project-a-preview"), false);
    expect(native.create).not.toHaveBeenCalled();
    const request = { "project-a-docs": 12 };
    await render(leaf("project-a-preview"), false, request);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.create.mock.calls[0][1]).toBe(urls["project-a-docs"]);
    expect(native.setFloating).toHaveBeenCalledExactlyOnceWith(
      native.create.mock.calls[0][0],
      true,
    );
    expect(pipResult).toHaveBeenCalledExactlyOnceWith(
      12,
      "preview-float-requested",
    );
    expect(address("project-a-preview")).toBeNull();
    expect(address("project-b-preview")).toBeNull();
    const docs = address("project-a-docs");
    expect(docs).not.toBeNull();
    await render(leaf("project-a-preview"), false, request);
    await render(leaf("project-a-preview"), false);
    expect(address("project-a-docs")).toBe(docs);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.setFloating).toHaveBeenCalledOnce();
    expect(native.close).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();
    expect(native.layout.mock.calls.some((call) => call[2] === true)).toBe(
      false,
    );
  });

  it("keeps each native page and its input through split, mixed order, project switching and closing a sibling", async () => {
    await render(columns());
    expect(native.create).toHaveBeenCalledTimes(2);
    const previewNativeId = native.create.mock.calls[0][0];
    const docsNativeId = native.create.mock.calls[1][0];
    const preview = address("project-a-preview")!;
    const docs = address("project-a-docs")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(preview, "Unsubmitted address text");
      preview.dispatchEvent(new Event("input", { bubbles: true }));
    });
    pageIds = ["project-a-docs", "project-b-preview", "project-a-preview"];
    await render({ ...columns(), type: "split", dir: "down" });
    expect(address("project-a-preview")).toBe(preview);
    expect(address("project-a-docs")).toBe(docs);
    expect(preview.value).toBe("Unsubmitted address text");
    await render(leaf("project-b-preview"));
    expect(native.create).toHaveBeenCalledTimes(3);
    const projectB = address("project-b-preview")!;
    expect(native.layout).toHaveBeenCalledWith(
      previewNativeId,
      expect.any(Object),
      false,
    );
    expect(native.layout).toHaveBeenCalledWith(
      docsNativeId,
      expect.any(Object),
      false,
    );
    await render(columns());
    await render(columns(), false);
    await render(columns());
    expect(address("project-a-preview")).toBe(preview);
    expect(address("project-a-docs")).toBe(docs);
    expect(address("project-b-preview")).toBe(projectB);
    expect(native.create).toHaveBeenCalledTimes(3);
    expect(native.close).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();
    pageIds = pageIds.filter((id) => id !== "project-a-docs");
    await render(leaf("project-a-preview"));
    expect(native.close).toHaveBeenCalledExactlyOnceWith(docsNativeId);
    expect(native.unlisten).toHaveBeenCalledOnce();
    expect(address("project-a-preview")).toBe(preview);
    expect(address("project-b-preview")).toBe(projectB);
    expect(native.create).toHaveBeenCalledTimes(3);
  });
});
