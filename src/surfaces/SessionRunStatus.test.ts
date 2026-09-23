// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../lib/activity";
import type { Session } from "../lib/session";
import { SessionRunStatus } from "./SessionRunStatus";

const ledger = vi.hoisted(() => ({ entries: [] as ActivityEntry[] }));
vi.mock("../lib/activity", () => ({ useActivity: () => ledger.entries }));

let root: Root;
let host: HTMLDivElement;
let session: Session;
const stop = vi.fn();
const openTerminal = vi.fn();
async function render(visible = true) {
  await act(async () => root.render(createElement(SessionRunStatus, { session, visible, onStop: stop, onOpenTerminal: openTerminal })));
}
const state = () => host.querySelector("[data-run-state]")?.getAttribute("data-run-state");
const outcome = (value: "completed" | "failed" | "stopped"): ActivityEntry => ({
  id: `session:turn:provider-turn:${value}`,
  sessionId: "session", outcome: value, title: "Test task", summary: "Result",
  cwd: "/repo", harness: "codex", model: "codex:gpt-6-astra",
  createdAt: 20000, readAt: null, resolvedAt: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ledger.entries = [];
  stop.mockReset();
  openTerminal.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  session = {
    id: "session", title: "Test task", cwd: "/repo", harness: "codex",
    model: "codex:gpt-6-astra", modelSettings: {}, runtimeMode: "full-access", busy: true,
    blocks: [{ id: "user", role: "user", text: "Inspect", startedAt: 1000 }],
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("persistent agent run status", () => {
  it("stays working between tool updates and while the answer streams, with a functional stop button", async () => {
    await render();
    expect(state()).toBe("working");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Working");
    expect(host.querySelector('[role="timer"]')?.textContent).toBe("9s");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.querySelector('[role="timer"]')?.textContent).toBe("11s");
    session = { ...session, blocks: [...session.blocks,
      { id: "tool", role: "tool", text: "Command", tool: { status: "completed", kind: "shell" } },
      { id: "answer", role: "assistant", text: "Here is", streaming: true },
    ] };
    await render();
    expect(state()).toBe("working");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]')!.click());
    expect(stop).toHaveBeenCalledExactlyOnceWith("session");
  });

  it("shows approval as waiting, then resumes the active state", async () => {
    session.blocks.push({ id: "approval", role: "tool", text: "Command", approval: { requestId: 1 } });
    await render();
    expect(state()).toBe("waiting");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Waiting for you");
    expect(vi.getTimerCount()).toBe(0);
    session = { ...session, blocks: session.blocks.map(block => block.approval ? { ...block, approval: { ...block.approval, decided: "allow" } } : block) };
    await render();
    expect(state()).toBe("working");
  });

  it.each(["completed", "failed", "stopped"] as const)("keeps the %s outcome visible without a stop control or ticking timer", async result => {
    await render();
    ledger.entries = [outcome(result)];
    session = { ...session, busy: false, blocks: session.blocks.map(block => ({ ...block, durationMs: 19000 })) };
    await render();
    expect(state()).toBe(result === "completed" ? "finished" : result);
    expect(host.querySelector('[aria-label="Stop agent"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const before = host.textContent;
    await act(async () => vi.advanceTimersByTime(5000));
    expect(host.textContent).toBe(before);
  });

  it("unmounts hidden panes' status and timer and catches up when shown", async () => {
    await render();
    expect(vi.getTimerCount()).toBe(1);
    await render(false);
    expect(host.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(3000));
    await render();
    expect(host.querySelector('[role="timer"]')?.textContent).toBe("12s");
  });

  it("explains sign-in recovery and opens this session's terminal only on request", async () => {
    session = { ...session, harness: "claude", busy: false, blocks: [...session.blocks,
      { id: "error", role: "system", text: "Failed to authenticate: OAuth session expired and could not be refreshed" },
    ] };
    ledger.entries = [outcome("failed")];
    await render();
    expect(state()).toBe("failed");
    expect(host.textContent).toContain("Sign in required");
    expect(host.textContent).toContain("claude auth login");
    expect(host.textContent).not.toContain("Finished");
    expect(openTerminal).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === "Open terminal")!;
    await act(async () => button.click());
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith("session");
  });

  it("keeps status changes accessible without announcing the clock every second", async () => {
    await render();
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(host.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
  });
});
