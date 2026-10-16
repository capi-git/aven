// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({ writePty: vi.fn(async () => {}) }));
vi.mock("../lib/pty", () => ({ writePty: pty.writePty }));

import {
  agentPreviewSource,
  observeAgentPreviewEvent,
  resetDevPreviews,
  stopDevServers,
  watchTerminalOutput,
} from "../lib/devPreviews";
import {
  installDuplicateServerMessenger,
  resetDuplicateServerMessenger,
} from "../lib/devServerDuplicates";
import { installSharedWorkSessions, resetSharedWork } from "../lib/sharedWork";
import { DuplicateServerChip } from "./DuplicateServerChip";

const SITE = "/Users/me/site";
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetDevPreviews();
  resetSharedWork();
  resetDuplicateServerMessenger();
  installSharedWorkSessions((id) => ({
    harness: id === "codex" ? "codex" : "claude",
    title: id === "codex" ? "Tidy API" : "Fix login",
    project: SITE,
    cwd: SITE,
    runtimeMode: "full-access",
  }));
  pty.writePty.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetDevPreviews();
  resetSharedWork();
  resetDuplicateServerMessenger();
  vi.unstubAllGlobals();
});

const vite = (port: number) =>
  `  VITE v5.4.0  ready in 300 ms\n  ➜  Local:   http://localhost:${port}/\n`;

function agent(sessionId: string, port: number) {
  observeAgentPreviewEvent(
    sessionId,
    {
      type: "tool.updated",
      callId: `c${port}`,
      kind: "execute",
      status: "in_progress",
      detail: vite(port),
    },
    () => ({ project: SITE, cwd: SITE }),
  );
}

function chip() {
  return host.querySelector<HTMLElement>(".duplicate-server-chip");
}

function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
}

it("shows in the chat that started the copy and asks its agent to stop it", async () => {
  const send = vi.fn(() => undefined);
  installDuplicateServerMessenger(send);
  await act(async () =>
    root.render(
      createElement(DuplicateServerChip, {
        placement: "chat",
        sessionId: "codex",
      }),
    ),
  );
  expect(chip()).toBeNull();
  await act(async () => {
    agent("claude", 5173);
    agent("codex", 5174);
  });
  expect(chip()?.textContent).toBe(
    "Codex started a second dev server on :5174 while :5173 is runningAsk Codex to stop itKeep both",
  );
  expect(button("Ask Codex to stop it")?.title).toContain(
    "Aven can't stop a server an agent started",
  );
  await act(async () => button("Ask Codex to stop it")!.click());
  expect(send).toHaveBeenCalledWith(
    "codex",
    expect.stringContaining(
      "Please stop the dev server you started on port 5174.",
    ),
  );
  expect(chip()?.textContent).toBe("Asked Codex to stop the server on :5174");
  expect(chip()?.dataset.state).toBe("handled");
  await act(async () => stopDevServers(agentPreviewSource("codex")));
  expect(chip()).toBeNull();
});

it("never shows in the chat whose server came first", async () => {
  await act(async () =>
    root.render(
      createElement(DuplicateServerChip, {
        placement: "chat",
        sessionId: "claude",
      }),
    ),
  );
  await act(async () => {
    agent("claude", 5173);
    agent("codex", 5174);
  });
  expect(chip()).toBeNull();
});

it("stops a terminal's copy with Ctrl+C, or keeps both", async () => {
  await act(async () =>
    root.render(
      createElement(DuplicateServerChip, {
        placement: "terminal",
        project: SITE,
      }),
    ),
  );
  const watch = watchTerminalOutput({
    id: "term-1",
    project: SITE,
    cwd: SITE,
    placement: "terminal",
  });
  await act(async () => {
    agent("claude", 5173);
    watch.push(vite(5174));
  });
  expect(chip()?.dataset.placement).toBe("terminal");
  expect(chip()?.textContent).toBe(
    "Second dev server on :5174 while :5173 is runningStop the new oneKeep both",
  );
  await act(async () => button("Stop the new one")!.click());
  expect(pty.writePty).toHaveBeenCalledWith("term-1", "\x03");
  expect(chip()?.textContent).toBe("Stopping the server on :5174…");
  await act(async () => watch.push("^C\n"));
  expect(chip()).toBeNull();

  await act(async () => watch.push(vite(5175)));
  expect(chip()).not.toBeNull();
  await act(async () => button("Keep both")!.click());
  expect(chip()).toBeNull();
});
