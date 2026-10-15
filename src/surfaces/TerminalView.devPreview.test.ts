// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  onData: undefined as ((data: Uint8Array) => void) | undefined,
  onExit: undefined as ((code: number | null) => void) | undefined,
  spawnPty: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn(),
}));
const status = vi.hoisted(() => ({
  report: undefined as ((foreground: string | null) => void) | undefined,
}));
const screen = vi.hoisted(() => ({ type: "normal" }));
vi.mock("../lib/pty", () => pty);
vi.mock("../hooks/useTerminalStatus", () => ({
  useTerminalStatus: (
    _id: string,
    _presented: boolean,
    _ready: unknown,
    onStatus: (foreground: string | null) => void,
  ) => {
    status.report = onStatus;
  },
}));
vi.mock("../lib/workspaceTransfers", () => ({
  terminalIsTransferred: () => false,
  readTerminalScreen: () => undefined,
  rememberTerminalScreen: vi.fn(),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = {
      active: screen,
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    focus() {}
    write() {}
    dispose() {}
    writeln() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
  },
}));
import { devPreviewsSnapshot, resetDevPreviews } from "../lib/devPreviews";
import { TerminalView } from "./TerminalView";

const encode = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  screen.type = "normal";
  resetDevPreviews();
  pty.subscribePty.mockImplementation(
    (
      _id: string,
      onData: (data: Uint8Array) => void,
      onExit: (code: number | null) => void,
    ) => {
      pty.onData = onData;
      pty.onExit = onExit;
      return () => {};
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetDevPreviews();
});

async function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "term-1",
        cwd: "/Users/me/site/web",
        active: true,
        onMetaChange: () => {},
        ...props,
      }),
    );
  });
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

it("offers the server a terminal starts, for the dock's project", async () => {
  const unmount = await mount({
    previewProject: "/Users/me/site",
    previewPlacement: "terminal",
  });
  pty.onData!(encode("\r\n  VITE v5.4.0  ready in 210 ms\r\n\r\n  ➜  Lo"));
  pty.onData!(encode("cal:   http://localhost:5173/\r\n"));
  expect(devPreviewsSnapshot()).toEqual([
    expect.objectContaining({
      project: "/Users/me/site",
      cwd: "/Users/me/site/web",
      url: "http://localhost:5173/",
      sourceId: "terminal:term-1",
      placement: "terminal",
      status: "live",
    }),
  ]);
  status.report!("node");
  status.report!(null);
  expect(devPreviewsSnapshot()[0].status).toBe("stale");
  await unmount();
});

it("marks the server stale when the shell exits or the terminal closes", async () => {
  let unmount = await mount();
  pty.onData!(
    encode("Starting development server at http://127.0.0.1:8000/\n"),
  );
  expect(devPreviewsSnapshot()[0]).toMatchObject({
    project: "/Users/me/site/web",
    placement: "chat",
    status: "live",
  });
  pty.onExit!(0);
  expect(devPreviewsSnapshot()[0].status).toBe("stale");
  await unmount();

  resetDevPreviews();
  unmount = await mount();
  pty.onData!(
    encode("Starting development server at http://127.0.0.1:8000/\n"),
  );
  await unmount();
  await act(async () => {});
  expect(pty.killPty).toHaveBeenCalled();
  expect(devPreviewsSnapshot()[0].status).toBe("stale");
});

it("ignores full-screen programs and setup shells", async () => {
  let unmount = await mount();
  screen.type = "alternate";
  pty.onData!(encode("  ➜  Local:   http://localhost:5173/\r\n"));
  expect(devPreviewsSnapshot()).toEqual([]);
  await unmount();
  screen.type = "normal";
  unmount = await mount({ ephemeral: true });
  pty.onData!(encode("  ➜  Local:   http://localhost:5173/\r\n"));
  expect(devPreviewsSnapshot()).toEqual([]);
  await unmount();
});
