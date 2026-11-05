import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the top row beside a pinned sidebar", () => {
  it("starts the tabs after its buttons when the sidebar leaves too little room", () => {
    const css = readFileSync("src/chrome/WorkspaceStatusBar.css", "utf8");
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
