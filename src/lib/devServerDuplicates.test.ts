import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({ writePty: vi.fn(async () => {}) }));
vi.mock("./pty", () => ({ writePty: pty.writePty }));

import {
  devPreviewsSnapshot,
  duplicateDevServers,
  observeAgentPreviewEvent,
  resetDevPreviews,
  watchTerminalOutput,
} from "./devPreviews";
import {
  duplicateSummary,
  duplicatesFor,
  installDuplicateServerMessenger,
  keepDuplicateServer,
  resetDuplicateServerMessenger,
  stopDuplicateServer,
  stopRequestText,
} from "./devServerDuplicates";
import {
  installSharedWorkSessions,
  resetSharedWork,
  type SharedWorkSession,
} from "./sharedWork";

const SITE = "/Users/me/site";
const vite = (port: number) =>
  `  VITE v5.4.0  ready in 300 ms\n  ➜  Local:   http://localhost:${port}/\n`;

const chats: Record<string, SharedWorkSession> = {
  claude: {
    harness: "claude",
    title: "Fix login",
    project: SITE,
    cwd: SITE,
    runtimeMode: "full-access",
  },
  codex: {
    harness: "codex",
    title: "Tidy API",
    project: SITE,
    cwd: SITE,
    runtimeMode: "supervised",
  },
};

function agent(sessionId: string, port: number) {
  const place = () => ({ project: SITE, cwd: SITE });
  observeAgentPreviewEvent(
    sessionId,
    { type: "tool.started", callId: `c${port}`, title: "npm run dev" },
    place,
  );
  observeAgentPreviewEvent(
    sessionId,
    {
      type: "tool.updated",
      callId: `c${port}`,
      kind: "execute",
      status: "in_progress",
      detail: vite(port),
    },
    place,
  );
}

function terminal(id: string, port: number) {
  watchTerminalOutput({
    id,
    project: SITE,
    cwd: SITE,
    placement: "terminal",
  }).push(vite(port));
}

const only = () => {
  const list = duplicateDevServers(devPreviewsSnapshot());
  expect(list).toHaveLength(1);
  return list[0];
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetDevPreviews();
  resetSharedWork();
  resetDuplicateServerMessenger();
  installSharedWorkSessions((id) => chats[id]);
  pty.writePty.mockClear();
});

afterEach(() => {
  resetDevPreviews();
  resetSharedWork();
  resetDuplicateServerMessenger();
  vi.unstubAllGlobals();
});

describe("a second copy an agent started", () => {
  it("is described and shown only in that agent's chat", () => {
    agent("claude", 5173);
    agent("codex", 5174);
    expect(duplicateSummary(only())).toBe(
      "Codex started a second dev server on :5174 while :5173 is running",
    );
    const list = devPreviewsSnapshot();
    expect(
      duplicatesFor(list, { placement: "chat", sessionId: "codex" }),
    ).toHaveLength(1);
    expect(
      duplicatesFor(list, { placement: "chat", sessionId: "claude" }),
    ).toEqual([]);
    expect(
      duplicatesFor(list, { placement: "terminal", project: SITE }),
    ).toEqual([]);
  });

  it("asks the agent to stop it, because Aven cannot", async () => {
    const send = vi.fn(() => undefined);
    installDuplicateServerMessenger(send);
    agent("claude", 5173);
    agent("codex", 5174);
    expect(stopRequestText(only())).toBe(
      "Please stop the dev server you started on port 5174. The same app is already running at http://localhost:5173/ (started by Claude in “Fix login”); use that one instead of starting another.",
    );
    expect(await stopDuplicateServer(only().preview.key)).toBe(true);
    expect(send).toHaveBeenCalledWith("codex", stopRequestText(only()));
    expect(pty.writePty).not.toHaveBeenCalled();
    expect(only().preview.duplicateHandled).toBe("asked");
  });

  it("reports failure when the chat refuses the message", async () => {
    installDuplicateServerMessenger(() => false);
    agent("claude", 5173);
    agent("codex", 5174);
    expect(await stopDuplicateServer(only().preview.key)).toBe(false);
    expect(only().preview.duplicateHandled).toBeUndefined();
  });

  it("goes once both are kept", () => {
    agent("claude", 5173);
    agent("codex", 5174);
    keepDuplicateServer(only().preview.key);
    expect(duplicateDevServers(devPreviewsSnapshot())).toEqual([]);
  });
});

describe("a second copy a terminal started", () => {
  it("is stopped with Ctrl+C in that terminal", async () => {
    agent("claude", 5173);
    terminal("term-1", 5174);
    const duplicate = only();
    expect(duplicateSummary(duplicate)).toBe(
      "Your terminal started a second dev server on :5174 while :5173 is running",
    );
    expect(
      duplicatesFor(devPreviewsSnapshot(), {
        placement: "terminal",
        project: SITE,
      }),
    ).toHaveLength(1);
    expect(await stopDuplicateServer(duplicate.preview.key)).toBe(true);
    expect(pty.writePty).toHaveBeenCalledWith("term-1", "\x03");
    expect(only().preview.duplicateHandled).toBe("stopping");
  });

  it("undoes the stopping state when the terminal is gone", async () => {
    pty.writePty.mockRejectedValueOnce(new Error("Terminal is not running"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    agent("claude", 5173);
    terminal("term-1", 5174);
    expect(await stopDuplicateServer(only().preview.key)).toBe(false);
    expect(only().preview.duplicateHandled).toBeUndefined();
  });
});
