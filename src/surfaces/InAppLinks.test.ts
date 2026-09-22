// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown, MarkdownPreview } from "./AgentMarkdown";
import {
  installInAppLinks,
  openInAppUrl,
  resolveFileLink,
} from "../lib/inAppLinks";

const native = vi.hoisted(() => ({ enabled: false, listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.enabled,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: native.listen }),
}));

describe("in-app links", () => {
  let root: Root;
  let element: HTMLDivElement;
  let stop: () => void;
  const openUrl = vi.fn();
  const openFile = vi.fn();
  const report = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    native.enabled = false;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    stop = installInAppLinks({ openUrl, openFile }, report);
  });
  afterEach(async () => {
    stop();
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
  });
  it("keeps ordinary, modified, and middle web-link clicks in the app", async () => {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text: "[Docs](https://example.com/docs)",
        }),
      ),
    );
    const link = element.querySelector("a")!;
    for (const options of [{}, { metaKey: true }, { button: 1 }]) {
      const event = new MouseEvent(options.button ? "auxclick" : "click", {
        bubbles: true,
        cancelable: true,
        ...options,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(openUrl).toHaveBeenCalledTimes(3);
    expect(openUrl).toHaveBeenLastCalledWith("https://example.com/docs");
    expect(openFile).not.toHaveBeenCalled();
  });
  it.each([
    ["[Plan](<docs/My Plan.md>)", "/project/docs/My Plan.md", undefined],
    [
      "[Code](/project/app.ts:12:3)",
      "/project/app.ts",
      { line: 12, column: 3 },
    ],
    [
      "[Notes](file:///Users/test/My%20Notes.md#L4)",
      "/Users/test/My Notes.md",
      { line: 4 },
    ],
    ["[Data](./report.json)", "/project/report.json", undefined],
    ["[Section](docs/guide.md#setup)", "/project/docs/guide.md", undefined],
  ])(
    "opens rendered file reference %s in the local viewer",
    async (text, path, navigation) => {
      await act(async () =>
        root.render(
          createElement(AgentMarkdown, {
            text,
            cwd: "/project",
            onOpenFile: openFile,
          }),
        ),
      );
      const link = element.querySelector("a")!;
      expect(link).not.toBeNull();
      link.click();
      expect(openFile).toHaveBeenCalledWith(path, navigation);
      expect(openUrl).not.toHaveBeenCalled();
    },
  );
  it("opens relative links from a Markdown document's own folder", async () => {
    await act(async () =>
      root.render(
        createElement(MarkdownPreview, {
          text: "[Sibling](./next.md)",
          cwd: "/project/docs",
        }),
      ),
    );
    element.querySelector("a")!.click();
    expect(openFile).toHaveBeenCalledWith("/project/docs/next.md", undefined);
  });
  it("does not turn remote inbox links into local file access", async () => {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text: "[File](/Users/test/private.md)",
          allowRemoteMedia: true,
          onOpenFile: openFile,
        }),
      ),
    );
    element.querySelector("a")?.click();
    expect(openFile).not.toHaveBeenCalled();
  });
  it("preserves same-document anchors", async () => {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, { text: "[Section](#section)" }),
      ),
    );
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    let preventedByApp = true;
    window.addEventListener("click", (click) => { preventedByApp = click.defaultPrevented; click.preventDefault(); }, { once: true });
    element.querySelector("a")!.dispatchEvent(event);
    expect(preventedByApp).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });
  it("routes programmatic actions and rejects privileged or executable URLs", async () => {
    await openInAppUrl("http://localhost:3000/path");
    expect(openUrl).toHaveBeenCalledWith("http://localhost:3000/path");
    for (const url of [
      "javascript:alert(1)",
      "file:///private/test",
      "https://tauri.localhost/private",
    ]) {
      await expect(openInAppUrl(url)).rejects.toThrow();
    }
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
  it("removes event listeners when a window unmounts", () => {
    stop();
    element.innerHTML = '<a href="https://example.com">Link</a>';
    window.addEventListener("click", (event) => event.preventDefault(), { once: true });
    element.querySelector("a")!.click();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("native shell link routing", () => {
  type NativeHandler = (event: { payload: { url: string } }) => void;
  const openUrl = vi.fn();
  const openFile = vi.fn();
  const report = vi.fn();
  const unlisten = vi.fn();
  let handler: NativeHandler;
  let stop: () => void;

  beforeEach(() => {
    native.enabled = true;
    openUrl.mockReset().mockResolvedValue(undefined);
    openFile.mockReset();
    report.mockReset();
    unlisten.mockReset();
    native.listen
      .mockReset()
      .mockImplementation((_name: string, callback: NativeHandler) => {
        handler = callback;
        return Promise.resolve(unlisten);
      });
  });

  afterEach(async () => {
    stop?.();
    await Promise.resolve();
    native.enabled = false;
  });

  const install = () => installInAppLinks({ openUrl, openFile }, report);
  const emit = async (url: string) => {
    handler({ payload: { url } });
    await Promise.resolve();
    await Promise.resolve();
  };

  it("routes a native Open Link action once through the same normalized browser host", async () => {
    stop = install();
    expect(native.listen).toHaveBeenCalledExactlyOnceWith(
      "aven:open-link",
      expect.any(Function),
    );
    await emit("HTTP://LOCALHOST:3000/preview");
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3000/preview",
    );
    expect(openFile).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)",
    "file:///private/test",
    "https://tauri.localhost/private",
    "https://user:password@example.com/",
  ])("reports and rejects a native link to %s", async (url) => {
    stop = install();
    await emit(url);
    expect(openUrl).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  });

  it("reports an asynchronous browser-open failure without navigating the document", async () => {
    const error = new Error("Browser unavailable");
    openUrl.mockRejectedValueOnce(error);
    const location = window.location.href;
    stop = install();
    await emit("https://example.com");
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(window.location.href).toBe(location);
  });

  it("ignores a disposed callback and unregisters after a delayed registration completes", async () => {
    let registered!: (unlisten: () => void) => void;
    native.listen.mockImplementationOnce(
      (_name: string, callback: NativeHandler) => {
        handler = callback;
        return new Promise<() => void>((resolve) => {
          registered = resolve;
        });
      },
    );
    const oldStop = install();
    const oldHandler = handler;
    oldStop();
    stop = install();
    oldHandler({ payload: { url: "https://old.example.com" } });
    await emit("https://current.example.com");
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(
      "https://current.example.com/",
    );
    const oldUnlisten = vi.fn();
    registered(oldUnlisten);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(oldUnlisten).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports listener setup failure only while its host is active", async () => {
    const error = new Error("Could not listen");
    native.listen.mockRejectedValueOnce(error);
    stop = install();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    stop();
    report.mockClear();
    native.listen.mockRejectedValueOnce(error);
    stop = install();
    stop();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });

  it("unregisters a completed listener once and ignores late native events", async () => {
    stop = install();
    await Promise.resolve();
    stop();
    stop();
    await emit("https://example.com");
    expect(unlisten).toHaveBeenCalledOnce();
    expect(openUrl).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("does not register a native event listener outside the desktop app", () => {
    native.enabled = false;
    stop = install();
    expect(native.listen).not.toHaveBeenCalled();
  });
});

it.each([
  "javascript:alert(1)",
  "data:text/html,test",
  "mailto:person@example.com",
  "https://example.com/readme.md",
  "file://remote/share.md",
  "#heading",
  "//remote/readme.md",
])("does not treat %s as a workspace file", (href) => {
  expect(resolveFileLink(href, "/project")).toBeUndefined();
});
