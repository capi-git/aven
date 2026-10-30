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

import { SMOKE_REPLY, type SmokeStep } from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";
const config = { projectPath: PROJECT, binDir: "/tmp/check/bin" };
const REACTION_MS = 1_200;

type Flaws = {
  /** The sidebar's New chat leaves Home on screen (the 0.1.141 QA bug). */
  homeStays?: boolean;
  /** The mascot reacts a second time a moment after the first. */
  reactsTwice?: boolean;
  /** The working mark does not animate. */
  stillWhileWorking?: boolean;
  /** Parallel work opens unfolded. */
  parallelOpen?: boolean;
};

/**
 * A stand-in for the workspace: the state the check reads, and the DOM the
 * app would draw from it, kept in step as the check drives it.
 */
function app(flaws: Flaws = {}) {
  let homeOpen = false;
  let changesOpen = false;
  let reaction: string | null = null;
  let done = 0;
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    sidebarOpen: true,
    newProjectTask: vi.fn((path: string) => {
      const id = `task-${state.sessions.length + 1}`;
      state.sessions = [
        ...state.sessions,
        { id, harness: "claude", cwd: path, busy: false, blocks: [] },
      ] as unknown as Session[];
      focused = id;
      if (!flaws.homeStays) homeOpen = false;
      draw();
    }),
    submit: vi.fn((id: string, text: string) => {
      const hold = /AVEN_SMOKE_HOLD (\d+)/.exec(text);
      update(id, { busy: true });
      setTimeout(
        () => {
          const session = state.sessions.find((entry) => entry.id === id)!;
          update(id, {
            busy: false,
            blocks: [
              ...session.blocks,
              { id: `r${done}`, role: "assistant", text: SMOKE_REPLY },
            ],
          });
          done += 1;
          react();
          if (flaws.reactsTwice) setTimeout(react, REACTION_MS + 400);
        },
        hold ? Number(hold[1]) : 0,
      );
    }),
    motion: {
      openHome: vi.fn(() => {
        homeOpen = true;
        draw();
      }),
      showChanges: vi.fn(() => {
        changesOpen = true;
        draw();
      }),
      hideChanges: vi.fn(() => {
        changesOpen = false;
        draw();
      }),
    },
  };
  let focused = "";
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((session) =>
      session.id === id ? { ...session, ...patch } : session,
    );
    draw();
  }
  function react() {
    reaction = "cheer";
    draw();
    setTimeout(() => {
      reaction = null;
      draw();
    }, REACTION_MS);
  }
  // A project's mark: a dot mark sweeping while working, reacting once.
  const mark = (working: boolean) => {
    if (reaction)
      return `<span class="project-mark" data-kind="mark" data-reaction="${reaction}"><span class="dot-mark" data-state="done" data-reaction="${reaction}"><svg class="dot-mark-art" style="animation-name: dot-mark-${reaction}"></svg></span></span>`;
    if (working)
      return `<span class="project-mark" data-kind="mark" data-active="true"><span class="dot-mark" data-state="working"><svg class="dot-mark-art"><path class="dot-mark-lit-d" style="animation-name: ${flaws.stillWhileWorking ? "none" : "dot-mark-sweep"}"></path></svg></span></span>`;
    return `<span class="project-mark" data-kind="mark"><span class="dot-mark" data-state="still"><svg class="dot-mark-art"></svg></span></span>`;
  };
  function draw() {
    const working = state.sessions.some((session) => session.busy);
    document.body.innerHTML = `
      <div class="personal-project-row" data-project-path="${PROJECT}">${mark(working)}</div>
      <div class="personal-workspace-content"${homeOpen ? " hidden" : ""}>
        <div data-session-drop="${focused}"><div data-composer><textarea style="visibility: visible"></textarea></div></div>
      </div>
      ${
        homeOpen
          ? `<section class="workspace-home">
              <ul>
                <li class="workspace-home-agent" data-project-path="${PROJECT}" data-state="${working ? "running" : "idle"}">${mark(working)}</li>
                <li class="workspace-home-agent" data-project-path="/tmp/check/other" data-state="idle">${mark(false)}</li>
              </ul>
              ${working ? `<ul><li data-pulse="running"><button>1 agent working</button></li></ul>` : ""}
              ${done ? `<p><button class="workspace-home-today">Today: ${done} ${done === 1 ? "task" : "tasks"} done</button></p>` : ""}
            </section>`
          : ""
      }
      ${
        changesOpen
          ? `<section class="git-copies" aria-label="Parallel work"${flaws.parallelOpen ? " data-open" : ""}><h3><button class="git-copies-toggle" aria-expanded="${!!flaws.parallelOpen}">Parallel work <span>· 1 merged</span></button></h3>${flaws.parallelOpen ? "<p>Copy</p>" : ""}</section>`
          : ""
      }`;
  }
  draw();
  return state;
}

async function check(flaws?: Flaws): Promise<SmokeStep[]> {
  const state = app(flaws);
  const run = runDevSmoke(config, () => state);
  await vi.runAllTimersAsync();
  await run;
  return (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0];
}

const named = (steps: SmokeStep[], start: string) =>
  steps.find((step) => step.name.startsWith(start))!;

describe("the real-app check's motion steps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.finish.mockClear();
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("pass when the mark moves, reacts once, Home gives way and Parallel work is folded", async () => {
    const steps = await check();
    expect(steps.map((step) => [step.name, step.passed])).toEqual([
      ["stand-in provider is the one Aven found", true],
      ["window stayed hidden until the workspace drew", true],
      ["agent turn through the normal send path", true],
      ["the project's mark steps while its agent works and reacts once", true],
      [
        "Home shows each project's agent, and New chat leaves Home for the chat",
        true,
      ],
      ["Parallel work starts folded to one line", true],
    ]);
    expect(named(steps, "the project's mark").detail).toBe(
      "hopped while working, cheered once",
    );
    expect(named(steps, "Home shows").detail).toBe(
      "2 agents; 1 agent working; Today: 3 tasks done",
    );
    expect(named(steps, "Parallel work").detail).toBe(
      "Parallel work · 1 merged",
    );
  });

  it("fail when New chat in the sidebar leaves Home in front of the chat", async () => {
    const home = named(await check({ homeStays: true }), "Home shows");
    expect(home.passed).toBe(false);
    expect(home.detail).toContain("Home to give way to the new chat");
  });

  it("fail when the mascot reacts twice to one turn", async () => {
    const mark = named(
      await check({ reactsTwice: true }),
      "the project's mark",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toContain("came back");
  });

  it("fail when the working mark stands still", async () => {
    const mark = named(
      await check({ stillWhileWorking: true }),
      "the project's mark",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe(
      "While the agent worked, its mark its animation is none, expected dot-mark-sweep",
    );
  });

  it("fail when Parallel work opens unfolded", async () => {
    const parallel = named(
      await check({ parallelOpen: true }),
      "Parallel work",
    );
    expect(parallel.passed).toBe(false);
    expect(parallel.detail).toBe("Parallel work opened unfolded");
  });
});
