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
    if (command === "git_release_start")
      return mocks.start(args.cwd, args.version, args.sourceSha);
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
  sourceSha: "a".repeat(40),
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

async function render(cwd = "/repo") {
  await act(async () =>
    root.render(createElement(GitHousekeeping, { cwd, enabled: true })),
  );
}

const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      "0.1.108",
      released.sourceSha,
    );
  });

  it("does not offer publication when the source commit is unknown", async () => {
    mocks.release.mockResolvedValue({ ...released, sourceSha: null });
    await render();
    expect(button("Publish")).toBeUndefined();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("binds confirmation to the displayed source even if status refreshes", async () => {
    const consent = deferred<boolean>();
    mocks.ask.mockReturnValue(consent.promise);
    mocks.start.mockResolvedValue(undefined);
    await render();
    await act(async () => button("Publish 0.1.108")!.click());
    mocks.release.mockResolvedValue({ ...released, sourceSha: "b".repeat(40) });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => consent.resolve(true));
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      "0.1.108",
      released.sourceSha,
    );
  });

  it("clears the previous project's cards and ignores its pending reads", async () => {
    mocks.merged.mockResolvedValue({ ...none, local: ["old-project-branch"] });
    await render();
    const staleRelease = deferred<ReleaseStatus>();
    const staleBranches = deferred<MergedBranches>();
    const nextRelease = deferred<ReleaseStatus>();
    const nextBranches = deferred<MergedBranches>();
    mocks.release.mockImplementation((cwd) =>
      cwd === "/repo" ? staleRelease.promise : nextRelease.promise,
    );
    mocks.merged.mockImplementation((cwd) =>
      cwd === "/repo" ? staleBranches.promise : nextBranches.promise,
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    await render("/other-project");
    expect(button("Publish")).toBeUndefined();
    expect(button("Delete merged branches")).toBeUndefined();
    expect(container.textContent).not.toContain("old-project-branch");
    await act(async () => {
      staleRelease.resolve({ ...released, version: "0.1.999" });
      staleBranches.resolve({ ...none, local: ["stale-branch"] });
    });
    expect(button("Publish")).toBeUndefined();
    expect(container.textContent).not.toContain("stale-branch");
    const next = { ...released, version: "0.1.109", sourceSha: "c".repeat(40) };
    await act(async () => {
      nextRelease.resolve(next);
      nextBranches.resolve(none);
    });
    mocks.ask.mockResolvedValue(true);
    mocks.start.mockResolvedValue(undefined);
    await act(async () => button("Publish 0.1.109")!.click());
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(
      "/other-project",
      "0.1.109",
      next.sourceSha,
    );
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
