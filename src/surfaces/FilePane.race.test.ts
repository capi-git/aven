// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newRaceWorkspaceTab } from "../lib/layout";
import { saveRace } from "../lib/race";
import { newSession, type Session } from "../lib/session";

const seen = vi.hoisted(() => [] as (boolean | undefined)[][]);
vi.mock("./RaceView", () => ({
  RaceView: (props: { sessions: readonly Session[] }) => {
    seen.push(
      ["lane-0", "lane-1"].map(
        (id) => props.sessions.find((session) => session.id === id)?.busy,
      ),
    );
    return null;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { FilePane } from "./FilePane";

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FilePane>;

const chat = (id: string, busy = false): Session => ({
  ...newSession("claude", "/repo"),
  id,
  busy,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  saveRace({
    id: "r1",
    project: "/repo",
    root: "/repo",
    base: "a".repeat(40),
    prompt: "Fix it",
    createdAt: 0,
    uncommitted: false,
    untracked: false,
    state: "running",
    lanes: [0, 1].map((slot) => ({
      sessionId: `lane-${slot}`,
      harness: slot ? "codex" : "claude",
      model: "m",
      label: `Lane ${slot}`,
      path: `/data/races/r1/${slot}`,
      branch: `aven/race/r1-${slot}`,
    })),
  });
  seen.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  const tab = newRaceWorkspaceTab("r1", "Race overview", "/repo");
  props = {
    pane: tab.editorPanes[0],
    focused: true,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    sessions: [chat("lane-0", true), chat("lane-1", true), chat("other")],
    onFocus: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onDirtyChange: noop,
    onErrorCountChange: noop,
    onReorderFiles: noop,
    onOpenFile: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(next: Partial<ComponentProps<typeof FilePane>> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(createElement(FilePane, props)));
  // The overview's code loads on first use.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

it("re-renders the race overview when a lane's chat changes, and only then", async () => {
  await render();
  expect(seen.at(-1)).toEqual([true, true]);
  const count = seen.length;

  // Another chat streams: the overview is left alone.
  await render({
    sessions: [props.sessions[0], props.sessions[1], chat("other", true)],
  });
  expect(seen.length).toBe(count);

  // A lane's agent stops: the overview sees it.
  await render({
    sessions: [props.sessions[0], chat("lane-1"), props.sessions[2]],
  });
  expect(seen.at(-1)).toEqual([true, false]);
});
