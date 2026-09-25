import { expect, it, vi } from "vitest";
import {
  applyBrowserUpdateStates,
  browserUpdatePaused,
  pauseBrowsersForUpdate,
  registerBrowserUpdatePage,
  subscribeBrowserUpdate,
} from "./browserUpdateState";
import type { BrowserState } from "./browser";

const state = (id: string): BrowserState => ({
  id,
  url: "https://example.com/latest",
  title: "Latest title",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  notice: null,
});

it("commits the native snapshot only when every page has a restore owner", () => {
  const receive = vi.fn();
  const unregister = registerBrowserUpdatePage("known", receive);
  try {
    expect(() =>
      applyBrowserUpdateStates([state("known"), state("missing")]),
    ).toThrow("still opening");
    expect(receive).not.toHaveBeenCalled();
    applyBrowserUpdateStates([state("known")]);
    expect(receive).toHaveBeenCalledExactlyOnceWith(state("known"));
  } finally {
    unregister();
  }
});

it("keeps browsers paused until every update input lock releases", () => {
  const changed = vi.fn();
  const unsubscribe = subscribeBrowserUpdate(changed);
  const first = pauseBrowsersForUpdate();
  const second = pauseBrowsersForUpdate();
  expect(browserUpdatePaused()).toBe(true);
  first();
  first();
  expect(browserUpdatePaused()).toBe(true);
  second();
  expect(browserUpdatePaused()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
});
