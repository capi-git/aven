// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repo: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../lib/githubTasks", () => ({
  githubRepo: mocks.repo,
  listGithubWorkItems: mocks.list,
}));

import { resetGithubRepos } from "../hooks/useGithubRepo";
import {
  addFeatureIdea,
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "../lib/featureCards";
import { BoardIssueImport } from "./BoardIssueImport";

const PROJECT = "/work/site";
let root: Root;
let container: HTMLDivElement;

const issue = (number: number, title: string) => ({
  kind: "issue" as const,
  number,
  title,
  url: `https://github.com/o/site/issues/${number}`,
  state: "OPEN",
  updatedAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
  repo: "o/site",
});

async function settle() {
  await act(async () => {
    for (let round = 0; round < 4; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () =>
    root.render(
      createElement(BoardIssueImport, { project: PROJECT, visible: true }),
    ),
  );
  await settle();
}

const importButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Import issues",
  );
const panel = () => document.querySelector<HTMLElement>("[data-board-import]");
const buttonIn = (scope: Element, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === name,
  )!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGithubRepos();
  mocks.repo.mockReset().mockResolvedValue("o/site");
  mocks.list
    .mockReset()
    .mockResolvedValue([
      issue(12, "Dark mode"),
      issue(14, "Export to CSV"),
      issue(15, "Keyboard shortcuts"),
    ]);
  setFeatureCardBackend(memoryFeatureCardBackend());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setFeatureCardBackend(null);
  vi.unstubAllGlobals();
});

describe("Import issues", () => {
  it("adds the open issues picked as ideas, each linked to its issue", async () => {
    await addFeatureIdea(PROJECT, {
      title: "Dark mode",
      sourceUrl: "https://github.com/o/site/issues/12",
    });
    await render();
    await act(async () => importButton()!.click());
    await settle();
    expect(mocks.list).toHaveBeenCalledWith(PROJECT, {
      kind: "issue",
      assignedToMe: false,
      state: "open",
      search: "",
    });
    const list = panel()!;
    const rows = [...list.querySelectorAll("label")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "#12Dark modeOn the board",
      "#14Export to CSV",
      "#15Keyboard shortcuts",
    ]);
    // One already on the board can't be picked again.
    expect(rows[0].querySelector("input")!.disabled).toBe(true);
    await act(async () => rows[1].querySelector("input")!.click());
    await act(async () => buttonIn(list, "Add 1 idea").click());
    await settle();
    expect(panel()).toBeNull();
    expect(
      featureBoardState(PROJECT).cards.map((card) => [
        card.title,
        card.sourceUrl,
      ]),
    ).toEqual([
      ["Dark mode", "https://github.com/o/site/issues/12"],
      ["Export to CSV", "https://github.com/o/site/issues/14"],
    ]);
  });

  it("says plainly when the issues can't be loaded", async () => {
    mocks.list.mockRejectedValue("gh: not logged in");
    await render();
    await act(async () => importButton()!.click());
    await settle();
    expect(panel()?.textContent).toContain(
      "Couldn't load issues: gh: not logged in",
    );
  });

  it("is not offered for a project that isn't on GitHub", async () => {
    mocks.repo.mockRejectedValue("no GitHub remote");
    await render();
    expect(importButton()).toBeUndefined();
  });
});
