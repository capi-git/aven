// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_KEEP_AWAKE_HEARTBEAT_MS,
  type AgentKeepAwakeProgress,
  agentKeepAwakeProgress,
  agentKeepAwakeSessionIds,
  agentKeepAwakeSessions,
  loadAgentKeepAwake,
  saveAgentKeepAwake,
} from "../lib/agentKeepAwake";
import type { Session } from "../lib/session";
import { useAgentKeepAwake } from "./useAgentKeepAwake";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

describe("keeping the Mac awake while agents work", () => {
  let root: Root;
  let container: HTMLDivElement;
  const report = vi.fn();

  function Harness({
    busy,
    progress,
  }: {
    busy: ReadonlySet<string>;
    progress: AgentKeepAwakeProgress;
  }) {
    useAgentKeepAwake(busy, progress, report);
    return null;
  }
  // Every chat gets the same fingerprint unless a test says otherwise.
  const render = (
    busy: string[],
    progress: string | AgentKeepAwakeProgress = "p1",
  ) =>
    act(() =>
      root.render(
        createElement(Harness, {
          busy: new Set(busy),
          progress:
            typeof progress === "string"
              ? Object.fromEntries(busy.map((id) => [id, progress]))
              : progress,
        }),
      ),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage();
    report.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("is on by default and remembers being turned off", () => {
    expect(loadAgentKeepAwake()).toBe(true);
    saveAgentKeepAwake(false);
    expect(loadAgentKeepAwake()).toBe(false);
    saveAgentKeepAwake(true);
    expect(loadAgentKeepAwake()).toBe(true);
  });

  it("reports working chats, releases when idle, and refreshes long turns", () => {
    render([]);
    expect(report).toHaveBeenLastCalledWith(true, [], {});
    render(["b", "a"]);
    expect(report).toHaveBeenLastCalledWith(true, ["a", "b"], {
      a: "p1",
      b: "p1",
    });
    const calls = report.mock.calls.length;
    // Same set in another order: no extra report.
    render(["a", "b"]);
    expect(report.mock.calls.length).toBe(calls);
    act(() => vi.advanceTimersByTime(AGENT_KEEP_AWAKE_HEARTBEAT_MS));
    expect(report).toHaveBeenLastCalledWith(true, ["a", "b"], {
      a: "p1",
      b: "p1",
    });
    expect(report.mock.calls.length).toBe(calls + 1);
    render([]);
    expect(report).toHaveBeenLastCalledWith(true, [], {});
    // Idle: no heartbeat.
    const idle = report.mock.calls.length;
    act(() => vi.advanceTimersByTime(AGENT_KEEP_AWAKE_HEARTBEAT_MS * 3));
    expect(report.mock.calls.length).toBe(idle);
  });

  it("follows the setting and releases on unmount", () => {
    render(["a"]);
    act(() => saveAgentKeepAwake(false));
    expect(report).toHaveBeenLastCalledWith(false, ["a"], { a: "p1" });
    act(() => saveAgentKeepAwake(true));
    expect(report).toHaveBeenLastCalledWith(true, ["a"], { a: "p1" });
    act(() => root.unmount());
    expect(report).toHaveBeenLastCalledWith(true, [], {});
    root = createRoot(container);
  });

  it("refreshes with the latest progress without reporting every change", () => {
    render(["a"], "p1");
    const calls = report.mock.calls.length;
    render(["a"], "p2");
    render(["a"], "p3");
    expect(report.mock.calls.length).toBe(calls);
    act(() => vi.advanceTimersByTime(AGENT_KEEP_AWAKE_HEARTBEAT_MS));
    expect(report).toHaveBeenLastCalledWith(true, ["a"], { a: "p3" });
  });

  it("reports each chat's own progress, and only for reported chats", () => {
    render(["a", "bad id"], { a: "f1", "bad id": "f2", gone: "f3" });
    expect(report).toHaveBeenLastCalledWith(true, ["a"], { a: "f1" });
  });

  it("sends only identifiers the host accepts", () => {
    expect(
      agentKeepAwakeSessions(["ok-1", "bad id", "", "x".repeat(81), "ok-1"]),
    ).toEqual(["ok-1"]);
  });
});

describe("which chats keep the Mac awake", () => {
  const session = (id: string, patch: Partial<Session> = {}): Session =>
    ({
      id,
      harness: "codex",
      model: "m",
      modelSettings: {},
      runtimeMode: "default",
      title: id,
      cwd: "/tmp",
      blocks: [],
      ...patch,
    }) as Session;
  const approval = {
    id: "approval",
    role: "approval",
    text: "Allow?",
    approval: { requestId: 1 },
  } as Session["blocks"][number];
  const ids = (sessions: Session[]) => [...agentKeepAwakeSessionIds(sessions)];

  it("counts running turns and sub-agents, but not chats waiting for the user", () => {
    expect(
      ids([
        session("turn", { busy: true }),
        session("agents", {
          liveAgents: [{ id: "w", title: "w", status: "running" }],
        }),
        session("idle"),
        session("done", {
          liveAgents: [{ id: "w", title: "w", status: "completed" }],
        }),
        session("approval", { busy: true, blocks: [approval] }),
        session("question", {
          busy: true,
          pendingQuestion: {} as Session["pendingQuestion"],
        }),
      ]).sort(),
    ).toEqual(["agents", "turn"]);
  });

  it("keeps an orchestration lead awake while its worker runs", () => {
    expect(
      ids([session("worker", { busy: true, orchestrationLeadId: "lead" })]),
    ).toEqual(["worker", "lead"]);
  });

  it("keeps working through an optional question but releases blocking input", () => {
    expect(
      ids([
        session("optional", {
          busy: true,
          pendingQuestion: { requestId: 1, questions: [], blocking: false },
        }),
        session("blocking", {
          harness: "claude",
          busy: true,
          pendingQuestion: { requestId: 2, questions: [] },
        }),
        session("approval", {
          busy: true,
          pendingQuestion: { requestId: 3, questions: [], blocking: false },
          blocks: [approval],
        }),
      ]),
    ).toEqual(["optional"]);
  });

  it("fingerprints each working chat's progress separately", () => {
    const text = (value: string) =>
      [{ id: "b", role: "assistant", text: value }] as Session["blocks"];
    const of = (sessions: Session[], ids = ["a"]) =>
      agentKeepAwakeProgress(sessions, new Set(ids));
    const working = session("a", { busy: true, blocks: text("Hel") });
    const before = of([working]).a;
    expect(before).toMatch(/^[0-9a-f]{1,8}$/);
    // Same content, new objects: unchanged.
    expect(of([session("a", { busy: true, blocks: text("Hel") })]).a).toBe(
      before,
    );
    // Streamed output changes it; an idle chat is not reported.
    expect(
      of([session("a", { busy: true, blocks: text("Hello") })]).a,
    ).not.toBe(before);
    expect(of([working, session("idle", { blocks: text("x") })])).toEqual({
      a: before,
    });
    // Another working chat's output never changes this chat's fingerprint.
    const other = (value: string) =>
      session("b", { busy: true, blocks: text(value) });
    const both = of([working, other("1")], ["a", "b"]);
    const later = of([working, other("12")], ["a", "b"]);
    expect(later.a).toBe(both.a);
    expect(later.b).not.toBe(both.b);
    const tool = (status: string) =>
      [
        { id: "t", role: "tool", text: "", tool: { status } },
      ] as Session["blocks"];
    expect(
      of([session("a", { busy: true, blocks: tool("running") })]).a,
    ).not.toBe(of([session("a", { busy: true, blocks: tool("completed") })]).a);
  });
});
