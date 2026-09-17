// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { writePty } from "../lib/pty";
import { TerminalView } from "./TerminalView";

const terminal = vi.hoisted(() => ({
  handlers: new Map<number, (data: string) => boolean>(),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    parser = {
      registerOscHandler: (
        code: number,
        handler: (data: string) => boolean,
      ) => {
        terminal.handlers.set(code, handler);
        return { dispose: () => terminal.handlers.delete(code) };
      },
    };
    buffer = {
      active: { type: "normal", length: 0 },
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    write() {}
    dispose() {}
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
  },
}));
vi.mock("../hooks/useTerminalStatus", () => ({ useTerminalStatus: vi.fn() }));
vi.mock("../lib/pty", () => ({
  spawnPty: vi.fn(async () => undefined),
  killPty: vi.fn(async () => undefined),
  resizePty: vi.fn(async () => undefined),
  writePty: vi.fn(async () => undefined),
  subscribePty: vi.fn(() => () => {}),
}));
vi.mock("../lib/workspaceTransfers", () => ({
  terminalIsTransferred: () => false,
  readTerminalScreen: () => undefined,
  rememberTerminalScreen: vi.fn(),
}));

afterEach(() => {
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("answers CLI color queries with custom theme colors and follows live palette changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  // Shell overrides must win over the app-wide theme, as they do on screen.
  document.documentElement.style.setProperty(
    "--color-background-base",
    "#222222",
  );
  const style = host.style;
  style.setProperty("--color-content", "#ebedef");
  style.setProperty("--color-background-base", "#0b121a");
  style.setProperty("--color-accent", "#6cabdd");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(TerminalView, {
          id: "terminal-theme",
          cwd: "/repo",
          active: false,
        }),
      ),
    );
    expect(terminal.handlers.get(10)?.("rgb:0000/0000/0000")).toBe(false);
    expect(writePty).not.toHaveBeenCalled();
    await act(async () => {
      expect(terminal.handlers.get(10)?.("?")).toBe(true);
      expect(terminal.handlers.get(11)?.("?")).toBe(true);
      expect(terminal.handlers.get(12)?.("?")).toBe(true);
    });
    expect(vi.mocked(writePty).mock.calls.map(([, data]) => data)).toEqual([
      "\x1b]10;rgb:ebeb/eded/efef\x1b\\",
      "\x1b]11;rgb:0b0b/1212/1a1a\x1b\\",
      "\x1b]12;rgb:6c6c/abab/dddd\x1b\\",
    ]);

    // Query again without recreating the terminal after changing the palette.
    style.setProperty("--color-background-base", "rgb(245, 241, 230)");
    style.setProperty("--color-accent", "rgba(27, 107, 150, 0.7)");
    await act(async () => {
      terminal.handlers.get(11)?.("?");
      terminal.handlers.get(12)?.("?");
    });
    expect(writePty).toHaveBeenNthCalledWith(
      4,
      "terminal-theme",
      "\x1b]11;rgb:f5f5/f1f1/e6e6\x1b\\",
    );
    expect(writePty).toHaveBeenNthCalledWith(
      5,
      "terminal-theme",
      "\x1b]12;rgb:1b1b/6b6b/9696\x1b\\",
    );
    // happy-dom does not resolve CSS Color 4; supply the computed value a
    // browser produces for the shell's color-mix(in srgb, ...) surface.
    const computedStyle = getComputedStyle;
    vi.stubGlobal("getComputedStyle", (element: Element) =>
      element instanceof HTMLElement &&
      element.style.color === "var(--color-background-base)"
        ? ({ color: "color(srgb 0.2 0.4 0.6)" } as CSSStyleDeclaration)
        : computedStyle(element),
    );
    await act(async () => {
      terminal.handlers.get(11)?.("?");
    });
    expect(writePty).toHaveBeenNthCalledWith(
      6,
      "terminal-theme",
      "\x1b]11;rgb:3333/6666/9999\x1b\\",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(terminal.handlers.size).toBe(0);
});
