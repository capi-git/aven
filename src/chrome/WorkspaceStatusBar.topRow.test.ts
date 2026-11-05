import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the top row beside a pinned sidebar", () => {
  const css = readFileSync("src/chrome/WorkspaceStatusBar.css", "utf8");

  it("sizes the tabs with the interface scale, not the row's native points", () => {
    const from = css.slice(css.indexOf(".workspace-status-strip {"));
    expect(from.slice(0, from.indexOf("}"))).toContain(
      "zoom: calc(1 / var(--aven-toolbar-zoom, 1));",
    );
  });

  it("starts the tabs after its buttons when the sidebar leaves too little room", () => {
    const from = css.slice(
      css.indexOf(
        '.personal-shell[data-sidebar-pinned="true"] .workspace-navigation {',
      ),
    );
    expect(from.slice(0, from.indexOf("}"))).toContain(
      "min-width: min-content;",
    );
  });
});
