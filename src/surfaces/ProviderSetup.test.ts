// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ProviderSetup } from "./ProviderSetup";
import {
  loadProviderSetup,
  saveProviderSetup,
  type ProviderSetupCheck,
  type ProviderSetupPlan,
} from "../lib/providerSetup";

const platform = vi.hoisted(() => ({ IS_MAC: true, IS_WIN: false }));
vi.mock("../lib/platform", () => platform);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./TerminalView", () => ({
  TerminalView: (props: { setupCommand?: string; ephemeral?: boolean }) =>
    createElement(
      "div",
      { "data-ephemeral": props.ephemeral, "data-testid": "setup-terminal" },
      props.setupCommand,
    ),
}));
vi.mock("../lib/inAppLinks", () => ({
  openInAppUrl: vi.fn().mockResolvedValue(undefined),
}));

const missing: ProviderSetupCheck = {
  harness: "codex",
  platform: "macos",
  status: "missing",
  version: null,
  message: "Codex is not installed.",
};
const ready: ProviderSetupCheck = {
  ...missing,
  status: "ready",
  version: "1.0.0",
  message: "Sign-in is confirmed.",
};
const plan: ProviderSetupPlan = {
  harness: "codex",
  platform: "macos",
  action: "install",
  command: "official-installer",
  docsUrl: "https://developers.openai.com/codex/cli",
  message: "Install the selected CLI.",
};
let container: HTMLDivElement;
let root: Root;
let onDone: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  platform.IS_MAC = true;
  platform.IS_WIN = false;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "provider_setup_plan" ? plan : missing,
    );
  onDone = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(StrictMode, null, createElement(ProviderSetup, { onDone })),
    ),
  );
}
function button(text: string) {
  const result = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) =>
      item.textContent?.trim() === text ||
      item.getAttribute("aria-label") === text,
  );
  expect(result, text).toBeDefined();
  return result!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function chooseCodex() {
  await click("Connect Codex");
  await click("Continue");
}

describe("chosen-provider setup", () => {
  it("does not preselect, check, install, or sign in to any provider on launch", async () => {
    await render();
    expect(button("Continue").disabled).toBe(true);
    expect(
      [...container.querySelectorAll('[role="checkbox"]')].every(
        (item) => item.getAttribute("aria-checked") === "false",
      ),
    ).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    await click("Connect Codex");
    expect(loadProviderSetup().selected).toEqual(["codex"]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("checks only the selected provider after Continue, including when setup resumes", async () => {
    saveProviderSetup({ selected: ["codex"], finished: true });
    await render();
    expect(invoke).not.toHaveBeenCalled();
    expect(button("Connect Codex").getAttribute("aria-checked")).toBe("true");
    await click("Continue");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("provider_setup_check", {
      harness: "codex",
    });
    expect(container.textContent).toContain("Not installed");
  });
  it("requires an explicit Run after the chosen installation is prepared", async () => {
    await render();
    await chooseCodex();
    await click("Install CLI");
    expect(invoke).toHaveBeenCalledWith("provider_setup_plan", {
      harness: "codex",
      action: "install",
    });
    expect(
      container.querySelector('[data-testid="setup-terminal"]'),
    ).toBeNull();
    await click("Run installation");
    expect(
      container.querySelector('[data-testid="setup-terminal"]')?.textContent,
    ).toBe("official-installer");
    expect(
      container
        .querySelector('[data-testid="setup-terminal"]')
        ?.getAttribute("data-ephemeral"),
    ).toBe("true");
    await click("Close & check");
    expect(
      container.querySelector('[data-testid="setup-terminal"]'),
    ).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  it("does not prepare duplicate commands and ignores an action plan returned after unmount", async () => {
    let resolve!: (value: ProviderSetupPlan) => void;
    await render();
    await chooseCodex();
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => {
      button("Install CLI").click();
      button("Install CLI").click();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => resolve(plan));
    expect(
      container.querySelector('[data-testid="setup-terminal"]'),
    ).toBeNull();
  });
  it("keeps installed separate from authenticated and never sends a test automatically", async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...ready,
      status: "installed",
      message: "Finish provider setup.",
    });
    await render();
    await chooseCodex();
    expect(container.textContent).toContain("connection not checked");
    expect(container.textContent).not.toContain("Send test message");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("sends a test only when requested and marks success only after the response", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...ready, harness: "claude" });
    await render();
    await click("Connect Claude Code");
    await click("Continue");
    expect(container.textContent).toContain("Signed in");
    expect(invoke).not.toHaveBeenCalledWith(
      "provider_setup_verify",
      expect.anything(),
    );
    await click("Send test message");
    expect(invoke).toHaveBeenCalledWith("provider_setup_verify", {
      harness: "claude",
    });
    expect(container.textContent).toContain("Connection tested");
    await click("Continue");
    expect(container.textContent).toContain("responded to a test message");
    await click("Open Aven");
    expect(onDone).toHaveBeenCalledWith("claude");
  });
  it("shows a failed connection test without declaring setup ready", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ...ready, harness: "claude" })
      .mockResolvedValueOnce({
        ...ready,
        harness: "claude",
        status: "error",
        message: "The test did not finish. Try again.",
      });
    await render();
    await click("Connect Claude Code");
    await click("Continue");
    await click("Send test message");
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).not.toContain("Connection tested");
  });
  it("checks Codex sign-in and directs its first-response verification through a real task", async () => {
    vi.mocked(invoke).mockResolvedValue(ready);
    await render();
    await chooseCodex();
    expect(container.textContent).toContain("Signed in");
    expect(container.textContent).not.toContain("Send test message");
    expect(container.textContent).toContain("Start your first task in Aven");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("offers deferral and keeps user choices for later", async () => {
    await render();
    await click("Connect Codex");
    await click("Set up later");
    expect(loadProviderSetup()).toEqual({
      selected: ["codex"],
      finished: true,
    });
    expect(onDone).toHaveBeenCalledWith();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("lets a manually connected provider become the first-task choice without claiming authentication", async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...ready,
      harness: "pi",
      status: "installed",
      message: "Follow the provider guide, then start a task.",
    });
    await render();
    container.querySelector("details")!.open = true;
    await click("Connect Pi");
    await click("Continue");
    expect(container.textContent).toContain("connection not checked");
    expect(container.textContent).not.toContain("Signed in");
    await click("Continue setup later");
    await click("Open Aven");
    expect(onDone).toHaveBeenCalledWith("pi");
  });
  it("uses the same explicit choice flow on Windows", async () => {
    platform.IS_MAC = false;
    platform.IS_WIN = true;
    await render();
    expect(container.textContent).toContain("Windows");
    expect(button("Continue").disabled).toBe(true);
    await chooseCodex();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("provider_setup_check", {
      harness: "codex",
    });
  });
});
