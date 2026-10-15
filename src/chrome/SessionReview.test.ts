// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeShipRequests, takeShipRequest } from "../lib/shipRequest";
import { SessionReview } from "./SessionReview";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "session_checkpoint_status")
      return {
        files: [
          {
            path: "/repo/a.ts",
            relative: "a.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            exact: true,
            undoable: true,
          },
        ],
      };
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));

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
  takeShipRequest("/repo");
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

describe("SessionReview Ship it", () => {
  it("asks the Changes panel for this folder to ship the turn's changes", async () => {
    const heard = vi.fn();
    const stop = subscribeShipRequests(heard);
    await render();
    const ship = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Ship it",
    )!;
    expect(ship.disabled).toBe(false);
    await act(async () => ship.click());
    stop();
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo", sessionId: "s1" }),
    );
    expect(takeShipRequest("/repo")).toMatchObject({ sessionId: "s1" });
  });
});
