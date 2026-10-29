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
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
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
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await Promise.resolve();
});

describe("agent iPhone guidance", () => {
  it("is given, and the simulator scoped, only while the chat has an iPhone pane", async () => {
    const api = await import("./agentBrowser");
    let pane: string | null = "/project";
    dispose = api.installAgentBrowserHost({
      surfaces: () => [],
      simulatorProject: () => pane,
      open: vi.fn(),
    });
    const context = { sessionId: "session-a", cwd: "/project" };
    const withPane = await api.prepareAgentBrowserPrompt("Check it", context);
    expect(mocks.invoke).toHaveBeenLastCalledWith("browser_agent_bind", {
      sessionId: "session-a",
      simulatorProject: "/project",
      browserIds: [],
      anyTab: true,
      workDir: "/project",
    });
    expect(withPane).toContain("<aven-iphone>");
    expect(withPane).toContain(
      "'/Applications/Aven.app/Contents/MacOS/aven' --aven-simulator '{\"action\":\"list\"}'",
    );
    expect(withPane).toContain('{"action":"launch"}');
    expect(withPane).toContain("never use a real device");
    expect(withPane.indexOf("<aven-iphone>")).toBeLessThan(
      withPane.indexOf("Check it"),
    );

    pane = null;
    const without = await api.prepareAgentBrowserPrompt("Check it", context);
    expect(mocks.invoke).toHaveBeenLastCalledWith("browser_agent_bind", {
      sessionId: "session-a",
      browserIds: [],
      anyTab: true,
      workDir: "/project",
    });
    expect(without).not.toContain("aven-iphone");
    expect(without).not.toContain("--aven-simulator");
  });

  it("names the command and keeps credentials out of the guidance", async () => {
    const api = await import("./agentBrowser");
    const text = api.agentSimulatorInstructions("/Apps/It's Aven/aven");
    expect(text).toContain("'/Apps/It'\\''s Aven/aven' --aven-simulator");
    expect(text).not.toContain("TOKEN");
    expect(text).toContain("--aven-simulator --help");
  });
});
