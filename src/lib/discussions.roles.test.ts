import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createDiscussion,
  DiscussionStore,
  readDiscussion,
  relayDisplayText,
  relayPrompt,
  settleDiscussion,
  type Discussion,
  type DiscussionParty,
} from "./discussions";
import { discussionVoices } from "./discussionVoices";
import { discussionTeam } from "./teamRuns";

const A: DiscussionParty = {
  sessionId: "chat-a",
  harness: "claude",
  model: "Opus",
  title: "Caching plan",
  cwd: "/work/site",
};
// The chat brought in, as a Skeptic.
const B: DiscussionParty = {
  sessionId: "chat-b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/api",
  role: "skeptic",
};
const BRIEF =
  "Your role in this discussion: Skeptic. Push back on weak points and look for what could go wrong; agree only when convinced.";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function fresh(rounds = 2): Discussion {
  return createDiscussion({
    id: "d1",
    owner: "main",
    a: A,
    b: B,
    topic: "Should we cache the lookups?",
    rounds,
    now: 1,
  });
}

/** Every turn of a discussion: what each chat receives and shows. */
function turns(discussion: Discussion) {
  const sent: { prompt: string; shown: string }[] = [];
  let current = discussion;
  while (current.status === "active") {
    sent.push({
      prompt: relayPrompt(current),
      shown: relayDisplayText(current),
    });
    current = settleDiscussion(
      current,
      { status: "completed", text: `Reply ${current.settled}` },
      2,
    );
  }
  return sent;
}

it("gives the other chat its role once, in its first message, visibly", () => {
  const sent = turns(fresh(3));
  expect(sent).toHaveLength(6);
  const withBrief = sent.flatMap((turn, index) =>
    turn.prompt.includes("Your role") ? [index] : [],
  );
  // Turn 1 is the other chat's first message; the chat you started from
  // never gets a role.
  expect(withBrief).toEqual([1]);
  expect(sent[1].prompt.split(BRIEF)).toHaveLength(2);
  // Its transcript shows the line, before the reply it is answering.
  expect(sent[1].shown).toBe(`${BRIEF}\n\nReply 0`);
  expect(sent[3].shown).toBe("Reply 2");
});

it("sends nothing extra without a role", () => {
  const { role: _role, ...plain } = B;
  const sent = turns(
    createDiscussion({
      id: "d2",
      owner: "main",
      a: A,
      b: plain,
      topic: "Topic",
      rounds: 2,
      now: 1,
    }),
  );
  expect(sent.some((turn) => turn.prompt.includes("Your role"))).toBe(false);
  expect(sent[1].shown).toBe("Reply 0");
});

it("keeps the role with the discussion, never with the chat that started it", () => {
  const stored = JSON.parse(JSON.stringify(fresh()));
  stored.a.role = "designer";
  const read = readDiscussion(stored)!;
  expect(read.b.role).toBe("skeptic");
  expect(read.a.role).toBeUndefined();
  stored.b.role = "admin";
  expect(readDiscussion(stored)!.b.role).toBeUndefined();
});

it("keeps the role when the chats' names are read again", () => {
  const store = new DiscussionStore(memoryStorage(), "main");
  store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
  const { role: _role, ...renamed } = { ...B, title: "Renamed review" };
  store.refreshParties("d1", A, renamed);
  expect(store.get("d1")?.b).toEqual({ ...renamed, role: "skeptic" });
});

it("badges the other chat's mascot and member with its role", () => {
  const voices = discussionVoices(fresh());
  expect(voices.b.role).toBe("skeptic");
  expect(voices.b.persona).toBe("Skeptic · Joined the topic");
  expect(voices.a.role).toBeUndefined();
  const team = discussionTeam(fresh(), {
    session: () => undefined,
    activity: [],
  });
  expect(team.members.map((member) => member.agentRole)).toEqual([
    undefined,
    "skeptic",
  ]);
});
