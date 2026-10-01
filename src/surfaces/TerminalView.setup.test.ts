// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { killPty, spawnPty, writePty } from "../lib/pty";
import {
  readTerminalScreen,
  rememberTerminalScreen,
  terminalIsTransferred,
} from "../lib/workspaceTransfers";
import { TerminalView } from "./TerminalView";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = {
      active: {
        type: "normal",
        length: 1,
        getLine: () => ({ translateToString: () => "private login output" }),
      },
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    write() {}
    writeln() {}
    dispose() {}
    focus() {}
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
  terminalIsTransferred: vi.fn(() => false),
  readTerminalScreen: vi.fn(() => undefined),
  rememberTerminalScreen: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(spawnPty).mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const setup = (command?: string) =>
  createElement(TerminalView, {
    id: "provider-action",
    cwd: "~",
    active: true,
    ephemeral: true,
    setupCommand: command,
  });

it("executes an explicit setup command once under StrictMode and kills only its own shells", async () => {
  const ready: (() => void)[] = [];
  vi.mocked(spawnPty).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        ready.push(resolve);
      }),
  );
  await act(async () =>
    root.render(createElement(StrictMode, null, setup("codex login"))),
  );
  expect(spawnPty).toHaveBeenCalledTimes(2);
  const [discarded, live] = vi.mocked(spawnPty).mock.calls.map(([id]) => id);
  expect(discarded).not.toBe(live);
  expect(discarded).not.toBe("provider-action");
  expect(writePty).not.toHaveBeenCalled();

  // The replay shell can become ready before the discarded spawn returns.
  await act(async () => ready[1]());
  expect(writePty).toHaveBeenCalledExactlyOnceWith(live, "codex login\r");
  expect(killPty).not.toHaveBeenCalledWith(live);
  await act(async () => ready[0]());
  expect(writePty).toHaveBeenCalledTimes(1);
  expect(killPty).toHaveBeenCalledExactlyOnceWith(discarded);

  await act(async () => root.unmount());
  expect(vi.mocked(killPty).mock.calls.map(([id]) => id)).toEqual([
    discarded,
    live,
  ]);
});

it("never launches an action after its terminal closes during a pending spawn", async () => {
  let ready!: () => void;
  vi.mocked(spawnPty).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  await act(async () => root.render(setup("provider install")));
  const id = vi.mocked(spawnPty).mock.calls[0][0];
  await act(async () => root.unmount());
  expect(writePty).not.toHaveBeenCalled();
  await act(async () => ready());
  expect(writePty).not.toHaveBeenCalled();
  expect(killPty).toHaveBeenCalledExactlyOnceWith(id);
});

it("does not read, capture, remember or transfer a setup login screen", async () => {
  vi.mocked(terminalIsTransferred).mockReturnValue(true);
  await act(async () => root.render(setup("claude auth login")));
  const id = vi.mocked(spawnPty).mock.calls[0][0];
  window.dispatchEvent(new Event("workspace-transfer-capture"));
  await act(async () => root.unmount());
  expect(readTerminalScreen).not.toHaveBeenCalled();
  expect(rememberTerminalScreen).not.toHaveBeenCalled();
  expect(terminalIsTransferred).not.toHaveBeenCalled();
  expect(killPty).toHaveBeenCalledExactlyOnceWith(id);
  vi.mocked(terminalIsTransferred).mockReturnValue(false);
});

it("does not auto-execute anything without an explicit setup command", async () => {
  await act(async () => root.render(setup()));
  expect(spawnPty).toHaveBeenCalledTimes(1);
  expect(writePty).not.toHaveBeenCalled();
});

it.each(["", " \n ", "login\0token"])(
  "does not write an invalid setup command %j",
  async (command) => {
    await act(async () => root.render(setup(command)));
    expect(writePty).not.toHaveBeenCalled();
  },
);
