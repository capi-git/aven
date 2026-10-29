// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/session";

const mocks = vi.hoisted(() => ({
  resolveClaudeBinary: vi.fn(),
  finish: vi.fn(async () => {}),
}));

vi.mock("../lib/harness/child", () => ({
  resolveClaudeBinary: mocks.resolveClaudeBinary,
}));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));
vi.mock("../lib/devSmoke", async (original) => ({
  ...(await original<typeof import("../lib/devSmoke")>()),
  finishDevSmoke: mocks.finish,
}));
vi.mock("../lib/devSmokeReveal", async (original) => ({
  ...(await original<typeof import("../lib/devSmokeReveal")>()),
  readLaunchReveal: async () => ({
    native: {
      concealedAtMs: 1_000,
      revealedAtMs: 1_300,
      reason: "painted",
      concealedUntilReveal: true,
    },
    page: { committedAtEpochMs: 1_250, drawnAtEpochMs: 1_299 },
    firstContentfulPaintEpochMs: 1_260,
  }),
}));

import { memoryStorage, SMOKE_REPLY, type SmokeStep } from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";
const config = {
  projectPath: PROJECT,
  binDir: "/tmp/check/bin",
  pageUrl: "http://127.0.0.1:8123/index.html",
};
const STEP = "an agent's opens build on one page";

/** What the stand-in answers the pages turn with, or null for never. */
type Answer = string | null;

const built = JSON.stringify(
  ["-", "reloaded", "navigated", "navigated", "-", "navigated"].map(
    (reused, index) => ({
      id: index < 4 ? "page-a" : "page-b",
      reused: reused === "-" ? null : reused,
      ms: [140, 380, 260, 250, 160, 240][index],
    }),
  ),
);

/** A workspace whose chats answer as the stand-in does. */
function app(answer: Answer) {
  let count = 0;
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    sidebarOpen: true,
    newProjectTask: vi.fn((path: string) => {
      count += 1;
      state.sessions = [
        ...state.sessions,
        {
          id: `${count}`,
          harness: "claude",
          cwd: path,
          title: `Chat ${count}`,
          busy: false,
          blocks: [],
        } as unknown as Session,
      ];
    }),
    submit: vi.fn((id: string, text: string) => {
      update(id, { busy: true });
      const reply = text.includes("AVEN_SMOKE_PAGES") ? answer : SMOKE_REPLY;
      if (reply === null) return;
      setTimeout(() => {
        const blocks = state.sessions.find((entry) => entry.id === id)!.blocks;
        update(id, {
          busy: false,
          blocks: [...blocks, { id: `r${id}`, role: "assistant", text: reply }],
        } as Partial<Session>);
      }, 3_000);
    }),
    stop: vi.fn((id: string) => update(id, { busy: false })),
    agentPages: () =>
      ["page-a", "page-b"].map((id) => ({ id, url: "", agentChat: "2" })),
  };
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
  }
  return state;
}

async function check(answer: Answer) {
  mocks.finish.mockClear();
  vi.stubGlobal("localStorage", memoryStorage());
  const state = app(answer);
  const run = runDevSmoke(config, () => state);
  await vi.runAllTimersAsync();
  await run;
  const steps = (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0];
  return { step: steps.find((entry) => entry.name === STEP), state };
}

describe("the real-app check's agent pages step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("passes opens that built on one page and says what each took", async () => {
    const { step, state } = await check(`${SMOKE_REPLY} AVEN_PAGES ${built}`);
    expect(step).toEqual({
      name: STEP,
      passed: true,
      detail:
        "one page reloaded and navigated, a second only for another path (-, reloaded, navigated, navigated, -, navigated) in 140, 380, 260, 250, 160, 240 ms",
    });
    // Its turn ended by itself: nothing to stop.
    expect(state.stop).not.toHaveBeenCalled();
  });

  it("fails reuses that hand back a page still loading, after their full waits", async () => {
    const note =
      "Your page is still loading. Take a snapshot again in a moment to read the new page.";
    const stalled = JSON.stringify(
      ["-", "reloaded", "navigated", "navigated", "-", "navigated"].map(
        (reused, index) => ({
          id: index < 4 ? "page-a" : "page-b",
          reused: reused === "-" ? null : reused,
          ms: [108, 6335, 6331, 6297, 229, 6199][index],
          ...(reused === "-" ? {} : { note }),
        }),
      ),
    );
    const { step } = await check(`${SMOKE_REPLY} AVEN_PAGES ${stalled}`);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toMatch(
      /^Reusing the check's local page must hand back its loaded page within 1500 ms, but open 2 \(reloaded\) took 6335 ms and handed back still loading; /,
    );
  });

  it("names each open's time when one got no answer", async () => {
    const { step } = await check(
      `${SMOKE_REPLY} AVEN_PAGES FAILED open 3 got no answer in 20 s [{"id": "page-a", "reused": null, "ms": 140}, {"id": "page-a", "reused": "reloaded", "ms": 380}, {"ms": 20004}]`,
    );
    expect(step).toEqual({
      name: STEP,
      passed: false,
      detail:
        "The stand-in's opens failed: open 3 got no answer in 20 s (1. - 140 ms, 2. reloaded 380 ms, 3. no answer 20004 ms)",
    });
  });

  it("stops a turn that never answers, leaving the project free for the next step", async () => {
    const { step, state } = await check(null);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toBe(
      "Timed out waiting for the stand-in's page opens (its browser calls follow the results)",
    );
    expect(state.stop).toHaveBeenCalledExactlyOnceWith("2");
    expect(state.sessions.some((session) => session.busy)).toBe(false);
  });
});
