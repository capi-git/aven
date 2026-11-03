// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREWS_KEY,
  CREW_ROLE_INFO,
  CREW_ROLE_ORDER,
  cardInCopy,
  cardSteppedAside,
  cardResearcher,
  crewAgentsFor,
  crewMembers,
  crewRoleUsesBrowser,
  crewRoleUsesWeb,
  getCrew,
  newCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
  type Crew,
  type CrewCard,
} from "./crews";
import { crewMemberSigil } from "./dotSigils";
import { crewMemberTone } from "./markTones";
import { queueCard, startCard } from "./crewLoop";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PROJECT = "/Users/me/aven-site";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});

describe("the Researcher role", () => {
  it("is a reader listed after the Scout, in its own mark and colour", () => {
    expect(CREW_ROLE_INFO.researcher).toEqual({
      role: "researcher",
      label: "Researcher",
      job: "Reads up on a question and writes findings you can turn into ideas",
      edits: false,
    });
    expect(CREW_ROLE_ORDER).toEqual([
      "builder",
      "checker",
      "security",
      "scout",
      "researcher",
      "fixer",
    ]);
    // A reader may run on Claude or Codex, locked down.
    expect(crewAgentsFor("researcher")).toEqual(["claude", "codex"]);
    expect(crewMemberSigil("researcher").key).toBe("researcher");
    expect(crewMemberTone("researcher")).toBe("orange");
  });

  it("reads the web whenever Builders may, and has the browser exactly then", () => {
    const access = (web: "none" | "builders" | "everyone") => ({
      access: { web },
    });
    expect(crewRoleUsesWeb(access("none"), "researcher")).toBe(false);
    expect(crewRoleUsesWeb(access("builders"), "researcher")).toBe(true);
    expect(crewRoleUsesWeb(access("everyone"), "researcher")).toBe(true);
    expect(crewRoleUsesBrowser(access("none"), "researcher")).toBe(false);
    expect(crewRoleUsesBrowser(access("builders"), "researcher")).toBe(true);
    expect(crewRoleUsesBrowser(access("everyone"), "researcher")).toBe(true);
    // The Scout and Checker keep their rules.
    expect(crewRoleUsesWeb(access("builders"), "scout")).toBe(false);
    expect(crewRoleUsesWeb(access("builders"), "checker")).toBe(false);
    expect(crewRoleUsesBrowser(access("builders"), "scout")).toBe(false);
  });

  it("lists members in role order, and keeps one Researcher", () => {
    const crew: Crew = {
      ...newCrew(PROJECT, 1),
      members: [
        { id: "researcher", role: "researcher" },
        { id: "builder", role: "builder" },
      ],
    };
    expect(crewMembers(crew).map((member) => member.role)).toEqual([
      "builder",
      "researcher",
    ]);
    expect(cardResearcher(crew)?.id).toBe("researcher");
    expect(
      cardResearcher({
        members: [{ id: "researcher", role: "researcher", paused: true }],
      }),
    ).toBeUndefined();
    const read = readCrew({
      path: PROJECT,
      members: [
        { id: "r1", role: "researcher" },
        { id: "r2", role: "researcher" },
      ],
    })!;
    expect(read.members.map((member) => member.id)).toEqual(["r1"]);
  });

  it("reads a research card with its findings back from storage, nothing trusted", () => {
    const card = readCrew({
      path: PROJECT,
      cards: [
        {
          id: "q",
          title: "How do others debounce search?",
          brief: "q",
          from: "you",
          kind: "research",
          stage: "ready",
          round: 1,
          maxRounds: 1,
          holder: "researcher",
          rounds: [{ n: 1 }],
          later: [],
          runs: 1,
          queuedAt: 1,
          updatedAt: 2,
          turn: {
            role: "researcher",
            sessionId: "r-chat",
            turnId: "t1",
            sentAt: 1,
          },
          findings: {
            summary: "About 200 ms.",
            findings: [
              { text: "React suggests useDeferredValue", source: "https://x" },
              { text: 42 },
              { text: "No source" },
            ],
            ideas: ["Debounce it", 7, ""],
            sources: 3,
            readAt: 2,
            added: 1,
          },
        },
        {
          id: "bad",
          title: "No findings time",
          brief: "x",
          from: "you",
          kind: "research",
          stage: "ready",
          round: 1,
          maxRounds: 1,
          rounds: [],
          later: [],
          runs: 1,
          queuedAt: 1,
          updatedAt: 2,
          findings: { summary: "s", findings: [], ideas: [] },
        },
      ],
      ideas: {
        q1: { at: 3, size: "medium", by: "researcher", outside: true },
        q2: { at: 3, size: "medium", by: "keeper" },
      },
    })!;
    expect(card.cards[0]).toMatchObject({
      kind: "research",
      holder: "researcher",
      turn: { role: "researcher" },
      findings: {
        summary: "About 200 ms.",
        findings: [
          { text: "React suggests useDeferredValue", source: "https://x" },
          { text: "No source" },
        ],
        ideas: ["Debounce it"],
        sources: 3,
        readAt: 2,
        added: 1,
      },
    });
    expect(card.cards[1]!.findings).toBeUndefined();
    expect(card.cards[1]!.kind).toBe("research");
    expect(card.ideas).toEqual({
      q1: { at: 3, size: "medium", by: "researcher", outside: true },
      q2: { at: 3, size: "medium" },
    });
  });

  it("keeps a Researcher through a save, beside members of roles it doesn't know", () => {
    localStorage.setItem(
      CREWS_KEY,
      JSON.stringify({
        version: 1,
        crews: {
          [PROJECT]: {
            path: PROJECT,
            members: [
              { id: "builder", role: "builder" },
              { id: "researcher", role: "researcher" },
              { role: "keeper", name: "Hedgehog" },
            ],
          },
        },
      }),
    );
    resetCrewsCache();
    expect(getCrew(PROJECT)!.members.map((member) => member.role)).toEqual([
      "builder",
      "researcher",
    ]);
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(Object.values(saved.crews)[0]).toMatchObject({
      members: [
        { id: "builder", role: "builder" },
        { id: "researcher", role: "researcher" },
        { role: "keeper", name: "Hedgehog" },
      ],
    });
  });

  it("holds the copy while reading, and frees it once its findings wait for you", () => {
    const question = queueCard(
      {
        id: "q",
        title: "Q",
        brief: "q",
        from: "you",
        kind: "research",
        maxRounds: 3,
      },
      1,
    );
    expect(question.maxRounds).toBe(1);
    const reading = startCard(question, 2);
    expect(reading.holder).toBe("researcher");
    expect(cardInCopy({ cards: [reading] })?.id).toBe("q");
    expect(
      cardInCopy({
        cards: [{ ...reading, stage: "ready", holder: undefined }],
      }),
    ).toBeUndefined();
    // Stopped without changing a file (no findings, failed, timed out,
    // stopped): nothing of its own is in the copy, so it steps aside and
    // the team goes on. Only a turn that changed files holds the copy.
    const stuck = (reason: NonNullable<CrewCard["stuck"]>["reason"]) => ({
      ...reading,
      stage: "stuck" as const,
      turn: undefined,
      stuck: { reason, text: "x" },
    });
    for (const reason of [
      "no-verdict",
      "failed",
      "timeout",
      "stopped",
    ] as const) {
      expect(cardSteppedAside(stuck(reason)), reason).toBe(true);
      expect(cardInCopy({ cards: [stuck(reason)] }), reason).toBeUndefined();
    }
    expect(cardSteppedAside(stuck("checker-edited"))).toBe(false);
    expect(cardInCopy({ cards: [stuck("checker-edited")] })?.id).toBe("q");
    // Not while its turn still runs.
    expect(
      cardSteppedAside({
        ...stuck("failed"),
        turn: { role: "researcher", sessionId: "r", turnId: "t", sentAt: 2 },
      }),
    ).toBe(false);
  });
});
