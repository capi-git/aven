// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBrowserTab } from "./agentBrowserTabs";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => Promise<void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: mocks.listen }),
}));

/** Node's own localStorage is not the page's; give the settings one. */
function stubLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
    },
    configurable: true,
  });
}

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  stubLocalStorage();
  mocks.handlers.clear();
  mocks.invoke.mockReset().mockImplementation(async (name: string) =>
    name === "browser_agent_bind"
      ? {
          executablePath: "/Applications/Aven.app/Contents/MacOS/aven",
          socketPath: "/private/unused.sock",
        }
      : undefined,
  );
  mocks.listen
    .mockReset()
    .mockImplementation(
      async (
        name: string,
        handler: (event: { payload: unknown }) => Promise<void>,
      ) => {
        mocks.handlers.set(name, handler);
        return () => mocks.handlers.delete(name);
      },
    );
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
});

const tab = (
  surfaceId: string,
  extra: Partial<AgentBrowserTab> = {},
): AgentBrowserTab => ({
  surfaceId,
  project: "/project",
  projectName: "project",
  title: surfaceId,
  url: `https://example.com/${surfaceId}`,
  detached: false,
  onScreen: false,
  ...extra,
});

function lastCall(command: string) {
  return mocks.invoke.mock.calls
    .filter(([name]) => name === command)
    .at(-1)?.[1] as Record<string, unknown> | undefined;
}

describe("tabs across Aven for agents", () => {
  it("answers a tab list with every tab of this window, which are awake, and the asking chat's scope", async () => {
    const api = await import("./agentBrowser");
    dispose = api.installAgentBrowserHost({
      surfaces: () => ["mine", "users"],
      open: vi.fn(),
      tabs: () => [
        tab("mine", { agentChat: "chat" }),
        tab("users", { onScreen: true }),
        tab("elsewhere", { project: "/notes", projectName: "notes" }),
      ],
    });
    api.registerAgentBrowserPage("mine", "native-mine");
    api.registerAgentBrowserPage("elsewhere", "native-elsewhere");
    await api.prepareAgentBrowserPrompt("Grab my Notion page", {
      sessionId: "chat",
      cwd: "/project",
    });
    // The chat's own page is named, so using any other shows the bar.
    expect(lastCall("browser_agent_bind")).toMatchObject({
      browserIds: ["native-mine"],
      ownBrowserIds: ["native-mine"],
      anyTab: true,
      workDir: "/project",
    });
    await mocks.handlers.get("browser-agent-tabs")!({
      payload: { requestId: "list", sessionId: "chat" },
    });
    expect(lastCall("browser_agent_tabs_result")).toEqual({
      requestId: "list",
      tabs: [
        {
          ...tab("mine", { agentChat: "chat" }),
          nativeId: "native-mine",
          asleep: false,
          scope: true,
        },
        { ...tab("users", { onScreen: true }), asleep: true, scope: true },
        {
          ...tab("elsewhere", { project: "/notes", projectName: "notes" }),
          nativeId: "native-elsewhere",
          asleep: false,
          scope: false,
        },
      ],
    });
    // A chat of another window has no scope here.
    await mocks.handlers.get("browser-agent-tabs")!({
      payload: { requestId: "other", sessionId: "unknown-chat" },
    });
    const other = lastCall("browser_agent_tabs_result") as {
      tabs: { scope: boolean }[];
    };
    expect(other.tabs.every((entry) => !entry.scope)).toBe(true);
  });

  it("loads a tab never shown, or wakes a sleeping one, out of sight for a read and names its page", async () => {
    const api = await import("./agentBrowser");
    const reach = vi.fn((surface: string) => {
      // The window mounts the page hidden; it registers shortly after.
      setTimeout(
        () => api.registerAgentBrowserPage(surface, `native-${surface}`),
        5,
      );
    });
    const wake = vi.fn();
    dispose = api.installAgentBrowserHost({
      surfaces: () => [],
      open: vi.fn(),
      tabs: () => [tab("never-shown"), tab("asleep")],
      reach,
    });
    api.registerAgentBrowserWake("asleep", wake);
    await mocks.handlers.get("browser-agent-reach")!({
      payload: { requestId: "r1", surfaceId: "never-shown" },
    });
    expect(reach).toHaveBeenCalledWith("never-shown");
    expect(lastCall("browser_agent_reach_result")).toEqual({
      requestId: "r1",
      browserId: "native-never-shown",
    });
    let protectedWhileWaking = false;
    wake.mockImplementation(() => {
      protectedWhileWaking = api.isAgentBrowserPageProtected("asleep");
    });
    await mocks.handlers.get("browser-agent-reach")!({
      payload: { requestId: "r2", surfaceId: "asleep" },
    });
    expect(wake).toHaveBeenCalled();
    expect(protectedWhileWaking).toBe(true);
    expect(api.isAgentBrowserPageProtected("asleep")).toBe(false);
    expect(lastCall("browser_agent_reach_result")).toEqual({
      requestId: "r2",
      browserId: "native-asleep",
    });
    await mocks.handlers.get("browser-agent-reach")!({
      payload: { requestId: "r3", surfaceId: "closed" },
    });
    expect(lastCall("browser_agent_reach_result")).toEqual({
      requestId: "r3",
      error: "That tab has closed.",
    });
  });

  it("follows Settings: off narrows every chat to its project at once, and says so", async () => {
    const api = await import("./agentBrowser");
    const { SETTINGS } = await import("./settingDefinitions");
    expect(SETTINGS.agentsReadAnyTab.load()).toBe(true);
    dispose = api.installAgentBrowserHost({
      surfaces: () => [],
      open: vi.fn(),
      tabs: () => [],
    });
    const on = await api.prepareAgentBrowserPrompt("Read it", {
      sessionId: "chat",
      cwd: "/project",
    });
    expect(on).toContain('{"action":"tabs"}');
    expect(on).toContain("every open tab in every project and window");
    expect(on).toContain('{"action":"export","id":"TAB_ID"');
    expect(on).toContain("never type passwords");
    expect(on).toContain(
      "so are tab titles and addresses, what read and export return, and the files export saves",
    );
    SETTINGS.agentsReadAnyTab.save(false);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(lastCall("browser_agent_bind")).toMatchObject({
      sessionId: "chat",
      anyTab: false,
    });
    const off = await api.prepareAgentBrowserPrompt("Read it", {
      sessionId: "chat",
      cwd: "/project",
    });
    expect(off).toContain("turned off");
    expect(off).toContain("lists only this project's tabs");
    expect(off).not.toContain("every open tab in every project");
    expect(localStorage.getItem("aven.agentsReadAnyTab")).toBe("0");
  });
});
