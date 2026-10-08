// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../lib/session";
import { useWorkspaceSessions } from "./useWorkspaceSessions";

let root: Root;
let state: ReturnType<typeof useWorkspaceSessions>;
let session: Session;
function Harness() {
  state = useWorkspaceSessions(() => [session]);
  return null;
}
function reply(text: string): Session {
  return { ...session, blocks: [{ id: "reply", role: "assistant", text, streaming: true }] };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  session = newSession("codex", "/repo");
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("publishes streaming to the visible chat immediately and commits the newest text at a fixed deadline", async () => {
  const first = reply("Hi");
  await act(async () => state.commitStream([first], new Set()));
  expect(state.sessions[0]).toBe(session);
  expect(state.liveSessions.session(session.id)).toBe(first);
  await act(async () => vi.advanceTimersByTime(200));
  const latest = reply("Hi there");
  await act(async () => state.commitStream([latest], new Set()));
  await act(async () => vi.advanceTimersByTime(50));
  expect(state.sessions[0]).toBe(latest);
});

it("applies a rename against live text and cancels the trailing commit", async () => {
  await act(async () => state.commitStream([reply("Unsaved token")], new Set()));
  await act(async () => state.setSessions((current) => current.map((item) => ({ ...item, title: "Renamed" }))));
  expect(state.sessions[0].title).toBe("Renamed");
  expect(state.sessions[0].blocks[0].text).toBe("Unsaved token");
  expect(vi.getTimerCount()).toBe(0);
});

it("commits externally rendered sessions and approvals immediately", async () => {
  const latest = reply("Detached text");
  await act(async () => state.commitStream([latest], new Set([session.id])));
  expect(state.sessions[0]).toBe(latest);
  const completed = { ...latest, busy: !latest.busy };
  await act(async () => state.commitStream([completed], new Set()));
  expect(state.sessions[0]).toBe(completed);
  expect(vi.getTimerCount()).toBe(0);
});

it("flushes current text explicitly and releases its timer on unmount", async () => {
  const latest = reply("Keep me");
  await act(async () => state.commitStream([latest], new Set()));
  await act(async () => state.flushCommittedSessions());
  expect(state.sessions[0]).toBe(latest);
  await act(async () => state.commitStream([reply("Next token")], new Set()));
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
