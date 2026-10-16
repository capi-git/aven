// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  observeSharedWorkEvent,
  resetSharedWork,
  sharedWorkTurnEnded,
  sharedWorkTurnStarted,
} from "../lib/sharedWork";
import { SharedWorkBar } from "./SharedWorkBar";

const SITE = "/Users/me/site";
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSharedWork();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetSharedWork();
  vi.unstubAllGlobals();
});

function edit(sessionId: string, path: string) {
  observeSharedWorkEvent(sessionId, {
    type: "tool.started",
    callId: `${sessionId}:${path}`,
    title: `Edit ${path}`,
    kind: "edit",
    paths: [path],
  });
}

it("says which agent also edits this chat's files, and goes when its turn ends", async () => {
  const renders = vi.fn();
  function Probe() {
    renders();
    return createElement(SharedWorkBar, { sessionId: "claude" });
  }
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    sharedWorkTurnStarted({
      sessionId: "claude",
      harness: "claude",
      cwd: SITE,
    });
    sharedWorkTurnStarted({ sessionId: "codex", harness: "codex", cwd: SITE });
    edit("claude", "src/App.tsx");
    edit("codex", "src/other.ts");
  });
  expect(host.querySelector("[data-shared-work-bar]")).toBeNull();
  await act(async () => edit("codex", "src/App.tsx"));
  const bar = host.querySelector<HTMLElement>(
    '[data-shared-work-bar="claude"]',
  );
  expect(bar?.textContent).toBe("Codex is also editing src/App.tsx");
  expect(bar?.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => sharedWorkTurnEnded("codex"));
  expect(host.querySelector("[data-shared-work-bar]")).toBeNull();
  // The parent never re-rendered for the store's changes.
  expect(renders).toHaveBeenCalledTimes(1);
});
