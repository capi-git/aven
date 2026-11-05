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
  /** The sidebar's Stack sweeps while its agent works. */
  stackSweeps?: boolean;
  /** The sidebar's Stack reacts as the turn ends. */
  stackReacts?: boolean;
  /** The sidebar's Stack stays closed when the project opens. */
  fanStuck?: boolean;
  /** The sidebar row never shows its running dot. */
  noRunningDot?: boolean;
  /** Home's working agent mark does not animate. */
  stillWhileWorking?: boolean;
  /** Parallel work opens unfolded. */
  parallelOpen?: boolean;
};

/** A page's turn as a browser reports it. */
const turned = (degrees: number) => {
  if (!degrees) return "none";
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 0, 0)`;
};

/**
 * A stand-in for the workspace: the state the check reads, and the DOM the
 * app would draw from it, kept in step as the check drives it.
 */
function app(flaws: Flaws = {}) {
  let homeOpen = false;
  let changesOpen = false;
  let expanded = false;
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
  // The sidebar's project mark: a Stack, fanned while the project is open.
  const stack = (working: boolean) => {
    const fanned = expanded && !flaws.fanStuck;
    const page = (part: string, degrees: number) =>
      `<rect class="stack-mark-${part}" style="transform: ${turned(fanned ? degrees : 0)}; transition-duration: 0.16s"></rect>`;
    const attributes = [
      working && flaws.stackSweeps ? ' data-active="true"' : "",
      reaction && flaws.stackReacts ? ` data-reaction="${reaction}"` : "",
    ].join("");
    return `<span class="project-mark" data-kind="stack"${attributes}><span class="stack-mark"${expanded ? " data-open" : ""}><svg class="stack-mark-art">${page("back", -14)}${page("middle", -6)}<rect class="stack-mark-front"></rect></svg></span></span>`;
  };
  // A project's agent (Home's tiles): Hopper, hopping while it works.
  const mark = (working: boolean) =>
    `<span class="dot-mark hopper-mark" data-hopper="${working ? "working" : "still"}"${reaction ? ` data-reaction="${reaction}"` : ""}><svg class="hopper-steps"></svg><span class="hopper-walk"><i class="hopper-dot" style="animation-name: ${working && !flaws.stillWhileWorking ? "hopper-hop" : "none"}"></i></span></span>`;
  function draw() {
    const working = state.sessions.some((session) => session.busy);
    document.body.innerHTML = `
      <div class="personal-project-row" data-project-path="${PROJECT}">
        <button class="personal-project-open">${stack(working)}${working && !flaws.noRunningDot ? '<span class="personal-project-status"><span class="personal-project-running"></span></span>' : ""}</button>
        <button class="personal-project-disclosure" aria-expanded="${expanded}"></button>
      </div>
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
  // The fold button opens and closes the project, as the sidebar's does.
  document.body.onclick = (event) => {
    if (!(event.target as Element).closest(".personal-project-disclosure"))
      return;
    expanded = !expanded;
    draw();
  };
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

  it("pass when the Stack stays still and fans, Home gives way and Parallel work is folded", async () => {
    const steps = await check();
    expect(steps.map((step) => [step.name, step.passed])).toEqual([
      ["stand-in provider is the one Aven found", true],
      ["window stayed hidden until the workspace drew", true],
      ["agent turn through the normal send path", true],
      [
        "the project's Stack stays still while its agent works, and fans while the project is open",
        true,
      ],
      [
        "Home shows each project's agent, and New chat leaves Home for the chat",
        true,
      ],
      ["Parallel work starts folded to one line", true],
    ]);
    expect(named(steps, "the project's Stack").detail).toBe(
      "still while working; fanned and folded",
    );
    expect(named(steps, "Home shows").detail).toBe(
      "2 agents; 1 agent working; Today: 3 tasks done",
    );
    expect(named(steps, "Parallel work").detail).toBe(
      "Parallel work · 1 merged",
    );
    // It leaves the project as it found it: closed.
    expect(
      document
        .querySelector(".personal-project-disclosure")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("fail when New chat in the sidebar leaves Home in front of the chat", async () => {
    const home = named(await check({ homeStays: true }), "Home shows");
    expect(home.passed).toBe(false);
    expect(home.detail).toContain("Home to give way to the new chat");
  });

  it("fail when the Stack stays closed as the project opens", async () => {
    const mark = named(await check({ fanStuck: true }), "the project's Stack");
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe(
      "Once the project opened, the project's Stack has its back page at 0.0°, expected -14° while the project is open",
    );
  });

  it("fail when the Stack sweeps while its agent works", async () => {
    const mark = named(
      await check({ stackSweeps: true }),
      "the project's Stack",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe("While the agent worked, the mark swept");
  });

  it("fail when the Stack reacts as the turn ends", async () => {
    const mark = named(
      await check({ stackReacts: true }),
      "the project's Stack",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe("The mark reacted (cheer) as the turn ended");
  });

  it("fail when the row never says its agent is running", async () => {
    const mark = named(
      await check({ noRunningDot: true }),
      "the project's Stack",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toContain(
      "the project's row to show its agent running",
    );
  });

  it("fail when Home's working agent mark stands still", async () => {
    const home = named(await check({ stillWhileWorking: true }), "Home shows");
    expect(home.passed).toBe(false);
    expect(home.detail).toBe(
      "On Home, the working agent's mark its animation is none, expected hopper-hop",
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
