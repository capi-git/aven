import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "./session";
import {
  isPersistableId,
  persistFingerprint,
  sanitizeSessionForPersist,
} from "./sessionStore";

describe("isPersistableId", () => {
  it("accepts alphanumeric ids with hyphens and underscores", () => {
    expect(isPersistableId("acp-session-1")).toBe(true);
    expect(isPersistableId("abc_123")).toBe(true);
  });

  it("rejects filesystem paths", () => {
    expect(isPersistableId("/Users/me/.pi/agent/sessions/abc.jsonl")).toBe(
      false,
    );
  });
});

describe("sanitizeSessionForPersist", () => {
  it("does not persist live agent observations as running work after a restart", () => {
    const session: Session = { ...newSession("codex", "/repo"), liveAgents: [{ id: "one", title: "Review", status: "running" }] };
    expect(sanitizeSessionForPersist(session)).not.toHaveProperty("liveAgents");
  });
  it("preserves an internal worker's lead and hidden turns without mutating the runtime blocks", () => {
    const session = {
      ...newSession("claude", "/repo"),
      orchestrationLeadId: "lead",
    };
    session.blocks = [
      { id: "u", role: "user", text: "Bounded assignment", internal: true },
    ];
    const saved = sanitizeSessionForPersist(session);
    expect(saved.blocks[0]).toMatchObject({
      orchestrationLeadId: "lead",
      internal: true,
    });
    expect(session.blocks[0].orchestrationLeadId).toBeUndefined();
    expect(
      sanitizeSessionForPersist({
        ...session,
        orchestrationLeadId: undefined,
        blocks: saved.blocks,
      }).blocks[0],
    ).toEqual(saved.blocks[0]);
    expect(
      persistFingerprint({ ...session, orchestrationLeadId: undefined }),
    ).not.toBe(persistFingerprint(session));
  });

  it("omits a path-like provider session id so upsert can still snapshot git", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "/Users/me/.pi/agent/sessions/abc.jsonl";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(
      sanitizeSessionForPersist(session).providerSessionId,
    ).toBeUndefined();
  });

  it("keeps a UUID provider session id", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(sanitizeSessionForPersist(session).providerSessionId).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("keeps a handoff divider and settles a preparing one", () => {
    const session = newSession("cursor", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "hey" },
      {
        id: "h1",
        role: "handoff",
        text: "",
        handoff: { from: "cursor", to: "claude", status: "preparing" },
      },
    ];
    const persisted = sanitizeSessionForPersist(session);
    expect(persisted.blocks[1]).toMatchObject({
      role: "handoff",
      handoff: { from: "cursor", to: "claude", status: "ready", pending: true },
    });
  });

  it("keeps a second-opinion card on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Second opinion",
        secondOpinion: {
          from: "claude",
          to: "codex",
          request: "fix the footer",
          files: 2,
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Second opinion",
      secondOpinion: {
        from: "claude",
        to: "codex",
        request: "fix the footer",
        files: 2,
      },
    });
  });

  it("keeps a handoff card kind on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Handoff",
        secondOpinion: {
          from: "claude",
          to: "codex",
          kind: "handoff",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Handoff",
      secondOpinion: { from: "claude", to: "codex", kind: "handoff" },
    });
  });

  it("keeps a note card on the user turn without the note body", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "hi",
        noteCard: {
          id: "n1",
          slug: "overview",
          title: "agent-os project overview",
          sourceCwd: "/tmp/project",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toEqual({
      id: "u1",
      role: "user",
      text: "hi",
      noteCard: {
        id: "n1",
        slug: "overview",
        title: "agent-os project overview",
        sourceCwd: "/tmp/project",
      },
    });
  });

  it("keeps edited and approved plan metadata", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "plan this" },
      {
        id: "p1",
        role: "plan",
        text: "# Edited plan",
        plan: {
          key: "turn:1",
          status: "built",
          originalText: "# Original plan",
          approvedText: "# Edited plan",
          edited: true,
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[1]).toMatchObject({
      role: "plan",
      text: "# Edited plan",
      plan: {
        key: "turn:1",
        status: "built",
        originalText: "# Original plan",
        approvedText: "# Edited plan",
        edited: true,
      },
    });
  });

  it("keeps structured task lists", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "fix it" },
      {
        id: "tasks1",
        role: "tasks",
        text: "[x] Inspect\n[~] Implement",
        taskList: {
          key: "turn_1",
          explanation: "Inspection complete.",
          items: [
            { id: "1", text: "Inspect", status: "completed" },
            { id: "2", text: "Implement", status: "in_progress" },
          ],
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[1]).toEqual(
      session.blocks[1],
    );
  });
});

describe("persistFingerprint", () => {
  const user: Block = { id: "u1", role: "user", text: "hi" };
  const answer: Block = { id: "a1", role: "assistant", text: "done" };

  // One base session: `newSession` mints a fresh id, and the id is part of the
  // fingerprint, so variants have to be spread off a single session.
  const base = (blocks: Block[] = [user, answer]): Session => ({
    ...newSession("codex", "/tmp/project"),
    blocks,
  });

  it("is stable while nothing changes", () => {
    const session = base();
    expect(persistFingerprint(session)).toBe(persistFingerprint(session));
  });

  it("matches a copy holding the same blocks", () => {
    const session = base();
    expect(persistFingerprint({ ...session })).toBe(
      persistFingerprint(session),
    );
  });

  it("changes when a block in the middle is replaced", () => {
    const tool: Block = {
      id: "t1",
      role: "tool",
      text: "run",
      tool: { status: "running" },
    };
    const before = base([user, tool, answer]);
    const after = {
      ...before,
      blocks: [user, { ...tool, tool: { status: "completed" } }, answer],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when an approval is decided", () => {
    const approval: Block = {
      id: "p1",
      role: "approval",
      text: "allow?",
      approval: { requestId: 1 },
    };
    const before = base([user, approval]);
    const after = {
      ...before,
      blocks: [
        user,
        { ...approval, approval: { requestId: 1, decided: "allow" as const } },
      ],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when a block is appended", () => {
    const before = base([user]);
    expect(persistFingerprint({ ...before, blocks: [user, answer] })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("changes when a persisted field changes", () => {
    const before = base();
    expect(persistFingerprint({ ...before, title: "Renamed" })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("ignores state that is never written", () => {
    const before = base();
    expect(persistFingerprint({ ...before, busy: true })).toBe(
      persistFingerprint(before),
    );
  });

  it("treats a path-like provider session id as absent", () => {
    const session = base();
    expect(
      persistFingerprint({
        ...session,
        providerSessionId: "/Users/me/.pi/agent/sessions/abc.jsonl",
      }),
    ).toBe(persistFingerprint(session));
  });

  it("matches persist for a zero context window", () => {
    const session = base();
    expect(
      persistFingerprint({ ...session, context: { used: 10, window: 0 } }),
    ).toBe(persistFingerprint({ ...session, context: { used: 10 } }));
  });
});

it("persists accepted queued work independently of transcript blocks and fingerprints edits", () => {
  const session = newSession("codex", "/tmp/project");
  session.blocks = [{ id: "u", role: "user", text: "initial" }];
  const oldFingerprint = persistFingerprint(session);
  session.queuedMessages = [
    {
      id: "q",
      text: "next",
      attachments: [
        {
          id: "image",
          name: "shot.png",
          kind: "image",
          mimeType: "image/png",
          size: 3,
          path: "/attachments/shot.png",
          data: "YWJj",
          previewUrl: "blob:temporary",
        },
      ],
      intent: "plan",
    },
  ];
  const payload = sanitizeSessionForPersist(session);
  expect(payload.queuedMessages).toEqual([
    {
      id: "q",
      text: "next",
      attachments: [
        {
          id: "image",
          name: "shot.png",
          kind: "image",
          mimeType: "image/png",
          size: 3,
          path: "/attachments/shot.png",
        },
      ],
      intent: "plan",
    },
  ]);
  expect(payload.blocks).toHaveLength(1);
  expect(persistFingerprint(session)).not.toBe(oldFingerprint);
  const queuedFingerprint = persistFingerprint(session);
  session.queuedMessages = [];
  expect(persistFingerprint(session)).not.toBe(queuedFingerprint);
  expect(sanitizeSessionForPersist(session).queuedMessages).toEqual([]);
});

it("retains still-unsaved legacy image bytes when persisting a sent draft", () => {
  const session = newSession("codex", "/tmp/project");
  session.blocks = [
    {
      id: "u",
      role: "user",
      text: "",
      attachments: [
        {
          id: "legacy",
          name: "paste.png",
          mimeType: "image/png",
          kind: "image",
          size: 3,
          data: "YWJj",
          previewUrl: "blob:expired",
        },
      ],
    },
  ];
  expect(sanitizeSessionForPersist(session).blocks[0].attachments?.[0]).toEqual(
    {
      id: "legacy",
      name: "paste.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      data: "YWJj",
    },
  );
});
