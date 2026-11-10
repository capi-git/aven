// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessAdapter } from "./harness/registry";
import type { SendTurnInput, SteerTurnInput } from "./harness/types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: native.listen }),
}));

const EXECUTABLE = "/Applications/Aven.app/Contents/MacOS/aven";
const FULL_BROWSER = "<aven-browser>\nYou are working inside Aven.";
const REMINDER =
  "The Aven browser and desktop guidance given earlier in this conversation still applies";
const FILES = "<aven-files>When you make a file";
const CONTEXT = { sessionId: "chat", cwd: "/project", harness: "claude" };

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

let bindFails = false;
let simulator: string | null = null;
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  stubLocalStorage();
  bindFails = false;
  simulator = null;
  native.listen.mockReset().mockResolvedValue(() => {});
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "browser_agent_bind") {
      if (bindFails) throw new Error("no connection");
      return { executablePath: EXECUTABLE, socketPath: "/private/test.sock" };
    }
    if (command === "agent_files_folder") return "/project/.aven-files";
    return undefined;
  });
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
});

/** Aven's browser, the registry and a Claude adapter that records its text. */
async function setup(
  turn: (input: SendTurnInput) => Promise<void> | void = () => {},
) {
  const browser = await import("./agentBrowser");
  const registry = await import("./harness/registry");
  const { harnessDescriptor } = await import("./harness/descriptors");
  dispose = browser.installAgentBrowserHost({
    surfaces: () => [],
    simulatorProject: () => simulator,
    open: vi.fn(),
  });
  const sent: string[] = [];
  const adapter: HarnessAdapter = {
    id: "claude",
    descriptor: harnessDescriptor("claude"),
    live: true,
    async sendTurn(input) {
      sent.push(input.text);
      input.onEvent({
        type: "session.providerBound",
        providerSessionId: "conversation-1",
      });
      await turn(input);
    },
    async steerTurn(input: SteerTurnInput) {
      sent.push(input.text);
    },
    async compactContext() {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
  };
  registry.registerHarness(adapter);
  const prompt = (text: string) =>
    browser.prepareAgentBrowserPrompt(text, CONTEXT, { typed: true });
  const send = async (text: string) => {
    await registry.sendHarnessTurn({
      harness: "claude",
      sessionId: CONTEXT.sessionId,
      cwd: CONTEXT.cwd,
      model: "",
      runtimeMode: "supervised",
      text: await prompt(text),
      onEvent: () => {},
    });
    return sent[sent.length - 1];
  };
  const steer = async (text: string) => {
    await registry.steerHarnessTurn({
      harness: "claude",
      sessionId: CONTEXT.sessionId,
      cwd: CONTEXT.cwd,
      model: "",
      text: await prompt(text),
    });
    return sent[sent.length - 1];
  };
  return { browser, registry, send, steer, sent };
}

describe("standing guidance per conversation", () => {
  it("gives the guidance in full once, then a short reminder to turns and steers", async () => {
    const { send, steer } = await setup();
    const first = await send("Fix the header");
    expect(first).toContain(FULL_BROWSER);
    expect(first).toContain(`'${EXECUTABLE}' --aven-desktop`);
    expect(first).toContain(FILES);
    const second = await send("And the footer");
    expect(second).not.toContain(FULL_BROWSER);
    expect(second).not.toContain(FILES);
    expect(second).toContain(REMINDER);
    expect(second).toContain(`executable: '${EXECUTABLE}'`);
    expect(second).toContain("<aven-files>Save files made for the user in");
    expect(second.length).toBeLessThan(first.length / 10);
    expect(await steer("Also the logo")).toContain(REMINDER);
  });

  it("gives the iPhone guidance in full when the pane appears, and a Git change", async () => {
    const { send } = await setup();
    await send("One");
    simulator = "/project";
    const { saveGitFinishBehavior } = await import("./gitPreference");
    saveGitFinishBehavior("pr");
    const next = await send("Two");
    expect(next).toContain("<aven-iphone>\nThis chat has Aven's iPhone pane");
    expect(next).toContain("open a pull request");
    expect(next).toContain(REMINDER);
    const third = await send("Three");
    expect(third).toContain("the iPhone guidance given earlier");
    expect(third).toContain("The Git preference given earlier");
  });

  it("gives it again after compaction, by Aven or by the provider itself", async () => {
    let compactNow = false;
    const { send, registry } = await setup((input) => {
      if (compactNow)
        input.onEvent({
          type: "status",
          text: "Compacted context",
          compacted: true,
        });
    });
    await send("One");
    await registry.compactHarnessContext({
      harness: "claude",
      sessionId: CONTEXT.sessionId,
      cwd: CONTEXT.cwd,
      model: "",
    } as never);
    expect(await send("Two")).toContain(FULL_BROWSER);
    compactNow = true;
    expect(await send("Three")).toContain(REMINDER);
    compactNow = false;
    expect(await send("Four")).toContain(FULL_BROWSER);
  });

  it("gives it again to a new provider conversation or a forgotten chat", async () => {
    let id = "conversation-1";
    const { send, registry } = await setup((input) => {
      input.onEvent({ type: "session.providerBound", providerSessionId: id });
    });
    await send("One");
    expect(await send("Two")).toContain(REMINDER);
    id = "conversation-2";
    await send("Three");
    expect(await send("Four")).toContain(FULL_BROWSER);
    await registry.forgetHarnessSession("claude", CONTEXT.sessionId);
    expect(await send("Five")).toContain(FULL_BROWSER);
  });

  it("gives it again after the turn that carried it was stopped", async () => {
    let stop = true;
    const { send, registry } = await setup(async () => {
      if (stop) await registry.cancelHarnessTurn("claude", CONTEXT.sessionId);
    });
    expect(await send("One")).toContain(FULL_BROWSER);
    stop = false;
    expect(await send("Two")).toContain(FULL_BROWSER);
    expect(await send("Three")).toContain(REMINDER);
  });

  it("says unavailability each turn and gives the full guidance once it is back", async () => {
    const { send } = await setup();
    await send("One");
    bindFails = true;
    expect(await send("Two")).toContain(
      "In-app browser controls are unavailable for this turn",
    );
    expect(await send("Three")).toContain(
      "In-app browser controls are unavailable for this turn",
    );
    bindFails = false;
    expect(await send("Four")).toContain(FULL_BROWSER);
  });
});
