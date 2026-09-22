// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../lib/session";
import { useAutomaticModelCatalogs } from "./useAutomaticModelCatalogs";

const catalog = vi.hoisted(() => ({
  installed: new Set<string>(),
  loaded: new Set<string>(),
  hidden: new Set<string>(),
  probe: vi.fn(async () => {}),
  refresh: vi.fn(async (_ids: HarnessId[]) => {}),
  updateTools: vi.fn(async (_ids: HarnessId[]) => new Set<HarnessId>()),
  preferenceListeners: new Set<() => void>(),
}));
vi.mock("../lib/harness/availability", () => ({
  isHarnessAvailable: (id: string) => catalog.installed.has(id),
  probeHarnessAvailability: catalog.probe,
}));
vi.mock("../lib/harness/registry", () => ({
  HARNESS_CATALOG_RETRY_MS: 300_000,
  isLiveHarness: () => true,
  refreshHarnessCatalogs: catalog.refresh,
}));
vi.mock("../lib/models", () => ({
  hasLiveCatalog: (id: string) => catalog.loaded.has(id),
  isPickerProviderVisible: (id: string) => !catalog.hidden.has(id),
}));
vi.mock("../lib/providerToolUpdates", () => ({
  refreshAutomaticProviderTools: catalog.updateTools,
  subscribeProviderToolAutoUpdates: (listener: () => void) => {
    catalog.preferenceListeners.add(listener);
    return () => catalog.preferenceListeners.delete(listener);
  },
}));

let root: Root;
let container: HTMLDivElement;
function Harness({ providers }: { providers: HarnessId[] }) {
  useAutomaticModelCatalogs(providers.map((harness) => ({ harness })));
  return null;
}
async function render(providers: HarnessId[] = []) {
  await act(async () => root.render(createElement(Harness, { providers })));
}
async function dispatch(target: Window | Document, event: string) {
  await act(async () => {
    target.dispatchEvent(new Event(event));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  catalog.installed.clear();
  catalog.loaded.clear();
  catalog.hidden.clear();
  catalog.probe.mockReset().mockResolvedValue(undefined);
  catalog.refresh.mockReset().mockResolvedValue(undefined);
  catalog.updateTools.mockReset().mockResolvedValue(new Set());
  catalog.preferenceListeners.clear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic model catalogs", () => {
  it("loads installed account providers and used catalogs without starting unused extension hosts", async () => {
    catalog.installed = new Set(["codex", "claude", "pi", "omp"]);
    catalog.loaded.add("cursor");
    await render(["grok"]);
    expect(catalog.refresh).toHaveBeenCalledExactlyOnceWith([
      "claude",
      "codex",
      "cursor",
      "grok",
    ]);
  });

  it("respects a hidden unused account provider but keeps a used one current", async () => {
    catalog.installed = new Set(["codex", "claude"]);
    catalog.hidden.add("claude");
    await render();
    expect(catalog.refresh).toHaveBeenLastCalledWith(["codex"]);
    await render(["claude"]);
    expect(catalog.refresh).toHaveBeenLastCalledWith(["claude", "codex"]);
  });

  it("checks on focus, resume, reconnect and while the app remains open", async () => {
    catalog.installed.add("codex");
    await render();
    await dispatch(window, "focus");
    await dispatch(document, "visibilitychange");
    await dispatch(window, "online");
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(catalog.refresh).toHaveBeenCalledTimes(5);
    expect(catalog.refresh).toHaveBeenLastCalledWith(["codex"]);
  });

  it("does no hidden or offline work and discovers a newly installed provider on return", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(catalog.probe).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await dispatch(window, "focus");
    expect(catalog.probe).not.toHaveBeenCalled();
    catalog.installed.add("claude");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await dispatch(window, "online");
    expect(catalog.refresh).toHaveBeenCalledExactlyOnceWith(["claude"]);
  });

  it("coalesces lifecycle events while provider discovery is pending", async () => {
    let finish!: () => void;
    catalog.probe.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render(["codex"]);
    await dispatch(window, "focus");
    await dispatch(document, "visibilitychange");
    expect(catalog.probe).toHaveBeenCalledOnce();
    expect(catalog.refresh).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(catalog.refresh).toHaveBeenCalledExactlyOnceWith(["codex"]);
  });

  it("can retry after a failed availability probe", async () => {
    catalog.probe.mockRejectedValueOnce(new Error("Unavailable"));
    await render(["codex"]);
    expect(catalog.refresh).not.toHaveBeenCalled();
    await dispatch(window, "focus");
    expect(catalog.refresh).toHaveBeenCalledExactlyOnceWith(["codex"]);
  });

  it("rediscovers a provider immediately after its CLI updates even if the catalog was fresh", async () => {
    catalog.installed = new Set(["claude", "codex"]);
    let finish!: (updated: Set<HarnessId>) => void;
    catalog.updateTools.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    expect(catalog.refresh).not.toHaveBeenCalled();
    await act(async () => finish(new Set(["codex"])));
    expect(catalog.refresh).toHaveBeenCalledWith(["claude"]);
    expect(catalog.refresh).toHaveBeenCalledWith(new Set(["codex"]), {
      force: true,
    });
    await act(async () =>
      catalog.preferenceListeners.forEach((listener) => listener()),
    );
    expect(catalog.updateTools).toHaveBeenCalledTimes(2);
  });

  it("removes listeners and timers and ignores pending discovery after unmount", async () => {
    let finish!: () => void;
    catalog.probe.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render(["codex"]);
    await act(async () => root.unmount());
    await act(async () => finish());
    await dispatch(window, "focus");
    await dispatch(document, "visibilitychange");
    await dispatch(window, "online");
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(catalog.probe).toHaveBeenCalledOnce();
    expect(catalog.refresh).not.toHaveBeenCalled();
    expect(catalog.preferenceListeners.size).toBe(0);
  });
});
