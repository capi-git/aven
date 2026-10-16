import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  agentPreviewSource,
  observeAgentPreviewEvent,
  resetDevPreviews,
  stopDevServers,
} from "./devPreviews";
import {
  installSharedWorkSessions,
  observeSharedWorkEvent,
  resetSharedWork,
  sharedWorkTurnEnded,
  sharedWorkTurnStarted,
} from "./sharedWork";
import { subscribeWorkConflicts, workConflictsSnapshot } from "./workConflicts";

const SITE = "/Users/me/site";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetDevPreviews();
  resetSharedWork();
  installSharedWorkSessions((id) => ({
    harness: id === "codex" ? "codex" : "claude",
    title: id,
    project: SITE,
    cwd: SITE,
    runtimeMode: "full-access",
  }));
});

afterEach(() => {
  resetDevPreviews();
  resetSharedWork();
  vi.unstubAllGlobals();
});

function server(sessionId: string, port: number) {
  const place = () => ({ project: SITE, cwd: SITE });
  observeAgentPreviewEvent(
    sessionId,
    {
      type: "tool.updated",
      callId: `c${port}`,
      kind: "execute",
      status: "in_progress",
      detail: `VITE v5.4.0 ready\n  ➜  Local:   http://localhost:${port}/\n`,
    },
    place,
  );
}

function edit(sessionId: string, path: string) {
  observeSharedWorkEvent(sessionId, {
    type: "tool.started",
    callId: `${sessionId}${path}`,
    title: `Edit ${path}`,
    kind: "edit",
    paths: [path],
  });
}

it("marks both chats editing one file and the chat with a second server", () => {
  const listener = vi.fn();
  subscribeWorkConflicts(listener);
  expect(workConflictsSnapshot()).toEqual({});
  sharedWorkTurnStarted({ sessionId: "claude", harness: "claude", cwd: SITE });
  sharedWorkTurnStarted({ sessionId: "codex", harness: "codex", cwd: SITE });
  edit("claude", "src/App.tsx");
  edit("codex", "src/App.tsx");
  server("claude", 5173);
  server("codex", 5174);
  expect(workConflictsSnapshot()).toEqual({
    claude: { kind: "files", label: "Codex is also editing src/App.tsx" },
    codex: {
      kind: "files",
      label:
        "Claude is also editing src/App.tsx. Codex started a second dev server on :5174 while :5173 is running",
    },
  });
  expect(listener).toHaveBeenCalled();

  const before = workConflictsSnapshot();
  edit("claude", "src/other.ts");
  expect(workConflictsSnapshot()).toBe(before);

  sharedWorkTurnEnded("claude");
  expect(workConflictsSnapshot()).toEqual({
    codex: {
      kind: "server",
      label:
        "Codex started a second dev server on :5174 while :5173 is running",
    },
  });
  stopDevServers(agentPreviewSource("codex"));
  expect(workConflictsSnapshot()).toEqual({});
});
