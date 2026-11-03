import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: mocks.listen }),
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PROJECT = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  mocks.invoke
    .mockReset()
    .mockImplementation(async (name: string) =>
      name === "browser_agent_bind"
        ? { executablePath: "/Applications/Aven.app/aven", socketPath: "/s" }
        : undefined,
    );
  mocks.listen.mockReset().mockImplementation(async () => () => {});
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  await Promise.resolve();
});

/** The bind call's `web` for a chat, after one prompt for it. */
async function boundWeb(sessionId: string, cwd: string) {
  const api = await import("./agentBrowser");
  dispose = api.installAgentBrowserHost({
    surfaces: () => ["page"],
    open: vi.fn(),
  });
  api.registerAgentBrowserPage("page", "native-page");
  await api.prepareAgentBrowserPrompt("Read", { sessionId, cwd });
  const call = mocks.invoke.mock.calls.findLast(
    ([name]) => name === "browser_agent_bind",
  )!;
  return (call[1] as { web?: boolean }).web;
}

describe("which chats bind with the web", () => {
  it("binds a Researcher's chat with web: true while Access allows it, a Scout's without, and a chat of your own unchanged", async () => {
    const { resetCrewsCache, updateCrew } = await import("./crews");
    const { setCrewAccess } = await import("./crewActions");
    resetCrewsCache();
    updateCrew(PROJECT, (crew) => ({
      ...crew,
      on: true,
      onAt: 1,
      copy: { path: COPY, branch: "aven/bot/crew-1", root: PROJECT },
      members: [
        { id: "builder", role: "builder", sessionId: "b-chat" },
        { id: "researcher", role: "researcher", sessionId: "r-chat" },
        { id: "scout", role: "scout", sessionId: "s-chat" },
      ],
    }));
    setCrewAccess(PROJECT, { web: "builders" });
    expect(await boundWeb("r-chat", COPY)).toBe(true);
    dispose?.();
    expect(await boundWeb("s-chat", COPY)).toBe(false);
    dispose?.();
    // Turned off in the Team sheet: the next bind carries it.
    setCrewAccess(PROJECT, { web: "none" });
    expect(await boundWeb("r-chat", COPY)).toBe(false);
    dispose?.();
    // A chat of your own: never a grant of its own (the host leaves it as it is).
    expect(await boundWeb("my-chat", PROJECT)).toBe(false);
  });
});
