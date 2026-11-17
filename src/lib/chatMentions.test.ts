import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChatsToTurn,
  chatIdsInText,
  chatMentionLabel,
  chatReference,
  chatSlug,
  otherChats,
  rankChatFiles,
  resetChatMentionLabels,
  type ChatRef,
} from "./chatMentions";
import type { Block, Session } from "./session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "full-access" as Session["runtimeMode"],
    title: `Chat ${id}`,
    cwd: "/work/app",
    blocks: [block("user", "hello"), block("assistant", "hi")],
    ...patch,
  };
}

function block(role: Block["role"], text: string): Block {
  return { id: crypto.randomUUID(), role, text } as Block;
}

function ref(id: string, title: string, recency = 0): ChatRef {
  return { id, title, harness: "claude", cwd: "/work/app", recency };
}

beforeEach(() => resetChatMentionLabels());

describe("chat mention labels", () => {
  it("slugs titles into one safe word", () => {
    expect(chatSlug("Fix the Login bug!")).toBe("fix-the-login-bug");
    expect(chatSlug("Café déjà vu")).toBe("cafe-deja-vu");
    expect(chatSlug("???")).toBe("chat");
  });

  it("keeps one label per chat, and tells chats with one title apart", () => {
    const a = ref("a", "Same");
    const b = ref("b", "Same");
    expect(chatMentionLabel(a)).toBe("chat/same");
    expect(chatMentionLabel(b)).toBe("chat/same-2");
    // A renamed chat keeps the label a draft already holds.
    expect(chatMentionLabel({ ...a, title: "Renamed" })).toBe("chat/same");
  });

  it("finds the chats a message names, once each, past punctuation", () => {
    chatMentionLabel(ref("a", "Alpha"));
    chatMentionLabel(ref("b", "Beta"));
    expect(
      chatIdsInText("see @chat/alpha, then @chat/beta. and @chat/alpha"),
    ).toEqual(["a", "b"]);
    expect(chatIdsInText("mail me@chat/alpha")).toEqual([]);
  });
});

describe("otherChats", () => {
  it("leaves out this chat, empty chats and hidden ones; this project first", () => {
    const list = [
      session("here-old"),
      session("self"),
      session("empty", { blocks: [] }),
      session("inbox", { inboxAsk: {} as Session["inboxAsk"] }),
      session("worker", { orchestrationLeadId: "x" }),
      session("elsewhere", { cwd: "/work/other" }),
      session("here-new"),
    ];
    expect(otherChats(list, "self", "/work/app").map((c) => c.id)).toEqual([
      "here-new",
      "here-old",
      "elsewhere",
    ]);
  });

  it("adds saved chats that are not in memory", () => {
    const saved = [ref("saved", "Saved", 5), ref("here", "Stale", 1)];
    const ids = otherChats([session("here")], undefined, "/work/app", saved);
    expect(ids.map((c) => c.id)).toEqual(["here", "saved"]);
    expect(ids[0]!.title).toBe("Chat here");
  });
});

describe("rankChatFiles", () => {
  it("offers a few chats without a query and matches titles after", () => {
    const chats = ["One", "Two", "Three", "Four", "Five"].map((t, i) =>
      ref(String(i), t),
    );
    expect(rankChatFiles(chats, "")).toHaveLength(4);
    const hits = rankChatFiles(chats, "thr");
    expect(hits.map((h) => h.name)).toEqual(["Three"]);
    expect(hits[0]!.path).toBe("chat:2");
    expect(rankChatFiles(chats, "chat/fiv").map((h) => h.name)).toEqual([
      "Five",
    ]);
  });
});

describe("chatReference", () => {
  it("keeps the last messages and says how many were left out", () => {
    const blocks = Array.from({ length: 14 }, (_, i) =>
      block(i % 2 ? "assistant" : "user", `m${i}`),
    );
    blocks.push(block("tool", "ran ls"));
    const text = chatReference(session("a", { blocks }));
    expect(text).toContain("(4 earlier messages omitted)");
    expect(text).toContain("User: m4");
    expect(text).toContain("Assistant: m13");
    expect(text).not.toContain("ran ls");
    expect(text).not.toContain("m3\n");
  });
});

describe("applyChatsToTurn", () => {
  it("adds each named chat's conversation to the message", async () => {
    const a = session("a", { title: "Login work" });
    const label = chatMentionLabel(a);
    const out = await applyChatsToTurn(`continue from @${label}`, {
      session: (id) => (id === "a" ? a : undefined),
      list: () => [a],
      load: async () => null,
    });
    expect(out).toContain(`continue from @${label}`);
    expect(out).toContain('Referenced chat "Login work" (Claude Code in app)');
    expect(out).toContain("<chat>\nUser: hello\n\nAssistant: hi\n</chat>");
  });

  it("loads a saved chat, and finds a label written before a restart", async () => {
    const saved = session("s", { title: "Old plan" });
    const load = vi.fn(async (id: string) => (id === "s" ? saved : null));
    const out = await applyChatsToTurn("see @chat/old-plan", {
      session: () => undefined,
      list: () => [saved],
      load,
    });
    expect(load).toHaveBeenCalledWith("s");
    expect(out).toContain('Referenced chat "Old plan"');
  });

  it("leaves a message without chat mentions alone", async () => {
    const source = {
      session: vi.fn(),
      list: () => [],
      load: vi.fn(),
    };
    await expect(applyChatsToTurn("@App.tsx please", source)).resolves.toBe(
      "@App.tsx please",
    );
    expect(source.load).not.toHaveBeenCalled();
  });
});

describe("chat mentions in a sent message", () => {
  it("are found with the chat's current name, past punctuation", async () => {
    const { chatReferenceParts } = await import("./chatReferences");
    const { setChatReferenceSource } = await import("./chatMentions");
    const a = session("a", { title: "Login work" });
    chatMentionLabel(a);
    setChatReferenceSource({
      session: (id) =>
        id === "a" ? { ...a, title: "Login, renamed" } : undefined,
      list: () => [a],
      load: async () => null,
    });
    const parts = chatReferenceParts("see @chat/login-work, then @chat/nope");
    setChatReferenceSource(null);
    expect(parts).toEqual([
      { text: "see " },
      {
        text: "@chat/login-work",
        chat: { id: "a", title: "Login, renamed", harness: "claude" },
      },
      { text: ", then @chat/nope" },
    ]);
  });
});
