import { describe, expect, it } from "vitest";
import { activeSessionAgents, sessionAgentSummary, sessionWithManagedAgents, uncertainSessionAgents } from "./sessionAgents";
import { newSession } from "./session";
import type { OrchestrationRun } from "./orchestration";

describe("session agent observations", () => {
  it("separates active, unknown, and terminal provider observations", () => {
    const session = { ...newSession("codex", "/repo"), liveAgents: [
      { id: "running", title: "Review", status: "running" as const },
      { id: "unknown", title: "Review", status: "unknown" as const },
      { id: "done", title: "Review", status: "completed" as const },
    ] };
    expect(activeSessionAgents(session).map(agent => agent.id)).toEqual(["running"]);
    expect(uncertainSessionAgents(session).map(agent => agent.id)).toEqual(["unknown"]);
    expect(sessionAgentSummary(session.liveAgents)).toBe("1 active · 1 status unknown · 1 done");
  });

  it("projects only this lead's live orchestration and never revives historical runs", () => {
    const session = newSession("codex", "/repo");
    const run = { leadId: session.id, status: "active", tasks: [
      { sessionId: "worker", title: "Layout review", status: "running" },
    ] } as OrchestrationRun;
    expect(sessionWithManagedAgents(session, [run]).liveAgents).toEqual([
      { id: "managed:worker", title: "Layout review", status: "running", detail: undefined },
    ]);
    expect(sessionWithManagedAgents(session, [{ ...run, leadId: "other" }])).toBe(session);
    expect(sessionWithManagedAgents(session, [{ ...run, status: "finished" }])).toBe(session);
    expect(session.liveAgents).toBeUndefined();
  });

  it("keeps a worker's live child visible after the managed run ends", () => {
    const session = newSession("codex", "/repo");
    const run = { leadId: session.id, status: "finished", tasks: [] } as unknown as OrchestrationRun;
    const child = { id: "worker:child", title: "Layout review · Research", status: "running" as const };
    expect(sessionWithManagedAgents(session, [run], [child]).liveAgents).toEqual([child]);
    expect(session.liveAgents).toBeUndefined();
  });
});
