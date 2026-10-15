// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectKey } from "../lib/paths";
import {
  TAB_GROUP_COLORS,
  saveTabGroupColor,
  tabGroupColor,
} from "../lib/tabGroups";
import { useProjectAppearance } from "./useProjectAppearance";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";
let root: Root;
let host: HTMLDivElement;
let data: Map<string, string>;
const renders: Record<string, number> = {};

function Probe({ path }: { path: string }) {
  const look = useProjectAppearance(path);
  renders[path] = (renders[path] ?? 0) + 1;
  return createElement("span", { "data-path": path }, look?.color ?? "none");
}

beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const key of Object.keys(renders)) delete renders[key];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const text = (path: string) =>
  host.querySelector(`[data-path="${path}"]`)?.textContent;

it("updates only the marks of the project that changed", async () => {
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Probe, { path: APP }),
        createElement(Probe, { path: SITE }),
      ),
    ),
  );
  expect(renders).toEqual({ [APP]: 1, [SITE]: 1 });

  await act(async () => saveTabGroupColor(projectKey(APP), 6));
  expect(text(APP)).toBe(TAB_GROUP_COLORS[6]);
  expect(renders).toEqual({ [APP]: 2, [SITE]: 1 });

  // Another window (the floating sidebar) saves; this one follows.
  await act(async () => {
    data.set(
      "monocode:tab-group:colors",
      JSON.stringify({ [projectKey(SITE)]: "3" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "monocode:tab-group:colors" }),
    );
  });
  expect(text(SITE)).toBe(TAB_GROUP_COLORS[3]);
  // That write replaced the whole record, so App is back to its own colour.
  expect(text(APP)).toBe(tabGroupColor("app"));
});

it("has no appearance for home", async () => {
  await act(async () => root.render(createElement(Probe, { path: "~" })));
  expect(text("~")).toBe("none");
});
