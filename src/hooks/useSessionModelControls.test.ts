// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../lib/session";
import { useWorkspaceSessions } from "./useWorkspaceSessions";

const forgetHarnessSession = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../lib/harness/registry", () => ({ forgetHarnessSession }));

import { useSessionModelControls } from "./useSessionModelControls";

type Controls = ReturnType<typeof useSessionModelControls>;
let controls: Controls;
let sessions: Session[];
let root: Root;
let host: HTMLElement;
const seed = { ...newSession("cursor", "/tmp/project"), id: "s" };

function Harness() {
  const workspace = useWorkspaceSessions(() => [seed]);
  sessions = workspace.sessions;
  controls = useSessionModelControls(workspace);
  return null;
}

beforeEach(() => {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  forgetHarnessSession.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps every control's identity across renders", async () => {
  await act(async () => root.render(createElement(Harness)));
  const first = controls;
  await act(async () => controls.onRuntimeModeChange("s", "auto"));
  expect(sessions[0].runtimeMode).toBe("auto");
  expect(controls.onModelChange).toBe(first.onModelChange);
  expect(controls.onModelSettingsChange).toBe(first.onModelSettingsChange);
  expect(controls.onRuntimeModeChange).toBe(first.onRuntimeModeChange);
});

it("switches an unused session's provider and forgets the old one", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () =>
    controls.onModelChange("s", "claude", "claude:sonnet-5"),
  );
  expect(sessions[0].harness).toBe("claude");
  expect(sessions[0].pendingSwitch).toBeUndefined();
  expect(forgetHarnessSession).toHaveBeenCalledWith("cursor", "s");
});
