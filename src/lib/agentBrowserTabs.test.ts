import { describe, expect, it, vi } from "vitest";
import {
  agentBrowserTabs,
  agentTabRecords,
  reachAgentTab,
  shownBrowserProjects,
} from "./agentBrowserTabs";
import { leaf } from "./layout";
import { browserIdForTab } from "./personalWorkspace";

const workspace = (
  tabs: { id: string; url: string; title?: string; agentChat?: string }[],
  open = true,
) => ({
  open,
  mode: "tab" as const,
  url: "",
  ratio: 0.4,
  expanded: false,
  tabs,
  activeTabId: tabs[0]?.id ?? null,
});

describe("an agent's list of open tabs", () => {
  const projects = {
    "/work/site": workspace([
      { id: "a", url: "http://localhost:5173/", title: "Site" },
      {
        id: "b",
        url: "https://www.notion.so/Launch-plan-1",
        title: "Launch plan",
        agentChat: "chat-2",
      },
    ]),
    "/work/notes": workspace([
      { id: "c", url: "https://mail.google.com/", title: "Inbox" },
      { id: "blank", url: "" },
    ]),
    "/app/projectless/default": workspace([
      { id: "d", url: "https://docs.example.com/", title: "Docs" },
    ]),
    "/work/closed": workspace(
      [{ id: "e", url: "https://hidden.example.com/" }],
      false,
    ),
  };
  const surface = (project: string, tab: string) =>
    browserIdForTab(project, tab);

  it("lists every project's open tabs, the projectless workspace and detached windows, and names other chats", () => {
    const tabs = agentBrowserTabs({
      workspaces: projects,
      detached: new Set([surface("/work/notes", "c")]),
      onScreen: new Set([surface("/work/site", "a")]),
      projectName: (project) =>
        project.startsWith("/app/projectless") ? "" : project.split("/").pop()!,
      chatName: (id) => (id === "chat-2" ? "Codex · Launch" : undefined),
    });
    expect(tabs).toEqual([
      {
        surfaceId: surface("/work/site", "a"),
        project: "/work/site",
        projectName: "site",
        title: "Site",
        url: "http://localhost:5173/",
        detached: false,
        onScreen: true,
      },
      {
        surfaceId: surface("/work/site", "b"),
        project: "/work/site",
        projectName: "site",
        title: "Launch plan",
        url: "https://www.notion.so/Launch-plan-1",
        agentChat: "chat-2",
        agentName: "Codex · Launch",
        detached: false,
        onScreen: false,
      },
      {
        surfaceId: surface("/work/notes", "c"),
        project: "/work/notes",
        projectName: "notes",
        title: "Inbox",
        url: "https://mail.google.com/",
        detached: true,
        onScreen: false,
      },
      {
        surfaceId: surface("/app/projectless/default", "d"),
        project: "/app/projectless/default",
        projectName: "",
        title: "Docs",
        url: "https://docs.example.com/",
        detached: false,
        onScreen: false,
      },
    ]);
  });

  it("marks which tabs have a live page and which are in the asking chat's scope", () => {
    const tabs = agentBrowserTabs({
      workspaces: projects,
      detached: new Set(),
      onScreen: new Set(),
      projectName: () => "p",
      chatName: () => undefined,
    });
    const live = surface("/work/site", "a");
    const records = agentTabRecords(
      tabs,
      (id) => (id === live ? "native-1" : undefined),
      new Set([live, surface("/work/site", "b")]),
    );
    expect(
      records.map(({ surfaceId, nativeId, asleep, scope }) => ({
        surfaceId,
        nativeId,
        asleep,
        scope,
      })),
    ).toEqual([
      { surfaceId: live, nativeId: "native-1", asleep: false, scope: true },
      {
        surfaceId: surface("/work/site", "b"),
        nativeId: undefined,
        asleep: true,
        scope: true,
      },
      {
        surfaceId: surface("/work/notes", "c"),
        nativeId: undefined,
        asleep: true,
        scope: false,
      },
      {
        surfaceId: surface("/app/projectless/default", "d"),
        nativeId: undefined,
        asleep: true,
        scope: false,
      },
    ]);
  });

  it("leaves out another window's projects unless this window has a page for the tab", () => {
    // This window shows the site (in front) and the notes chat's project;
    // the projectless workspace is open only in another window.
    const shown = shownBrowserProjects(
      "/work/site",
      [{ layout: leaf("chat-notes") }],
      [
        { id: "chat-notes", cwd: "/work/notes" },
        { id: "chat-elsewhere", cwd: "/app/projectless/default" },
      ],
    );
    expect([...shown].sort()).toEqual(["/work/notes", "/work/site"]);
    const tabs = agentBrowserTabs({
      workspaces: projects,
      detached: new Set(),
      onScreen: new Set(),
      projectName: () => "p",
      chatName: () => undefined,
      shown: (project) => shown.has(project),
    });
    const docs = surface("/app/projectless/default", "d");
    expect(tabs.find((tab) => tab.surfaceId === docs)?.elsewhere).toBe(true);
    const listed = (live?: string) =>
      agentTabRecords(
        tabs,
        (id) => (id === live ? "native-docs" : undefined),
        new Set(),
      ).map((tab) => tab.surfaceId);
    expect(listed()).not.toContain(docs);
    expect(listed()).toHaveLength(3);
    // A page this window holds is listed, with nothing extra sent.
    expect(listed(docs)).toContain(docs);
    expect(
      agentTabRecords(tabs, () => "native", new Set()).some(
        (tab) => "elsewhere" in tab,
      ),
    ).toBe(false);
  });
});

describe("loading a tab an agent reads", () => {
  const ways = (detached: boolean, registered = false) => ({
    registered: () => registered,
    detached: () => detached,
    loadDetached: vi.fn(async () => true),
    load: vi.fn(),
  });

  it("asks the detached window that holds the tab to load it there", async () => {
    const detached = ways(true);
    await reachAgentTab("browser-1", detached);
    expect(detached.loadDetached).toHaveBeenCalledWith("browser-1");
    expect(detached.load).not.toHaveBeenCalled();
    const here = ways(false);
    await reachAgentTab("browser-2", here);
    expect(here.load).toHaveBeenCalledWith("browser-2");
    expect(here.loadDetached).not.toHaveBeenCalled();
  });

  it("leaves a tab with a page alone and says when its window has gone", async () => {
    const live = ways(true, true);
    await reachAgentTab("browser-1", live);
    expect(live.loadDetached).not.toHaveBeenCalled();
    const gone = ways(true);
    gone.loadDetached.mockResolvedValue(false);
    await expect(reachAgentTab("browser-1", gone)).rejects.toThrow(
      "That tab's window has closed.",
    );
  });
});
