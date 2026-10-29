import { describe, expect, it } from "vitest";
import {
  afterBuild,
  afterCheck,
  changedAfterCheck,
  changedSinceLastRound,
  crewStageDetail,
  crewStageLabel,
  earlierFindings,
  markApplied,
  queueCard,
  resumeCard,
  startCard,
  stopCard,
  turnFailed,
  turnTimedOut,
} from "./crewLoop";
import type { CrewCard, CrewChange, CrewHandoff, CrewVerdict } from "./crews";

const names = { builder: "Beetle", checker: "Owl" };

function card(maxRounds = 3): CrewCard {
  return startCard(
    queueCard(
      {
        id: "card-1",
        title: "Dark mode toggle",
        brief: "Add a dark mode switch in Settings.",
        from: "you",
        maxRounds,
      },
      1_000,
    ),
    2_000,
  );
}

function change(hash: string, paths = ["src/theme.ts"]): CrewChange {
  return {
    base: "base-1",
    hash,
    files: paths.length,
    additions: 10,
    deletions: 2,
    paths: paths.map((path) => ({ path, additions: 5, deletions: 1 })),
  };
}

const handoff: CrewHandoff = {
  summary: "A switch in Settings and a theme store.",
  howToCheck: ["Open Settings", "Switch to Dark"],
  ran: [{ command: "npm test", ok: true, note: "48 passed" }],
};

function verdict(mustFix: string[], later: string[] = []): CrewVerdict {
  return {
    pass: !mustFix.length,
    summary: mustFix.length ? "Not yet." : "Looks right.",
    mustFix: mustFix.map((text) => ({ text })),
    later,
    ran: [{ command: "npm test", ok: true }],
  };
}

describe("the work → check → work loop", () => {
  it("queues a card, then gives round 1 to the Builder", () => {
    const queued = queueCard(
      { id: "x", title: "X", brief: "X", from: "you", maxRounds: 3 },
      5,
    );
    expect(queued).toMatchObject({ stage: "queued", round: 0 });
    expect(crewStageLabel(queued)).toBe("Queued");
    const started = startCard(queued, 6);
    expect(started).toMatchObject({
      stage: "building",
      round: 1,
      holder: "builder",
      startedAt: 6,
    });
    expect(crewStageLabel(started)).toBe("Building");
    expect(crewStageDetail(started)).toBe("round 1 of 3");
    expect(startCard(started, 7)).toBe(started);
  });

  it("passes, fails, then passes: Ready after round 2 with the round-2 change", () => {
    let step = afterBuild(card(), {
      handoff,
      change: change("h1"),
      now: 3_000,
      names,
    });
    expect(step.event).toEqual({ kind: "to-checker", round: 1 });
    expect(step.card).toMatchObject({ stage: "checking", holder: "checker" });

    step = afterCheck(step.card, {
      verdict: verdict([
        "Label contrast is 2.9:1",
        "Reload forgets the choice",
      ]),
      edited: false,
      now: 4_000,
      names,
    });
    expect(step.event).toEqual({ kind: "to-builder", round: 2, mustFix: 2 });
    expect(step.card).toMatchObject({
      stage: "building",
      holder: "builder",
      round: 2,
    });
    expect(crewStageLabel(step.card)).toBe("Fixing");
    expect(crewStageDetail(step.card)).toBe("round 2 of 3");

    step = afterBuild(step.card, {
      handoff,
      change: change("h2"),
      now: 5_000,
      names,
    });
    expect(step.card.stage).toBe("checking");
    step = afterCheck(step.card, {
      verdict: verdict([]),
      edited: false,
      now: 6_000,
      names,
    });
    expect(step.event).toEqual({ kind: "ready", round: 2 });
    expect(step.card).toMatchObject({
      stage: "ready",
      round: 2,
      endedAt: 6_000,
    });
    expect(step.card.fix?.hash).toBe("h2");
    expect(crewStageDetail(step.card)).toBe("passed in round 2");
    expect(markApplied(step.card, 7_000).stage).toBe("applied");
  });

  it("stops Stuck after the last round, never going round 4", () => {
    let current = card(3);
    for (let round = 1; round <= 3; round += 1) {
      const built = afterBuild(current, {
        handoff,
        change: change(`h${round}`),
        now: round * 10,
        names,
      });
      const checked = afterCheck(built.card, {
        verdict: verdict(["Search still takes 1.8 s"]),
        edited: false,
        now: round * 10 + 5,
        names,
      });
      current = checked.card;
      if (round < 3) expect(checked.event.kind).toBe("to-builder");
      else
        expect(checked.event).toEqual({
          kind: "stuck",
          reason: "rounds",
          text: "Stuck after 3 rounds",
        });
    }
    expect(current).toMatchObject({ stage: "stuck", round: 3 });
    expect(current.stuck?.reason).toBe("rounds");
    expect(crewStageLabel(current)).toBe("Needs you");
  });

  it("stops early when round 1 changes nothing", () => {
    const step = afterBuild(card(), {
      handoff,
      change: null,
      now: 10,
      names,
    });
    expect(step.card.stage).toBe("stuck");
    expect(step.card.stuck).toEqual({
      reason: "no-change",
      text: "Beetle changed nothing",
    });
  });

  it("stops early when a fixing round leaves the change as it was", () => {
    const built = afterBuild(card(), {
      handoff,
      change: change("same"),
      now: 10,
      names,
    });
    const back = afterCheck(built.card, {
      verdict: verdict(["Broken on reload"]),
      edited: false,
      now: 20,
      names,
    });
    const again = afterBuild(back.card, {
      handoff,
      change: change("same"),
      now: 30,
      names,
    });
    expect(again.event).toEqual({
      kind: "stuck",
      reason: "no-change",
      text: "Stopped early: round 2 changed nothing Owl asked for",
    });
  });

  it("waits on you when the Builder asks a question, and goes on in the same round", () => {
    const step = afterBuild(card(), {
      handoff: {
        ...handoff,
        question: "Should the PDF keep each note's colour?",
      },
      change: change("h1"),
      now: 10,
      names,
    });
    expect(step.event).toEqual({
      kind: "question",
      text: "Beetle asked: Should the PDF keep each note's colour?",
    });
    expect(step.card).toMatchObject({ stage: "stuck", holder: "builder" });
    const answered = resumeCard(step.card, { note: "Yes, keep it.", now: 20 });
    expect(answered).toMatchObject({
      stage: "building",
      round: 1,
      holder: "builder",
      note: "Yes, keep it.",
    });
  });

  it("sends a card back only for must-fix items; notes for later ride along", () => {
    const built = afterBuild(card(), {
      handoff,
      change: change("h1"),
      now: 10,
      names,
    });
    const passed = afterCheck(built.card, {
      verdict: verdict([], ["Follow the system setting until someone picks"]),
      edited: false,
      now: 20,
      names,
    });
    expect(passed.card.stage).toBe("ready");
    expect(passed.card.later).toEqual([
      "Follow the system setting until someone picks",
    ]);
    const failed = afterCheck(built.card, {
      verdict: verdict(["Crashes on load"], ["Rename the helper"]),
      edited: false,
      now: 20,
      names,
    });
    expect(failed.card.stage).toBe("building");
    expect(failed.card.later).toEqual(["Rename the helper"]);
  });

  it("voids a check that changed files, and one that ended without a verdict", () => {
    const built = afterBuild(card(), {
      handoff,
      change: change("h1"),
      now: 10,
      names,
    }).card;
    expect(
      afterCheck(built, { verdict: verdict([]), edited: true, now: 20, names })
        .card.stuck?.reason,
    ).toBe("checker-edited");
    expect(
      afterCheck(built, { verdict: null, edited: false, now: 20, names }).card
        .stuck,
    ).toEqual({
      reason: "no-verdict",
      text: "Owl's check ended without a verdict",
    });
  });

  it("gives a card past its rounds exactly one more when you ask", () => {
    let current = card(1);
    current = afterBuild(current, {
      handoff,
      change: change("h1"),
      now: 1,
      names,
    }).card;
    current = afterCheck(current, {
      verdict: verdict(["Still slow"]),
      edited: false,
      now: 2,
      names,
    }).card;
    expect(current.stuck?.reason).toBe("rounds");
    const more = resumeCard(current, { note: "Try an index.", now: 3 });
    expect(more).toMatchObject({
      stage: "building",
      round: 2,
      maxRounds: 2,
      note: "Try an index.",
    });
  });

  it("stops a turn you stop, a failed one and one past the time limit", () => {
    const building = card();
    expect(stopCard(building, 5).stuck).toEqual({
      reason: "stopped",
      text: "You stopped it",
    });
    expect(
      turnFailed(building, {
        role: "builder",
        error: "No network",
        now: 5,
        name: "Beetle",
      }).card.stuck?.text,
    ).toBe("Beetle's turn didn't finish: No network");
    expect(
      turnTimedOut(building, {
        role: "checker",
        minutes: 20,
        now: 5,
        name: "Owl",
      }).card.stuck?.text,
    ).toBe("Owl's turn ran past 20 minutes and was stopped");
    // A stopped turn runs again in the same round.
    const again = resumeCard(stopCard(building, 5), { now: 6 });
    expect(again).toMatchObject({ stage: "building", round: 1 });
  });
});

describe("the re-check's scope", () => {
  it("names the earlier must-fix items and the files changed since", () => {
    let current = afterBuild(card(), {
      handoff,
      change: change("h1", ["src/theme.ts", "src/Toggle.css"]),
      now: 1,
      names,
    }).card;
    current = afterCheck(current, {
      verdict: verdict(["Contrast", "Reload"]),
      edited: false,
      now: 2,
      names,
    }).card;
    expect(earlierFindings(current).map((item) => item.text)).toEqual([
      "Contrast",
      "Reload",
    ]);
    current = afterBuild(current, {
      handoff,
      change: {
        ...change("h2", ["src/theme.ts"]),
        paths: [{ path: "src/theme.ts", additions: 9, deletions: 1 }],
      },
      now: 3,
      names,
    }).card;
    // theme.ts grew; Toggle.css is gone from the change.
    expect(changedSinceLastRound(current)).toEqual([
      "src/theme.ts",
      "src/Toggle.css",
    ]);
  });
});

describe("a Ready change that moved after its check", () => {
  it("is never Ready again without another check", () => {
    const built = afterBuild(card(), {
      handoff,
      change: change("h1"),
      now: 1,
      names,
    });
    const ready = afterCheck(built.card, {
      verdict: verdict([]),
      edited: false,
      // What the Checker saw becomes the fix.
      seen: change("seen-by-owl"),
      now: 2,
      names,
    }).card;
    expect(ready.fix?.hash).toBe("seen-by-owl");
    const moved = changedAfterCheck(ready, { now: 3, checker: "Owl" });
    expect(moved).toMatchObject({ stage: "stuck", holder: "checker" });
    expect(moved.fix).toBeUndefined();
    expect(moved.stuck?.text).toBe(
      "The change moved after Owl's check, so it wasn't applied",
    );
    // One more round checks it again, in the same round.
    expect(resumeCard(moved, { now: 4 })).toMatchObject({
      stage: "checking",
      holder: "checker",
      round: 1,
    });
  });
});
