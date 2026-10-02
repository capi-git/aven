import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));

import type { InboxItem } from "../lib/githubTasks";
import { inboxStatusMark } from "./InboxView";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    kind: "issue",
    number: 1,
    title: "Issue",
    url: "https://github.com/acme/web/issues/1",
    state: "open",
    updatedAt: "2026-09-01T00:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    projectPath: "/work/web",
    provider: "github",
    ...overrides,
  };
}

describe("inboxStatusMark", () => {
  it("uses GitHub's purple check for issues closed as completed", () => {
    const completed = inboxStatusMark(
      item({ state: "closed", stateReason: "completed" }),
    );
    expect(completed.Icon.displayName).toBe("CheckCircle");
    expect(completed.className).toBe("text-violet-400/90");
    expect(completed.label).toBe("Closed");
  });

  it("keeps the red cross for issues closed as not planned or without a reason", () => {
    for (const stateReason of ["not_planned", "", undefined]) {
      const mark = inboxStatusMark(item({ state: "closed", stateReason }));
      expect(mark.Icon.displayName).toBe("CircleX");
      expect(mark.className).toBe("text-rose-400/90");
    }
  });

  it("does not treat a closed pull request as completed", () => {
    const mark = inboxStatusMark(
      item({ kind: "pr", state: "closed", stateReason: "completed" }),
    );
    expect(mark.Icon.displayName).toBe("GitPullRequestClosed");
  });
});
