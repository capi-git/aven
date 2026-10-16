import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/session";

const mocks = vi.hoisted(() => ({
  resolveClaudeBinary: vi.fn(),
  finish: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  listeners: new Map<string, (payload: unknown) => void>(),
  readLaunchReveal: vi.fn(),
}));

vi.mock("../lib/harness/child", () => ({
  resolveClaudeBinary: mocks.resolveClaudeBinary,
}));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: {
    send: mocks.send,
    listen: vi.fn(async (event: string, callback: (p: unknown) => void) => {
      mocks.listeners.set(event, callback);
      return () => mocks.listeners.delete(event);
    }),
  },
}));
vi.mock("../lib/devSmoke", async (original) => ({
  ...(await original<typeof import("../lib/devSmoke")>()),
  finishDevSmoke: mocks.finish,
}));
vi.mock("../lib/devSmokeReveal", async (original) => ({
  ...(await original<typeof import("../lib/devSmokeReveal")>()),
  readLaunchReveal: mocks.readLaunchReveal,
}));

/** A launch whose window appeared once its workspace had drawn. */
const drawnLaunch = {
  native: {
    concealedAtMs: 1_000,
    revealedAtMs: 1_300,
    reason: "painted",
    concealedUntilReveal: true,
  },
  page: { committedAtEpochMs: 1_250, drawnAtEpochMs: 1_299 },
  firstContentfulPaintEpochMs: 1_260,
};

import {
  SMOKE_OVERLAY_RESULT_EVENT,
  SMOKE_REPLY,
  type SmokeStep,
} from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";

const config = { projectPath: "/tmp/check/project", binDir: "/tmp/check/bin" };

function harness(overrides: { floating?: string | null } = {}) {
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel:
      overrides.floating === undefined
        ? "floating-sidebar-main"
        : overrides.floating,
    expectFloatingSidebar: overrides.floating !== null,
    newProjectTask: vi.fn((path: string) => {
      state.sessions = [
        {
          id: "task",
          harness: "claude",
          cwd: path,
          busy: false,
          blocks: [],
        } as unknown as Session,
      ];
    }),
    submit: vi.fn((id: string) => {
      // The stand-in answers like Claude Code would.
      state.sessions = state.sessions.map((session) =>
        session.id === id
          ? ({
              ...session,
              blocks: [{ id: "b", role: "assistant", text: SMOKE_REPLY }],
            } as unknown as Session)
          : session,
      );
    }),
  };
  return state;
}

function reportedSteps(): SmokeStep[] {
  return (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0];
}

describe("Aven Dev's real-app check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.finish.mockClear();
    mocks.send.mockReset();
    mocks.listeners.clear();
    mocks.readLaunchReveal.mockResolvedValue(drawnLaunch);
  });
  afterEach(() => vi.useRealTimers());

  it("never sends when Claude is not the stand-in", async () => {
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/opt/homebrew/bin/claude",
    });
    const state = harness({ floating: null });
    await runDevSmoke(config, () => state);
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.newProjectTask).not.toHaveBeenCalled();
    const steps = reportedSteps();
    expect(steps[0]).toMatchObject({ passed: false });
    expect(steps[0].detail).toContain("not the stand-in");
  });

  it("passes when the turn returns and the floating sidebar answers", async () => {
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    mocks.send.mockImplementation(async () => {
      mocks.listeners.get(SMOKE_OVERLAY_RESULT_EVENT)?.({ ok: true });
    });
    const state = harness();
    const run = runDevSmoke(config, () => state);
    await vi.runAllTimersAsync();
    await run;
    expect(state.newProjectTask).toHaveBeenCalledWith(config.projectPath);
    expect(state.submit).toHaveBeenCalledWith("task", expect.any(String));
    expect(reportedSteps().every((step) => step.passed)).toBe(true);
  });

  it("fails a launch whose window appeared before its workspace drew", async () => {
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    mocks.readLaunchReveal.mockResolvedValue({
      ...drawnLaunch,
      native: { ...drawnLaunch.native, reason: "timeout" },
    });
    const state = harness({ floating: null });
    const run = runDevSmoke(config, () => state);
    await vi.runAllTimersAsync();
    await run;
    const launch = reportedSteps().find((step) =>
      step.name.startsWith("window stayed hidden"),
    )!;
    expect(launch).toMatchObject({ passed: false });
    expect(launch.detail).toContain("timeout, not by a drawn frame");
    // The rest of the check still runs.
    expect(state.submit).toHaveBeenCalled();
  });

  it("fails when the floating sidebar stops answering", async () => {
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    const state = harness();
    const run = runDevSmoke(config, () => state);
    await vi.advanceTimersByTimeAsync(50_000);
    await run;
    const overlay = reportedSteps().at(-1)!;
    expect(overlay).toMatchObject({ passed: false });
    expect(overlay.detail).toContain("stopped responding");
  });

  it("names the provider failure the chat showed", async () => {
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    const state = harness({ floating: null });
    state.submit.mockImplementation((id: string) => {
      state.sessions = state.sessions.map((session) =>
        session.id === id
          ? ({
              ...session,
              blocks: [
                {
                  id: "e",
                  role: "system",
                  text: "current webview is not a WebviewWindow",
                },
              ],
            } as unknown as Session)
          : session,
      );
    });
    const run = runDevSmoke(config, () => state);
    await vi.advanceTimersByTimeAsync(65_000);
    await run;
    const turn = reportedSteps().find((step) =>
      step.name.startsWith("agent turn"),
    )!;
    expect(turn.passed).toBe(false);
    expect(turn.detail).toContain("current webview is not a WebviewWindow");
  });
});
