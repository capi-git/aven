// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  hasWorkspaceOverlay,
  workspaceShortcutDisposition,
} from "./workspaceKeyboard";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workspace keyboard ownership", () => {
  it("does not mutate background panes from a dialog or popup", () => {
    for (const command of [
      "close",
      "close-others",
      "split-right",
      "activate-1",
      "focus-left",
      "new",
      "new-terminal",
      "reopen",
      "back",
    ]) {
      expect(
        workspaceShortcutDisposition(command, {
          overlay: true,
          utility: false,
          workspace: true,
        }),
      ).toBe("block");
    }
  });
  it("closes a covering utility before its underlying pane", () => {
    expect(
      workspaceShortcutDisposition("close", {
        overlay: false,
        utility: true,
        workspace: false,
      }),
    ).toBe("dismiss-utility");
    expect(
      workspaceShortcutDisposition("close", {
        overlay: false,
        utility: false,
        workspace: true,
      }),
    ).toBe("run");
    expect(
      workspaceShortcutDisposition("close", {
        overlay: true,
        utility: true,
        workspace: false,
      }),
    ).toBe("block");
  });
  it("keeps navigation and new-work entry points available on Home", () => {
    for (const command of ["new", "back", "open_search"]) {
      expect(
        workspaceShortcutDisposition(command, {
          overlay: false,
          utility: false,
          workspace: false,
        }),
      ).toBe("run");
    }
    expect(
      workspaceShortcutDisposition("split-down", {
        overlay: false,
        utility: false,
        workspace: false,
      }),
    ).toBe("block");
  });
  it("ignores hidden overlays but recognizes a visible owning dialog", () => {
    document.body.innerHTML =
      '<div hidden><div role="dialog" aria-modal="true"></div></div><div style="display:none"><div data-popover-side="bottom"></div></div>';
    expect(hasWorkspaceOverlay()).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(hasWorkspaceOverlay()).toBe(true);
  });
});
