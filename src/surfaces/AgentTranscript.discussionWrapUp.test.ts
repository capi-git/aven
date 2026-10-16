// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discussionStore, resetDiscussionStore } from "../lib/discussions";
import type { Block } from "../lib/session";

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { AgentTranscript } from "./AgentTranscript";

const NOTE = "Discussion ended after 1 round.";

function transcript(end?: Block["discussionEnd"]): string {
  const blocks: Block[] = [
    { id: "topic", role: "user", text: "Cache the lookups?", startedAt: 1 },
    { id: "reply", role: "assistant", text: "Cache by URL." },
    {
      id: "note",
      role: "system",
      text: NOTE,
      ...(end ? { discussionEnd: end } : {}),
    },
  ];
  return renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks,
      harness: "claude",
      model: "claude:opus-5.5",
    }),
  );
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
});

afterEach(() => {
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

describe("a discussion's closing note in the chat that started it", () => {
  it("is followed by where they landed", () => {
    const store = discussionStore();
    store.start({
      id: "d1",
      a: {
        sessionId: "a",
        harness: "claude",
        model: "Opus",
        title: "Caching plan",
        cwd: "/work",
      },
      b: {
        sessionId: "b",
        harness: "codex",
        model: "GPT-5",
        title: "Review",
        cwd: "/work",
      },
      topic: "Cache the lookups?",
      rounds: 1,
    });
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "Cache by URL." });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "Agreed." });

    const markup = transcript({ id: "d1", settled: 2 });
    const note = markup.indexOf(NOTE);
    const card = markup.indexOf('data-discussion-wrapup-note="d1"');
    expect(note).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(note);
    expect(markup).toContain("Summing up…");
  });

  it("stays a plain note without the discussion's wrap-up", () => {
    const markup = transcript();
    expect(markup).toContain(NOTE);
    expect(markup).not.toContain("data-discussion-wrapup");
  });
});
