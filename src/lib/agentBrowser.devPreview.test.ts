import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: mocks.listen }),
}));

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  mocks.invoke.mockReset().mockImplementation(async (name: string) =>
    name === "browser_agent_bind"
      ? {
          executablePath: "/Applications/Aven.app/Contents/MacOS/aven",
          socketPath: "/private/unused.sock",
        }
      : undefined,
  );
  mocks.listen.mockReset().mockResolvedValue(() => {});
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function prepare(cwd: string) {
  const api = await import("./agentBrowser");
  const previews = await import("./devPreviews");
  const { localDevAddress } = await import("./devServerUrls");
  dispose = api.installAgentBrowserHost({ surfaces: () => [], open: vi.fn() });
  return {
    previews,
    announce: () =>
      previews.reportDevServer({
        project: "/Users/me/site",
        cwd: "/Users/me/site",
        address: localDevAddress("http://localhost:5173/")!,
        source: "terminal",
        sourceId: "terminal:t1",
        placement: "terminal",
      }),
    prompt: () =>
      api.prepareAgentBrowserPrompt("Fix the header", {
        sessionId: "session-a",
        cwd,
      }),
  };
}

it("tells an agent with the browser which dev server is already running", async () => {
  const { announce, prompt } = await prepare("/Users/me/site");
  expect(await prompt()).not.toContain("<aven-preview>");
  announce();
  const text = await prompt();
  expect(text).toContain(
    "<aven-preview>This project's dev server is running at http://localhost:5173/ (started in an Aven terminal).",
  );
  expect(text.indexOf("</aven-browser>")).toBeLessThan(
    text.indexOf("<aven-preview>"),
  );
  expect(text.endsWith("Fix the header")).toBe(true);
});

it("leaves out stopped servers and other projects' servers", async () => {
  const other = await prepare("/Users/me/api");
  other.announce();
  expect(await other.prompt()).not.toContain("<aven-preview>");
  dispose?.();
  const site = await prepare("/Users/me/site");
  site.announce();
  site.previews.stopDevServers("terminal:t1");
  expect(await site.prompt()).not.toContain("<aven-preview>");
});
