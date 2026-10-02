import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

// Only Claude is installed: the same shape as a user with one provider.
vi.mock("../lib/harness/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: (harness: string) => harness === "claude",
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { AgentTranscript } from "./AgentTranscript";

describe("second opinion with one installed provider", () => {
  it("still offers a second opinion from another model of the same provider", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Ship it", durationMs: 5_000 },
      { id: "answer", role: "assistant", text: "Done." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5.5",
        onSecondOpinion: () => {},
      }),
    );
    expect(markup).toContain('aria-label="Second opinion"');
    expect(markup).not.toContain("No different model available");
  });
});
