// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";

const fileMocks = vi.hoisted(() => ({
  peek: vi.fn((cwd: string) =>
    cwd === "/first"
      ? [{ path: "/first/alpha.ts", relative: "alpha.ts", name: "alpha.ts" }]
      : null,
  ),
  load: vi.fn(
    async () => [] as { path: string; relative: string; name: string }[],
  ),
}));

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));
vi.mock("../lib/fileIndex", () => ({
  peekProjectFiles: fileMocks.peek,
  loadProjectFiles: fileMocks.load,
  rankProjectFiles: (
    files: { path: string; relative: string; name: string }[],
  ) => files.map((file) => ({ ...file, score: 1, positions: [] })),
  recentOpenedFiles: () => [],
}));
vi.mock("../lib/search", () => ({
  searchProject: async ({ query }: { query: string }) => ({
    matches:
      query === "alpha"
        ? [
            {
              path: "/project/alpha.ts",
              relative: "alpha.ts",
              line: 1,
              column: 1,
              preview: "alpha",
            },
          ]
        : [],
    truncated: false,
  }),
}));
vi.mock("../lib/sessionStore", () => ({
  searchSessions: async () => ({ hits: [] }),
}));

it("does not open an old search hit while the next query is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpenFile = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(SearchView, {
          open: true,
          cwd: "/project",
          recents: [],
          history: [],
          sessions: [],
          onClose: vi.fn(),
          onOpenFile,
          onOpenSession: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
    const input = container.querySelector(
      'input[aria-label="Search"]',
    )! as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "alpha");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 230));
    });
    expect(container.textContent).toContain("alpha.ts");

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "beta");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("alpha.ts");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onOpenFile).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("drops prior-project file hits while the next project index loads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const base = {
    open: true,
    recents: [],
    history: [],
    sessions: [],
    onClose: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenProject: vi.fn(),
  };
  try {
    fileMocks.load.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () =>
      root.render(createElement(SearchView, { ...base, cwd: "/first" })),
    );
    const input = container.querySelector(
      'input[aria-label="Search"]',
    )! as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "alpha");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("alpha.ts");
    fileMocks.load.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () =>
      root.render(createElement(SearchView, { ...base, cwd: "/second" })),
    );
    expect(container.textContent).not.toContain("alpha.ts");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    fileMocks.load.mockReset();
    fileMocks.load.mockImplementation(async () => []);
  }
});

it("lets a nested dialog handle Escape before closing Search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  try {
    await act(async () =>
      root.render(
        createElement(SearchView, {
          open: true,
          cwd: "/project",
          recents: [],
          history: [],
          sessions: [],
          onClose,
          onOpenFile: vi.fn(),
          onOpenSession: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
    container.append(dialog);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    dialog.remove();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    dialog.remove();
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
