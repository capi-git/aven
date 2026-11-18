// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitDiffIndex, GitPr } from "../lib/fs";

const mocks = vi.hoisted(() => ({
  state: {
    index: null as GitDiffIndex | null,
    localIndex: null as GitDiffIndex | null,
    pr: null as GitPr | null,
  },
  refresh: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("../lib/gitHousekeeping", () => ({ gitPrSquashMerge: vi.fn() }));
vi.mock("../lib/prChecks", () => ({
  gitPrChecks: () => new Promise(() => {}),
}));
vi.mock("../lib/githubTasks", () => ({
  githubWorkItemThread: () => new Promise(() => {}),
}));
vi.mock("../hooks/useMergePath", () => ({
  useMergePath: () => ({
    index: mocks.state.index,
    localIndex: mocks.state.localIndex,
    pr: mocks.state.pr,
    error: null,
    nextIn: null,
    loading: false,
    refresh: mocks.refresh,
  }),
}));
vi.mock("./DotSpinner", () => ({ DotSpinner: () => null }));

const { MergeLine } = await import("./MergeLine");
const { clearMergeLineMemory } = await import("../hooks/useMergeLine");

let root: Root;
let host: HTMLDivElement;

const branch = (overrides: Partial<GitDiffIndex> = {}): GitDiffIndex => ({
  branch: "feature",
  files: [],
  additions: 0,
  deletions: 0,
  remote: "origin",
  upstream: "origin/feature",
  defaultBranch: "main",
  ahead: 0,
  behind: 0,
  aheadOfDefault: 2,
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearMergeLineMemory();
  mocks.state = { index: null, localIndex: null, pr: null };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (cwd = "/copy") =>
  act(async () =>
    root.render(
      createElement(MergeLine, {
        cwd,
        enabled: true,
        busy: false,
        onSendToAgent: vi.fn(),
      }),
    ),
  );

it("holds its place as soon as local Git shows it applies", async () => {
  await render();
  expect(host.querySelector(".merge-line")).toBeNull();
  mocks.state.localIndex = branch();
  await render();
  const line = host.querySelector(".merge-line");
  expect(line).not.toBeNull();
  expect(line?.getAttribute("aria-hidden")).toBe("true");
  expect(line?.textContent).toBe("");
});

it("reserves nothing on the default branch", async () => {
  mocks.state.localIndex = branch({ branch: "main", aheadOfDefault: 0 });
  await render();
  expect(host.querySelector(".merge-line")).toBeNull();
});

it("shows the copy's last line at once when opened again, without acting on it", async () => {
  mocks.state.index = branch({ ahead: 1 });
  await render();
  const push = () =>
    host.querySelector<HTMLButtonElement>('[data-merge-action="push"]');
  expect(push()?.disabled).toBe(false);
  await act(async () => root.unmount());
  root = createRoot(host);

  // A new pane on the same copy, before anything is read again.
  mocks.state = { index: null, localIndex: null, pr: null };
  await render();
  expect(host.querySelector(".merge-line-word")?.textContent).toBe(
    "1 commit not pushed",
  );
  expect(push()?.disabled).toBe(true);

  // Another copy has nothing remembered.
  await render("/other");
  expect(host.querySelector(".merge-line")).toBeNull();
});
