// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __chatConnectionsTestReset,
  installChatConnectionsOpener,
  noteClaudeInit,
} from "../lib/chatConnections";
import { installSessionPermissions } from "../lib/harness/sessionPermissions";
import { ChatConnectionsBar } from "./ChatConnectionsBar";

const reconnect = vi.hoisted(() => vi.fn());

vi.mock("../lib/harness/registry", () => ({
  reconnectHarnessSession: reconnect,
}));

const init = (status: string) => ({
  type: "system",
  subtype: "init",
  mcp_servers: [{ name: "notion", status, source: "dynamic" }],
});

let container: HTMLElement;
let root: Root;
let values: Map<string, string>;

async function show(harness: "claude" | "codex" = "claude") {
  await act(async () => {
    root.render(
      createElement(ChatConnectionsBar, {
        sessionId: "c",
        harness,
        folder: "/repo",
      }),
    );
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === text ||
      candidate.getAttribute("aria-label") === text,
  );
  if (!found) throw new Error(`No ${text} button`);
  return found;
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  __chatConnectionsTestReset();
  reconnect.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the line above the message box", () => {
  it("shows nothing when all is well", async () => {
    noteClaudeInit("c", init("connected"));
    await show();
    expect(container.textContent).toBe("");
  });

  it("appears when a report arrives, without its parent rendering", async () => {
    await show();
    await act(async () => noteClaudeInit("c", init("needs-auth")));
    expect(container.textContent).toContain("notion isn't signed in");
  });

  it("shows nothing for another provider's report", async () => {
    noteClaudeInit("c", init("needs-auth"));
    await show("codex");
    expect(container.textContent).toBe("");
  });

  it("shows nothing in a chat with no connections on purpose", async () => {
    noteClaudeInit("c", init("needs-auth"));
    const uninstall = installSessionPermissions(() => ({
      mode: "auto",
      rules: {},
      noMcp: true,
    }));
    await show();
    expect(container.textContent).toBe("");
    uninstall();
  });

  it("Sign in opens the connections page", async () => {
    const open = vi.fn();
    const uninstall = installChatConnectionsOpener(open);
    noteClaudeInit("c", init("needs-auth"));
    await show();
    await act(async () => button("Sign in").click());
    expect(open).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("can be dismissed", async () => {
    noteClaudeInit("c", init("needs-auth"));
    await show();
    await act(async () => button("Dismiss").click());
    expect(container.textContent).toBe("");
  });

  it("Reconnect restarts the provider and the line goes", async () => {
    values.set("aven.chatConnections.dismissed", "{}");
    noteClaudeInit("c", init("needs-auth"));
    const { listClaudeConnections } =
      await import("../lib/harness/providerConnections");
    vi.mocked(listClaudeConnections).mockRejectedValue(new Error("no"));
    const uninstall = installChatConnectionsOpener(() => undefined);
    await show();
    await act(async () => button("Sign in").click());
    const { checkChatConnectionsAfterSettings } =
      await import("../lib/chatConnections");
    await act(async () => {
      await checkChatConnectionsAfterSettings();
    });
    await act(async () => button("Reconnect").click());
    expect(reconnect).toHaveBeenCalledWith("claude", "c");
    expect(container.textContent).toBe("");
    uninstall();
  });
});

vi.mock("../lib/harness/providerConnections", async (original) => ({
  ...(await original<typeof import("../lib/harness/providerConnections")>()),
  listClaudeConnections: vi.fn(),
}));
