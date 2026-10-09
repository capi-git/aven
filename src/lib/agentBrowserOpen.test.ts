import { describe, expect, it, vi } from "vitest";
import {
  matchingAgentBrowserTab,
  openAgentBrowserTab,
  coalesceAgentBrowserOpen,
} from "./agentBrowserOpen";
import {
  closeBrowserTab,
  EMPTY_BROWSER,
  updateBrowserTab,
} from "./personalWorkspace";

describe("agent browser open", () => {
  const url = "http://localhost:5173/design/mocks/index.html?focus=1#editor";

  it("shares concurrent same-project requests across windows but keeps explicit copies and other projects separate", async () => {
    const pending = new Map<string, Promise<string>>();
    let finish!: (id: string) => void;
    const firstOpen = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const otherOpen = vi.fn(async () => "other");
    const first = coalesceAgentBrowserOpen(
      pending,
      "/p",
      "https://EXAMPLE.com:443",
      {},
      firstOpen,
    );
    const second = coalesceAgentBrowserOpen(
      pending,
      "/p",
      "https://example.com/",
      {},
      otherOpen,
    );
    expect(second).toBe(first);
    expect(
      await coalesceAgentBrowserOpen(
        pending,
        "/q",
        "https://example.com/",
        {},
        otherOpen,
      ),
    ).toBe("other");
    expect(
      await coalesceAgentBrowserOpen(
        pending,
        "/p",
        "https://example.com/",
        { newTab: true },
        otherOpen,
      ),
    ).toBe("other");
    finish("shared");
    expect(await second).toBe("shared");
    expect(firstOpen).toHaveBeenCalledOnce();
    expect(otherOpen).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(0);
    await expect(
      coalesceAgentBrowserOpen(pending, "/p", url, {}, async () => {
        throw new Error("moving");
      }),
    ).rejects.toThrow("moving");
    expect(pending.size).toBe(0);
    expect(
      await coalesceAgentBrowserOpen(pending, "/p", url, {}, otherOpen),
    ).toBe("other");
  });

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

  it("prepares agent pages without changing the selected page or split mode", () => {
    const first = openAgentBrowserTab(EMPTY_BROWSER, url, {}, () => "one");
    const initial = {
      ...first.workspace,
      expanded: false,
      mode: "split" as const,
    };
    const added = openAgentBrowserTab(
      initial,
      "https://example.com/",
      { focus: false },
      () => "two",
    );
    expect(added.workspace).toMatchObject({
      activeTabId: "one",
      url,
      expanded: false,
      mode: "split",
    });
    const reused = openAgentBrowserTab(
      added.workspace,
      "https://example.com/",
      { focus: false },
    );
    expect(reused.tab.id).toBe("two");
    expect(reused.workspace).toMatchObject({
      activeTabId: "one",
      url,
      expanded: false,
      mode: "split",
    });
    expect(reused.workspace.tabs).toHaveLength(2);
  });
});
