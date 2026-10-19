// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ ready: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "session_checkpoint_ensure") return native.ready;
    if (command === "session_checkpoint_status") return { files: [] };
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));

const { beginSessionTurn } = await import("../lib/checkpoint");
const { SessionReview } = await import("./SessionReview");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  native.ready = true;
  await beginSessionTurn("s1", "/repo");
  vi.unstubAllGlobals();
});

async function render(busy = false) {
  await act(async () =>
    root.render(
      createElement(SessionReview, {
        sessionId: "s1",
        cwd: "/repo",
        busy,
        onOpenDiff: vi.fn(),
      }),
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const note = () => container.querySelector("[data-session-review-missed]");

describe("a reply that went ahead without a checkpoint", () => {
  it("says Undo isn't available once the reply is done", async () => {
    native.ready = false;
    await beginSessionTurn("s1", "/repo");
    await render(true);
    expect(note()).toBeNull();
    await render(false);
    expect(note()?.textContent).toBe(
      "Undo isn't available for this reply. Aven couldn't save a checkpoint in time.",
    );
  });

  it("shows nothing when the checkpoint was taken", async () => {
    native.ready = true;
    await beginSessionTurn("s1", "/repo");
    await render(false);
    expect(note()).toBeNull();
    expect(container.textContent).toBe("");
  });
});
