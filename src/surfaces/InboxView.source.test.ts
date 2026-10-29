// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));

import { InboxView } from "./InboxView";

const PROJECT = "/work/site";

const issue = {
  kind: "issue",
  number: 7,
  title: "Fix the login redirect",
  url: "https://github.com/acme/site/issues/7",
  state: "open",
  stateReason: "",
  updatedAt: "2026-10-01T10:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
  repo: "acme/site",
};

function answer(command: string, args?: Record<string, unknown>) {
  switch (command) {
    case "git_github_repo":
      return "acme/site";
    case "git_github_work_items":
      return args?.kind === "issue" ? [issue] : [];
    case "git_github_work_item_details":
      return {
        body: "Steps to reproduce",
        author: "maya",
        authorAvatarUrl: "",
        baseRefName: "",
        headRefName: "",
        reviewDecision: "",
      };
    case "git_github_work_item_thread":
      return {
        comments: [],
        truncated: false,
        reviewDecision: "",
        baseRefName: "",
        headRefName: "",
      };
    default:
      return [];
  }
}

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  host.invoke.mockReset();
  host.invoke.mockImplementation(
    async (command: string, args?: Record<string, unknown>) =>
      answer(command, args),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderInbox() {
  await act(async () =>
    root.render(
      createElement(InboxView, {
        onAsk: async () => "",
        onAskRestart: async () => "",
        onAskMount: () => {},
        cwd: PROJECT,
        recents: [{ path: PROJECT, openedAt: 1 }],
      }),
    ),
  );
  // Let the repository lookup, list fetch and detail fetch settle.
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("Inbox source", () => {
  it("shows GitHub issues with no source switch when Linear was the saved source", async () => {
    localStorage.setItem("monocode.inboxSource", "linear");
    localStorage.setItem("monocode.linearHiddenTeams", JSON.stringify(["t1"]));
    await renderInbox();

    const inbox = container.querySelector("[data-app-inbox]")!;
    expect(inbox.textContent).toContain("Reviews, issues & pull requests");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(inbox.textContent).toContain("Fix the login redirect");
    expect(inbox.textContent).toContain("Open on GitHub");
    expect(inbox.textContent).not.toMatch(/linear/i);

    const commands = host.invoke.mock.calls.map(([command]) => command);
    expect(commands).toContain("git_github_work_items");
    expect(commands.some((command) => /linear/i.test(command))).toBe(false);
    // The old saved values are left in place, not deleted.
    expect(localStorage.getItem("monocode.inboxSource")).toBe("linear");
  });
});
