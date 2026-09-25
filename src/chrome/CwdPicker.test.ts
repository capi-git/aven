// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CwdPicker } from "./CwdPicker";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("takes the keyboard when opened with the mouse, so Enter picks a project", async () => {
  const onCwdChange = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(CwdPicker, {
        cwd: "/work/site",
        recents: [
          { path: "/work/site", openedAt: 3 },
          { path: "/work/api", openedAt: 2 },
          { path: "/work/docs", openedAt: 1 },
        ],
        onCwdChange,
        onClose,
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    trigger.click();
  });
  const menu = document.body.querySelector<HTMLElement>("[data-cwd-picker]")!;
  expect(menu.contains(document.activeElement)).toBe(true);
  const key = (name: string) =>
    act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await key("ArrowDown");
  await key("Enter");
  expect(onCwdChange).toHaveBeenCalledWith("/work/docs");
  expect(onClose).toHaveBeenCalled();
});
