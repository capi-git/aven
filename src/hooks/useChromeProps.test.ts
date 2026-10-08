// @vitest-environment happy-dom
import { act, createElement, memo, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { equalChromeData, useChromeProps } from "./useChromeProps";

type Props = {
  rows: {
    id: string;
    cwd: string;
    harness: string;
    title: string;
    createdAt: number;
    updatedAt: number;
  }[];
  busy: Set<string>;
  onOpen: (id: string) => string;
  notifyOnLayout?: boolean;
};
const keys: readonly (keyof Props)[] = ["rows", "busy"];
let renders = 0;
let props: Props;
let rendered: Props;
let root: Root;
let host: HTMLElement;
const Pane = memo(function Pane(next: Props) {
  renders += 1;
  rendered = next;
  useLayoutEffect(() => {
    if (next.notifyOnLayout) next.onOpen(next.rows[0].id);
  });
  return createElement(
    "button",
    { onClick: () => next.onOpen(next.rows[0].id) },
    next.rows[0].title,
  );
});
function Harness() {
  return createElement(Pane, useChromeProps(props, keys));
}
const draw = () => act(async () => root.render(createElement(Harness)));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renders = 0;
  host = document.createElement("div");
  root = createRoot(host);
  props = {
    rows: [
      {
        id: "chat",
        cwd: "/one",
        harness: "codex",
        title: "Task",
        createdAt: 0,
        updatedAt: 1,
      },
    ],
    busy: new Set(["chat"]),
    onOpen: () => "/one",
  };
  await draw();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("skips chrome renders for repeated equivalent projections and still calls the latest action", async () => {
  for (let i = 0; i < 30; i++) {
    props = {
      ...props,
      rows: props.rows.map((row) => ({ ...row, updatedAt: i + 2 })),
      busy: new Set(["chat"]),
      onOpen: () => `/latest-${i}`,
    };
    await draw();
  }
  expect(renders).toBe(1);
  expect(rendered.onOpen("chat")).toBe("/latest-29");
});

it("rerenders for title, busy, project and persisted history timestamp changes", async () => {
  props = { ...props, rows: [{ ...props.rows[0], title: "Renamed" }] };
  await draw();
  expect(host.textContent).toBe("Renamed");
  props = { ...props, busy: new Set() };
  await draw();
  props = { ...props, rows: [{ ...props.rows[0], cwd: "/two" }] };
  await draw();
  props = {
    ...props,
    rows: [{ ...props.rows[0], createdAt: 10, updatedAt: 11 }],
  };
  await draw();
  props = { ...props, rows: [{ ...props.rows[0], updatedAt: 12 }] };
  await draw();
  expect(renders).toBe(6);
});

it("publishes changed actions before child layout effects run", async () => {
  const current = vi.fn(() => "current");
  props = { ...props, onOpen: current, notifyOnLayout: true };
  await draw();
  expect(current).toHaveBeenCalledExactlyOnceWith("chat");
});

it("does not consider reordered rows or changed nested callback data equivalent", () => {
  expect(equalChromeData([1, 2], [2, 1])).toBe(false);
  expect(equalChromeData({ action: () => 1 }, { action: () => 2 })).toBe(false);
  expect(equalChromeData({ removed: undefined }, {})).toBe(false);
});
