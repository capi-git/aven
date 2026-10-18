// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { discussionStore, resetDiscussionStore } from "../lib/discussions";
import { WorkspaceHome } from "./WorkspaceHome";

vi.mock("../chrome/ProjectMark", () => ({ ProjectMark: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

it("marks both chats of a discussion in Running now", async () => {
  const party = (sessionId: string, title: string) => ({
    sessionId,
    harness: "claude" as const,
    model: "Opus",
    title,
    cwd: "/projects/app",
  });
  const props: ComponentProps<typeof WorkspaceHome> = {
    profile: "Personal",
    needsYou: [],
    running: [
      { id: "a", title: "Caching", cwd: "/projects/app" },
      { id: "solo", title: "Solo", cwd: "/projects/app" },
    ],
    projects: [],
    recent: [],
    onNew: vi.fn(),
    onBrowser: vi.fn(),
    onSearch: vi.fn(),
    onProject: vi.fn(),
    onSession: vi.fn(),
    onAddProject: vi.fn(),
  };
  await act(async () => root.render(createElement(WorkspaceHome, props)));
  const titles = () =>
    [...container.querySelectorAll(".workspace-home-row")].map(
      (row) => row.textContent ?? "",
    );
  expect(titles().some((text) => text.includes("Discussing"))).toBe(false);
  await act(async () => {
    discussionStore().start({
      a: party("a", "Caching"),
      b: party("b", "Review"),
      topic: "Topic",
      rounds: 2,
    });
  });
  // The row says so in its line; its title stays the chat's own.
  expect(titles()[0]).toContain("Caching");
  expect(titles()[0]).toContain("app · Discussing");
  expect(titles()[1]).not.toContain("Discussing");
});
