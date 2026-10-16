// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.141"),
  getIdentifier: vi.fn().mockResolvedValue("com.capi.aven.dev"),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("./sounds", () => ({ announceUpdateAvailable: vi.fn() }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.querySelector("[data-update-input-lock]")?.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load() {
  return {
    preview: await import("./updateRestartPreview"),
    updater: await import("./updater"),
    work: await import("./updateRestartWork"),
    palette: await import("./commandPalette"),
  };
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label,
  );
}

describe("restart-to-update previews in development builds", () => {
  it("shows the question with made-up work, and its actions only close it", async () => {
    const { preview, work } = await load();
    const { UpdateRestartDialog } =
      await import("../chrome/UpdateRestartDialog");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(UpdateRestartDialog));
    });
    await act(async () => {
      expect(preview.previewUpdateRestart("question")).toBe(true);
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("1 agent is working: Fix login (Aven)");
    expect(text).toContain(
      "1 agent is waiting for your answer: Review PR (Cadence)",
    );
    expect(text).toContain("1 terminal is running npm");
    expect(text).toContain("1 file has unsaved changes: App.tsx (Aven)");
    // A real question already on screen is never covered.
    expect(preview.previewUpdateRestart("question")).toBe(false);
    await act(async () => button("Stop them and restart now")!.click());
    expect(work.getRestartDecision()).toBeNull();
    expect(document.body.textContent).not.toContain("Fix login");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("shows the waiting card, and Restart now or Cancel only close it", async () => {
    const { preview, updater } = await load();
    expect(preview.previewUpdateRestart("waiting")).toBe(true);
    expect(updater.getUpdaterSnapshot()).toMatchObject({
      phase: "ready",
      waitingFor: "your agents finish",
    });
    expect(preview.previewUpdateRestart("waiting")).toBe(false);
    // A background check while previewing does not replace the preview; its
    // result shows once the preview closes.
    await updater.runUpdateFlow(false);
    expect(updater.getUpdaterSnapshot().waitingFor).toBe("your agents finish");
    await updater.restartUpdateNow();
    const before = updater.getUpdaterSnapshot();
    expect(before).toMatchObject({ phase: "idle", developmentBuild: true });
    expect(preview.previewUpdateRestart("waiting")).toBe(true);
    await updater.cancelUpdateWait();
    expect(updater.getUpdaterSnapshot()).toBe(before);
    expect(preview.previewUpdateRestart("waiting")).toBe(true);
    await updater.installPendingUpdate();
    expect(updater.getUpdaterSnapshot()).toBe(before);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("shows the overlay with a waiting label until a click or key press", async () => {
    const { preview } = await load();
    expect(preview.previewUpdateRestart("overlay")).toBe(true);
    const overlay = document.querySelector("[data-update-input-lock]");
    expect(overlay?.textContent).toContain(
      "Waiting for Aven to finish updating Claude Code…",
    );
    expect(overlay?.textContent).toContain("Preview");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(document.querySelector("[data-update-input-lock]")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("lists the previews in the command palette", async () => {
    const { palette } = await load();
    expect(palette.DEV_PALETTE_COMMANDS.map((command) => command.id)).toEqual([
      "preview_restart_question",
      "preview_restart_waiting",
      "preview_restart_overlay",
    ]);
  });
});

describe("restart-to-update previews in release builds", () => {
  it("cannot be reached", async () => {
    vi.stubEnv("DEV", false);
    const { preview, updater, work, palette } = await load();
    const before = updater.getUpdaterSnapshot();
    expect(preview.updateRestartPreviewsAvailable()).toBe(false);
    expect(palette.DEV_PALETTE_COMMANDS).toEqual([]);
    for (const kind of ["question", "waiting", "overlay"] as const)
      expect(preview.previewUpdateRestart(kind)).toBe(false);
    expect(updater.previewUpdateWaiting("your agents finish")).toBe(false);
    expect(work.getRestartDecision()).toBeNull();
    expect(updater.getUpdaterSnapshot()).toBe(before);
    expect(document.querySelector("[data-update-input-lock]")).toBeNull();
  });
});
