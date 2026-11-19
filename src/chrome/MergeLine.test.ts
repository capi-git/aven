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
  checks: null as unknown,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("../lib/gitHousekeeping", () => ({ gitPrSquashMerge: vi.fn() }));
vi.mock("../lib/prChecks", () => ({
  gitPrChecks: () =>
    mocks.checks ? Promise.resolve(mocks.checks) : new Promise(() => {}),
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
const { clearMergeLineAsked } = await import("./MergeLine");

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
  clearMergeLineAsked();
  mocks.checks = null;
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

it("shows Fixing while the agent fixes failing checks, then the step again", async () => {
  mocks.state.index = branch();
  mocks.state.pr = {
    number: 449,
    url: "https://github.com/o/r/pull/449",
    title: "x",
    state: "open",
  } as GitPr;
  mocks.checks = {
    number: 449,
    url: "",
    state: "open",
    checks: [{ name: "lint", state: "fail", url: "" }],
    mergeable: "MERGEABLE",
    mergeStateStatus: "UNSTABLE",
  };
  const send = vi.fn();
  const show = (busy: boolean) =>
    act(async () =>
      root.render(
        createElement(MergeLine, {
          cwd: "/copy",
          enabled: true,
          busy,
          onSendToAgent: send,
        }),
      ),
    );
  await show(false);
  expect(host.querySelector(".merge-line-word")?.textContent).toBe(
    "1 check failing",
  );
  const fix = host.querySelector<HTMLButtonElement>(
    '[data-merge-action="fix-checks"]',
  );
  await act(async () => fix?.click());
  expect(send).toHaveBeenCalledTimes(1);
  const working = () =>
    host.querySelector(".merge-line-working")?.textContent ?? null;
  // Before the agent starts, and while it works: no second Fix.
  expect(working()).toBe("Fixing");
  expect(host.querySelector("[data-merge-action]")).toBeNull();
  await show(true);
  expect(working()).toBe("Fixing");

  // A chat opened again on the copy still shows it.
  await act(async () => root.unmount());
  root = createRoot(host);
  await show(true);
  expect(working()).toBe("Fixing");

  // Done, and still failing: the step comes back.
  await show(false);
  expect(working()).toBeNull();
  expect(host.querySelector('[data-merge-action="fix-checks"]')).not.toBeNull();
});
