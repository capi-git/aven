// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../lib/activity";
import type { ProjectStatusMap } from "../lib/projectStatus";
import type { Session } from "../lib/session";
import { useProjectStatus } from "./useProjectStatus";

const { readStats } = vi.hoisted(() => ({ readStats: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_diff_stats") return readStats(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

const APP = "/Users/me/Developer/status-app";
let root: Root;
let host: HTMLDivElement;
let latest: ProjectStatusMap;

function Probe(props: {
  sessions: Session[];
  activity: ActivityEntry[];
  projectPaths: string[];
}) {
  latest = useProjectStatus(props);
  return null;
}

const streaming = (text: string) =>
  ({
    id: "s",
    cwd: APP,
    busy: true,
    blocks: [{ id: "b", role: "assistant", text }],
  }) as unknown as Session;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  readStats.mockResolvedValue({ files: 7, additions: 9, deletions: 1 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(sessions: Session[], activity: ActivityEntry[] = []) {
  await act(async () =>
    root.render(
      createElement(Probe, { sessions, activity, projectPaths: [APP] }),
    ),
  );
}

it("keeps one status object through streaming flushes that change no count", async () => {
  await render([streaming("He")]);
  const first = latest;
  expect(first[APP]).toEqual({ running: 1, waiting: 0, unread: 0 });
  await render([streaming("Hello")]);
  await render([streaming("Hello, wor")]);
  expect(latest).toBe(first);

  // Counts that change produce a new object.
  await render([{ ...streaming("Done"), busy: false }]);
  expect(latest).not.toBe(first);
  expect(latest[APP]).toBeUndefined();
});

it("adds unread replies and the project's changed files once they are known", async () => {
  await render(
    [],
    [
      {
        id: "1",
        sessionId: "s",
        outcome: "completed",
        title: "",
        summary: "",
        cwd: APP,
        harness: "claude",
        model: "",
        createdAt: 1,
        readAt: null,
        resolvedAt: null,
      },
    ],
  );
  expect(latest[APP]).toEqual({ running: 0, waiting: 0, unread: 1 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
  expect(readStats).toHaveBeenCalledWith(APP);
  expect(latest[APP]).toEqual({ running: 0, waiting: 0, unread: 1, files: 7 });
});
