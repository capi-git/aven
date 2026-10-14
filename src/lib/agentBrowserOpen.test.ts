import { describe, expect, it, vi } from "vitest";
import {
  matchingAgentBrowserTab,
  openAgentBrowserTab,
  createAgentBrowserRouter,
  reserveAgentBrowserOpen,
} from "./agentBrowserOpen";
import {
  closeBrowserTab,
  EMPTY_BROWSER,
  updateBrowserTab,
} from "./personalWorkspace";

describe("agent browser open", () => {
  const url = "http://localhost:5173/design/mocks/index.html?focus=1#editor";

  it("uses one background policy for reuse and creation and reserves until placement finishes", async () => {
    const router = createAgentBrowserRouter();
    let finish!: (id: string) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const reuse = vi.fn(async (tab: { id: string; url: string }) => tab.id);
    const pages: Array<{ id: string; url: string }> = [];
    const adapter = { tabs: () => pages, create, reuse };
    const first = router.open("/p", url, { arrange: false }, adapter);
    const second = router.open("/p", url, { arrange: false }, adapter);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(create).toHaveBeenCalledExactlyOnceWith(url, {
      activate: false,
      arrange: false,
    });
    pages.push({ id: "one", url });
    finish("one");
    await expect(first).resolves.toBe("one");
    await expect(router.open("/p", url, {}, adapter)).resolves.toBe("one");
    expect(reuse).toHaveBeenCalledExactlyOnceWith(pages[0], {
      activate: false,
      arrange: true,
    });
  });

  it("requires both native delivery and a checkpoint before releasing a reservation", async () => {
    let deliver!: () => void;
    const release = vi.fn();
    const operation = reserveAgentBrowserOpen(
      "one",
      () =>
        new Promise<void>((resolve) => {
          deliver = resolve;
        }),
      release,
    );
    const finished = vi.fn();
    void operation.promise.then(finished);
    await Promise.resolve();
    operation.confirm();
    expect(release).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    deliver();
    await expect(operation.promise).resolves.toBe("one");
    expect(release).toHaveBeenCalledOnce();
    operation.confirm();
    operation.fail(new Error("late close"));
    expect(release).toHaveBeenCalledOnce();
  });

  it("reuses pending explicit copies without preventing another deliberate copy", async () => {
    const router = createAgentBrowserRouter();
    const deliveries: Array<(id: string) => void> = [];
    const create = vi.fn(
      () => new Promise<string>((resolve) => deliveries.push(resolve)),
    );
    const adapter = { tabs: () => [], reuse: async () => "unused", create };
    const first = router.open("/p", url, { newTab: true }, adapter);
    const second = router.open("/p", url, { newTab: true }, adapter);
    expect(router.open("/p", url, {}, adapter)).toBe(first);
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(2);
    deliveries[0]("first");
    await expect(first).resolves.toBe("first");
    expect(router.open("/p", url, {}, adapter)).toBe(second);
    deliveries[1]("second");
    await expect(second).resolves.toBe("second");
  });

  it("shares concurrent same-project requests across windows but keeps explicit copies and other projects separate", async () => {
    const router = createAgentBrowserRouter();
    const open = (
      project: string,
      target: string,
      options: { newTab?: boolean },
      open: () => Promise<string>,
    ) =>
      router.open(project, target, options, {
        tabs: () => [],
        reuse: async () => "unused",
        create: open,
      });
    let finish!: (id: string) => void;
    const firstOpen = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const otherOpen = vi.fn(async () => "other");
    const first = open("/p", "https://EXAMPLE.com:443", {}, firstOpen);
    const second = open("/p", "https://example.com/", {}, otherOpen);
    expect(second).toBe(first);
    expect(await open("/q", "https://example.com/", {}, otherOpen)).toBe(
      "other",
    );
    expect(
      await open("/p", "https://example.com/", { newTab: true }, otherOpen),
    ).toBe("other");
    finish("shared");
    expect(await second).toBe("shared");
    expect(firstOpen).toHaveBeenCalledOnce();
    expect(otherOpen).toHaveBeenCalledTimes(2);

    await expect(
      open("/p", url, {}, async () => {
        throw new Error("moving");
      }),
    ).rejects.toThrow("moving");

    expect(await open("/p", url, {}, otherOpen)).toBe("other");
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
