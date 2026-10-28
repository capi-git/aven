import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sheets: every dialog centred over the workspace is the popup's solid
 * material with the 12px sheet corner, over the same scrim, titled at the
 * sheet size, and springs in like a popover.
 */
const read = (file: string) => readFileSync(file, "utf8");

function rule(file: string, selector: string) {
  const css = read(file);
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing ${selector} in ${file}`);
  return css.slice(at, css.indexOf("}", at));
}

const tracked = (pattern: string) =>
  execFileSync("git", ["ls-files", pattern], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

describe("sheets", () => {
  it("share one material: the popup, its edge and the sheet corner", () => {
    for (const [file, selector] of [
      ["src/macos-theme.css", ".aven-sheet"],
      ["src/chrome/Overlays.css", '.modal-panel[role="dialog"]'],
    ]) {
      const body = rule(file, selector);
      expect(body).toContain("border-radius: var(--aven-radius-sheet);");
      expect(body).toContain("background: var(--aven-popup);");
      expect(body).toContain(
        "border: 1px solid var(--aven-glass-overlay-edge);",
      );
      expect(body).toContain(
        "box-shadow: var(--aven-specular), var(--aven-shadow);",
      );
    }
    expect(read("src/motion.css")).toMatch(
      /\.modal-panel,\n\.aven-sheet,\n\.discussion-float \{\n\s*animation: aven-pop/,
    );
  });

  it("titles every sheet at the sheet size", () => {
    expect(read("src/index.css")).toContain("--text-ui-sheet: 15px;");
    for (const [file, selector] of [
      ["src/chrome/Overlays.css", '.modal-panel[role="dialog"] > header h2'],
      ["src/chrome/WorkspaceActionDialog.css", ".workspace-action-dialog h2"],
    ])
      expect(rule(file, selector)).toContain(
        "font-size: var(--text-ui-sheet);",
      );
    for (const file of [
      "src/chrome/ProjectMemoryDialog.tsx",
      "src/chrome/SwitchBranchDialog.tsx",
      "src/chrome/RemoveProjectDialog.tsx",
    ])
      expect(read(file)).toMatch(
        /<h2 className="[^"]*text-ui-sheet font-semibold/,
      );
  });

  it("draws every modal dialog as a sheet over a 40% scrim", () => {
    // A coach mark, the image viewer and the floating sidebar are modal
    // without being sheets.
    const notSheets = new Set([
      "src/chrome/Tour.tsx",
      "src/surfaces/ImageViewer.tsx",
      "src/surfaces/FloatingSidebarWindow.tsx",
      "src/chrome/Modal.tsx",
    ]);
    const modal = tracked("src/*.tsx").filter(
      (file) =>
        !file.includes(".test.") &&
        !notSheets.has(file) &&
        read(file).includes('aria-modal="true"'),
    );
    expect(modal.length).toBeGreaterThan(4);
    for (const file of modal) {
      const source = read(file);
      expect(source, file).toMatch(/aven-sheet|modal-panel/);
      expect(source, file).not.toContain("bg-black/30");
    }
    expect(read("src/chrome/Modal.tsx")).toContain(
      "modal-backdrop absolute inset-0 bg-black/40",
    );
    expect(
      rule("src/chrome/WorkspaceActionDialog.css", ".workspace-dialog-shade"),
    ).toContain("background: rgb(0 0 0 / 40%);");
  });

  it("closes from the same quiet 28px button in a sheet and a panel", () => {
    expect(
      rule(
        "src/chrome/Overlays.css",
        '.modal-panel[role="dialog"] > header button',
      ),
    ).toMatch(/width: 28px;\s*height: 28px;/);
    expect(
      rule(
        "src/chrome/WorkspaceActionDialog.css",
        ".workspace-action-dialog header button",
      ),
    ).toMatch(/width: 28px;\s*height: 28px;/);
    expect(
      rule("src/chrome/ToolbarPanel.css", ".toolbar-panel-icon-button"),
    ).toMatch(/width: 28px;\s*height: 28px;/);
    // The same 14px cross everywhere.
    expect(read("src/chrome/Modal.tsx")).toContain(
      '<X className="size-3.5" strokeWidth={1.75} />',
    );
    expect(read("src/chrome/ToolbarPanel.tsx")).toContain(
      "<X size={14} strokeWidth={1.75} />",
    );
    expect(read("src/chrome/WorkspaceActionDialog.tsx")).toContain(
      '<X className="size-3.5" strokeWidth={1.75} />',
    );
  });
});
