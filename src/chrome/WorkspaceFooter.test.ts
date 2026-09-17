// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFooter, type WorkspaceFooterProps } from "./WorkspaceFooter";
import {
  applyProjectDiffStats,
  useProjectDiffStats,
} from "../hooks/useProjectDiffStats";
import { notifyGitChanged } from "../lib/fs";

const { readStats } = vi.hoisted(() => ({ readStats: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { cwd: string }) => {
    if (command === "git_diff_stats") return readStats(args.cwd);
    throw new Error(`Unexpected native command: ${command}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
let props: WorkspaceFooterProps;
let hidden: boolean;
let sequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  readStats.mockResolvedValue({ files: 4, additions: 64872, deletions: 14719 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    active: true,
    cwd: `/footer-${++sequence}`,
    branch: "feature/research-results",
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<WorkspaceFooterProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(WorkspaceFooter, props)));
}

describe("WorkspaceFooter", () => {
  it("keeps projectless terminal access without Git controls or reads", async () => {
    const cwd =
      "/Users/test/Library/Application Support/com.capi.supermono/projectless-workspaces/personal";
    localStorage.setItem(
      "monocode.projectlessWorkspaces.v1",
      JSON.stringify({ personal: cwd }),
    );
    const terminal = vi.fn();
    await render({
      cwd,
      onToggleTerminal: terminal,
      onOpenChanges: vi.fn(),
      onOpenBranchPicker: vi.fn(),
      onCreatePR: vi.fn(),
      onOpenPRMenu: vi.fn(),
    });
    expect(container.textContent).toContain("No project");
    expect(container.textContent).not.toContain(cwd);
    expect(container.querySelector(".workspace-footer-branch")).toBeNull();
    expect(container.querySelector(".workspace-footer-pr")).toBeNull();
    expect(container.querySelector('[aria-label="Open changes"]')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show terminal"]',
    )!;
    expect(toggle.disabled).toBe(false);
    await act(async () => {
      toggle.click();
      notifyGitChanged();
      window.dispatchEvent(new Event("focus"));
    });
    expect(terminal).toHaveBeenCalledOnce();
    expect(readStats).not.toHaveBeenCalled();
  });

  it("shows real stats and stops Git work when hidden or inactive", async () => {
    await render({ active: false });
    expect(container.childElementCount).toBe(0);
    expect(readStats).not.toHaveBeenCalled();
    await render({ active: true });
    expect(readStats).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("+64872");
    expect(container.textContent).toContain("-14719");
    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      notifyGitChanged();
    });
    expect(readStats).toHaveBeenCalledOnce();
    await render({ active: false });
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      notifyGitChanged();
    });
    expect(readStats).toHaveBeenCalledOnce();
  });

  it("shares one stats read with another surface and accepts published Git index stats", async () => {
    function OtherSurface() {
      useProjectDiffStats(props.cwd, true);
      return null;
    }
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(WorkspaceFooter, props),
          createElement(OtherSurface),
        ),
      ),
    );
    expect(readStats).toHaveBeenCalledOnce();
    await act(async () =>
      applyProjectDiffStats(props.cwd, {
        files: 2,
        additions: 17,
        deletions: 3,
      }),
    );
    expect(container.textContent).toContain("+17");
    expect(container.textContent).toContain("-3");
    expect(readStats).toHaveBeenCalledOnce();
  });

  it("does not invent zero stats or a branch when metadata is unavailable", async () => {
    readStats.mockRejectedValue(new Error("Not a Git repository"));
    await render({ branch: undefined });
    expect(
      container.querySelector(".workspace-footer-branch")?.textContent,
    ).toBe("—");
    expect(container.querySelector(".workspace-footer-stats")).toBeNull();
    await render({ detached: true });
    expect(
      container.querySelector(".workspace-footer-branch")?.textContent,
    ).toBe("Detached HEAD");
    await render({ cwd: "~", detached: false });
    expect(readStats).toHaveBeenCalledOnce();
    expect(
      [...container.querySelectorAll("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });

  it("routes branch, PR, Changes and Terminal controls to their actual callbacks", async () => {
    const branchPicker = vi.fn();
    const changes = vi.fn();
    const terminal = vi.fn();
    const createPR = vi.fn();
    const prMenu = vi.fn();
    await render({
      onOpenBranchPicker: branchPicker,
      onOpenChanges: changes,
      onToggleTerminal: terminal,
      onCreatePR: createPR,
      onOpenPRMenu: prMenu,
      changesOpen: true,
      terminalOpen: true,
    });
    const click = async (selector: string) => {
      const button = container.querySelector<HTMLButtonElement>(selector)!;
      await act(async () => button.click());
      return button;
    };
    const branchButton = await click(".workspace-footer-branch");
    expect(branchPicker).toHaveBeenCalledWith(branchButton);
    await click(".workspace-footer-stats");
    await click('[aria-label="Open changes"]');
    expect(changes).toHaveBeenCalledTimes(2);
    await click('[aria-label="Hide terminal"]');
    expect(terminal).toHaveBeenCalledOnce();
    await click(".workspace-footer-pr-action");
    expect(createPR).toHaveBeenCalledOnce();
    const menuButton = await click(".workspace-footer-pr-menu");
    expect(prMenu).toHaveBeenCalledWith(menuButton);
    expect(
      container
        .querySelector('[aria-label="Open changes"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("disables unavailable actions with the supplied reason", async () => {
    const createPR = vi.fn();
    await render({
      onCreatePR: createPR,
      createPRDisabledReason: "No GitHub remote is configured",
    });
    const button = container.querySelector<HTMLButtonElement>(
      ".workspace-footer-pr-action",
    )!;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("No GitHub remote is configured");
    await act(async () => button.click());
    expect(createPR).not.toHaveBeenCalled();
  });
});
