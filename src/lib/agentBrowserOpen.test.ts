import { describe, expect, it, vi } from "vitest";
import {
  matchingAgentBrowserTab,
  openAgentBrowserTab,
} from "./agentBrowserOpen";
import {
  closeBrowserTab,
  EMPTY_BROWSER,
  updateBrowserTab,
} from "./personalWorkspace";

describe("agent browser open", () => {
  const url = "http://localhost:5173/design/mocks/index.html?focus=1#editor";

  it("opens the same preview three times as one retained tab", () => {
    const create = vi.fn(() => "one");
    const first = openAgentBrowserTab(EMPTY_BROWSER, url, {}, create);
    const second = openAgentBrowserTab(first.workspace, url, {}, create);
    const third = openAgentBrowserTab(second.workspace, url, {}, create);
    expect(third.tab.id).toBe(first.tab.id);
    expect(third.workspace.tabs).toEqual([{ id: "one", url, kept: true }]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("selects the live tab and preserves URL, title and favicon without replacing it", () => {
    const saved = {
      ...EMPTY_BROWSER,
      open: true,
      activeTabId: "other",
      tabs: [
        {
          id: "preview",
          url,
          title: "Edited mock",
          favicon: "data:image/png;base64,aWNvbg==",
        },
        { id: "other", url: "https://example.com/" },
      ],
    };
    const next = openAgentBrowserTab(saved, url);
    expect(next.workspace.activeTabId).toBe("preview");
    expect(next.workspace.tabs[0]).toEqual({ ...saved.tabs[0], kept: true });
    expect(next.workspace.tabs).toHaveLength(2);
  });

  it("prefers the selected matching copy, while preserving deliberate duplicates", () => {
    const first = openAgentBrowserTab(EMPTY_BROWSER, url, {}, () => "one");
    const copy = openAgentBrowserTab(
      first.workspace,
      url,
      { newTab: true },
      () => "two",
    );
    const next = openAgentBrowserTab(copy.workspace, url);
    expect(next.tab.id).toBe("two");
    expect(next.workspace.tabs.map((tab) => tab.id)).toEqual(["one", "two"]);
  });

  it("normalizes URL spelling but keeps routes, query strings, fragments and hosts distinct", () => {
    const tabs = [{ id: "one", url: "https://EXAMPLE.com:443" }];
    expect(matchingAgentBrowserTab(tabs, "https://example.com/")?.id).toBe(
      "one",
    );
    for (const different of [
      "https://example.com/path",
      "https://example.com/?v=2",
      "https://example.com/#two",
      "http://example.com/",
      "https://other.com/",
    ])
      expect(matchingAgentBrowserTab(tabs, different)).toBeUndefined();
    expect(
      matchingAgentBrowserTab([{ id: "blank", url: "" }], url),
    ).toBeUndefined();
  });

  it("does not reuse a closed or navigated-away page or a different workspace", () => {
    const first = openAgentBrowserTab(EMPTY_BROWSER, url, {}, () => "one");
    const closed = closeBrowserTab(first.workspace, "one");
    const navigated = updateBrowserTab(first.workspace, "one", {
      url: "https://example.com/",
    });
    for (const state of [closed, navigated, EMPTY_BROWSER]) {
      expect(openAgentBrowserTab(state, url, {}, () => "fresh").tab.id).toBe(
        "fresh",
      );
    }
  });

  it("reveals a saved closed browser workspace without changing its tab identity", () => {
    const first = openAgentBrowserTab(EMPTY_BROWSER, url, {}, () => "one");
    const next = openAgentBrowserTab({ ...first.workspace, open: false }, url);
    expect(next.tab.id).toBe("one");
    expect(next.workspace.open).toBe(true);
  });
});
