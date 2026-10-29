// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../lib/activity";
import type { Session } from "../lib/session";
import { HelmBubble, useHelmSay, type HelmRun } from "./HelmRun";

const ledger = vi.hoisted(() => ({ entries: [] as ActivityEntry[] }));
vi.mock("../lib/activity", () => ({ useActivity: () => ledger.entries }));

let root: Root;
let host: HTMLDivElement;
let session: Session;
const stop = vi.fn();

/** The bubble as the helm draws it, for this chat's run. */
function Bubble({ run, stopInBar }: { run: HelmRun; stopInBar: boolean }) {
  const { say, dismiss } = useHelmSay(run, !!run.session.busy);
  return createElement(HelmBubble, {
    say,
    run,
    stopInBar,
    fixes: [],
    onDismiss: dismiss,
  });
}

async function render({
  visible = true,
  stopInBar = false,
  placement = "row" as HelmRun["placement"],
} = {}) {
  await act(async () =>
    root.render(
      createElement(Bubble, {
        run: { session, visible, placement, onStop: stop },
        stopInBar,
      }),
    ),
  );
}
const bubble = () => host.querySelector<HTMLElement>("[data-helm-say]");
const outcome = (value: "completed" | "failed" | "stopped"): ActivityEntry => ({
  id: `session:turn:provider-turn:${value}`,
  sessionId: "session",
  outcome: value,
  title: "Test task",
  summary: "Result",
  cwd: "/repo",
  harness: "codex",
  model: "codex:gpt-6-astra",
  createdAt: 20000,
  readAt: null,
  resolvedAt: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ledger.entries = [];
  stop.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  session = {
    id: "session",
    title: "Test task",
    cwd: "/repo",
    harness: "codex",
    model: "codex:gpt-6-astra",
    modelSettings: {},
    runtimeMode: "full-access",
    busy: true,
    blocks: [{ id: "user", role: "user", text: "Inspect", startedAt: 1000 }],
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the critter's speech bubble", () => {
  it("says what the agent is doing, for how long, with the one Stop", async () => {
    session.blocks.push({
      id: "read",
      role: "tool",
      text: "Read Composer.tsx",
      streaming: true,
      tool: { kind: "read", title: "Read Composer.tsx", status: "in_progress" },
    });
    await render();
    expect(bubble()?.dataset.helmSay).toBe("running");
    expect(bubble()?.textContent).toContain("Composer.tsx");
    expect(host.querySelector('[role="timer"]')?.textContent).toBe("0:09");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(host.querySelector('[role="timer"]')?.textContent).toBe("0:11");
    const stops = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Stop"]',
    );
    expect(stops).toHaveLength(1);
    await act(async () => stops[0].click());
    expect(stop).toHaveBeenCalledWith("session");
  });

  it("keeps changes accessible without announcing the clock every second", async () => {
    await render();
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      host.querySelector('[role="timer"]')?.getAttribute("aria-live"),
    ).toBe("off");
  });

  it("leaves Stop to the team bar for an orchestration's lead", async () => {
    await render({ stopInBar: true, placement: "attention" });
    expect(bubble()?.textContent).toContain("Working");
    expect(host.querySelector('[aria-label="Stop"]')).toBeNull();
  });

  it("says it needs you while an approval waits, then works on", async () => {
    session.blocks.push({
      id: "approval",
      role: "tool",
      text: "Command",
      approval: { requestId: 1 },
    });
    await render();
    expect(bubble()?.dataset.helmSay).toBe("waiting");
    expect(bubble()?.textContent).toContain("Needs you · Approval needed");
    expect(host.querySelector('[aria-label="Stop"]')).not.toBeNull();
    session = {
      ...session,
      blocks: session.blocks.map((block) =>
        block.approval
          ? { ...block, approval: { ...block.approval, decided: "allow" } }
          : block,
      ),
    };
    await render();
    expect(bubble()?.dataset.helmSay).toBe("running");
  });

  it("counts a retry down and names a long command, without new events", async () => {
    session = {
      ...session,
      waitingOn: {
        retry: { attempt: 1, retryAt: 13_000, reason: "connection" },
      },
    };
    await render();
    expect(bubble()?.textContent).toContain("Can’t reach Codex");
    expect(bubble()?.textContent).toContain("Retrying in 3s (try 2)");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(bubble()?.textContent).toContain("Retrying in 2s (try 2)");

    session = {
      ...session,
      waitingOn: undefined,
      blocks: [
        ...session.blocks,
        {
          id: "shell",
          role: "tool",
          text: "npm test",
          streaming: true,
          tool: { kind: "execute", status: "in_progress", startedAt: 2_000 },
        },
      ],
    };
    await render();
    expect(bubble()?.textContent).toContain("npm test");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(bubble()?.textContent).toContain("Running a command");
    expect(bubble()?.textContent).toContain("npm test · 10s");
  });

  it("lists the chat's agents on request", async () => {
    session = {
      ...session,
      liveAgents: [
        { id: "a1", title: "Explore", status: "running" } as never,
        { id: "a2", title: "Test", status: "completed" } as never,
      ],
    };
    await render();
    const agents = host.querySelector<HTMLButtonElement>("[data-helm-agents]")!;
    expect(agents.textContent).toBeTruthy();
    await act(async () => agents.click());
    expect(
      document.body.querySelector('[aria-label="Agent status"]'),
    ).not.toBeNull();
  });

  it("keeps the agents one press away after a turn whose agents failed", async () => {
    ledger.entries = [outcome("completed")];
    session = {
      ...session,
      busy: false,
      blocks: session.blocks.map((block) => ({ ...block, durationMs: 4000 })),
      liveAgents: [
        { id: "a1", title: "Explore", status: "failed" } as never,
        { id: "a2", title: "Test", status: "completed" } as never,
      ],
    };
    await render();
    expect(bubble()?.dataset.helmSay).toBe("error");
    expect(bubble()?.textContent).toContain("Agent failed");
    const agents = host.querySelector<HTMLButtonElement>("[data-helm-agents]")!;
    expect(agents.getAttribute("aria-label")).toMatch(/^Agent details: /);
    await act(async () => agents.click());
    expect(
      document.body.querySelector('[aria-label="Agent status"]'),
    ).not.toBeNull();
  });

  it("shortens the agents and the queue to a mark and a count, never hiding them", async () => {
    session = {
      ...session,
      queuedMessages: [
        { id: "q1", text: "One", attachments: [] },
        { id: "q2", text: "Two", attachments: [] },
      ],
      liveAgents: [{ id: "a1", title: "Explore", status: "running" } as never],
    };
    await render();
    const queued = host.querySelector<HTMLElement>("[data-helm-queued]")!;
    expect(queued.getAttribute("aria-label")).toBe("2 queued");
    expect(queued.querySelector(".helm-say-long")?.textContent).toBe(
      "2 queued",
    );
    expect(queued.querySelector(".helm-say-short")?.textContent).toBe("2");
    const agents = host.querySelector<HTMLElement>("[data-helm-agents]")!;
    expect(agents.querySelector(".helm-say-short")?.textContent).toBe("1");
  });

  it("stops its clock in a parked pane", async () => {
    await render({ visible: false });
    expect(host.querySelector('[role="timer"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["completed", "stopped"] as const)(
    "after a %s turn it watched, says so briefly with no Stop and no ticking",
    async (result) => {
      await render();
      ledger.entries = [outcome(result)];
      session = {
        ...session,
        busy: false,
        blocks: session.blocks.map((block) => ({
          ...block,
          durationMs: 19000,
        })),
      };
      await render();
      expect(bubble()?.dataset.helmSay).toBe(
        result === "completed" ? "done" : "stopped",
      );
      if (result === "completed")
        expect(bubble()?.textContent).toContain("Done in 0:19");
      expect(host.querySelector('[aria-label="Stop"]')).toBeNull();
      expect(host.querySelector('[role="timer"]')).toBeNull();
      await act(async () => vi.advanceTimersByTime(5000));
      expect(bubble()).toBeNull();
    },
  );

  it("keeps a failure until it is dismissed, even in a new window", async () => {
    session = {
      ...session,
      busy: false,
      blocks: session.blocks.map((block) => ({ ...block, durationMs: 4000 })),
    };
    ledger.entries = [outcome("failed")];
    await render();
    expect(bubble()?.dataset.helmSay).toBe("error");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(bubble()?.dataset.helmSay).toBe("error");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click(),
    );
    expect(bubble()).toBeNull();
  });

  it("says a queue is waiting when nothing runs", async () => {
    session = {
      ...session,
      busy: false,
      queuedMessages: [{ id: "q", text: "Next", attachments: [] }],
      queueStatus: "paused",
    };
    await render();
    expect(bubble()?.dataset.helmSay).toBe("queued");
    expect(bubble()?.textContent).toContain("Queue paused");
  });
});
