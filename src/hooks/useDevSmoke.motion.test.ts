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
  /** The sidebar's Stack sweeps while its agent works. */
  stackSweeps?: boolean;
  /** The sidebar's Stack reacts as the turn ends. */
  stackReacts?: boolean;
  /** The sidebar's Stack stays closed when the project opens. */
  fanStuck?: boolean;
  /** Neither the project's row nor its chat's shows its agent working. */
  noRunningDot?: boolean;
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
  function draw() {
    const working = state.sessions.some((session) => session.busy);
    document.body.innerHTML = `
      <div class="personal-project-row" data-project-path="${PROJECT}">
        <button class="personal-project-open">${stack(working)}${working && !expanded && !flaws.noRunningDot ? '<span class="personal-project-status"><span class="personal-project-running"></span></span>' : ""}</button>
        <button class="personal-project-disclosure" aria-expanded="${expanded}"></button>
      </div>
      ${
        // Open, the project's chats are listed, and a working one shows its
        // agent's screen on its own row instead of the project's.
        expanded
          ? state.sessions
              .map(
                (session) =>
                  `<div data-session-card="${session.id}"><span class="personal-task-lead">${session.busy && !flaws.noRunningDot ? '<span class="personal-task-agent"><span class="dot-mark agent-mark" data-agent="working"></span></span>' : ""}</span></div>`,
              )
              .join("")
          : ""
      }
      <div class="personal-workspace-content">
        <div data-session-drop="${focused}"><div data-composer><textarea style="visibility: visible"></textarea></div></div>
      </div>
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

  it("pass when the Stack stays still and fans and Parallel work is folded", async () => {
    const steps = await check();
    expect(steps.map((step) => [step.name, step.passed])).toEqual([
      ["stand-in provider is the one Aven found", true],
      ["window stayed hidden until the workspace drew", true],
      ["agent turn through the normal send path", true],
      [
        "the project's row stays still while its agent works, and folds open and closed",
        true,
      ],
      ["Parallel work starts folded to one line", true],
    ]);
    expect(named(steps, "the project's row").detail).toBe(
      "still while working; fanned and folded",
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

  it("fail when the Stack stays closed as the project opens", async () => {
    const mark = named(await check({ fanStuck: true }), "the project's row");
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe(
      "Once the project opened, the project's mark has its back page at 0.0°, expected -14° while the project is open",
    );
  });

  it("fail when the Stack sweeps while its agent works", async () => {
    const mark = named(
      await check({ stackSweeps: true }),
      "the project's row",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe("While the agent worked, the mark swept");
  });

  it("fail when the Stack reacts as the turn ends", async () => {
    const mark = named(
      await check({ stackReacts: true }),
      "the project's row",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toBe("The mark reacted (cheer) as the turn ended");
  });

  it("fail when the sidebar never says its agent is working", async () => {
    const mark = named(
      await check({ noRunningDot: true }),
      "the project's row",
    );
    expect(mark.passed).toBe(false);
    expect(mark.detail).toContain("the sidebar to show its agent working");
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
