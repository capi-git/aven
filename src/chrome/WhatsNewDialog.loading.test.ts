// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { loadBundledChangelog } from "../lib/releaseNotes";
import { WhatsNewBody } from "./WhatsNewDialog";

it("loads the real notes after mounting without briefly reporting them missing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(WhatsNewBody, { version: "0.1.71" })));
    expect(host.textContent).not.toContain("not available");
    await act(async () => {
      await loadBundledChangelog();
    });
    expect(host.querySelector(".whats-new-md")).not.toBeNull();
    expect(host.textContent?.trim()).not.toBe("");
    expect(host.textContent).not.toContain("## [0.1.71]");

    await act(async () =>
      root.render(createElement(WhatsNewBody, { version: "0.0.missing" })),
    );
    expect(host.textContent).toContain("not available in this build");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
