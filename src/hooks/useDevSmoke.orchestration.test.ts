// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationRun } from "../lib/orchestration";
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

import { recordActivity } from "../lib/activity";
import { memoryStorage, SMOKE_REPLY, type SmokeStep } from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";
const config = { projectPath: PROJECT, binDir: "/tmp/check/bin" };
const RUN_STEP = "an orchestration runs its agents and posts one Run finished";
const STALL_STEP = "a run the lead leaves open offers Finish run";

type Flaws = {
  /** The + menu has no Orchestrator. */
  noEntry?: boolean;
  /** A worker's question reaches Activity as yours to answer. */
  askYou?: boolean;
  /** A worker's finished turn posts its own entry. */
  workerFinished?: boolean;
  /** The run posts "Run finished" twice. */
  twice?: boolean;
  /** The card keeps its running status after the run finished. */
  staleCard?: boolean;
  /** The plan shows no file chips. */
  noChips?: boolean;
  /** Other chats in the project hear the old jargon. */
  jargon?: boolean;
  /** The stalled bar has no Finish run. */
  noFinish?: boolean;
  /** The lead's own finish call is answered with an error. */
  finishFails?: boolean;
};

/**
 * A stand-in workspace that runs orchestrations as the stand-in lead does:
 * the + menu, the Orchestrator chip, the proposal card, a worker asking its
 * lead, the run bar and the Activity entries the run posts.
 */
function app(flaws: Flaws = {}) {
  let count = 0;
  let focused = "";
  let plusOpen = false;
  let orchestrate = false;
  const cards = new Map<string, { stall: boolean; status: string }>();
  const runs = new Map<string, OrchestrationRun>();
  const stalled = new Set<string>();
  const session = (id: string) =>
    state.sessions.find((entry) => entry.id === id)!;
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    sidebarOpen: true,
    newProjectTask: vi.fn((path: string) => {
      count += 1;
      const id = `${count}`;
      state.sessions = [
        ...state.sessions,
        {
          id,
          harness: "claude",
          cwd: path,
          title: `claude · Chat ${id}`,
          busy: false,
          blocks: [],
        } as unknown as Session,
      ];
      focused = id;
      draw();
    }),
    submit: vi.fn((id: string) => {
      update(id, { busy: true });
      setTimeout(
        () =>
          update(id, {
            busy: false,
            blocks: [
              ...session(id).blocks,
              { id: `r${id}`, role: "assistant", text: SMOKE_REPLY },
            ],
          }),
        0,
      );
    }),
    orchestration: {
      run: (leadId: string) => runs.get(leadId),
      submissionError: (id: string) => {
        const open = [...runs.values()].find(
          (run) => run.status === "active" && run.leadId !== id,
        );
        if (!open) return null;
        return flaws.jargon
          ? "This checkout has an active orchestrator."
          : `project is busy with an orchestration in “Chat ${open.leadId}”. Finish or stop it there.`;
      },
    },
  };
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
    draw();
  }
  function setRun(leadId: string, patch: Partial<OrchestrationRun>) {
    runs.set(leadId, { ...runs.get(leadId)!, ...patch });
    draw();
  }
  function entry(
    id: string,
    sessionId: string,
    summary: string,
    outcome = "completed",
  ) {
    recordActivity({
      id,
      sessionId,
      outcome: outcome as "completed",
      title: "Chat",
      summary,
      cwd: PROJECT,
      harness: "claude",
      model: "sonnet",
    });
  }
  function confirm(leadId: string) {
    const card = cards.get(leadId)!;
    const workers = ["a", "b"].map((name) => `${leadId}-${name}`);
    state.sessions = [
      ...state.sessions,
      ...workers.map(
        (id) =>
          ({
            id,
            harness: "claude",
            cwd: PROJECT,
            title: "Worker",
            busy: true,
            blocks: [],
            orchestrationLeadId: leadId,
          }) as unknown as Session,
      ),
    ];
    runs.set(leadId, {
      leadId,
      status: "active",
      tasks: workers.map((sessionId) => ({ sessionId, status: "running" })),
    } as unknown as OrchestrationRun);
    card.status = "Running";
    draw();
    if (card.stall) {
      setTimeout(() => {
        for (const id of workers) update(id, { busy: false });
        stalled.add(leadId);
        draw();
      }, 500);
      return;
    }
    setTimeout(() => {
      update(workers[0], {
        pendingQuestion: {
          requestId: 1,
          questions: [],
        } as unknown as Session["pendingQuestion"],
      });
      if (flaws.askYou)
        entry(`${workers[0]}:q`, workers[0], "Which title?", "question");
    }, 200);
    setTimeout(() => {
      update(workers[0], { pendingQuestion: undefined, busy: false });
      update(workers[1], { busy: false });
      if (flaws.workerFinished)
        entry(`${workers[1]}:done`, workers[1], SMOKE_REPLY);
      setRun(leadId, { status: "finished" });
      update(leadId, {
        blocks: [
          ...session(leadId).blocks,
          {
            id: `${leadId}-done`,
            role: "assistant",
            text: flaws.finishFails
              ? `${SMOKE_REPLY} Finish failed: Lead connection was revoked`
              : `${SMOKE_REPLY} Both notes are written.`,
          },
        ],
      });
      entry(`${leadId}:run:finished`, leadId, "Run finished · 2 agents");
      if (flaws.twice)
        entry(`${leadId}:run:again`, leadId, "Run finished · 2 agents");
      if (!flaws.staleCard) card.status = "Finished";
      draw();
    }, 3_000);
  }
  function draw() {
    const pane = (id: string) => {
      const card = cards.get(id);
      const review = card
        ? `<div data-orchestration-review>${
            flaws.noChips
              ? ""
              : `<ul><li data-orchestration-scope>notes/a.md</li><li data-orchestration-scope>notes/b.md</li></ul>`
          }${
            card.status === "Waiting for you to confirm"
              ? "<button data-confirm>Confirm &amp; start</button>"
              : ""
          }<span data-orchestration-status>${card.status}</span></div>`
        : "";
      const bar =
        stalled.has(id) && runs.get(id)?.status === "active"
          ? `<div data-orchestration-bar="${id}"><div data-state="stalled">The lead stopped without finishing${
              flaws.noFinish ? "" : "<button data-finish>Finish run</button>"
            }<button>Ask the lead to wrap up</button><button>Stop run</button></div></div>`
          : "";
      const chip = orchestrate
        ? `<button aria-label="Turn off Orchestrator mode"></button>`
        : "";
      const composer =
        id === focused
          ? `${bar}<div data-composer><textarea style="visibility: visible"></textarea><button aria-label="Add files or choose a mode"></button>${chip}</div>`
          : "";
      return `<div data-session-drop="${id}"${id === focused ? "" : " hidden"}>${review}${composer}</div>`;
    };
    const workers = state.sessions
      .filter((entry) => entry.orchestrationLeadId)
      .map(
        (entry) =>
          `<div data-orchestration-agent="${entry.id}"${
            entry.pendingQuestion ? " data-lead-deciding" : ""
          }></div>`,
      )
      .join("");
    const menu = plusOpen
      ? `<div data-composer-plus><button>Upload file</button>${
          flaws.noEntry
            ? ""
            : "<button data-composer-orchestrator>Orchestrator</button>"
        }</div>`
      : "";
    document.body.innerHTML = `<aside>${workers}</aside><div>${state.sessions
      .filter((entry) => !entry.orchestrationLeadId)
      .map((entry) => pane(entry.id))
      .join("")}</div>${menu}`;
    const on = (selector: string, handler: () => void) =>
      document
        .querySelector(selector)
        ?.addEventListener("click", () => handler());
    on('[aria-label="Add files or choose a mode"]', () => {
      plusOpen = !plusOpen;
      draw();
    });
    on("[data-composer-orchestrator]", () => {
      plusOpen = false;
      orchestrate = true;
      draw();
    });
    on("[data-confirm]", () => confirm(focused));
    on("[data-finish]", () => {
      setRun(focused, { status: "finished" });
      cards.get(focused)!.status = "Finished";
      draw();
    });
    document
      .querySelector("[data-composer] textarea")
      ?.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key !== "Enter" || !orchestrate) return;
        const request = (event.target as HTMLTextAreaElement).value;
        orchestrate = false;
        const lead = focused;
        setTimeout(() => {
          cards.set(lead, {
            stall: request.includes("AVEN_SMOKE_STALL"),
            status: "Waiting for you to confirm",
          });
          draw();
        }, 100);
      });
  }
  draw();
  return state;
}

async function check(flaws?: Flaws): Promise<SmokeStep[]> {
  mocks.finish.mockClear();
  // The Activity ledger, fresh for each run of the check.
  vi.stubGlobal("localStorage", memoryStorage());
  const state = app(flaws);
  const run = runDevSmoke(config, () => state);
  await vi.runAllTimersAsync();
  await run;
  return (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0];
}
const named = (steps: SmokeStep[], name: string) =>
  steps.find((step) => step.name === name);
async function failure(flaws: Flaws, name = RUN_STEP) {
  const step = named(await check(flaws), name);
  expect(step?.passed).toBe(false);
  return step?.detail ?? "";
}

describe("the real-app check's orchestration steps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    // Hidden chats take no room, as on screen.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return (this.closest("[hidden]")
        ? []
        : [{ top: 0, height: 10 }]) as unknown as DOMRectList;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("passes when the run goes to the lead, finishes once and frees the project", async () => {
    const steps = await check();
    expect(steps.map((step) => [step.name, step.passed])).toEqual([
      ["stand-in provider is the one Aven found", true],
      ["window stayed hidden until the workspace drew", true],
      ["agent turn through the normal send path", true],
      [RUN_STEP, true],
      [STALL_STEP, true],
    ]);
    expect(named(steps, RUN_STEP)?.detail).toBe(
      '2 agents, 2 file chips; a worker\'s question went to the lead and nowhere else; one "Run finished · 2 agents" entry; the card reads Finished',
    );
    expect(named(steps, STALL_STEP)?.detail).toBe(
      '"project is busy with an orchestration in “Chat 3”. Finish or stop it there."; the bar offered Finish run, which ended the run',
    );
  });

  it("fails when the + menu has no Orchestrator", async () => {
    expect(await failure({ noEntry: true })).toBe(
      "The + menu does not offer Orchestrator",
    );
  });

  it("fails when the plan shows no file chips", async () => {
    expect(await failure({ noChips: true })).toBe(
      "The plan shows 0 file chips, not one per task",
    );
  });

  it("fails when a worker's question asks you", async () => {
    expect(await failure({ askYou: true })).toMatch(
      /^Activity asks you to answer it \("Which title\?"\)/,
    );
  });

  it("fails when a worker posts its own Finished, or the run posts two", async () => {
    expect(await failure({ workerFinished: true })).toBe(
      `Activity also has "${SMOKE_REPLY}" for a worker`,
    );
    expect(await failure({ twice: true })).toBe(
      'Activity has 2 "Run finished" entries, not one',
    );
  });

  it("fails when the lead's own finish call reports a failure", async () => {
    expect(await failure({ finishFails: true })).toBe(
      `The lead's finish call failed: ${SMOKE_REPLY} Finish failed: Lead connection was revoked`,
    );
  });

  it("fails when the card never reads Finished", async () => {
    expect(await failure({ staleCard: true })).toBe(
      "Timed out waiting for the card to read Finished",
    );
  });

  it("fails when other chats hear jargon or the bar has no Finish run", async () => {
    expect(await failure({ jargon: true }, STALL_STEP)).toBe(
      "Another chat in the project is told: This checkout has an active orchestrator.",
    );
    expect(await failure({ noFinish: true }, STALL_STEP)).toBe(
      'The bar offers "Ask the lead to wrap up", "Stop run"',
    );
  });
});
