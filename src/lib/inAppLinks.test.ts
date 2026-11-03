// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_FILE_LINK,
  fileLinkHref,
  installInAppLinks,
  openInAppFile,
  openInAppUrl,
  parseFileLink,
  resolveFileLink,
} from "./inAppLinks";

describe("links to local files", () => {
  it("writes a file link that survives Markdown, with its line and column", () => {
    const href = fileLinkHref("/p/a b#1.ts", { line: 12, column: 3 });
    expect(href.startsWith(LOCAL_FILE_LINK)).toBe(true);
    expect(parseFileLink(href)).toEqual({
      value: "/p/a b#1.ts",
      navigation: { line: 12, column: 3 },
    });
    expect(parseFileLink(fileLinkHref("notes/plan.md"))).toEqual({
      value: "notes/plan.md",
    });
  });

  it("reads plain paths, file: URLs and GitHub-style line anchors", () => {
    expect(parseFileLink("src/app.ts:41")).toEqual({
      value: "src/app.ts",
      navigation: { line: 41 },
    });
    expect(parseFileLink("src/app.ts#L7-L9")).toEqual({
      value: "src/app.ts",
      navigation: { line: 7 },
    });
    expect(parseFileLink("file:///Users/me/notes.md")).toEqual({
      value: "/Users/me/notes.md",
    });
    expect(parseFileLink("file://localhost/Users/me/notes.md")).toEqual({
      value: "/Users/me/notes.md",
    });
    expect(parseFileLink("C:/Users/me/notes.md")).toEqual({
      value: "C:/Users/me/notes.md",
    });
    expect(parseFileLink("docs/a%20b.md")).toEqual({ value: "docs/a b.md" });
  });

  it("never reads a web link, an anchor, a share, a remote file: URL or a hidden scheme as a path", () => {
    for (const href of [
      "https://x.test/a.ts",
      "mailto:me@x.test",
      "#section",
      "?q=1",
      "//share/file.ts",
      "file://host/etc/passwd",
      "javascript:alert(1)",
      "java%73cript:alert(1)",
      "%2F%2Fshare/x",
      "a\u0000b.ts",
      "%E0%A4%A",
      "",
    ])
      expect(parseFileLink(href), href).toBeUndefined();
  });

  it("resolves a relative path against the chat's folder, and an absolute one as it is", () => {
    expect(resolveFileLink("src/app.ts:3", "/p")).toEqual({
      path: "/p/src/app.ts",
      navigation: { line: 3 },
    });
    expect(resolveFileLink("/p/src/app.ts")).toEqual({ path: "/p/src/app.ts" });
    expect(resolveFileLink("src/app.ts")).toBeUndefined();
    expect(resolveFileLink("https://x.test", "/p")).toBeUndefined();
  });
});

describe("the in-app link router", () => {
  const openUrl = vi.fn();
  const openFile = vi.fn();
  const report = vi.fn();
  let dispose: () => void = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    dispose();
    document.body.innerHTML = "";
  });

  it("refuses to open anything before the workspace is up", async () => {
    await expect(openInAppUrl("https://x.test")).rejects.toThrow(
      "The workspace is still opening. Try the link again.",
    );
    expect(() => openInAppFile("/p/a.ts")).toThrow(
      "The workspace is still opening. Try the file again.",
    );
  });

  it("sends web links in the page to the browser, left or middle click, and leaves the rest", async () => {
    dispose = installInAppLinks({ openUrl, openFile }, report);
    const web = document.createElement("a");
    web.href = "https://x.test/page";
    const inner = document.createElement("b");
    inner.textContent = "x";
    web.append(inner);
    const local = document.createElement("a");
    local.href = fileLinkHref("/p/a.ts");
    const button = document.createElement("button");
    document.body.append(web, local, button);

    const click = (node: Element, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      node.dispatchEvent(event);
      return event;
    };
    expect(click(inner).defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://x.test/page");
    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    web.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(2);
    // A right click, a local file link and a button are not its business.
    expect(click(web, { button: 2 }).defaultPrevented).toBe(false);
    expect(click(local).defaultPrevented).toBe(false);
    expect(click(button).defaultPrevented).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(openFile).not.toHaveBeenCalled();
    // An address it can't open is reported, never thrown at the page.
    openUrl.mockRejectedValueOnce(new Error("no browser"));
    click(web);
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith(new Error("no browser")),
    );
  });

  it("opens through the host once installed, and stops after dispose", async () => {
    dispose = installInAppLinks({ openUrl, openFile }, report);
    await openInAppUrl("x.test");
    expect(openUrl).toHaveBeenCalledWith("https://x.test/");
    openInAppFile("/p/a.ts", { line: 2 });
    expect(openFile).toHaveBeenCalledWith("/p/a.ts", { line: 2 });
    dispose();
    const web = document.createElement("a");
    web.href = "https://x.test/";
    document.body.append(web);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    web.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await expect(openInAppUrl("https://x.test")).rejects.toThrow(
      "still opening",
    );
  });
});
