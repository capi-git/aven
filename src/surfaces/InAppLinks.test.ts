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

describe("in-app links", () => {
  let root: Root;
  let element: HTMLDivElement;
  let stop: () => void;
  const openUrl = vi.fn();
  const openFile = vi.fn();
  const report = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
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
