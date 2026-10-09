// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isWindowActive, subscribeWindowActivity } from "./windowActivity";

const native = vi.hoisted(() => ({ listen: vi.fn(), focused: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: native.listen,
    isFocused: native.focused,
  }),
}));
let cleanups: (() => void)[];
let hidden = false;
function subscribe(listener = vi.fn()) {
  const cleanup = subscribeWindowActivity(listener);
  cleanups.push(cleanup);
  return cleanup;
}
beforeEach(() => {
  vi.clearAllMocks();
  cleanups = [];
  hidden = false;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("tracks web-preview focus and visibility and removes listeners", () => {
  const listener = vi.fn();
  const cleanup = subscribe(listener);
  expect(isWindowActive()).toBe(true);
  window.dispatchEvent(new Event("blur"));
  expect(isWindowActive()).toBe(false);
  window.dispatchEvent(new Event("focus"));
  expect(isWindowActive()).toBe(true);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(isWindowActive()).toBe(false);
  expect(listener).toHaveBeenCalledTimes(3);
  cleanup();
  window.dispatchEvent(new Event("blur"));
  expect(listener).toHaveBeenCalledTimes(3);
});
it("shares native window focus and ignores DOM blur when CEF takes keyboard focus", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  let focus!: (event: { payload: boolean }) => void;
  let initial!: (focused: boolean) => void;
  const off = vi.fn();
  native.listen.mockImplementation((callback) => {
    focus = callback;
    return Promise.resolve(off);
  });
  native.focused.mockImplementation(
    () =>
      new Promise((resolve) => {
        initial = resolve;
      }),
  );
  const first = subscribe();
  const second = subscribe();
  expect(native.listen).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("blur"));
  expect(isWindowActive()).toBe(true);
  focus({ payload: false });
  expect(isWindowActive()).toBe(false);
  initial(true);
  await Promise.resolve();
  expect(isWindowActive()).toBe(false);
  focus({ payload: true });
  expect(isWindowActive()).toBe(true);
  first();
  expect(off).not.toHaveBeenCalled();
  second();
  expect(off).toHaveBeenCalledOnce();
});
it("disposes a delayed native registration and ignores old focus reads after remount", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  let register!: (off: () => void) => void;
  let initial!: (focused: boolean) => void;
  native.listen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        register = resolve;
      }),
  );
  native.focused.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        initial = resolve;
      }),
  );
  const cleanup = subscribe();
  cleanup();
  native.listen.mockResolvedValue(vi.fn());
  native.focused.mockResolvedValue(true);
  subscribe();
  const oldOff = vi.fn();
  register(oldOff);
  initial(false);
  await Promise.resolve();
  expect(oldOff).toHaveBeenCalledOnce();
  expect(isWindowActive()).toBe(true);
});
