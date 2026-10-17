// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceRecord } from "../lib/race";
import type { HarnessId, Session } from "../lib/session";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));

import { checkRace, type SmokeRace } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";
const config = { projectPath: PROJECT, binDir: "/tmp/check/bin" };
const LANES = ["/data/races/r1/0", "/data/races/r1/1"];

type Flaws = {
  /** Grok Build resolves to a real installation. */
  realGrok?: boolean;
  /** The Race menu would also send the task to Codex. */
  withCodex?: boolean;
  /** Keep this does not ask while an agent works. */
  noConfirm?: boolean;
  /** A failed lane reads Done. */
  failedReadsDone?: boolean;
  /** A failed lane offers no Retry. */
  noRetry?: boolean;
  /** Keep applies only the files the overview last listed. */
  staleKeep?: boolean;
  /** The copies are left behind. */
  copiesStay?: boolean;
};

/**
 * A stand-in workspace: a chat whose agent panel turns Race on, a race whose
 * Claude lane writes a file every half second, an overview that refreshes
 * every four seconds, and a keep that applies the lane's files.
 */
function app(flaws: Flaws = {}) {
  const disk = new Map<string, Set<string>>([
    [PROJECT, new Set(["README.md"])],
  ]);
  const races: RaceRecord[] = [];
  const sent: string[] = [];
  let chats = 0;
  let screen: "chat" | "lanes" | "overview" = "chat";
  let panelOpen = false;
  let raceOn = false;
  let chosen: HarnessId[] = [];
  let laneState: string[] = [];
  let listed: string[] = [];
  let asking = false;
  let writer: ReturnType<typeof setInterval> | undefined;
  let refresher: ReturnType<typeof setInterval> | undefined;
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    sidebarOpen: true,
    submit: vi.fn(),
    newProjectTask: vi.fn((path: string) => {
      chats += 1;
      state.sessions = [...state.sessions, chat(`chat-${chats}`, path)];
      screen = "chat";
      draw();
    }),
  };
  function chat(id: string, cwd: string, worktreeCwd?: string): Session {
    return {
      id,
      harness: "claude",
      cwd,
      worktreeCwd,
      title: id,
      busy: false,
      blocks: [],
    } as unknown as Session;
  }
  const record = () => races[0];
  const files = (folder: string) => [...(disk.get(folder) ?? [])];
  const refresh = () => {
    listed = files(LANES[0]).filter((name) => name.startsWith("race-"));
  };

  function start() {
    sent.push("race");
    races.push({
      id: "r1",
      project: PROJECT,
      root: PROJECT,
      base: "a".repeat(40),
      prompt: "Build the change.",
      createdAt: 0,
      uncommitted: false,
      untracked: false,
      state: "running",
      lanes: (["claude", "grok"] as const).map((harness, slot) => ({
        sessionId: `lane-${slot}`,
        harness,
        model: "m",
        label: harness === "claude" ? "Claude Code · Sonnet" : "Grok Build",
        path: LANES[slot],
        branch: `aven/race/r1-${slot}`,
      })),
    });
    state.sessions = [
      ...state.sessions,
      chat("lane-0", PROJECT, LANES[0]),
      chat("lane-1", PROJECT, LANES[1]),
    ];
    disk.set(LANES[0], new Set(["README.md", "race-claude.txt"]));
    disk.set(LANES[1], new Set(["README.md"]));
    laneState = ["working", flaws.failedReadsDone ? "done" : "failed"];
    let count = 0;
    writer = setInterval(() => {
      count += 1;
      disk.get(LANES[0])?.add(`race-claude-late-${count}.txt`);
    }, 500);
    refresh();
    refresher = setInterval(refresh, 4_000);
    screen = "lanes";
    draw();
  }

  function keep() {
    clearInterval(writer);
    clearInterval(refresher);
    const kept = flaws.staleKeep ? listed : files(LANES[0]);
    for (const name of kept)
      if (name.startsWith("race-")) disk.get(PROJECT)!.add(name);
    if (!flaws.copiesStay) for (const lane of LANES) disk.delete(lane);
    races[0] = { ...record(), state: "kept" };
    state.sessions = state.sessions.map((session) =>
      session.id.startsWith("lane-")
        ? { ...session, worktreeCwd: undefined }
        : session,
    );
    asking = false;
    draw();
  }

  function button(label: string, onClick: () => void, attrs = {}) {
    const element = document.createElement("button");
    element.textContent = label;
    Object.assign(element.dataset, attrs);
    element.addEventListener("click", onClick);
    return element;
  }

  function composer(sessionId: string) {
    const pane = document.createElement("div");
    pane.dataset.sessionDrop = sessionId;
    const box = document.createElement("div");
    box.dataset.composer = "";
    if (sessionId.startsWith("lane-")) {
      const bar = document.createElement("div");
      bar.dataset.raceBar = "r1";
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      status.textContent = "Racing · 0 of 2 done";
      bar.append(
        status,
        button(
          "Compare",
          () => {
            screen = "overview";
            draw();
          },
          { raceCompare: "" },
        ),
      );
      box.append(bar);
    }
    box.append(
      button(
        "Agent",
        () => {
          panelOpen = !panelOpen;
          draw();
        },
        { agentPill: "" },
      ),
    );
    const field = document.createElement("textarea");
    field.style.visibility = "visible";
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && raceOn) {
        raceOn = false;
        start();
      }
    });
    box.append(field);
    if (raceOn) {
      const send = button("Race", () => {});
      send.setAttribute("aria-label", "Race 2 agents");
      box.append(send);
    }
    pane.append(box);
    return pane;
  }

  function panel() {
    const element = document.createElement("div");
    element.dataset.agentPanel = "";
    const options = document.createElement("div");
    options.dataset.raceOptions = "";
    const toggle = button("Race this message", () => {
      raceOn = !raceOn;
      draw();
    });
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(raceOn));
    options.append(toggle);
    const lanes = [
      "Claude Code",
      ...(flaws.withCodex ? ["Codex"] : []),
      ...(chosen.includes("grok") ? ["Grok Build"] : []),
    ];
    for (const name of lanes) {
      const lane = button(name, () => {});
      lane.setAttribute("role", "checkbox");
      lane.setAttribute("aria-checked", "true");
      options.append(lane);
    }
    element.append(options);
    return element;
  }

  function overview() {
    const view = document.createElement("div");
    view.dataset.raceView = "r1";
    record().lanes.forEach((_, index) => {
      const section = document.createElement("section");
      section.dataset.raceLane = String(index);
      const badge = document.createElement("span");
      badge.dataset.laneState = laneState[index];
      section.append(badge);
      if (laneState[index] === "failed" && !flaws.noRetry)
        section.append(
          button("Retry", () => {
            laneState[1] = "working";
            disk.get(LANES[1])?.add("race-grok.txt");
            draw();
          }),
        );
      section.append(
        button("Keep this", () => {
          if (index !== 0) return;
          if (flaws.noConfirm) return keep();
          asking = true;
          draw();
        }),
      );
      view.append(section);
    });
    for (const name of listed) {
      const row = document.createElement("div");
      row.dataset.raceFile = name;
      view.append(row);
    }
    return view;
  }

  function dialog() {
    const element = document.createElement("div");
    element.setAttribute("role", "dialog");
    const working = laneState.filter((kind) => kind === "working").length;
    element.append(
      `Keep Claude Code's version? This stops ${working} agents still working and deletes their copies.`,
      button("Cancel", () => {
        asking = false;
        draw();
      }),
      button("Keep Claude Code's version", keep, { confirm: "" }),
    );
    return element;
  }

  function draw() {
    document.body.replaceChildren();
    if (screen === "chat") document.body.append(composer(`chat-${chats}`));
    else if (screen === "lanes")
      document.body.append(composer("lane-0"), composer("lane-1"));
    else if (record()?.state === "running") document.body.append(overview());
    if (panelOpen) document.body.append(panel());
    if (asking) document.body.append(dialog());
  }

  const host: SmokeRace = {
    races: () => races,
    listDir: async (path) => {
      const names = disk.get(path);
      if (!names) throw new Error(`${path}: No such file or directory`);
      return [...names].map((name) => ({ name }));
    },
    readFile: async (path) => {
      const at = path.lastIndexOf("/");
      if (!disk.get(path.slice(0, at))?.has(path.slice(at + 1)))
        throw new Error(`${path}: No such file`);
      return "x";
    },
    resolveGrok: async () => ({
      path: flaws.realGrok ? "/opt/homebrew/bin/grok" : "/tmp/check/bin/grok",
    }),
    probe: async () => {},
    chooseAgents: (harnesses) => {
      chosen = harnesses;
    },
  };
  return { state, host, disk, sent, stop: () => clearInterval(writer) };
}

async function run(flaws: Flaws = {}) {
  const fake = app(flaws);
  let outcome: { detail?: string; error?: string } | undefined;
  void checkRace(() => fake.state as never, config, fake.host).then(
    (detail) => (outcome = { detail }),
    (error: unknown) => (outcome = { error: String(error) }),
  );
  for (let tick = 0; tick < 1_500 && !outcome; tick++)
    await vi.advanceTimersByTimeAsync(100);
  fake.stop();
  return { ...outcome, fake };
}

describe("the real-app check's race step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
      () => [{}] as unknown as DOMRectList,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("passes when a lane kept mid-run brings the file the overview had not shown", async () => {
    const { detail, error, fake } = await run();
    expect(error).toBeUndefined();
    expect(detail).toMatch(
      /^Claude Code and Grok Build in separate copies; Compare from "Racing · 0 of 2 done"; Grok read Failed, then Working after Retry; kept Claude's lane mid-run \(stopping 2\) with race-claude-late-\d+\.txt the overview hadn't shown; copies removed, both chats back on the project$/,
    );
    expect(
      [...fake.disk.get(PROJECT)!].some((name) =>
        name.startsWith("race-claude-late-"),
      ),
    ).toBe(true);
  });

  it.each<[Flaws, string]>([
    [{ noConfirm: true }, "Timed out waiting for Keep's confirmation"],
    [
      { failedReadsDone: true },
      "Grok's lane to read Failed while Claude's works; the lanes read working and done",
    ],
    [{ noRetry: true }, "The failed lane offers no Retry"],
    [{ staleKeep: true }, "was not kept"],
    [{ copiesStay: true }, "copy is still there"],
  ])("fails when %o", async (flaws, message) => {
    const { error } = await run(flaws);
    expect(error).toContain(message);
  });

  it.each<[Flaws, string]>([
    [{ realGrok: true }, "Grok Build resolved to /opt/homebrew/bin/grok"],
    [
      { withCodex: true },
      "The race would go to Claude Code, Codex, Grok Build",
    ],
  ])("sends nothing when %o", async (flaws, message) => {
    const { error, fake } = await run(flaws);
    expect(error).toContain(message);
    expect(fake.sent).toEqual([]);
  });
});
