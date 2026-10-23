// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../lib/session";
import { TURN_START_SLACK_MS, type TurnShotTidy } from "../lib/turnShots";
import { useTurnShotTidy } from "./useTurnShotTidy";

const SHOT =
  "/Users/jack/Library/Application Support/com.capi.monocode.personal/turn-shots/s1/1792438599500-after.jpg";

let root: Root;
let container: HTMLDivElement;
const tidy = vi.fn<(request: TurnShotTidy) => Promise<void>>(async () => {});
const sessionsRef: { current: Session[] } = { current: [] };

function chat(id: string, blocks: Block[]): Session {
  return {
    id,
    harness: "codex",
    model: "m",
    modelSettings: {},
    runtimeMode: "supervised",
    title: id,
    cwd: "/w",
    blocks,
  } as Session;
}

function Harness({ working }: { working: ReadonlySet<string> }) {
  useTurnShotTidy(working, sessionsRef, tidy);
  return null;
}

const render = (working: string[]) =>
  act(() => root.render(createElement(Harness, { working: new Set(working) })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: 100_000, toFake: ["Date"] });
  tidy.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("tidies a turn only after the chat stops working, with its newest messages", async () => {
  sessionsRef.current = [chat("s1", [{ id: "u", role: "user", text: "Go" }])];
  await render([]);
  await render(["s1"]);
  vi.setSystemTime(160_000);
  await render(["s1"]);
  expect(tidy).not.toHaveBeenCalled();

  // The final reply lands in the newest state as the turn ends.
  sessionsRef.current = [
    chat("s1", [
      { id: "u", role: "user", text: "Go" },
      { id: "a", role: "assistant", text: `![After](<${SHOT}>)` },
    ]),
  ];
  vi.setSystemTime(170_000);
  await render([]);
  expect(tidy).toHaveBeenCalledExactlyOnceWith({
    sessionId: "s1",
    from: 100_000 - TURN_START_SLACK_MS,
    to: 170_000,
    referenced: ["1792438599500-after.jpg"],
  });
  await render([]);
  expect(tidy).toHaveBeenCalledTimes(1);
});

it("keeps going when a tidy fails", async () => {
  tidy.mockRejectedValueOnce(new Error("store unavailable"));
  sessionsRef.current = [chat("s1", []), chat("s2", [])];
  await render(["s1", "s2"]);
  await render([]);
  expect(tidy.mock.calls.map(([request]) => request.sessionId)).toEqual([
    "s1",
    "s2",
  ]);
});
