import { describe, expect, it, vi } from "vitest";
import {
  launchRevealProblem,
  launchRevealSummary,
  type LaunchReveal,
} from "./devSmokeReveal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const drawn: LaunchReveal = {
  native: {
    concealedAtMs: 1_000,
    revealedAtMs: 1_320,
    reason: "painted",
    concealedUntilReveal: true,
  },
  page: {
    committedAtEpochMs: 1_270,
    drawnAtEpochMs: 1_318,
    requestedAtEpochMs: 1_318,
  },
  firstContentfulPaintEpochMs: 1_285,
};

const launch = (
  native: Partial<NonNullable<LaunchReveal["native"]>>,
  rest: Partial<LaunchReveal> = {},
): LaunchReveal => ({
  ...drawn,
  ...rest,
  native: { ...drawn.native!, ...native },
});

describe("the launch reveal check", () => {
  it("passes a window that stayed concealed until its painted frame", () => {
    expect(launchRevealProblem(drawn)).toBeNull();
    expect(launchRevealSummary(drawn)).toBe(
      "shown 320 ms after the window was created, 35 ms after its first paint",
    );
  });

  it("fails a window that was never concealed or never shown", () => {
    expect(launchRevealProblem({ ...drawn, native: null })).toMatch(
      /never concealed/,
    );
    expect(
      launchRevealProblem(launch({ revealedAtMs: null, reason: null })),
    ).toMatch(/never shown/);
  });

  it("fails a window shown by its timeout or by something else", () => {
    expect(launchRevealProblem(launch({ reason: "timeout" }))).toMatch(
      /timeout, not by a drawn frame/,
    );
    expect(
      launchRevealProblem(launch({ concealedUntilReveal: false })),
    ).toMatch(/before its interface drew/);
    expect(
      launchRevealProblem({ ...drawn, page: { committedAtEpochMs: 1 } }),
    ).toMatch(/without the page reporting a drawn frame/);
  });

  it("fails a window shown before WebKit painted its content", () => {
    const late = { ...drawn, firstContentfulPaintEpochMs: 1_400 };
    expect(launchRevealProblem(late)).toBe(
      "the first content was painted 80 ms after the window was shown",
    );
    expect(
      launchRevealProblem({ ...drawn, firstContentfulPaintEpochMs: null }),
    ).toMatch(/no painted content/);
  });

  it("names a window that was covered at launch instead of judging it", () => {
    const covered = {
      ...drawn,
      page: { ...drawn.page, visibleWhenDrawn: false },
    };
    expect(launchRevealProblem(covered)).toMatch(
      /covered or on another Space at launch/,
    );
  });
});
