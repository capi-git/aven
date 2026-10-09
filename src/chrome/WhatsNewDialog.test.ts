import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatsNewBody } from "./WhatsNewDialog";
import { loadBundledChangelog } from "../lib/releaseNotes";

describe("WhatsNewBody", () => {
  it("renders the version notes without the changelog heading once loaded", async () => {
    await loadBundledChangelog();
    const markup = renderToStaticMarkup(
      createElement(WhatsNewBody, { version: "0.1.71" }),
    );

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain("What&#x27;s new in Aven 0.1.71");
    expect(markup).not.toContain("## [0.1.71]");
  });
});
