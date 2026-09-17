// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showRenderFailure } from "./renderFailure";

const reactRoots: Root[] = [];
afterEach(() => {
  if (reactRoots.length) vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const root of reactRoots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function workspaceRoot() {
  const root = document.createElement("div");
  root.id = "root";
  root.textContent = "Broken workspace";
  document.body.append(root);
  return root;
}

describe("render failure recovery", () => {
  it("replaces the failed UI with an opaque, accessible recovery action", () => {
    const root = workspaceRoot();
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => undefined);
    showRenderFailure(root, new Error("Render failed"));

    const alert = root.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.querySelector("h1")?.textContent).toBe(
      "Aven couldn’t display this workspace",
    );
    expect(alert.getAttribute("aria-labelledby")).toBe(
      alert.querySelector("h1")?.id,
    );
    expect(alert.style.background).toBe("#151518");
    expect(alert.textContent).not.toContain("Broken workspace");
    expect(alert.querySelector("p")?.textContent).toContain("saved sessions");
    expect(alert.querySelector("details")?.open).toBe(false);
    const button = alert.querySelector("button")!;
    expect(button.textContent).toBe("Reload interface");
    expect(document.activeElement).toBe(button);
    expect(reload).not.toHaveBeenCalled();
    button.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps error text and stacks inert inside a closed disclosure", () => {
    const root = workspaceRoot();
    const error = new Error('<img src=x onerror="alert(1)">');
    error.stack = "Error stack <script>example()</script>";
    showRenderFailure(root, error, "at Workspace (<b>component</b>)");
    const report = root.querySelector("details pre")!;
    expect(report.textContent).toContain(String(error));
    expect(report.textContent).toContain(error.stack);
    expect(report.textContent).toContain("at Workspace (<b>component</b>)");
    expect(report.children).toHaveLength(0);
    expect(root.querySelector("img, script, b")).toBeNull();
  });

  it("handles thrown values without relying on their string conversion", () => {
    const root = workspaceRoot();
    showRenderFailure(root, {
      toString() {
        throw new Error("conversion failed");
      },
    });
    expect(root.querySelector("pre")?.textContent).toBe(
      "Unknown rendering error",
    );
    expect(root.querySelector("button")).not.toBeNull();
  });

  it("replaces repeated failures without duplicate panels or changing saved state", () => {
    const root = workspaceRoot();
    const sibling = document.createElement("aside");
    document.body.append(sibling);
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);
    showRenderFailure(root, "First failure");
    showRenderFailure(root, "Second failure");
    expect(root.querySelectorAll("[data-render-failure]")).toHaveLength(1);
    expect(root.querySelector("pre")?.textContent).toBe("Second failure");
    expect(sibling.isConnected).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it.each(["render", "effect"] as const)(
    "survives React root cleanup after a button triggers an uncaught %s error",
    async (phase) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const saved = JSON.stringify({
        sessions: [{ id: "saved-session", title: "Preserved conversation" }],
      });
      const values = new Map([["saved-workspace", saved]]);
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
        clear: vi.fn(() => values.clear()),
      };
      vi.stubGlobal("localStorage", storage);
      const reload = vi
        .spyOn(window.location, "reload")
        .mockImplementation(() => undefined);
      const container = workspaceRoot();
      const splash = document.createElement("div");
      splash.id = "boot-splash";
      document.body.append(splash);
      const cleanup = vi.fn();
      const failure = new Error(`Workspace ${phase} failure`);

      function Workspace() {
        const [failed, setFailed] = useState(false);
        useEffect(() => cleanup, []);
        useEffect(() => {
          if (failed && phase === "effect") throw failure;
        }, [failed]);
        if (failed && phase === "render") throw failure;
        return createElement(
          "button",
          { type: "button", onClick: () => setFailed(true) },
          "Close session",
        );
      }

      // Mirror main.tsx: React owns teardown; the uncaught-error callback
      // replaces the emptied root with a recovery panel outside React.
      const onUncaughtError = vi.fn(
        (error: unknown, info: { componentStack?: string | null }) => {
          document.getElementById("boot-splash")?.remove();
          showRenderFailure(
            document.getElementById("root") as HTMLElement,
            error,
            info.componentStack,
          );
        },
      );
      const root = createRoot(container, { onUncaughtError });
      reactRoots.push(root);
      await act(async () => root.render(createElement(Workspace)));
      const close = container.querySelector("button")!;
      expect(close.textContent).toBe("Close session");
      // React 19's development act() deliberately diverts uncaught errors
      // into its own thrownErrors queue instead of calling onUncaughtError.
      // Flush the actual browser callback path outside act for this failure.
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      flushSync(() => close.click());
      // Allow queued effects and event-loop work to finish before checking
      // that no later React cleanup erased the imperative recovery panel.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUncaughtError).toHaveBeenCalledOnce();
      expect(onUncaughtError.mock.calls[0][0]).toBe(failure);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(splash.isConnected).toBe(false);
      const panel = container.querySelector('[role="alert"]')!;
      expect(panel).not.toBeNull();
      expect(panel.querySelector("h1")?.textContent).toBe(
        "Aven couldn’t display this workspace",
      );
      expect(panel.querySelector("pre")?.textContent).toContain(
        String(failure),
      );
      expect(panel.querySelector("pre")?.textContent).toContain("Workspace");
      expect(panel.querySelector("details")?.open).toBe(false);
      expect(storage.getItem("saved-workspace")).toBe(saved);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(storage.clear).not.toHaveBeenCalled();
      const button = panel.querySelector("button")!;
      expect(document.activeElement).toBe(button);
      expect(reload).not.toHaveBeenCalled();
      button.click();
      expect(reload).toHaveBeenCalledOnce();
    },
  );
});
