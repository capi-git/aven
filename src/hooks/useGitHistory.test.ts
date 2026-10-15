// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyGitChanged, type GitHistoryCommit } from "../lib/fs";
import {
  headCommit,
  useGitHistory,
  type GitHistorySnapshot,
} from "./useGitHistory";

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_history") return mocks.history(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let sequence = 0;
const seen: Record<string, GitHistorySnapshot> = {};

const commit = (sha: string, head = false): GitHistoryCommit => ({
  sha,
  shortSha: sha,
  parents: [],
  author: "Test",
  timestamp: 1,
  subject: sha,
  refs: [],
  head,
});

function Reader(props: { name: string; cwd: string; enabled: boolean }) {
  seen[props.name] = useGitHistory(props.cwd, props.enabled);
  return null;
}

async function render(cwd: string, enabled = true) {
  await act(async () =>
    root.render([
      createElement(Reader, { key: "a", name: "header", cwd, enabled }),
      createElement(Reader, { key: "b", name: "graph", cwd, enabled }),
    ]),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  mocks.history.mockResolvedValue({
    head: "b",
    commits: [commit("a"), commit("b", true)],
  });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.history.mockReset();
});

describe("useGitHistory", () => {
  it("shares one read between the header and the graph", async () => {
    const cwd = `/shared-${++sequence}`;
    await render(cwd);
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(seen.header).toBe(seen.graph);
    expect(headCommit(seen.header)?.sha).toBe("b");
    await act(async () => notifyGitChanged(cwd));
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it("starts no reads while hidden and keeps the last rows", async () => {
    const cwd = `/shared-${++sequence}`;
    await render(cwd);
    const before = seen.graph;
    await render(cwd, false);
    await act(async () => {
      notifyGitChanged(cwd);
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.history).toHaveBeenCalledOnce();
    expect(seen.graph).toBe(before);
  });

  it("finds HEAD by flag or by sha", () => {
    expect(
      headCommit({ commits: [commit("x")], head: "x", loaded: true })?.sha,
    ).toBe("x");
    expect(headCommit({ commits: [], head: null, loaded: true })).toBeNull();
  });
});
