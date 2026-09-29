import { describe, expect, it } from "vitest";
import {
  addBrowserTab,
  browserIdForTab,
  closeBrowserTab,
  EMPTY_BROWSER,
} from "./personalWorkspace";
import { resolveBrowserTabTarget } from "./browserTabTarget";

const cwd = "/synthetic/project";
const first = { id: "first", url: "https://example.test/first" };
const second = { id: "second", url: "https://example.test/second" };
const workspace = addBrowserTab(addBrowserTab(EMPTY_BROWSER, first), second);

describe("browser action targets", () => {
  it("uses the active page only when no explicit target was supplied", () => {
    expect(resolveBrowserTabTarget(workspace, cwd)).toEqual(second);
    expect(
      resolveBrowserTabTarget(workspace, cwd, browserIdForTab(cwd, first.id)),
    ).toEqual(first);
  });

  it("does not retarget a delayed close after its original page has closed", () => {
    const closed = closeBrowserTab(workspace, second.id);
    expect(closed.activeTabId).toBe(first.id);
    expect(
      resolveBrowserTabTarget(closed, cwd, browserIdForTab(cwd, second.id)),
    ).toBeUndefined();
    expect(resolveBrowserTabTarget(closed, cwd)).toEqual(first);
  });

  it("rejects a surface from a different project even if its tab ID matches", () => {
    expect(
      resolveBrowserTabTarget(
        workspace,
        cwd,
        browserIdForTab("/synthetic/other", second.id),
      ),
    ).toBeUndefined();
  });

  it("does not treat an empty or unknown explicit surface as an active-page action", () => {
    expect(resolveBrowserTabTarget(workspace, cwd, "")).toBeUndefined();
    expect(resolveBrowserTabTarget(workspace, cwd, "missing")).toBeUndefined();
    expect(resolveBrowserTabTarget(EMPTY_BROWSER, cwd)).toBeUndefined();
  });
});
