// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTINUE_AT_RESET_TEXT } from "../lib/messageQueue";
import { newSession, type Session } from "../lib/session";
import {
  requestContinueAtReset,
  useUsageHoldRelease,
} from "./useUsageHoldRelease";

const NOW = 1_800_000_000_000;
const RESET = NOW + 3 * 60 * 60_000;

let root: Root;
let host: HTMLDivElement;
let latest: Session[] = [];

function Workspace({ initial }: { initial: Session[] }) {
  const [sessions, setSessions] = useState(initial);
  useUsageHoldRelease(sessions, setSessions);
  latest = sessions;
  return null;
}

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "/repo", "gpt-5"),
    id: "chat",
    usageHold: { harness: "codex", resetsAt: RESET, cutOff: true },
    ...patch,
  };
}

async function render(initial: Session[]) {
  await act(async () => root.render(createElement(Workspace, { initial })));
}

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useUsageHoldRelease", () => {
  it("lets the hold go at reset, checking again through a long wait", async () => {
    await render([
      chat({
        queuedMessages: [{ id: "q", text: "Then this", attachments: [] }],
        queueStatus: "active",
      }),
    ]);
    await act(async () => vi.advanceTimersByTime(RESET - NOW - 1));
    expect(latest[0].usageHold?.resetsAt).toBe(RESET);
    await act(async () => vi.advanceTimersByTime(1));
    // It holds nothing back now; the cut-off turn still says it has reset.
    expect(latest[0].usageHold?.reset).toBe(true);
    expect(latest[0].queuedMessages).toHaveLength(1);
  });

  it("looks again when the window comes back, as after the Mac wakes", async () => {
    await render([chat()]);
    // Timers did not run while the Mac slept; the clock moved on.
    vi.setSystemTime(RESET + 5 * 60_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(latest[0].usageHold?.reset).toBe(true);
  });

  it("sends a short continue at reset when Continue at is on", async () => {
    await render([chat()]);
    await act(async () => requestContinueAtReset("chat", true));
    expect(latest[0].usageHold?.continueAtReset).toBe(true);
    await act(async () => vi.advanceTimersByTime(RESET - NOW));
    expect(latest[0].usageHold).toBeUndefined();
    expect(latest[0].queuedMessages?.map((message) => message.text)).toEqual([
      CONTINUE_AT_RESET_TEXT,
    ]);
  });

  it("turns Continue at off again", async () => {
    await render([chat()]);
    await act(async () => requestContinueAtReset("chat", true));
    await act(async () => requestContinueAtReset("chat", false));
    await act(async () => vi.advanceTimersByTime(RESET - NOW));
    expect(latest[0].queuedMessages).toBeUndefined();
  });
});
