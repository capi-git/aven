// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserTabIcon } from "./BrowserTabIcon";
import { browserFavicon, BROWSER_FALLBACK_ICON } from "../lib/browserIcons";
import {
  EMPTY_BROWSER,
  addBrowserTab,
  normalizeBrowserWorkspace,
  updateBrowserTab,
} from "../lib/personalWorkspace";

const png = "data:image/png;base64,iVBORw0KGgo=";
it("shows the site icon and falls back to Aven when it cannot render", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () =>
      root.render(createElement(BrowserTabIcon, { favicon: png })),
    );
    expect(element.querySelector("img")?.getAttribute("src")).toBe(png);
    element.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(element.querySelector("img")?.getAttribute("src")).toBe(
      BROWSER_FALLBACK_ICON,
    );
    await act(async () => root.render(createElement(BrowserTabIcon, {})));
    expect(element.querySelector("img")?.getAttribute("src")).toBe(
      BROWSER_FALLBACK_ICON,
    );
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it.each([
  "https://example.com/icon.png",
  "file:///private/icon.png",
  "data:image/svg+xml,<svg/>",
  "data:image/png;base64," + "A".repeat(32768),
])("rejects untrusted or oversized chrome images: %s", (value) => {
  expect(browserFavicon(value)).toBeUndefined();
});
it("retains the cached favicon on restore and clears it when the page changes", () => {
  const workspace = addBrowserTab(EMPTY_BROWSER, {
    id: "page",
    url: "https://example.com",
    favicon: png,
  });
  expect(
    normalizeBrowserWorkspace(JSON.parse(JSON.stringify(workspace))).tabs[0]
      .favicon,
  ).toBe(png);
  expect(
    updateBrowserTab(workspace, "page", {
      url: "https://example.com/docs#section",
    }).tabs[0].favicon,
  ).toBe(png);
  expect(
    updateBrowserTab(workspace, "page", { url: "https://other.example" })
      .tabs[0].favicon,
  ).toBeUndefined();
  expect(
    updateBrowserTab(workspace, "page", { favicon: "" }).tabs[0].favicon,
  ).toBeUndefined();
});
