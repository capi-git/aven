// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../lib/session";
import { useAccountUsageProviders } from "./useAccountUsageProviders";

const availability = vi.hoisted(() => ({
  installed: new Set<string>(),
  listeners: new Set<() => void>(),
}));
vi.mock("../lib/harness/availability", () => ({
  isHarnessAvailable: (provider: string) =>
    availability.installed.has(provider),
  subscribeHarnessAvailability: (listener: () => void) => {
    availability.listeners.add(listener);
    return () => availability.listeners.delete(listener);
  },
}));

let root: Root;
let container: HTMLDivElement;
function Harness({ providers }: { providers: HarnessId[] }) {
  const visible = useAccountUsageProviders(
    providers.map((harness) => ({ harness })),
  );
  return createElement("div", null, visible.join(","));
}
async function render(providers: HarnessId[] = []) {
  await act(async () => root.render(createElement(Harness, { providers })));
}
async function setInstalled(providers: HarnessId[]) {
  await act(async () => {
    availability.installed = new Set(providers);
    availability.listeners.forEach((listener) => listener());
  });
}
beforeEach(() => {
  availability.installed.clear();
  availability.listeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("account-wide usage providers", () => {
  it("keeps installed Claude visible in a Codex-only project and on home", async () => {
    await setInstalled(["claude", "codex"]);
    await render(["codex"]);
    expect(container.textContent).toBe("codex,claude");
    await render([]);
    expect(container.textContent).toBe("codex,claude");
  });

  it("adds discovered accounts without needing a model or project switch", async () => {
    await render(["codex"]);
    expect(container.textContent).toBe("codex");
    await setInstalled(["codex", "claude"]);
    expect(container.textContent).toBe("codex,claude");
  });

  it("retains a known account through a failed availability lookup", async () => {
    await setInstalled(["codex", "claude"]);
    await render(["codex"]);
    await setInstalled(["codex"]);
    expect(container.textContent).toBe("codex,claude");
  });

  it("retains a used provider when its tab closes while discovery is unavailable", async () => {
    await render(["codex", "claude"]);
    await render(["codex"]);
    expect(container.textContent).toBe("codex,claude");
  });

  it("does not invent accounts for other installed providers", async () => {
    await setInstalled(["cursor", "pi"]);
    await render(["cursor", "pi"]);
    expect(container.textContent).toBe("");
    expect(availability.listeners.size).toBe(1);
    await act(async () => root.unmount());
    expect(availability.listeners.size).toBe(0);
  });
});
