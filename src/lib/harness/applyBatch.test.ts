import { describe, expect, it } from "vitest";
import { newSession, type Session } from "../session";
import { applyHarnessEvent, applyHarnessEvents } from "./apply";
import type { HarnessEvent } from "./types";

function content(session: Session) {
  return {
    ...session,
    blocks: session.blocks.map(({ id: _id, ...block }) => block),
  };
}

function conversation(): Session {
  return {
    ...newSession("codex", "/repo"),
    blocks: [
      { id: "user", role: "user", text: "Help" },
      { id: "reply", role: "assistant", text: "Hello", streaming: true },
    ],
  };
}

function oneByOne(session: Session, events: readonly HarnessEvent[]) {
  return events.reduce(applyHarnessEvent, session);
}

describe("batched harness events", () => {
  it("preserves mixed snapshots, repeated tokens, whitespace and message boundaries", () => {
    const events: HarnessEvent[] = [
      { type: "message.delta", text: " " },
      { type: "message.delta", text: "Hello world" },
      { type: "message.delta", text: "Hello world" },
      { type: "message.delta", text: "\n" },
      { type: "message.delta", text: "\n" },
      { type: "status", text: "Working" },
      { type: "message.delta", text: "Next paragraph" },
      { type: "message.delta", text: "." },
      { type: "message.completed" },
      { type: "message.delta", text: "New message" },
      { type: "message.delta", text: "!" },
      { type: "reasoning.delta", text: "" },
      { type: "reasoning.delta", text: "Think" },
      { type: "reasoning.delta", text: "Think carefully" },
      { type: "reasoning.completed" },
      { type: "tool.started", callId: "read", title: "Read" },
      {
        type: "approval.requested",
        callId: "read",
        requestId: 1,
        title: "Read",
      },
      { type: "approval.resolved", requestId: 1, decision: "allow" },
      { type: "tool.updated", callId: "read", status: "completed" },
      { type: "message.delta", text: "Done" },
      { type: "message.delta", text: "." },
    ];
    const session = conversation();
    expect(content(applyHarnessEvents(session, events))).toEqual(
      content(oneByOne(session, events)),
    );
    expect(session.blocks[1].text).toBe("Hello");
  });

  it("keeps keyed messages apart and appends keyed tokens verbatim", () => {
    const events: HarnessEvent[] = [
      { type: "message.delta", key: "m1", text: "abc" },
      { type: "message.delta", key: "m1", text: "abc" },
      { type: "message.delta", key: "m2", text: "Second" },
      { type: "message.delta", key: "m1", text: " late" },
      { type: "message.delta", key: "m2", text: " message" },
      { type: "message.completed", key: "m1" },
      { type: "message.delta", text: "" },
      { type: "message.delta", text: "Unkeyed" },
      { type: "message.delta", key: "m2", text: "!" },
    ];
    const session = conversation();
    const batched = applyHarnessEvents(session, events);
    expect(content(batched)).toEqual(content(oneByOne(session, events)));
    expect(
      batched.blocks
        .filter((block) => block.messageKey)
        .map((block) => block.text),
    ).toEqual(["abcabc late", "Second messageUnkeyed!"]);
  });

  it("does not treat combined token fragments as a snapshot of existing text", () => {
    const session = conversation();
    session.blocks[1].text = "abc";
    const events: HarnessEvent[] = [
      { type: "message.delta", text: "a" },
      { type: "message.delta", text: "bc" },
    ];
    expect(applyHarnessEvents(session, events).blocks[1].text).toBe("abcabc");
    expect(oneByOne(session, events).blocks[1].text).toBe("abcabc");
  });

  it("retains identity for empty batches, empty reasoning and repeated snapshots", () => {
    const session = conversation();
    expect(applyHarnessEvents(session, [])).toBe(session);
    expect(
      applyHarnessEvents(session, [
        { type: "reasoning.delta", text: "" },
        { type: "reasoning.delta", text: "" },
      ]),
    ).toBe(session);
    expect(
      applyHarnessEvents(session, [
        { type: "message.delta", text: "Hello" },
        { type: "message.delta", text: "Hello" },
      ]),
    ).toBe(session);
  });

  it("matches per-event application for random token, snapshot and boundary streams", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(random() * items.length)];
    const fragments = ["", " ", "\n", "a", "ab", "abc", "Hello", "Hello world"];
    for (let run = 0; run < 200; run++) {
      const events: HarnessEvent[] = [];
      for (let index = 0; index < 40; index++) {
        const roll = random();
        if (roll < 0.45) {
          const key = pick([undefined, undefined, "m1", "m2"]);
          events.push({
            type: "message.delta",
            text: pick(fragments),
            ...(key ? { key } : {}),
          });
        } else if (roll < 0.7) {
          events.push({ type: "reasoning.delta", text: pick(fragments) });
        } else if (roll < 0.8) {
          events.push({ type: "message.completed" });
        } else if (roll < 0.85) {
          events.push({ type: "reasoning.completed" });
        } else if (roll < 0.95) {
          events.push({ type: "status", text: pick(["Working", "Reading"]) });
        } else {
          events.push({
            type: "tool.started",
            callId: `call_${index}`,
            title: "Read",
          });
        }
      }
      const session = conversation();
      expect(content(applyHarnessEvents(session, events))).toEqual(
        content(oneByOne(session, events)),
      );
    }
  });

  it("handles ten simultaneous long histories without cloning history blocks", () => {
    const events: HarnessEvent[] = Array.from({ length: 64 }, (_, index) => ({
      type: "message.delta",
      text: ` token-${index}`,
    }));
    for (let thread = 0; thread < 10; thread++) {
      const session = conversation();
      session.blocks = [
        ...Array.from({ length: 2_000 }, (_, index) => ({
          id: `history-${index}`,
          role: "user" as const,
          text: `History ${index}`,
        })),
        ...session.blocks,
      ];
      const next = applyHarnessEvents(session, events);
      expect(next).toEqual(oneByOne(session, events));
      for (let index = 0; index < 2_001; index++) {
        expect(next.blocks[index]).toBe(session.blocks[index]);
      }
    }
  });
});
