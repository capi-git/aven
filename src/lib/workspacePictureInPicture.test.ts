// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, type LayoutNode } from "./layout";
import {
  groupPictureInPictureWindows,
  useBrowserPipRequests,
  workspacePipGroupTargets,
} from "./workspacePictureInPicture";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const split = (id: string, children: LayoutNode[]): LayoutNode => ({
  type: "split",
  id,
  dir: "right",
  children,
  sizes: children.map(() => 1 / children.length),
});

describe("whole-group Picture in Picture targets", () => {
  it("keeps tab order and includes every nested session without duplicating repeated group members", () => {
    expect(
      workspacePipGroupTargets(
        ["docs", "sessions", "preview", "sessions", "last"],
        [
          { id: "last", layout: leaf("s4") },
          {
            id: "sessions",
            layout: split("outer", [
              leaf("s1"),
              split("inner", [leaf("s2"), leaf("s3")]),
            ]),
          },
        ],
        new Set(["s4", "s3", "s2", "s1"]),
        [
          { surfaceId: "preview", url: "http://localhost:3000/" },
          { surfaceId: "docs", url: "https://example.com/docs" },
        ],
      ),
    ).toEqual([
      { kind: "browser", id: "docs", surfaceId: "docs" },
      { kind: "session", id: "s1", surfaceId: "sessions" },
      { kind: "session", id: "s2", surfaceId: "sessions" },
      { kind: "session", id: "s3", surfaceId: "sessions" },
      { kind: "browser", id: "preview", surfaceId: "preview" },
      { kind: "session", id: "s4", surfaceId: "last" },
    ]);
  });

  it.each(["file", "terminal"])(
    "rejects an entire mixed %s group instead of silently dropping its unsupported pane",
    (unsupported) => {
      expect(
        workspacePipGroupTargets(
          ["sessions", "docs"],
          [
            {
              id: "sessions",
              layout: split("mixed", [leaf("s1"), leaf(unsupported)]),
            },
          ],
          new Set(["s1"]),
          [{ surfaceId: "docs", url: "https://example.com/" }],
        ),
      ).toBeNull();
    },
  );

  it("rejects missing members and empty browser pages before opening any windows", () => {
    const tabs = [{ id: "session", layout: leaf("s1") }];
    const sessions = new Set(["s1"]);
    expect(
      workspacePipGroupTargets(["session", "removed"], tabs, sessions, []),
    ).toBeNull();
    expect(
      workspacePipGroupTargets(["session", "blank"], tabs, sessions, [
        { surfaceId: "blank", url: "   " },
      ]),
    ).toBeNull();
    expect(workspacePipGroupTargets([], tabs, sessions, [])).toBeNull();
    expect(
      workspacePipGroupTargets(["session"], tabs, sessions, []),
    ).toBeNull();
  });

  it("allows all sessions inside a single split tab to form a complete group", () => {
    expect(
      workspacePipGroupTargets(
        ["sessions"],
        [{ id: "sessions", layout: split("pair", [leaf("s2"), leaf("s1")]) }],
        new Set(["s1", "s2"]),
        [],
      ),
    ).toEqual([
      { kind: "session", id: "s2", surfaceId: "sessions" },
      { kind: "session", id: "s1", surfaceId: "sessions" },
    ]);
  });

  it("passes the exact ordered native labels and selected member to native grouping", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await groupPictureInPictureWindows(
      ["pip-session-a", "preview-float-b"],
      "preview-float-b",
    );
    expect(invoke).toHaveBeenLastCalledWith("pip_group_windows", {
      labels: ["pip-session-a", "preview-float-b"],
      selectedLabel: "preview-float-b",
    });
    invoke.mockRejectedValueOnce(new Error("A member closed"));
    await expect(groupPictureInPictureWindows(["a", "b"], "a")).rejects.toThrow(
      "A member closed",
    );
  });
});

describe("explicit floating browser requests", () => {
  let element: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useBrowserPipRequests>;
  let unmounted: boolean;
  function Harness() {
    api = useBrowserPipRequests();
    return null;
  }
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    element = document.createElement("div");
    document.body.append(element);
    root = createRoot(element);
    unmounted = false;
    await act(async () => root.render(createElement(Harness)));
  });
  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
    element.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deduplicates pending requests per page while allowing other members to open independently", async () => {
    let first!: Promise<string>,
      duplicate!: Promise<string>,
      other!: Promise<string>;
    await act(async () => {
      first = api.request("first");
      duplicate = api.request("first");
      other = api.request("other");
    });
    expect(duplicate).toBe(first);
    expect(other).not.toBe(first);
    expect(Object.keys(api.requests)).toEqual(["first", "other"]);
    expect(api.requests.first).not.toBe(api.requests.other);
    await act(async () =>
      api.complete("other", api.requests.other, "other-label"),
    );
    await expect(other).resolves.toBe("other-label");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () =>
      api.complete("first", api.requests.first, "first-label"),
    );
    await expect(first).resolves.toBe("first-label");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a stalled request and ignores its late result after an explicit retry", async () => {
    let first!: Promise<string>;
    await act(async () => {
      first = api.request("page");
    });
    const originalToken = api.requests.page;
    const timedOut = expect(first).rejects.toThrow(
      "could not open its floating window",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    await timedOut;
    let retry!: Promise<string>;
    await act(async () => {
      retry = api.request("page");
    });
    const settled = vi.fn();
    void retry.then(settled);
    expect(api.requests.page).toBeGreaterThan(originalToken);
    await act(async () => api.complete("page", originalToken, "stale-window"));
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () =>
      api.complete("page", api.requests.page, "current-window"),
    );
    await expect(retry).resolves.toBe("current-window");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [null, "Native popout failed", "Native popout failed"],
    [null, undefined, "floating browser window is unavailable"],
  ])(
    "rejects an unsuccessful completion and permits a fresh request",
    async (label, error, expected) => {
      let pending!: Promise<string>;
      await act(async () => {
        pending = api.request("page");
      });
      const token = api.requests.page;
      const rejected = expect(pending).rejects.toThrow(expected!);
      await act(async () => api.complete("page", token, label, error));
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      let retry!: Promise<string>;
      await act(async () => {
        retry = api.request("page");
      });
      expect(api.requests.page).toBeGreaterThan(token);
      await act(async () =>
        api.complete("page", api.requests.page, "retry-window"),
      );
      await expect(retry).resolves.toBe("retry-window");
    },
  );

  it("rejects every outstanding member and clears its deadline when the workspace closes", async () => {
    let first!: Promise<string>, second!: Promise<string>;
    await act(async () => {
      first = api.request("first");
      second = api.request("second");
    });
    const rejected = [first, second].map((promise) =>
      expect(promise).rejects.toThrow("workspace closed"),
    );
    await act(async () => {
      root.unmount();
      unmounted = true;
    });
    await Promise.all(rejected);
    expect(vi.getTimerCount()).toBe(0);
  });
});
