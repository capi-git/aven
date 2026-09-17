// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSearch } from "./ProjectSearch";
import type { ProjectSearchResult } from "../lib/search";

const mocks = vi.hoisted(() => ({ searchProject: vi.fn() }));
vi.mock("../lib/search", () => ({ searchProject: mocks.searchProject }));
vi.mock("./FileTypeIcon", () => ({ FileTypeIcon: () => null }));

let root: Root;
let container: HTMLDivElement;
let props: Parameters<typeof ProjectSearch>[0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.searchProject.mockResolvedValue({ matches: [], truncated: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = { cwd: "/project", onOpenFile: vi.fn(), onClose: vi.fn() };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(ProjectSearch, props)));
}

function input() {
  return container.querySelector<HTMLInputElement>('[aria-label="Search"]')!;
}

async function query(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(), value,
    );
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function debounce() {
  await act(async () => vi.advanceTimersByTimeAsync(200));
}

function result(preview: string): ProjectSearchResult {
  return {
    matches: [{ path: "/project/file.ts", relative: "file.ts", line: 1, column: 1, preview }],
    truncated: false,
  };
}

describe("ProjectSearch retained sidebar lifecycle", () => {
  it("does not focus or intercept Escape while hidden and defers an explicit focus request", async () => {
    await render({ enabled: false, focusToken: 1 });
    expect(document.activeElement).not.toBe(input());
    const hiddenEscape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(hiddenEscape);
    expect(hiddenEscape.defaultPrevented).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();

    await render({ enabled: true });
    expect(document.activeElement).toBe(input());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(props.onClose).toHaveBeenCalledOnce();

    await render({ enabled: false });
    input().blur();
    await render({ enabled: true });
    expect(document.activeElement).not.toBe(input());
    await render({ focusToken: 2 });
    expect(document.activeElement).toBe(input());
  });

  it("cancels a pending debounce while hidden and resumes it when visible", async () => {
    await render();
    await query("needle");
    await render({ enabled: false });
    await debounce();
    expect(mocks.searchProject).not.toHaveBeenCalled();
    expect(input().value).toBe("needle");

    await render({ enabled: true });
    await debounce();
    expect(mocks.searchProject).toHaveBeenCalledOnce();
    expect(mocks.searchProject).toHaveBeenCalledWith(expect.objectContaining({ query: "needle" }));
  });

  it("retains settled results across a hover reopen without repeating the search", async () => {
    mocks.searchProject.mockResolvedValue(result("retained match"));
    await render();
    await query("match");
    await debounce();
    expect(container.textContent).toContain("retained match");

    await render({ enabled: false });
    expect(container.textContent).toContain("retained match");
    await render({ enabled: true });
    await debounce();
    expect(mocks.searchProject).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("retained match");
  });

  it("ignores an in-flight result after hiding and restarts only the interrupted request", async () => {
    let resolveOld!: (value: ProjectSearchResult) => void;
    mocks.searchProject
      .mockImplementationOnce(() => new Promise<ProjectSearchResult>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue(result("current result"));
    await render();
    await query("result");
    await debounce();
    expect(container.textContent).toContain("Searching…");
    await render({ enabled: false });
    await act(async () => resolveOld(result("stale result")));
    expect(container.textContent).not.toContain("stale result");
    expect(container.textContent).not.toContain("Searching…");

    await render({ enabled: true });
    await debounce();
    expect(mocks.searchProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("current result");
  });

  it("revalidates on a later reopen while retaining the previous results", async () => {
    mocks.searchProject
      .mockResolvedValueOnce(result("previous match"))
      .mockResolvedValue(result("updated match"));
    await render();
    await query("match");
    await debounce();
    await render({ enabled: false });
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(mocks.searchProject).toHaveBeenCalledOnce();

    await render({ enabled: true });
    expect(container.textContent).toContain("previous match");
    await debounce();
    expect(mocks.searchProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("updated match");
    expect(container.textContent).not.toContain("previous match");
  });

  it("retries a failed search on reopening without caching the error", async () => {
    mocks.searchProject
      .mockRejectedValueOnce(new Error("Search unavailable"))
      .mockResolvedValue(result("recovered match"));
    await render();
    await query("match");
    await debounce();
    expect(container.textContent).toContain("Search unavailable");
    await render({ enabled: false });
    await render({ enabled: true });
    await debounce();
    expect(mocks.searchProject).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("recovered match");
    expect(container.textContent).not.toContain("Search unavailable");
  });
});
