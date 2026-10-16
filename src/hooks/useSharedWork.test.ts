// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../lib/session";
import {
  resetSharedWork,
  sharedWorkSession,
  sharedWorkTurnStarted,
  sharedWorkTurns,
} from "../lib/sharedWork";
import { latestRequest, useSharedWorkSessions } from "./useSharedWork";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSharedWork();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetSharedWork();
  vi.unstubAllGlobals();
});

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: text,
  role: "user",
  text,
  ...extra,
});

it("reads the latest request the user typed", () => {
  expect(latestRequest([])).toBeUndefined();
  expect(
    latestRequest([
      user("\n  Fix the login form\nand its tests"),
      { id: "r", role: "assistant", text: "Done" },
      user("Continue", { internal: true }),
      user("The other chat said", {
        discussion: {
          id: "d",
          turn: 1,
          rounds: 2,
          partner: { harness: "codex", model: "GPT-5", title: "x" },
        },
      }),
    ]),
  ).toBe("Fix the login form");
});

it("tells the store about the window's chats and forgets closed ones", async () => {
  const chat: Session = {
    ...newSession("codex", "/Users/me/site"),
    id: "chat",
    title: "codex · Tidy API",
    runtimeMode: "supervised",
    blocks: [user("Tidy the API")],
  };
  const ref = { current: [chat] as Session[] };
  function Host({ ids }: { ids: string }) {
    useSharedWorkSessions(ref, ids);
    return null;
  }
  await act(async () => root.render(createElement(Host, { ids: "chat" })));
  expect(sharedWorkSession("chat")).toEqual({
    harness: "codex",
    title: "Tidy API",
    project: "/Users/me/site",
    cwd: "/Users/me/site",
    runtimeMode: "supervised",
    request: "Tidy the API",
  });
  sharedWorkTurnStarted({
    sessionId: "chat",
    harness: "codex",
    cwd: "/Users/me/site",
  });
  expect(sharedWorkTurns()).toHaveLength(1);
  ref.current = [];
  await act(async () => root.render(createElement(Host, { ids: "" })));
  expect(sharedWorkTurns()).toEqual([]);
  expect(sharedWorkSession("chat")).toBeUndefined();
});
