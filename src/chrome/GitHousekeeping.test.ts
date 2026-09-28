// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHousekeeping } from "./GitHousekeeping";
import type { MergedBranches, ReleaseStatus } from "../lib/gitHousekeeping";

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  start: vi.fn(),
  merged: vi.fn(),
  remove: vi.fn(),
  ask: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === "git_release_status") return mocks.release(args.cwd);
    if (command === "git_release_start") return mocks.start(args.cwd, args.version);
    if (command === "git_merged_branches") return mocks.merged(args.cwd);
    if (command === "git_delete_merged_branches")
      return mocks.remove(args.cwd, args.local, args.remote);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("../lib/inAppLinks", () => ({ openInAppUrl: mocks.open }));

let root: Root;
let container: HTMLDivElement;

const released: ReleaseStatus = {
  base: "main",
  latest: {
    tag: "v0.1.107",
    name: "Aven 0.1.107",
    url: "https://example.com/releases/v0.1.107",
    publishedAt: "2026-09-28T19:00:31Z",
  },
  unreleased: 2,
  version: "0.1.108",
  versionUnreleased: true,
  workflow: "release.yml",
  workflowHasPublish: true,
  run: null,
};

const none: MergedBranches = {
  base: "main",
  remote: "origin",
  local: [],
  remoteBranches: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.release.mockResolvedValue(released);
  mocks.merged.mockResolvedValue(none);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(createElement(GitHousekeeping, { cwd: "/repo", enabled: true })),
  );
}

const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

describe("release card", () => {
  it("publishes the ready version only after confirming", async () => {
    mocks.start.mockResolvedValue(undefined);
    await render();
    expect(container.textContent).toContain("Version 0.1.108 is ready to publish");
    expect(container.textContent).toContain("2 changes on main since v0.1.107.");
    mocks.ask.mockResolvedValueOnce(false);
    await act(async () => button("Publish 0.1.108")!.click());
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.ask.mockResolvedValueOnce(true);
    await act(async () => button("Publish 0.1.108")!.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith("/repo", "0.1.108");
  });

  it("shows why a publish was refused", async () => {
    mocks.start.mockRejectedValue(new Error("A release is already running."));
    mocks.ask.mockResolvedValue(true);
    await render();
    await act(async () => button("Publish 0.1.108")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "A release is already running.",
    );
  });

  it("stays hidden for a project without releases or a release workflow", async () => {
    mocks.release.mockResolvedValue({
      ...released,
      latest: null,
      workflow: null,
      workflowHasPublish: false,
    });
    await render();
    expect(container.textContent).not.toContain("Release");
  });
});

describe("merged branches", () => {
  it("lists merged branches and deletes them after confirming", async () => {
    mocks.merged.mockResolvedValueOnce({
      ...none,
      local: ["feat/tab-groups"],
      remoteBranches: ["fix/menus"],
    });
    mocks.remove.mockResolvedValue({
      deletedLocal: ["feat/tab-groups"],
      deletedRemote: ["fix/menus"],
      failed: [],
    });
    mocks.ask.mockResolvedValue(true);
    await render();
    expect(container.textContent).toContain("2 to clean up");
    expect(container.textContent).toContain("feat/tab-groups");
    expect(container.textContent).toContain("GitHub");
    await act(async () => button("Delete merged branches")!.click());
    expect(mocks.ask).toHaveBeenCalledWith(
      expect.stringContaining("Delete 2 merged branches (1 local, 1 on GitHub)?"),
      expect.objectContaining({ okLabel: "Delete" }),
    );
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      ["feat/tab-groups"],
      ["fix/menus"],
    );
    expect(container.textContent).toContain("Deleted 2 merged branches.");
  });

  it("shows nothing when every branch is live work", async () => {
    await render();
    expect(container.textContent).not.toContain("Merged branches");
  });
});
