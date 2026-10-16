// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscussionStartRequest } from "../lib/discussions";
import type { Block, Session } from "../lib/session";

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
const STEP = "two chats discuss for two rounds, linked in the sidebar";
const ROUNDS = 2;

type Flaws = {
  /** The chat's + menu has no Discuss with… (the host never reached it). */
  noEntry?: boolean;
  /** The picker's start refuses with this reason. */
  refuse?: string;
  /** The second chat is sent the first chat's reply twice. */
  relayTwice?: boolean;
  /** The sidebar marks both rows but draws no connector. */
  noLink?: boolean;
  /** The connector's pulse does not move. */
  stillPulse?: boolean;
  /** The pulse travels away from the chat that is answering. */
  wrongWay?: boolean;
  /** The relayed message has no relay card. */
  noCard?: boolean;
  /** The connector stays after the discussion ended. */
  keepsLink?: boolean;
};

const ROW_TOP = 100;
const ROW_STEP = 40;
const ROW_HEIGHT = 30;

/**
 * A stand-in for the workspace with a discussion broker: chats, the sidebar
 * rows and connector, the bar above the message box and relayed messages,
 * drawn from the state the check drives.
 */
function app(flaws: Flaws = {}) {
  let focused = "";
  let count = 0;
  let talk: {
    a: string;
    b: string;
    topic: string;
    turn: number;
  } | null = null;
  let ended = false;
  let plusOpen = false;
  const session = (id: string) =>
    state.sessions.find((entry) => entry.id === id)!;
  const title = (id: string) => `Chat ${id}`;
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
          title: `claude · ${title(id)}`,
          busy: false,
          blocks: [],
        } as unknown as Session,
      ];
      focused = id;
      draw();
    }),
    submit: vi.fn((id: string) => {
      update(id, { busy: true });
      setTimeout(() => {
        update(id, {
          busy: false,
          blocks: [
            ...session(id).blocks,
            { id: `r${id}`, role: "assistant", text: SMOKE_REPLY },
          ],
        });
      }, 0);
    }),
    discussion: {
      options: () => ({ candidates: [] }),
      start: vi.fn((request: DiscussionStartRequest) => {
        if (flaws.refuse) return flaws.refuse;
        if (request.partner.kind !== "chat") return "Expected a chat";
        talk = {
          a: request.sessionId,
          b: request.partner.sessionId,
          topic: request.topic,
          turn: 0,
        };
        relay(0);
        return null;
      }),
    },
  };
  function update(id: string, patch: Partial<Session>) {
    state.sessions = state.sessions.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
    draw();
  }
  function relay(turn: number) {
    if (!talk) return;
    const { a, b, topic } = talk;
    talk.turn = turn;
    const target = turn % 2 === 0 ? a : b;
    const partner = turn % 2 === 0 ? b : a;
    const message: Omit<Block, "id"> = {
      role: "user",
      text: turn === 0 ? topic : SMOKE_REPLY,
      startedAt: turn,
      discussion: {
        id: "d1",
        turn,
        rounds: ROUNDS,
        partner: {
          harness: "claude",
          model: "Sonnet",
          title: title(partner),
        },
      },
    };
    const copies = flaws.relayTwice && turn === 1 ? 2 : 1;
    update(target, {
      busy: true,
      blocks: [
        ...session(target).blocks,
        ...Array.from({ length: copies }, (_, index) => ({
          ...message,
          id: `relay-${turn}-${index}`,
        })),
      ],
    });
    const hold = turn < 2 ? /AVEN_SMOKE_HOLD (\d+)/.exec(topic) : null;
    setTimeout(
      () => {
        update(target, {
          busy: false,
          blocks: [
            ...session(target).blocks,
            { id: `reply-${turn}`, role: "assistant", text: SMOKE_REPLY },
          ],
        });
        if (turn + 1 < ROUNDS * 2) {
          relay(turn + 1);
          return;
        }
        ended = true;
        for (const id of [a, b])
          update(id, {
            blocks: [
              ...session(id).blocks,
              {
                id: `note-${id}`,
                role: "system",
                text: `Discussion ended after ${ROUNDS} rounds.`,
              },
            ],
          });
      },
      hold ? Number(hold[1]) : 0,
    );
  }
  function draw() {
    const active = talk && (!ended || flaws.keepsLink) ? talk : null;
    // Chats appear in the sidebar once they have a message, as in history.
    const listed = state.sessions.filter((entry) => entry.blocks.length > 0);
    const top = (id: string) =>
      ROW_TOP + ROW_STEP * listed.findIndex((entry) => entry.id === id);
    const talking = (id: string) =>
      !!active && (id === active.a || id === active.b);
    const linked =
      !!active &&
      !flaws.noLink &&
      listed.some((entry) => entry.id === active.a) &&
      listed.some((entry) => entry.id === active.b);
    const rows = listed
      .map(
        (entry) =>
          `<button class="personal-task-card" data-top="${top(entry.id)}" data-height="${ROW_HEIGHT}"${
            talking(entry.id) ? ` data-discussion-row="${entry.id}"` : ""
          }>${title(entry.id)}${
            talking(entry.id) && !linked
              ? `<span class="discussion-talk-badge">↔ talking with</span>`
              : ""
          }</button>`,
      )
      .join("");
    let link = "";
    if (active && linked) {
      const centres = [active.a, active.b].map(
        (id) => top(id) + ROW_HEIGHT / 2,
      );
      const answering = active.turn % 2 === 0 ? centres[0] : centres[1];
      let toward = answering > Math.min(...centres) ? "down" : "up";
      if (flaws.wrongWay) toward = toward === "down" ? "up" : "down";
      link = `<div class="discussion-links"><span class="discussion-link" data-discussion-link="d1" data-toward="${toward}" data-top="${Math.min(...centres)}" data-height="${Math.abs(centres[0] - centres[1])}"><span class="discussion-link-track"><span class="discussion-link-pulse" style="animation-name: ${
        flaws.stillPulse ? "none" : `discussion-link-${toward}`
      }"></span></span></span></div>`;
    }
    const cards = flaws.noCard
      ? ""
      : (state.sessions.find((entry) => entry.id === focused)?.blocks ?? [])
          .filter((block) => block.discussion)
          .map(
            (block) =>
              `<div data-discussion-relay="${block.discussion!.id}"></div>`,
          )
          .join("");
    const bar = active
      ? `<div data-discussion-bar="d1">Discussing with Sonnet in “Chat” round ${
          Math.floor(active.turn / 2) + 1
        } of ${ROUNDS} Stop</div>`
      : "";
    const menu = plusOpen
      ? `<div data-composer-plus><button>Upload file</button>${
          flaws.noEntry
            ? ""
            : "<button data-composer-discuss>Discuss with…</button>"
        }</div>`
      : "";
    document.body.innerHTML = `
      <aside class="personal-navigation">${link}${rows}</aside>
      <div class="personal-workspace-content">
        <div data-session-drop="${focused}">${cards}
          <div data-composer>${bar}<textarea style="visibility: visible"></textarea><button aria-label="Add files or choose a mode"></button></div>
        </div>
      </div>${menu}`;
    document
      .querySelector('[aria-label="Add files or choose a mode"]')
      ?.addEventListener("click", () => {
        plusOpen = !plusOpen;
        draw();
      });
  }
  draw();
  return state;
}

function rect(element: Element): DOMRect {
  const top = Number((element as HTMLElement).dataset?.top ?? 0);
  const height = Number((element as HTMLElement).dataset?.height ?? 0);
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

async function check(
  flaws?: Flaws,
  extra: { noHost?: boolean } = {},
): Promise<{ steps: SmokeStep[]; state: ReturnType<typeof app> }> {
  const state = app(flaws);
  const options = extra.noHost ? { ...state, discussion: undefined } : state;
  const run = runDevSmoke(config, () => options);
  await vi.runAllTimersAsync();
  await run;
  return {
    steps: (mocks.finish.mock.calls.at(-1) as unknown as [SmokeStep[]])[0],
    state,
  };
}

const discussionStep = (steps: SmokeStep[]) =>
  steps.find((step) => step.name === STEP);

describe("the real-app check's discussion step", () => {
  let reducedMotion = false;
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    mocks.finish.mockClear();
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/tmp/check/bin/claude",
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return rect(this);
      },
    );
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return [rect(this)] as unknown as DOMRectList;
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: reducedMotion && query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("passes when the chats are linked, each reply is relayed once and it ends", async () => {
    const { steps, state } = await check();
    expect(steps.map((step) => [step.name, step.passed])).toEqual([
      ["stand-in provider is the one Aven found", true],
      ["agent turn through the normal send path", true],
      [STEP, true],
    ]);
    expect(discussionStep(steps)?.detail).toBe(
      "4 replies relayed once each; linked with the pulse toward the answering chat; ended after 2 rounds",
    );
    expect(state.discussion.start).toHaveBeenCalledExactlyOnceWith({
      sessionId: "2",
      partner: { kind: "chat", sessionId: "3" },
      topic: "Compare notes. AVEN_SMOKE_HOLD 8000",
      rounds: 2,
    });
  });

  it("accepts a still pulse with reduced motion on", async () => {
    reducedMotion = true;
    const step = discussionStep((await check({ stillPulse: true })).steps);
    expect(step?.passed).toBe(true);
    expect(step?.detail).toContain("still (reduced motion)");
  });

  it("fails when a reply is relayed twice", async () => {
    const step = discussionStep((await check({ relayTwice: true })).steps);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toBe(
      "Relayed turns were 0,2 in the first chat and 1,1,3 in the second, not 0,2 and 1,3",
    );
  });

  it("fails when the sidebar does not link the two rows", async () => {
    const step = discussionStep((await check({ noLink: true })).steps);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toContain("no connector links the two rows");
  });

  it("fails when the pulse stands still or runs the wrong way", async () => {
    const still = discussionStep((await check({ stillPulse: true })).steps);
    expect(still?.passed).toBe(false);
    expect(still?.detail).toContain(
      "the pulse its animation is none, expected discussion-link-down",
    );
    mocks.finish.mockClear();
    const wrong = discussionStep((await check({ wrongWay: true })).steps);
    expect(wrong?.passed).toBe(false);
    expect(wrong?.detail).toContain(
      "the pulse travels up, not down toward the answering chat",
    );
  });

  it("fails when the relayed message has no relay card", async () => {
    const step = discussionStep((await check({ noCard: true })).steps);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toContain("the relay card on the relayed message");
  });

  it("fails when the connector stays after the end", async () => {
    const step = discussionStep((await check({ keepsLink: true })).steps);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toContain(
      "the connector and the bar to go once it ended",
    );
  });

  it("fails when the chat's + menu does not offer Discuss with…", async () => {
    const { steps, state } = await check({ noEntry: true });
    const step = discussionStep(steps);
    expect(step?.passed).toBe(false);
    expect(step?.detail).toBe("The + menu does not offer Discuss with…");
    expect(state.discussion.start).not.toHaveBeenCalled();
    expect(document.querySelector("[data-composer-plus]")).toBeNull();
  });

  it("fails with the reason when the discussion does not start", async () => {
    const step = discussionStep(
      (await check({ refuse: "This chat is busy with another turn." })).steps,
    );
    expect(step?.passed).toBe(false);
    expect(step?.detail).toBe(
      "The discussion did not start: This chat is busy with another turn.",
    );
  });

  it("is skipped without discussions, or when Claude is not the stand-in", async () => {
    expect(
      discussionStep((await check(undefined, { noHost: true })).steps),
    ).toBeUndefined();
    mocks.finish.mockClear();
    mocks.resolveClaudeBinary.mockResolvedValue({
      path: "/opt/homebrew/bin/claude",
    });
    const { steps, state } = await check();
    expect(discussionStep(steps)).toBeUndefined();
    expect(state.discussion.start).not.toHaveBeenCalled();
  });
});
