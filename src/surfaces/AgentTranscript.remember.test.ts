import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { AgentTranscript } from "./AgentTranscript";

const blocks: Block[] = [
  { id: "user", role: "user", text: "How do we run tests?", durationMs: 5_000 },
  {
    id: "answer",
    role: "assistant",
    text: "Run `make test`; it needs Docker.",
  },
];

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remembering a reply", () => {
  it("offers Remember this beside the reply's other actions in a project", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5.5",
        onSaveNote: () => {},
        memoryProject: "/work/app",
      }),
    );
    expect(markup).toContain('aria-label="Copy response"');
    expect(markup).toContain('aria-label="Save to Notes"');
    expect(markup).toContain('aria-label="Remember this"');
  });

  it("leaves it out where there is no project memory", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5.5",
      }),
    );
    expect(markup).toContain('aria-label="Copy response"');
    expect(markup).not.toContain("Remember this");
  });
});
