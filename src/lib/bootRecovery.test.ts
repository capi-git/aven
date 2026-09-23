// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showRenderFailure } from "./renderFailure";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

let splash: HTMLElement;
let logo: HTMLImageElement;
let title: HTMLElement;
let message: HTMLElement;
let retry: HTMLButtonElement;
let entry: HTMLScriptElement;
let reload: ReturnType<typeof vi.spyOn>;
let disconnect: ReturnType<typeof vi.spyOn>;
let startRecovery: () => void;

function isolatedStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", isolatedStorage());
  vi.stubGlobal("sessionStorage", isolatedStorage());
  const markup = new DOMParser().parseFromString(indexHtml, "text/html");
  const recovery = markup.querySelector<HTMLScriptElement>(
    "#aven-boot-recovery",
  )!;
  const script = recovery.textContent!;
  const module = markup.querySelector<HTMLScriptElement>(
    'script[type="module"][src]',
  )!;
  // Keep the real entry element's attributes, but never fetch or execute the
  // application's module graph in this isolated startup test.
  module.removeAttribute("src");
  for (const other of markup.querySelectorAll("script")) {
    if (other !== module) other.remove();
  }
  for (const image of markup.querySelectorAll("img"))
    image.removeAttribute("src");
  document.body.replaceChildren(...markup.body.childNodes);
  splash = document.getElementById("boot-splash")!;
  logo = splash.querySelector("img")!;
  title = document.getElementById("boot-title")!;
  message = document.getElementById("boot-message")!;
  retry = document.getElementById("boot-retry") as HTMLButtonElement;
  entry = module;
  Object.defineProperties(logo, {
    complete: { configurable: true, value: false },
    naturalWidth: { configurable: true, value: 0 },
  });
  reload = vi
    .spyOn(window.location, "reload")
    .mockImplementation(() => undefined);
  disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  startRecovery = () => window.eval(script);
});

afterEach(async () => {
  document.body.replaceChildren();
  await vi.advanceTimersByTimeAsync(0);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pre-module boot recovery", () => {
  it("shows an accessible recovery action when the entry module cannot load", () => {
    startRecovery();
    expect(retry.hidden).toBe(true);
    entry.dispatchEvent(new Event("error"));

    expect(title.textContent).toBe("Aven couldn’t load its interface");
    expect(message.hidden).toBe(false);
    expect(message.textContent).toContain("required app file");
    expect(retry.hidden).toBe(false);
    expect(retry.textContent).toBe("Retry loading");
    expect(splash.style.pointerEvents).toBe("auto");
    expect(
      splash.querySelector('[role="status"][aria-live="polite"]'),
    ).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    retry.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each(["later error", "already failed"])(
    "hides a logo with %s without interrupting normal startup",
    async (failure) => {
      if (failure === "already failed") {
        Object.defineProperty(logo, "complete", {
          configurable: true,
          value: true,
        });
      }
      startRecovery();
      if (failure === "later error") logo.dispatchEvent(new Event("error"));

      expect(logo.hidden).toBe(true);
      expect(title.textContent).toBe("Opening Aven…");
      expect(message.hidden).toBe(true);
      expect(retry.hidden).toBe(true);
      splash.dataset.dismissed = "1";
      await vi.advanceTimersByTimeAsync(20_000);
      expect(retry.hidden).toBe(true);
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("offers retry after 15 seconds without restarting or discarding saved state", async () => {
    const savedWorkspace = JSON.stringify({
      sessions: [{ id: "saved", draft: "Unsent work" }],
    });
    window.localStorage.setItem(
      "monocode.composerDraft.v1:saved",
      savedWorkspace,
    );
    window.sessionStorage.setItem("aven-test-window", "saved-window");
    const writes = [
      vi.spyOn(window.localStorage, "setItem"),
      vi.spyOn(window.localStorage, "removeItem"),
      vi.spyOn(window.localStorage, "clear"),
      vi.spyOn(window.sessionStorage, "setItem"),
      vi.spyOn(window.sessionStorage, "removeItem"),
      vi.spyOn(window.sessionStorage, "clear"),
    ];
    startRecovery();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(retry.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(title.textContent).toBe("Aven is taking longer to open");
    expect(message.textContent).toContain("keep waiting");
    expect(retry.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reload).not.toHaveBeenCalled();
    retry.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("monocode.composerDraft.v1:saved")).toBe(
      savedWorkspace,
    );
    expect(window.sessionStorage.getItem("aven-test-window")).toBe(
      "saved-window",
    );
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it.each([0, 15_000])(
    "releases recovery after a committed ready signal at %i ms, even if loading was slow",
    async (elapsed) => {
      startRecovery();
      await vi.advanceTimersByTimeAsync(elapsed);
      splash.dataset.dismissed = "1";
      await vi.advanceTimersByTimeAsync(0);
      const readyText = title.textContent;
      const readyImageVisibility = logo.hidden;

      expect(disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      entry.dispatchEvent(new Event("error"));
      logo.dispatchEvent(new Event("error"));
      retry.click();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(title.textContent).toBe(readyText);
      expect(logo.hidden).toBe(readyImageVisibility);
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("does not race a ready signal before its mutation observer runs", () => {
    startRecovery();
    splash.dataset.dismissed = "1";
    entry.dispatchEvent(new Event("error"));
    expect(retry.hidden).toBe(true);
    expect(title.textContent).toBe("Opening Aven…");
    retry.click();
    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases recovery when a runtime failure replaces the splash", async () => {
    startRecovery();
    splash.remove();
    const root = document.getElementById("root")!;
    showRenderFailure(root, new Error("Workspace failed"));
    await vi.advanceTimersByTimeAsync(0);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    retry.click();
    entry.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).not.toHaveBeenCalled();
    expect(document.getElementById("boot-splash")).toBeNull();
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.querySelector("h1")?.textContent).toBe(
      "Aven couldn’t display this workspace",
    );
    alert.querySelector<HTMLButtonElement>("button")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });
});
