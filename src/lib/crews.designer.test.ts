// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCKUP_FENCE, parseMockup } from "./crewHandoff";
import { afterMockup, markMockupDone, queueCard, startCard } from "./crewLoop";
import {
  CREW_ROLE_INFO,
  MOCKUP_DIR,
  cardDesigner,
  cardInCopy,
  cardSteppedAside,
  crewAgentsFor,
  crewRoleUsesBrowser,
  crewRoleUsesWeb,
  crewRoleWritesCopy,
  readCrew,
  resetCrewsCache,
  type CrewCard,
} from "./crews";
import { crewMemberSigil } from "./dotSigils";
import { crewMemberTone } from "./markTones";

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

const mockupCard = (): CrewCard =>
  startCard(
    queueCard(
      {
        id: "m",
        title: "Timer: a ring that fills",
        brief: "m",
        from: "you",
        kind: "mockup",
        maxRounds: 3,
      },
      1,
    ),
    2,
  );

describe("the Designer role", () => {
  it("writes one file, so it runs on Claude Code, and never reads the web or the browser", () => {
    expect(CREW_ROLE_INFO.designer).toEqual({
      role: "designer",
      label: "Designer",
      job: "Mocks up a screen or a look before anyone builds it",
      edits: true,
    });
    expect(crewAgentsFor("designer")).toEqual(["claude"]);
    expect(crewRoleWritesCopy("designer")).toBe(false);
    expect(crewRoleWritesCopy("builder")).toBe(true);
    for (const web of ["none", "builders", "everyone"] as const) {
      expect(crewRoleUsesWeb({ access: { web } }, "designer")).toBe(false);
      expect(crewRoleUsesBrowser({ access: { web } }, "designer")).toBe(false);
    }
    expect(crewMemberSigil("designer").key).toBe("designer");
    expect(crewMemberTone("designer")).toBe("pink");
    expect(MOCKUP_DIR).toBe("aven-mockups");
  });

  it("keeps one Designer, and reads a mock-up card with its mock-up back", () => {
    const read = readCrew({
      path: PROJECT,
      members: [
        { id: "d1", role: "designer" },
        { id: "d2", role: "designer" },
      ],
      cards: [
        {
          id: "m",
          title: "Timer",
          brief: "m",
          from: "you",
          kind: "mockup",
          stage: "applied",
          round: 1,
          maxRounds: 1,
          holder: "designer",
          rounds: [],
          later: [],
          runs: 1,
          queuedAt: 1,
          updatedAt: 2,
          turn: { role: "designer", sessionId: "d", turnId: "t", sentAt: 1 },
          mockup: {
            file: "/data/bots/mockups/copy/m.html",
            note: "A ring that fills",
            bytes: 1200,
            madeAt: 2,
            outcome: "built",
          },
        },
        {
          id: "bad",
          title: "x",
          brief: "x",
          from: "you",
          kind: "mockup",
          stage: "ready",
          round: 1,
          maxRounds: 1,
          rounds: [],
          later: [],
          runs: 1,
          queuedAt: 1,
          updatedAt: 2,
          mockup: { file: "", note: "x", bytes: 1, madeAt: 2 },
        },
      ],
    })!;
    expect(read.members.map((member) => member.id)).toEqual(["d1"]);
    expect(cardDesigner(read)?.id).toBe("d1");
    expect(read.cards[0]).toMatchObject({
      kind: "mockup",
      holder: "designer",
      turn: { role: "designer" },
      mockup: {
        file: "/data/bots/mockups/copy/m.html",
        note: "A ring that fills",
        bytes: 1200,
        madeAt: 2,
        outcome: "built",
      },
    });
    expect(read.cards[1]!.mockup).toBeUndefined();
  });

  it("holds the copy while mocking up, frees it when the mock-up waits, and steps aside when stopped", () => {
    const reading = mockupCard();
    expect(reading.holder).toBe("designer");
    expect(reading.maxRounds).toBe(1);
    expect(cardInCopy({ cards: [reading] })?.id).toBe("m");
    const ready = afterMockup(reading, {
      mockup: { file: "/data/m.html", note: "n", bytes: 10 },
      now: 3,
    }).card;
    expect(ready).toMatchObject({
      stage: "ready",
      mockup: { file: "/data/m.html", note: "n", bytes: 10, madeAt: 3 },
    });
    expect(cardInCopy({ cards: [ready] })).toBeUndefined();
    expect(markMockupDone(ready, 4, "dismissed")).toMatchObject({
      stage: "applied",
      mockup: { outcome: "dismissed" },
    });
    const strayed = afterMockup(reading, {
      mockup: null,
      strayed: true,
      problem: "src/app.ts",
      now: 3,
      name: "Brush",
    }).card;
    expect(strayed.stuck).toEqual({
      reason: "checker-edited",
      text: "Brush wrote outside aven-mockups, so its mock-up wasn't kept: src/app.ts",
    });
    expect(cardSteppedAside(strayed)).toBe(false);
    const nothing = afterMockup(reading, {
      mockup: null,
      now: 3,
      name: "Brush",
    }).card;
    expect(nothing.stuck?.text).toBe("Brush's turn ended without a mock-up");
    expect(cardSteppedAside(nothing)).toBe(true);
    expect(cardInCopy({ cards: [nothing] })).toBeUndefined();
  });

  it("reads the Designer's block: the file and a note", () => {
    const text = `Drawn.\n\n\`\`\`${MOCKUP_FENCE}\n${JSON.stringify({
      file: "./aven-mockups/m.html",
      note: "A ring that fills, with the end state",
    })}\n\`\`\``;
    expect(parseMockup(text)).toEqual({
      file: "aven-mockups/m.html",
      note: "A ring that fills, with the end state",
    });
    expect(parseMockup("Drawn.")).toBeNull();
    expect(
      parseMockup(
        `\`\`\`${MOCKUP_FENCE}\n${JSON.stringify({ note: "x" })}\n\`\`\``,
      ),
    ).toBeNull();
  });
});
