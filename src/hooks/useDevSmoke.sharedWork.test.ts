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

import { SMOKE_REPLY, type SmokeStep } from "../lib/devSmoke";
import { runDevSmoke } from "./useDevSmoke";

const PROJECT = "/tmp/check/project";
const config = { projectPath: PROJECT, binDir: "/tmp/check/bin" };
const STEP = "a second dev server is flagged and the next turn names the first";

type Flaws = {
  /** No chip appears for the second server. */
  noChip?: boolean;
  /** The first chat shows the chip too. */
  chipInBoth?: boolean;
  /** The next turn is not told about the first server. */
  noNote?: boolean;
  /** Keep both leaves the chip on screen. */
  keepStays?: boolean;
};

/**
 * A stand-in workspace: chats in panes, servers the stand-in announces, the
 * chip a second server shows and the note the next turn would carry.
 */
function app(flaws: Flaws = {}) {
  let count = 0;
  const servers: { id: string; port: number }[] = [];
  let kept = false;
  const state = {
    sessions: [] as Session[],
    floatingSidebarLabel: null,
    expectFloatingSidebar: false,
    sidebarOpen: true,
    sharedWork: true,
    newProjectTask: vi.fn((path: string) => {
      count += 1;
      state.sessions = [
        ...state.sessions,
        {
          id: `${count}`,
          harness: "claude",
          cwd: path,
          title: `claude · Chat ${count}`,
          busy: false,
          blocks: [],
        } as unknown as Session,
      ];
      draw();
    }),
    submit: vi.fn((id: string, text: string) => {
      update(id, { busy: true });
      const port = /AVEN_SMOKE_DEV_SERVER (\d+)/.exec(text);
      setTimeout(() => {
        if (port) servers.push({ id, port: Number(port[1]) });
        const [first, second] = servers;
        const note =
          text.includes("AVEN_SMOKE_ECHO_NOTE") && !flaws.noNote && second
            ? ` NOTE[Dev servers running: http://localhost:${second.port}/ (started by you); http://localhost:${first.port}/ (started by Claude in “Chat 1”). | You started a second dev server on :${second.port} while :${first.port} (started by Claude in “Chat 1”) was already running for the same app.]`
            : text.includes("AVEN_SMOKE_ECHO_NOTE")
              ? " NOTE[none]"
              : "";
        const session = state.sessions.find((entry) => entry.id === id)!;
        update(id, {
          busy: false,
          blocks: [
            ...session.blocks,
            {
              id: `r${session.blocks.length}`,
              role: "assistant",
              text: `${SMOKE_REPLY}${note}`,
            },
          ],
        });
      }, 0);
    }),
  };
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
    draw();
  }
  function chip(port: number, original: number) {
    const element = document.createElement("div");
    element.className = "duplicate-server-chip";
    element.dataset.duplicateServer = `${port}`;
    element.append(
      `Claude started a second dev server on :${port} while :${original} is running`,
    );
    for (const label of ["Ask Claude to stop it", "Keep both"]) {
      const button = document.createElement("button");
      button.textContent = label;
      if (label === "Keep both")
        button.addEventListener("click", () => {
          kept = !flaws.keepStays;
          draw();
        });
      element.append(button);
    }
    return element;
  }
  function draw() {
    document.body.replaceChildren();
    const [first, second] = servers;
    for (const session of state.sessions) {
      const pane = document.createElement("div");
      pane.dataset.sessionDrop = session.id;
      const flagged =
        second &&
        !kept &&
        !flaws.noChip &&
        (session.id === second.id ||
          (flaws.chipInBoth && session.id === first.id));
      if (flagged) pane.append(chip(second.port, first.port));
      document.body.append(pane);
    }
  }
  return state;
}

async function run(flaws: Flaws = {}): Promise<SmokeStep | undefined> {
  mocks.resolveClaudeBinary.mockResolvedValue({
    path: "/tmp/check/bin/claude",
  });
  const state = app(flaws);
  const done = runDevSmoke(config, () => state);
  await vi.runAllTimersAsync();
  await done;
  const steps = (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0];
  return steps.find((step) => step.name === STEP);
}

describe("the real-app check's second dev server", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.finish.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("passes when the chip shows, the note names the first server and Keep both clears it", async () => {
    expect(await run()).toEqual({
      name: STEP,
      passed: true,
      detail: ":5200 flagged beside :5199; the next turn named :5199",
    });
  });

  it.each<[Flaws, string]>([
    [{ noChip: true }, "Timed out waiting for the second-server chip"],
    [{ chipInBoth: true }, "The first chat shows the chip too"],
    [{ noNote: true }, "The second chat's next turn was told"],
    [{ keepStays: true }, "Timed out waiting for the chip to go"],
  ])("fails when %o", async (flaws, detail) => {
    const step = await run(flaws);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toContain(detail);
  });
});
