import { describe, expect, it, vi } from "vitest";
import {
  agentPageFor,
  matchingAgentBrowserTab,
  openAgentBrowserTab,
  createAgentBrowserRouter,
  reserveAgentBrowserOpen,
  sameAgentSite,
} from "./agentBrowserOpen";
import {
  addRetainedBrowserTab,
  closeBrowserTab,
  EMPTY_BROWSER,
  keepBrowserTab,
  normalizeBrowserWorkspace,
  releaseAgentBrowserTab,
  updateBrowserTab,
  type BrowserWorkspace,
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
    await expect(first).resolves.toEqual({ id: "one" });
    await expect(router.open("/p", url, {}, adapter)).resolves.toEqual({
      id: "one",
    });
    expect(reuse).toHaveBeenCalledExactlyOnceWith(
      pages[0],
      { activate: false, arrange: true },
      undefined,
    );
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
    await expect(first).resolves.toEqual({ id: "first" });
    expect(router.open("/p", url, {}, adapter)).toBe(second);
    deliveries[1]("second");
    await expect(second).resolves.toEqual({ id: "second" });
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
    expect(await open("/q", "https://example.com/", {}, otherOpen)).toEqual({
      id: "other",
    });
    expect(
      await open("/p", "https://example.com/", { newTab: true }, otherOpen),
    ).toEqual({ id: "other" });
    finish("shared");
    expect(await second).toEqual({ id: "shared" });
    expect(firstOpen).toHaveBeenCalledOnce();
    expect(otherOpen).toHaveBeenCalledTimes(2);

    await expect(
      open("/p", url, {}, async () => {
        throw new Error("moving");
      }),
    ).rejects.toThrow("moving");

    expect(await open("/p", url, {}, otherOpen)).toEqual({ id: "other" });
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

describe("an agent builds on one page", () => {
  const mock = "http://localhost:5173/mocks/index.html";
  const ids = () => {
    let next = 0;
    return () => `page-${++next}`;
  };
  /** Opens in order from one chat, as the agent's tool calls arrive. */
  const openAll = (
    start: BrowserWorkspace,
    urls: readonly string[],
    chat = "chat-a",
    createId = ids(),
  ) => {
    let workspace = normalizeBrowserWorkspace(start);
    const results = urls.map((url) => {
      const result = openAgentBrowserTab(workspace, url, { chat }, createId);
      workspace = result.workspace;
      return result;
    });
    return { workspace, results };
  };

  it("reloads the same address and navigates another query, fragment or mock file in one tab", () => {
    const { workspace, results } = openAll(EMPTY_BROWSER, [
      mock,
      mock,
      `${mock}?v=2`,
      `${mock}?v=2#hero`,
      "http://localhost:5173/mocks/pricing.html",
      // Loopback names are one host.
      "http://127.0.0.1:5173/mocks/pricing.html",
      "http://localhost:5173/",
    ]);
    expect(workspace.tabs).toHaveLength(1);
    expect(results.map((result) => result.tab.id)).toEqual(
      Array(7).fill("page-1"),
    );
    expect(results.map((result) => result.refresh)).toEqual([
      undefined,
      "reload",
      "navigate",
      "navigate",
      "navigate",
      "navigate",
      "navigate",
    ]);
    expect(workspace.tabs[0]).toEqual({
      id: "page-1",
      url: "http://localhost:5173/",
      kept: true,
      agentChat: "chat-a",
    });
  });

  it("opens a second page for a new tab at another path, and builds on the one in front", () => {
    const createId = ids();
    const first = openAll(EMPTY_BROWSER, [mock], "chat-a", createId);
    const alternative = "http://localhost:5173/mocks/alternative.html";
    const copy = openAgentBrowserTab(
      first.workspace,
      alternative,
      { chat: "chat-a", newTab: true },
      createId,
    );
    expect(copy.refresh).toBeUndefined();
    expect(copy.workspace.tabs.map((tab) => [tab.id, tab.agentChat])).toEqual([
      ["page-1", "chat-a"],
      ["page-2", "chat-a"],
    ]);
    // Another site is a new page too.
    const docs = openAgentBrowserTab(
      copy.workspace,
      "https://example.com/mocks/index.html",
      { chat: "chat-a", newTab: true },
      createId,
    );
    expect(docs.tab.id).toBe("page-3");
    // The alternative is in front of the mock, so the next page builds on it.
    const next = openAgentBrowserTab(
      copy.workspace,
      `${alternative}?version=new`,
      { chat: "chat-a" },
      createId,
    );
    expect(next.tab.id).toBe("page-2");
    expect(next.refresh).toBe("navigate");
    expect(next.workspace.tabs).toHaveLength(2);
    expect(next.workspace.tabs[0].url).toBe(mock);
  });

  it("reuses the chat's own page when a new tab would only copy it", () => {
    const createId = ids();
    const first = openAll(EMPTY_BROWSER, [mock], "chat-a", createId).workspace;
    const same = openAgentBrowserTab(
      first,
      mock,
      { chat: "chat-a", newTab: true },
      createId,
    );
    expect([same.tab.id, same.refresh]).toEqual(["page-1", "reload"]);
    const query = openAgentBrowserTab(
      same.workspace,
      `${mock}?v=2#hero`,
      { chat: "chat-a", newTab: true },
      createId,
    );
    expect([query.tab.id, query.refresh]).toEqual(["page-1", "navigate"]);
    expect(query.workspace.tabs).toHaveLength(1);
    expect(query.workspace.tabs[0].url).toBe(`${mock}?v=2#hero`);
    // Nobody else's page is reused for a new tab, even at the same address.
    const user = addRetainedBrowserTab(EMPTY_BROWSER, {
      id: "mine",
      url: mock,
    });
    const beside = openAgentBrowserTab(
      user,
      mock,
      { chat: "chat-a", newTab: true },
      () => "fresh",
    );
    expect([beside.tab.id, beside.refresh]).toEqual(["fresh", undefined]);
    expect(beside.workspace.tabs).toHaveLength(2);
    // Without a chat (the dev preview opener) a new tab is always new.
    expect(
      openAgentBrowserTab(first, mock, { newTab: true }, () => "copy").tab.id,
    ).toBe("copy");
  });

  it("never navigates a page the user opened, and only shows one at the same address", () => {
    const user = addRetainedBrowserTab(EMPTY_BROWSER, {
      id: "mine",
      url: mock,
    });
    const same = openAgentBrowserTab(user, mock, { chat: "chat-a" }, ids());
    expect(same.tab.id).toBe("mine");
    expect(same.refresh).toBeUndefined();
    expect(same.workspace.tabs).toHaveLength(1);
    const { workspace, results } = openAll(user, [
      `${mock}?v=2`,
      "http://localhost:5173/mocks/pricing.html",
    ]);
    expect(results.map((result) => [result.tab.id, result.refresh])).toEqual([
      ["page-1", undefined],
      ["page-1", "navigate"],
    ]);
    expect(workspace.tabs.find((tab) => tab.id === "mine")).toEqual({
      id: "mine",
      url: mock,
      kept: true,
    });
  });

  it("opens a new tab once the user kept the page or typed an address into it", () => {
    const first = openAll(EMPTY_BROWSER, [mock]).workspace;
    for (const released of [
      // Keep open on the agent's page.
      releaseAgentBrowserTab(keepBrowserTab(first, "page-1"), "page-1"),
      // An address typed into it, which also changes what it shows.
      releaseAgentBrowserTab(
        updateBrowserTab(first, "page-1", { url: "https://example.com/" }),
        "page-1",
      ),
    ]) {
      const before = released.tabs[0];
      const next = openAgentBrowserTab(
        released,
        `${mock}?v=2`,
        { chat: "chat-a" },
        () => "fresh",
      );
      expect(next.tab.id).toBe("fresh");
      expect(next.refresh).toBeUndefined();
      expect(next.workspace.tabs[0]).toEqual(before);
      expect(next.workspace.tabs[0].agentChat).toBeUndefined();
    }
  });

  it("keeps a page moved into a split as the agent's to build on", () => {
    const first = openAll(EMPTY_BROWSER, [mock]).workspace;
    // A deliberate move into a split keeps the page (stripDropKeeps).
    const moved = keepBrowserTab(first, "page-1");
    const next = openAgentBrowserTab(moved, `${mock}?v=3`, { chat: "chat-a" });
    expect(next.tab.id).toBe("page-1");
    expect(next.refresh).toBe("navigate");
  });

  it("never navigates another chat's page and gives other servers and sites their own page", () => {
    const createId = ids();
    const a = openAll(EMPTY_BROWSER, [mock], "chat-a", createId).workspace;
    const b = openAll(
      a,
      ["http://localhost:5173/mocks/pricing.html"],
      "chat-b",
      createId,
    );
    expect(b.results[0].tab.id).toBe("page-2");
    expect(b.workspace.tabs[0].url).toBe(mock);
    const others = openAll(
      b.workspace,
      [
        "http://localhost:5174/",
        "https://example.com/docs",
        "https://example.com/docs/api",
        `${mock}?v=2`,
      ],
      "chat-a",
      createId,
    );
    expect(
      others.results.map((result) => [result.tab.id, result.refresh]),
    ).toEqual([
      ["page-3", undefined],
      ["page-4", undefined],
      ["page-4", "navigate"],
      ["page-1", "navigate"],
    ]);
  });

  it("reuses the chat's own page through the router and reports the refresh", async () => {
    const router = createAgentBrowserRouter();
    const pages = [
      { id: "mine", url: mock, agentChat: "chat-a" },
      { id: "user", url: "http://localhost:5173/other.html" },
    ];
    const reuse = vi.fn(async (tab: { id: string }) => tab.id);
    const create = vi.fn(async () => "new");
    const adapter = { tabs: () => pages, reuse, create };
    await expect(
      router.open("/p", mock, { chat: "chat-a" }, adapter),
    ).resolves.toEqual({ id: "mine", refresh: "reload" });
    await expect(
      router.open("/p", `${mock}?v=2`, { chat: "chat-a" }, adapter),
    ).resolves.toEqual({ id: "mine", refresh: "navigate" });
    // Another chat's open of the user's address only shows it.
    await expect(
      router.open(
        "/p",
        "http://localhost:5173/other.html",
        { chat: "chat-b" },
        adapter,
      ),
    ).resolves.toEqual({ id: "user" });
    await expect(
      router.open("/p", `${mock}?v=3`, { chat: "chat-b" }, adapter),
    ).resolves.toEqual({ id: "new" });
    expect(create).toHaveBeenCalledOnce();
    // A new tab at the chat's own page's path reuses it; another path does not.
    await expect(
      router.open(
        "/p",
        `${mock}?v=4`,
        { chat: "chat-a", newTab: true },
        adapter,
      ),
    ).resolves.toEqual({ id: "mine", refresh: "navigate" });
    await expect(
      router.open(
        "/p",
        "http://localhost:5173/mocks/other.html",
        { chat: "chat-a", newTab: true },
        adapter,
      ),
    ).resolves.toEqual({ id: "new" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats loopback names as one site but not other ports, schemes or hosts", () => {
    expect(sameAgentSite(mock, "http://127.0.0.1:5173/a?b#c")).toBe(true);
    expect(sameAgentSite(mock, "http://[::1]:5173/")).toBe(true);
    for (const other of [
      "http://localhost:5174/mocks/index.html",
      "https://localhost:5173/mocks/index.html",
      "http://app.localhost:5173/mocks/index.html",
      "http://192.168.1.4:5173/mocks/index.html",
      "not a url",
    ])
      expect(sameAgentSite(mock, other)).toBe(false);
    expect(
      agentPageFor([{ id: "x", url: mock }], `${mock}?v=2`, "chat-a"),
    ).toBeUndefined();
  });

  it("remembers whose page it is across a restart, and forgets it once released", () => {
    const saved = normalizeBrowserWorkspace({
      open: true,
      tabs: [
        { id: "mine", url: mock, kept: true, agentChat: "chat-a" },
        { id: "bad", url: mock, agentChat: 42 },
        { id: "long", url: mock, agentChat: "x".repeat(201) },
      ],
    });
    expect(saved.tabs.map((tab) => tab.agentChat)).toEqual([
      "chat-a",
      undefined,
      undefined,
    ]);
    expect(releaseAgentBrowserTab(saved, "mine").tabs[0]).toEqual({
      id: "mine",
      url: mock,
      kept: true,
    });
  });
});
