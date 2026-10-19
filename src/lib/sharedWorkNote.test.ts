import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentPreviewSource,
  markDuplicateDevServer,
  observeAgentPreviewEvent,
  reportDevServer,
  resetDevPreviews,
  stopDevServers,
} from "./devPreviews";
import { localDevAddress } from "./devServerUrls";
import type { HarnessId, RuntimeMode } from "./session";
import {
  installSharedWorkSessions,
  observeSharedWorkEvent,
  resetSharedWork,
  sharedWorkTurnEnded,
  sharedWorkTurnStarted,
  type SharedWorkSession,
} from "./sharedWork";
import {
  buildSharedWorkNote,
  prepareSharedWorkTurn,
  resetSharedWorkDelivery,
  resetSharedWorkDeliveryState,
  RECENT_TURN_MS,
  SHARED_WORK_CLEARED,
  SHARED_WORK_NOTE_LIMIT,
  sharedWorkNoteFor,
} from "./sharedWorkNote";

const SITE = "/Users/me/site";
const HEAD =
  "<aven-shared-work>\nLive from Aven: other work in this project. A newer note replaces this one.";
const SERVER_GUIDANCE =
  "Reuse a running dev server rather than starting another: list the in-app browser pages, reuse one already showing it and reload after edits. If you need a different port or a restart, say so first. If it does not load, it may have stopped since.";
const FILE_GUIDANCE =
  "Avoid editing files another agent is editing right now; if you must, tell the user first.";

let chats: Record<string, SharedWorkSession>;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  resetDevPreviews();
  resetSharedWork();
  resetSharedWorkDeliveryState();
  chats = {};
  installSharedWorkSessions((id) => chats[id]);
});

afterEach(() => {
  resetDevPreviews();
  resetSharedWork();
  resetSharedWorkDeliveryState();
  vi.unstubAllGlobals();
});

function chat(
  id: string,
  harness: HarnessId,
  title: string,
  extra: Partial<SharedWorkSession> = {},
) {
  chats[id] = {
    harness,
    title,
    project: SITE,
    cwd: SITE,
    runtimeMode: "full-access",
    ...extra,
  };
}

function terminalServer(port: number) {
  reportDevServer({
    project: SITE,
    cwd: SITE,
    address: localDevAddress(`http://localhost:${port}/`)!,
    source: "terminal",
    sourceId: `terminal:t${port}`,
    placement: "terminal",
  });
}

function agentServer(
  sessionId: string,
  port: number,
  callId = `c${port}`,
  cwd = SITE,
) {
  const place = () => ({ project: SITE, cwd });
  observeAgentPreviewEvent(
    sessionId,
    { type: "tool.started", callId, title: "npm run dev", kind: "execute" },
    place,
  );
  observeAgentPreviewEvent(
    sessionId,
    {
      type: "tool.updated",
      callId,
      kind: "execute",
      status: "in_progress",
      detail: `  VITE v5.4.0  ready in 300 ms\n  ➜  Local:   http://localhost:${port}/\n`,
    },
    place,
  );
}

function working(sessionId: string, ...paths: string[]) {
  sharedWorkTurnStarted({
    sessionId,
    harness: chats[sessionId].harness,
    cwd: chats[sessionId].cwd,
  });
  for (const path of paths)
    observeSharedWorkEvent(sessionId, {
      type: "tool.started",
      callId: path,
      title: `Edit ${path}`,
      kind: "edit",
      paths: [path],
    });
}

function noteFor(
  sessionId: string,
  extra: { runtimeMode?: RuntimeMode; now?: number } = {},
) {
  return sharedWorkNoteFor(
    {
      sessionId,
      harness: chats[sessionId].harness,
      cwd: chats[sessionId].cwd,
      ...(extra.runtimeMode ? { runtimeMode: extra.runtimeMode } : {}),
    },
    extra.now,
  );
}

describe("buildSharedWorkNote", () => {
  it("is empty when nothing else runs", () => {
    expect(
      buildSharedWorkNote({ servers: [], agents: [], sandboxed: true }),
    ).toBe("");
  });

  it("names servers, agents, a duplicate and the sandbox plainly", () => {
    expect(
      buildSharedWorkNote({
        servers: [
          {
            url: "http://localhost:5173/",
            port: 5173,
            by: "started by Claude in “Fix login”",
            own: false,
          },
          {
            url: "http://localhost:5174/",
            port: 5174,
            folder: "web",
            by: "started by you",
            own: true,
          },
        ],
        agents: [
          {
            name: "Claude in “Fix login”",
            working: true,
            request: "make the form validate emails",
            files: ["src/App.tsx", "src/login.ts"],
          },
          {
            name: "Cursor in “Docs”",
            working: false,
            files: ["README.md"],
          },
        ],
        duplicate: {
          port: 5174,
          original: { port: 5173, by: "started by Claude in “Fix login”" },
        },
        sandboxed: true,
      }),
    ).toBe(
      [
        HEAD,
        "Dev servers running: http://localhost:5173/ (started by Claude in “Fix login”); http://localhost:5174/ in web (started by you).",
        "You started a second dev server on :5174 while :5173 (started by Claude in “Fix login”) was already running for the same app. Use :5173, and stop yours unless the user wants both.",
        "Your sandbox may not reach localhost:5173; ask the user before starting another server.",
        "Other agents here: Claude in “Fix login” is working on “make the form validate emails”, editing src/App.tsx, src/login.ts. Cursor in “Docs” finished recently; it edited README.md.",
        `${SERVER_GUIDANCE} ${FILE_GUIDANCE}`,
        "</aven-shared-work>",
      ].join("\n"),
    );
  });

  it("stays within the limit however much is going on", () => {
    const files = Array.from(
      { length: 30 },
      (_, index) => `packages/some-long-package-name/src/file-${index}.ts`,
    );
    const note = buildSharedWorkNote({
      servers: Array.from({ length: 6 }, (_, index) => ({
        url: `http://localhost:${5000 + index}/`,
        port: 5000 + index,
        folder: "apps/a-rather-long-folder-name",
        by: "started by Claude in “A very long chat title that goes on”",
        own: false,
      })),
      agents: Array.from({ length: 6 }, (_, index) => ({
        name: `Codex in “Chat number ${index} with a long title”`,
        working: index % 2 === 0,
        request: "x".repeat(59),
        files,
      })),
      sandboxed: true,
    });
    expect(note.length).toBeLessThanOrEqual(SHARED_WORK_NOTE_LIMIT);
    expect(note.startsWith(HEAD)).toBe(true);
    expect(note.endsWith("</aven-shared-work>")).toBe(true);
  });
});

describe("sharedWorkNoteFor", () => {
  it("names who started each server and what other chats edit", () => {
    chat("claude", "claude", "Fix login", { request: "Fix the login form" });
    chat("codex", "codex", "Tidy API");
    terminalServer(3000);
    agentServer("claude", 5173);
    working("claude", "src/App.tsx");
    expect(noteFor("codex")).toBe(
      [
        HEAD,
        "Dev servers running: http://localhost:5173/ (started by Claude in “Fix login”); http://localhost:3000/ (started in the user's terminal).",
        "Other agents here: Claude in “Fix login” is working on “Fix the login form”, editing src/App.tsx.",
        `${SERVER_GUIDANCE} ${FILE_GUIDANCE}`,
        "</aven-shared-work>",
      ].join("\n"),
    );
    expect(noteFor("claude")).toContain(
      "http://localhost:5173/ (started by you)",
    );
    expect(noteFor("claude")).not.toContain("Other agents here");
  });

  it("keeps a finished turn's edits for a while, then drops them", () => {
    chat("claude", "claude", "Fix login");
    chat("codex", "codex", "Tidy API");
    working("claude", "src/App.tsx");
    sharedWorkTurnEnded("claude", 1_000);
    expect(noteFor("codex", { now: 2_000 })).toContain(
      "Other agents here: Claude in “Fix login” finished recently; it edited src/App.tsx.",
    );
    expect(noteFor("codex", { now: 2_000 })).not.toContain(FILE_GUIDANCE);
    expect(noteFor("codex", { now: 1_000 + RECENT_TURN_MS + 1 })).toBe("");
  });

  it("ignores chats in other projects and other checkouts", () => {
    chat("codex", "codex", "Tidy API");
    chat("lane", "claude", "Lane", {
      project: "/Users/me/.worktrees/site/lane",
      cwd: "/Users/me/.worktrees/site/lane",
    });
    working("lane", "src/App.tsx");
    expect(noteFor("codex")).toBe("");
  });

  it("says plainly when Codex's sandbox may not reach the server", () => {
    chat("claude", "claude", "Fix login");
    chat("codex", "codex", "Tidy API", { runtimeMode: "supervised" });
    agentServer("claude", 5173);
    expect(noteFor("codex")).toContain(
      "Your sandbox may not reach localhost:5173; ask the user before starting another server.",
    );
    expect(noteFor("codex", { runtimeMode: "full-access" })).not.toContain(
      "sandbox",
    );
    chat("cursor", "cursor", "Docs", { runtimeMode: "supervised" });
    expect(noteFor("cursor")).not.toContain("sandbox");
  });

  it("tells the chat that started a second copy which server to use", () => {
    chat("claude", "claude", "Fix login");
    chat("codex", "codex", "Tidy API");
    agentServer("claude", 5173);
    agentServer("codex", 5174);
    expect(noteFor("codex")).toContain(
      "You started a second dev server on :5174 while :5173 (started by Claude in “Fix login”) was already running for the same app. Use :5173, and stop yours unless the user wants both.",
    );
    expect(noteFor("claude")).not.toContain("second dev server");
    const key = `${SITE}\n5174`;
    markDuplicateDevServer(key, "kept");
    expect(noteFor("codex")).not.toContain("second dev server");
  });
});

describe("race lanes", () => {
  const RACE =
    "/Users/me/Library/Application Support/com.capi.monocode.personal/races/050df34e-f720-4782-8f47-95a70f047dc9";
  const LANE_1 = `${RACE}/1`;
  const LANE_2 = `${RACE}/2`;

  beforeEach(() => {
    chat("main", "claude", "Fix login");
    chat("codex", "codex", "Tidy API");
    chat("lane1", "codex", "Reset button · Codex", { cwd: LANE_1 });
    chat("lane1b", "claude", "Follow-up", { cwd: LANE_1 });
    chat("lane2", "claude", "Reset button · Claude", { cwd: LANE_2 });
    terminalServer(3000);
    agentServer("main", 5173);
    agentServer("lane1", 5180, "l1", LANE_1);
    agentServer("lane2", 5181, "l2", LANE_2);
    working("main", "src/App.tsx");
    working("lane1b", "src/Button.tsx");
    working("lane2", "src/Reset.tsx");
  });

  it("tells a lane only about its own copy's servers and edits", () => {
    const note = noteFor("lane1");
    expect(note).toContain("http://localhost:5180/ (started by you)");
    expect(note).toContain(
      "Other agents here: Claude in “Follow-up” is working, editing src/Button.tsx.",
    );
    expect(note).not.toContain(":5173");
    expect(note).not.toContain(":3000");
    expect(note).not.toContain(":5181");
    expect(note).not.toContain("Fix login");
    expect(note).not.toContain("Reset.tsx");
    expect(noteFor("lane2")).toContain(
      "http://localhost:5181/ (started by you)",
    );
    expect(noteFor("lane2")).not.toContain("Other agents here");
  });

  it("leaves the lanes out of the main project's note", () => {
    const note = noteFor("codex");
    expect(note).toContain(
      "Dev servers running: http://localhost:3000/ (started in the user's terminal); http://localhost:5173/ (started by Claude in “Fix login”).",
    );
    expect(note).toContain(
      "Other agents here: Claude in “Fix login” is working, editing src/App.tsx.",
    );
    expect(note).not.toContain(":5180");
    expect(note).not.toContain(":5181");
    expect(note).not.toContain("Reset button");
    expect(note).not.toContain("Follow-up");
    expect(note).not.toContain("Application Support");
  });
});

describe("prepareSharedWorkTurn", () => {
  const send = (
    sessionId: string,
    text = "Carry on",
    harness: HarnessId = chats[sessionId].harness,
  ) =>
    prepareSharedWorkTurn({
      sessionId,
      harness,
      cwd: chats[sessionId].cwd,
      text,
    });

  it("sends the note only when it changed since this chat last had it", () => {
    chat("claude", "claude", "Fix login");
    chat("codex", "codex", "Tidy API");
    expect(send("codex").text).toBe("Carry on");
    terminalServer(5173);
    const first = send("codex");
    expect(first.text).toBe(`${noteFor("codex")}\n\nCarry on`);
    expect(first.text).toContain("http://localhost:5173/");
    expect(send("codex").text).toBe("Carry on");
    working("claude", "src/App.tsx");
    expect(send("codex").text).toBe(`${noteFor("codex")}\n\nCarry on`);
    expect(send("codex").text).toBe("Carry on");
  });

  it("says once that an earlier note no longer holds", () => {
    chat("codex", "codex", "Tidy API");
    terminalServer(5173);
    send("codex");
    stopDevServers("terminal:t5173");
    expect(send("codex").text).toBe(`${SHARED_WORK_CLEARED}\n\nCarry on`);
    expect(send("codex").text).toBe("Carry on");
  });

  it("leaves provider commands untouched", () => {
    chat("codex", "codex", "Tidy API");
    terminalServer(5173);
    expect(send("codex", "/compact").text).toBe("/compact");
    expect(send("codex").text).toContain("<aven-shared-work>");
  });

  it("gives it again after a provider switch, a reset or a failed send", () => {
    chat("chat", "claude", "Fix login");
    terminalServer(5173);
    expect(send("chat").text).toContain("<aven-shared-work>");
    expect(send("chat", "Next", "codex").text).toContain("<aven-shared-work>");
    expect(send("chat", "Next", "codex").text).toBe("Next");
    resetSharedWorkDelivery("chat");
    const failed = send("chat", "Next", "codex");
    expect(failed.text).toContain("<aven-shared-work>");
    failed.rollback();
    expect(send("chat", "Next", "codex").text).toContain("<aven-shared-work>");
  });

  it("does not undo a newer delivery on a late rollback", () => {
    chat("codex", "codex", "Tidy API");
    terminalServer(5173);
    const first = send("codex");
    terminalServer(5174);
    expect(send("codex").text).toContain("5174");
    first.rollback();
    expect(send("codex").text).toBe("Carry on");
  });

  it("drops a server from the note once it stops", () => {
    chat("claude", "claude", "Fix login");
    chat("codex", "codex", "Tidy API");
    agentServer("claude", 5173);
    expect(send("codex").text).toContain("5173");
    stopDevServers(agentPreviewSource("claude"));
    expect(send("codex").text).toBe(`${SHARED_WORK_CLEARED}\n\nCarry on`);
  });
});
