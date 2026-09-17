// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceHome } from "./WorkspaceHome";
import { projectKey } from "../lib/paths";
import { saveTabGroupLabel } from "../lib/tabGroups";

it("updates saved project names on Home while preserving navigation paths and session titles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const path = "/projects/original-folder";
  const onProject = vi.fn();
  saveTabGroupLabel(projectKey(path), "Personal workspace");
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceHome, {
          profile: "Personal",
          projects: [{ path, name: "original-folder" }],
          sessions: [
            {
              id: "session-id",
              title: "Original task title",
              project: "original-folder",
              cwd: path,
              harness: "codex",
            },
          ],
          onProject,
          onNew: vi.fn(),
          onBrowser: vi.fn(),
          onSession: vi.fn(),
          onAddProject: vi.fn(),
          onSearch: vi.fn(),
        }),
      ),
    );
    expect(container.textContent?.match(/Personal workspace/g)).toHaveLength(2);
    await act(async () =>
      saveTabGroupLabel(projectKey(path), "Updated workspace"),
    );
    expect(container.textContent?.match(/Updated workspace/g)).toHaveLength(2);
    expect(container.textContent).toContain("Original task title");
    const projectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Updated workspace",
    )!;
    await act(async () => projectButton.click());
    expect(onProject).toHaveBeenCalledExactlyOnceWith(path);
    await act(async () => saveTabGroupLabel(projectKey(path), ""));
    expect(container.textContent?.match(/original-folder/g)).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    saveTabGroupLabel(projectKey(path), "");
    container.remove();
    vi.unstubAllGlobals();
  }
});
