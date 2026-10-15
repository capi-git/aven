// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrChecks } from "../lib/prChecks";
import { usePrChecks, type PrChecksState } from "./usePrChecks";

const mocks = vi.hoisted(() => ({ checks: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { number: number }) => {
    if (command === "git_pr_checks") return mocks.checks(args.number);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let hidden: boolean;
let state: PrChecksState;

const checks = (...states: string[]): PrChecks => ({
  number: 9,
  url: "https://github.com/o/r/pull/9",
  state: "open",
  checks: states.map((value, i) => ({ name: `c${i}`, state: value, url: "" })),
});

function Probe(props: { number: number | null; enabled: boolean }) {
  state = usePrChecks("/repo", props.number, props.enabled);
  return null;
}

async function render(number: number | null, enabled = true) {
  await act(async () => root.render(createElement(Probe, { number, enabled })));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.checks.mockReset();
});

describe("usePrChecks", () => {
  it("polls with backoff while checks run and stops when they finish", async () => {
    mocks.checks
      .mockResolvedValueOnce(checks("pending", "pass"))
      .mockResolvedValueOnce(checks("pending", "pass"))
      .mockResolvedValueOnce(checks("pass", "fail"));
    await render(9);
    expect(mocks.checks).toHaveBeenCalledOnce();
    expect(state.summary?.state).toBe("pending");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(mocks.checks).toHaveBeenCalledTimes(2);
    // The second wait is longer.
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(mocks.checks).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(mocks.checks).toHaveBeenCalledTimes(3);
    expect(state.summary).toMatchObject({ state: "failing", failed: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing while hidden or disabled, and resumes when shown", async () => {
    mocks.checks.mockResolvedValue(checks("pending"));
    await render(9);
    expect(mocks.checks).toHaveBeenCalledOnce();
    hidden = true;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(mocks.checks).toHaveBeenCalledOnce();
    hidden = false;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(mocks.checks).toHaveBeenCalledTimes(2);
    await render(9, false);
    expect(vi.getTimerCount()).toBe(0);
    await render(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops on an error until asked to check again", async () => {
    mocks.checks.mockRejectedValueOnce("gh: not logged in");
    await render(9);
    expect(state.error).toBe("gh: not logged in");
    expect(vi.getTimerCount()).toBe(0);
    mocks.checks.mockResolvedValueOnce(checks("pass"));
    await act(async () => state.refresh());
    expect(state.error).toBeNull();
    expect(state.summary?.state).toBe("passing");
    expect(vi.getTimerCount()).toBe(0);
  });
});
