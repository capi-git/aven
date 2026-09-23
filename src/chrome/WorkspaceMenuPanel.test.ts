// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceMenuPanelContent } from "./WorkspaceMenuPanel";

it("focuses enabled actions and navigates past unavailable destinations", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(WorkspaceMenuPanelContent, {
          snapshot: {
            title: "Open workspace",
            theme: {
              mode: "light",
              background: "#faf4e6",
              accent: "#8f6b25",
              text: "#181818",
            },
            items: [
              { id: "editor", label: "Editor" },
              { id: "folder", label: "Folder", disabled: true },
              { id: "terminal", label: "Terminal" },
            ],
          },
          onSelect: select,
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.activeElement?.textContent).toBe("Editor");
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement?.textContent).toBe("Terminal");
    await act(async () =>
      (document.activeElement as HTMLButtonElement).click(),
    );
    expect(select).toHaveBeenCalledExactlyOnceWith("terminal");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
