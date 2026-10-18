// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteChatReview } from "../lib/chatReview";
import { notifyGitChanged } from "../lib/fs";
import { recordShipped } from "../lib/shippedChats";
import { SessionChangesDiff, shippedLine } from "./SessionChangesDiff";

const native = vi.hoisted(() => ({
  files: [] as {
    path: string;
    relative: string;
    status: string;
    additions: number;
    deletions: number;
    exact: boolean;
    undoable: boolean;
  }[],
  statusReads: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "session_checkpoint_status") {
      native.statusReads += 1;
      return { files: native.files };
    }
    if (command === "session_checkpoint_file_diff")
      return {
        original: "a\n",
        current: "a\nb\n",
        binary: false,
        tooLarge: false,
        path: "/repo/app.js",
      };
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("./UnifiedDiffView", async () => {
  const { createElement } = await import("react");
  return {
    UnifiedDiffView: ({ files }: { files: { label: string }[] }) =>
      createElement(
        "div",
        { "data-diff": "" },
        files.map((file) => file.label).join(", "),
      ),
  };
});

const appJs = {
  path: "/repo/app.js",
  relative: "app.js",
  status: "modified",
  additions: 1,
  deletions: 0,
  exact: true,
  undoable: true,
};

let root: Root;
let container: HTMLDivElement;
let values: Map<string, string>;
let onClose: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  native.files = [appJs];
  native.statusReads = 0;
  onClose = vi.fn<() => void>();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(SessionChangesDiff, {
        cwd: "/repo",
        sessionId: "chat-1",
        onClose,
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ship = (at: number) =>
  recordShipped([
    {
      sessionId: "chat-1",
      project: "/repo",
      cwd: "/repo",
      at,
      commit: { sha: "1a2b3c4d5e", shortSha: "1a2b3c4", subject: "Add b" },
    },
  ]);

describe("Session Changes after Ship it", () => {
  it("says the changes shipped, with the commit, instead of the old diff", async () => {
    noteChatReview(
      { sessionId: "chat-1", project: "/repo", cwd: "/repo", files: [appJs] },
      1_000,
    );
    await render();
    expect(container.querySelector("[data-diff]")?.textContent).toBe("app.js");
    await act(async () => ship(2_000));
    expect(container.querySelector("[data-diff]")).toBeNull();
    expect(container.textContent).toContain(
      "Shipped · 1a2b3c4 · nothing left to review",
    );
    const close = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Close",
    )!;
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows newer changes made after the ship", async () => {
    ship(1_000);
    noteChatReview(
      { sessionId: "chat-1", project: "/repo", cwd: "/repo", files: [appJs] },
      2_000,
    );
    await render();
    expect(container.querySelector("[data-diff]")?.textContent).toBe("app.js");
  });

  it("reads again when Git changes and its changes went away", async () => {
    await render();
    expect(container.querySelector("[data-diff]")).not.toBeNull();
    const reads = native.statusReads;
    // A Git change that leaves the same changes keeps the diff as it is.
    await act(async () => notifyGitChanged("/repo"));
    expect(native.statusReads).toBe(reads + 1);
    expect(container.querySelector("[data-diff]")).not.toBeNull();
    native.files = [];
    await act(async () => notifyGitChanged("/repo"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("No session changes");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Close",
      ),
    ).toBe(true);
  });

  it("words the shipped line with or without a commit", () => {
    expect(shippedLine("1a2b3c4")).toBe(
      "Shipped · 1a2b3c4 · nothing left to review",
    );
    expect(shippedLine(undefined)).toBe("Shipped · nothing left to review");
  });
});
